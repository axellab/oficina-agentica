/**
 * Change triggers (CONTEXT.md "Change trigger"): the office itself watches the
 * Directories the user's triggers.json names, and starts a Workflow run for
 * the commits it has not handed to a run yet.
 *
 * - **Nothing is installed.** No git hook, no file in the repository: the
 *   office asks the checkout where it stands every few seconds (changeGit.ts)
 *   and compares. A change is new commits on the branch that is checked out:
 *   a commit, a pull, a merge.
 * - **The watch begins where the checkout stands.** What is there when the
 *   office starts watching (it started, a pause ended, another branch was
 *   checked out) is not a change: only what lands after it is. Memory only.
 * - **Commits that come together are one change.** A run starts once the
 *   newest commit has stood for the trigger's `settleSeconds`, for everything
 *   since the last commit handed to a run.
 * - **One run per Directory at a time.** While the run a trigger started is
 *   still in the office (finished or not: its report is in its lead's
 *   terminal), later commits wait and are reviewed together afterwards. With
 *   the hourly cap, this is what bounds what a trigger spends, and what keeps
 *   a run that commits from starting the next one for ever.
 * - **Nothing the repository says reaches a request.** A run is started with
 *   commit names and the paths the change touches; the paths only decide
 *   which stages run (workflows.ts `startForChange`).
 *
 * The rules alone: what is watched is the user's file, git is asked through
 * `git`, and a run is started through `start`, all handed in.
 */

import type { ChangeTriggerDefinition } from '../../../core/src/changeTriggers.js';
import type {
  WorkflowChangeTrigger,
  WorkflowChangeTriggerState,
} from '../../../core/src/messages.js';
import { nameSelector, pathSelected } from '../../../core/src/pathGlobs.js';
import {
  CHANGE_TRIGGER_POLL_MS,
  CHANGE_TRIGGER_RATE_WINDOW_MS,
  CHANGE_TRIGGER_RETRY_MS,
} from '../constants.js';
import type { ChangeSince, CheckoutHead } from './changeGit.js';

const LOG_PREFIX = '[Pixel Agents] Change triggers:';

export interface ChangeTriggersDeps {
  /** The user's triggers.json as it stands now. */
  definitions(): readonly ChangeTriggerDefinition[];
  /** The folder a trigger's `directory` names, and what the office calls it. */
  resolve(directory: string): { path: string; name: string };
  git: {
    headOf(directory: string): Promise<CheckoutHead | undefined>;
    changeSince(directory: string, since: string, head: string): Promise<ChangeSince | undefined>;
  };
  /** Why no run can be started now, in plain words; null when one can. */
  unavailable(): string | null;
  /** What the catalog calls Workflow `id` now; nothing when it has none. */
  workflowName(id: string): string | undefined;
  /** Start a run of the Workflow for the change. `crewId` names the run;
   *  absent = the change gave the Workflow nothing to do. */
  start(
    workflowId: string,
    directoryPath: string,
    change: ChangeSince,
  ): Promise<{ ok: true; crewId?: string } | { ok: false; reason: string }>;
  /** Whether the run of Crew `crewId` is still in the office. */
  isListed(crewId: string): boolean;
  now(): number;
  /** The status changed: the offices are told. */
  onChange(): void;
}

/** What the office keeps of one watched Directory. */
interface Watch {
  /** The commit the next change is counted from: the newest one handed to a
   *  run, or where the checkout stood when the watch began. Absent = the
   *  watch begins at the next look. */
  reviewed?: string;
  /** The branch the watch is on. */
  branch?: string;
  /** The newest commit seen, and since when it has stood. */
  head?: string;
  headSince: number;
  /** The run this trigger started, while it is still in the office. */
  crewId?: string;
  /** When its runs of the last hour were started. */
  starts: number[];
  /** No start is tried before this: one that failed is not tried again at once. */
  retryAt: number;
  state: WorkflowChangeTriggerState;
  note?: string;
}

const WAITS_FOR_RUN_NOTE =
  'New commits wait for the review before them: stop that workflow, or close its lead, once you have read its report.';
const START_FAILED_NOTE =
  "A review could not be started (the host's log says why). The office tries again shortly.";
const NOT_A_REPOSITORY_NOTE =
  'This Directory is not the root of a git repository with a commit: there is nothing to watch.';
const DETACHED_NOTE = 'No branch is checked out here: nothing is reviewed until one is.';
const OTHER_BRANCH_NOTE = 'The branch checked out here is not one this trigger watches.';

export class ChangeTriggers {
  /** By the watched folder's path, as `resolve` gives it. */
  private readonly watches = new Map<string, Watch>();
  private paused = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** The look under way, so two never run at once. */
  private looking: Promise<void> | undefined;
  /** The status the offices were last told. */
  private told = '';
  private disposed = false;

  constructor(private readonly deps: ChangeTriggersDeps) {}

  /** Start watching: a first look now, then one every CHANGE_TRIGGER_POLL_MS. */
  start(): void {
    if (this.timer !== undefined || this.disposed) return;
    this.timer = setInterval(() => void this.tick(), CHANGE_TRIGGER_POLL_MS);
    // The watch alone never keeps the server running.
    this.timer.unref?.();
    void this.tick();
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** The triggers that are switched on, in the file's order, and where each stands. */
  status(): { triggers: WorkflowChangeTrigger[]; paused: boolean } {
    const triggers = this.enabled().map((definition): WorkflowChangeTrigger => {
      const { path, name } = this.deps.resolve(definition.directory);
      const watch = this.watches.get(path);
      const state = this.paused ? 'paused' : (watch?.state ?? 'watching');
      const note = this.paused ? undefined : watch?.note;
      return {
        directoryName: name,
        workflowId: definition.workflow,
        workflowName: this.deps.workflowName(definition.workflow) ?? definition.workflow,
        state,
        ...(note !== undefined ? { note } : {}),
      };
    });
    return { triggers, paused: this.paused };
  }

  /**
   * The user pauses or resumes the triggers. While paused nothing is watched:
   * the watch begins again at the resume, from where each checkout stands
   * then, so commits made meanwhile are not reviewed.
   */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    console.log(`${LOG_PREFIX} ${paused ? 'paused' : 'resumed'} by the user`);
    if (paused) {
      for (const watch of this.watches.values()) watch.reviewed = undefined;
      this.tell();
    } else {
      void this.tick();
    }
  }

  /** One look at every watched Directory. Never two at once: a look that
   *  comes while another runs waits for that one and looks no further. */
  tick(): Promise<void> {
    this.looking ??= this.look().finally(() => {
      this.looking = undefined;
    });
    return this.looking;
  }

  private enabled(): ChangeTriggerDefinition[] {
    return this.deps.definitions().filter((definition) => definition.enabled);
  }

  private async look(): Promise<void> {
    const definitions = this.enabled();
    const paths = new Set<string>();
    for (const definition of definitions) {
      const { path } = this.deps.resolve(definition.directory);
      paths.add(path);
      let watch = this.watches.get(path);
      if (!watch) {
        watch = { headSince: 0, starts: [], retryAt: 0, state: 'watching' };
        this.watches.set(path, watch);
      }
      try {
        await this.lookAt(definition, path, watch);
      } catch (err) {
        console.error(`${LOG_PREFIX} the look at a watched Directory failed:`, err);
      }
    }
    // A Directory the file no longer names is no longer watched.
    for (const path of [...this.watches.keys()]) {
      if (!paths.has(path)) this.watches.delete(path);
    }
    this.tell();
  }

  /** Where one trigger stands now, and the run it is time for. */
  private async lookAt(
    definition: ChangeTriggerDefinition,
    path: string,
    watch: Watch,
  ): Promise<void> {
    const { deps } = this;
    /** It cannot watch, or has nothing to: the watch begins anew afterwards. */
    const idle = (state: WorkflowChangeTriggerState, note?: string): void => {
      watch.reviewed = undefined;
      watch.state = state;
      watch.note = note;
    };
    const stand = (state: WorkflowChangeTriggerState, note?: string): void => {
      watch.state = state;
      watch.note = note;
    };
    if (watch.crewId !== undefined && !deps.isListed(watch.crewId)) watch.crewId = undefined;

    if (this.paused) return idle('paused');
    const unavailable = deps.unavailable();
    if (unavailable !== null) return idle('problem', unavailable);
    if (deps.workflowName(definition.workflow) === undefined) {
      return idle('problem', `There is no workflow "${definition.workflow}" on this host.`);
    }
    const head = await deps.git.headOf(path);
    if (!head) return idle('problem', NOT_A_REPOSITORY_NOTE);
    if (head.branch === undefined) return idle('watching', DETACHED_NOTE);
    if (definition.branches && !pathSelected(head.branch, nameSelector(definition.branches))) {
      return idle('watching', OTHER_BRANCH_NOTE);
    }

    const now = deps.now();
    if (watch.reviewed === undefined || watch.branch !== head.branch) {
      // The watch begins here: what the checkout already holds is not a change.
      watch.reviewed = head.commit;
      watch.branch = head.branch;
      watch.head = head.commit;
      watch.headSince = now;
    } else if (head.commit !== watch.head) {
      watch.head = head.commit;
      watch.headSince = now;
    }
    const running = watch.crewId !== undefined;
    if (watch.head === watch.reviewed) return stand(running ? 'running' : 'watching');

    // There are commits no run was handed.
    if (running) return stand('waiting', WAITS_FOR_RUN_NOTE);
    if (now - watch.headSince < definition.settleSeconds * 1000) return stand('settling');
    watch.starts = watch.starts.filter((at) => now - at < CHANGE_TRIGGER_RATE_WINDOW_MS);
    if (watch.starts.length >= definition.maxRunsPerHour) {
      return stand(
        'waiting',
        `It started ${watch.starts.length} ${watch.starts.length === 1 ? 'review' : 'reviews'} in the last hour, the most it may: the next one waits.`,
      );
    }
    if (now < watch.retryAt) return stand('waiting', START_FAILED_NOTE);

    const change = await deps.git.changeSince(path, watch.reviewed, head.commit);
    if (!change || change.commits === 0 || change.files.length === 0) {
      // Nothing a run could read: history went back, an empty commit, or git
      // cannot compare the two. The watch goes on from here.
      watch.reviewed = head.commit;
      return stand('watching');
    }
    const outcome = await deps.start(definition.workflow, path, change);
    if (!outcome.ok) {
      console.warn(`${LOG_PREFIX} no run was started for a change: ${outcome.reason}`);
      watch.retryAt = deps.now() + CHANGE_TRIGGER_RETRY_MS;
      return stand('waiting', START_FAILED_NOTE);
    }
    watch.reviewed = change.head;
    if (outcome.crewId === undefined) {
      console.log(
        `${LOG_PREFIX} a change of ${change.commits} commit(s) touches no file its workflow is for: no run`,
      );
      return stand('watching');
    }
    watch.crewId = outcome.crewId;
    watch.starts.push(deps.now());
    console.log(
      `${LOG_PREFIX} started ${definition.workflow} for ${change.commits} commit(s) touching ${change.files.length} file(s)`,
    );
    return stand(deps.isListed(outcome.crewId) ? 'running' : 'watching');
  }

  /** Tell the offices, when what they were last told no longer holds. */
  private tell(): void {
    if (this.disposed) return;
    const status = JSON.stringify(this.status());
    if (status === this.told) return;
    this.told = status;
    this.deps.onChange();
  }
}
