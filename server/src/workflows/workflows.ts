/**
 * Workflow runs (CONTEXT.md "Workflow"): one request of the user's, handled by
 * a Crew stage by stage. One owner per office server, composed into the Pixel
 * Office MCP feature (composeOfficeMcp.ts), since a run is a Crew's work.
 *
 * - Started only by an office (`startWorkflow`: the launch drawer's Workflow
 *   row, then the request the user writes). Never by an agent: no tool starts
 *   one. The start launches the Workflow's lead Role into a NEW Crew
 *   (server/src/crews.ts) and the run is that Crew's: its id names the run.
 * - The lead is the agent the Crew was started with. It reads the request, the
 *   stages and the rules from the `workflow` tool, hands each stage to an
 *   agent of the Role that owns it, and reports each stage there. Only the
 *   lead moves a stage; the Crew's other agents read where things stand.
 * - The order is held HERE (workflowProgress.ts), whatever the lead was told:
 *   a stage starts once the stages before it are closed.
 * - A stage may be `required` (its lead cannot skip it: only the user can,
 *   from the office) and may name a Check (CONTEXT.md "Check"): then the
 *   OFFICE closes it, not its lead. A `finish` runs the Check's command (the
 *   user's own, from checks.json) and the stage is done only if it passes;
 *   its output stays with the stage. Where the user's file gives no command
 *   for it, the lead's note closes the stage as before, and the run says so.
 * - Ended when the user stops it (`stopWorkflow`, which ends its Crew), when
 *   the user ends its Crew, or when its lead leaves the office. A run whose
 *   stages are all closed stays listed, finished, until then.
 *
 * Memory only, like the tutorial's run: a run lives as long as this server
 * and its lead. The request never rides a command line: the lead's first
 * message only sends it to the tool (workflowCopy.ts).
 */

import type { CheckDefinition } from '../../../core/src/checks.js';
import type {
  WorkflowCheckOutput,
  WorkflowCheckState,
  WorkflowRun,
  WorkflowsLoaded,
  WorkflowStageCheck,
} from '../../../core/src/messages.js';
import {
  type CatalogWorkflow,
  isStageClosed,
  MAX_WORKFLOW_REQUEST_CHARS,
} from '../../../core/src/workflows.js';
import type { AgentStateStore } from '../agentStateStore.js';
import {
  CHECK_FINISH_HOLD_SECONDS,
  CHECK_OUTPUT_FOR_LEAD_CHARS,
  CHECK_OUTPUT_FOR_OFFICE_CHARS,
  WORKFLOW_SHOWN_TEXT_MAX_CHARS,
  WORKFLOW_USER_SKIP_NOTE,
} from '../constants.js';
import type { CrewPlace } from '../crews.js';
import type { AgentLaunch, AgentLaunchOutcome } from '../mcp/officeOperations.js';
import type { AgentState } from '../types.js';
import { outputTail } from './checkOutput.js';
import type { CheckResult, RunningCheck } from './checkRunner.js';
import { roleNameOf, workflowCatalog, workflowListing } from './workflowCatalog.js';
import {
  checkFailedReason,
  checkNotSetUpNote,
  checkPassedNote,
  checkRunningNote,
  NO_WORKFLOW_NOTE,
  WORKFLOW_FIRST_MESSAGE,
  WORKFLOW_LEAD_RULES,
  WORKFLOW_STOPPED_NOTE,
  workflowMemberNote,
} from './workflowCopy.js';
import {
  initialStages,
  isRunFinished,
  moveStage,
  type StageMove,
  type StageProgress,
} from './workflowProgress.js';

export interface WorkflowsDeps {
  store: AgentStateStore;
  /** The Crews a run is the work of: a start opens one, a stop ends it. */
  crews: {
    startForLaunch(): CrewPlace | undefined;
    end(crewId: string): boolean;
  };
  /** Why no run can be started now (what starting a Crew needs), in plain
   *  words; null when one can. */
  unavailable(): string | null;
  /** Launch the lead, resolving once it has joined (launch_agent's launch). */
  launch(request: AgentLaunch): Promise<AgentLaunchOutcome>;
  /** The Checks that close stages: what the user's checks.json says Check
   *  `id` is for a run started in a Directory (read as it stands now, so a
   *  corrected file counts for the next finish), and the running of one.
   *  Absent = this office closes no stage itself: every stage is closed on its
   *  lead's note. */
  checks?: {
    forDirectory(id: string, directoryPath: string): CheckDefinition | undefined;
    start(request: { command: string; cwd: string; timeoutSeconds: number }): RunningCheck;
  };
}

/** What an office asks a start with (`startWorkflow`), unchecked. */
export interface WorkflowStart {
  workflowId: unknown;
  directoryPath: unknown;
  request: unknown;
  palette?: unknown;
}

export type WorkflowStartOutcome = { ok: true } | { ok: false; reason: string };

/** The `workflow` tool's view, for the agent asking. */
export type WorkflowView =
  | { running: false; note: string }
  | {
      running: true;
      /** The asking agent leads the run (it alone moves its stages). */
      youLead: boolean;
      leadAgentId: number | null;
      workflow: { id: string; name: string; description: string; brief: string };
      /** The user's own words, whole. */
      request: string;
      finished: boolean;
      stages: Array<{
        id: string;
        title: string;
        role: { id: string; name: string };
        parallel: boolean;
        /** What its owner does and what closes it. */
        brief: string;
        /** The model its owner is launched on, when the stage names one. */
        model?: string;
        /** Its lead cannot skip it. */
        required: boolean;
        /** The Check the office runs to close it, when the stage names one. */
        check?: WorkflowStageCheck & { command?: string };
        state: StageProgress['state'];
        note?: string;
      }>;
      /** How the lead works the run; for the lead alone. */
      rules?: readonly string[];
      /** What an agent that is not the lead is told. */
      note?: string;
    };

/** A move's outcome. `note`: what the office did about the stage's Check,
 *  for the lead to read with the stages. */
export type WorkflowMoveOutcome =
  { ok: true; view: WorkflowView; note?: string } | { ok: false; reason: string };

/** A stage's Check as the office last ran it, or is running it. */
interface StageCheckRun {
  id: string;
  name: string;
  command: string;
  /** The folder it runs in. */
  cwd: string;
  /** What the stage is closed with if it passes: its lead's latest note. */
  note: string;
  /** Its process, while it runs (absent while it waits its turn). */
  process?: RunningCheck;
  /** How it ended; absent while it has not. */
  result?: CheckResult;
  /** The lead was told how it ended. */
  reported: boolean;
  /** The office ended it, or will not start it: its run stopped, its stage
   *  was skipped. Its end then moves nothing. */
  cancelled: boolean;
  /** Settles once it has ended and its stage was moved. */
  ended: Promise<void>;
}

interface RunRecord {
  crewId: string;
  /** Start order: the order runs are listed in. */
  order: number;
  /** The Workflow as it was when the run started: a later edit of
   *  workflows.json does not move a run's stages under its lead. */
  workflow: CatalogWorkflow;
  /** Each stage's Role by name, as the catalog had it then. */
  roleNames: string[];
  request: string;
  /** The Directory the run was started in: where its Checks run, and the one
   *  checks.json is asked about. */
  directory: string;
  /** Absent while the lead is still launching. */
  leadAgentId?: number;
  stages: StageProgress[];
  /** Each stage's Check as it last ran or is running (same order as the
   *  stages); none where it has not run since the stage last started. */
  checks: Array<StageCheckRun | undefined>;
}

/** Wait `ms`, or until `signal` aborts, leaving no timer behind. */
function holdFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done);
  });
}

/** A text as every office is shown it: one line, cut short. */
function shown(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= WORKFLOW_SHOWN_TEXT_MAX_CHARS
    ? line
    : `${line.slice(0, WORKFLOW_SHOWN_TEXT_MAX_CHARS - 1).trimEnd()}…`;
}

export class Workflows {
  private readonly runs = new Map<string, RunRecord>();
  /** The Crews whose run the user stopped: their agents are told so. */
  private readonly stopped = new Set<string>();
  private nextOrder = 1;
  /** One Check at a time, in the order they were asked for: each is a build
   *  or a test run, and two at once would fight over one machine. */
  private checkQueue: Promise<void> = Promise.resolve();
  private readonly detach: () => void;

  constructor(private readonly deps: WorkflowsDeps) {
    const { store } = deps;
    // The lead is the agent the run's Crew was started with: seen as it joins,
    // so its first `workflow` call finds the run however early it comes.
    const onAdded = (id: number, agent: AgentState): void => {
      const run = agent.crew && this.runs.get(agent.crew.id);
      if (!run || run.leadAgentId !== undefined || agent.crew?.launchedBy !== undefined) return;
      run.leadAgentId = id;
      this.broadcast();
    };
    const onRemoved = (id: number): void => {
      for (const run of this.runs.values()) {
        if (run.leadAgentId !== id) continue;
        this.runs.delete(run.crewId);
        this.cancelChecks(run);
        console.log(`[Pixel Agents] Workflows: ${run.workflow.name} ended, its lead left`);
        this.broadcast();
        return;
      }
    };
    store.on('agentAdded', onAdded);
    store.on('agentRemoved', onRemoved);
    this.detach = () => {
      store.off('agentAdded', onAdded);
      store.off('agentRemoved', onRemoved);
    };
  }

  dispose(): void {
    this.detach();
    // No Check outlives the office that ran it.
    for (const run of this.runs.values()) this.cancelChecks(run);
  }

  // ── The wire ──────────────────────────────────────────────

  statusMessage(): WorkflowsLoaded {
    const reason = this.deps.unavailable();
    const runs: WorkflowRun[] = [...this.runs.values()]
      .sort((a, b) => a.order - b.order)
      .map((run) => ({
        crewId: run.crewId,
        workflowId: run.workflow.id,
        name: run.workflow.name,
        ...(run.leadAgentId !== undefined ? { leadAgentId: run.leadAgentId } : {}),
        request: shown(run.request),
        finished: isRunFinished(run.stages),
        stages: run.workflow.stages.map((stage, index) => {
          const { state, note } = run.stages[index];
          const check = this.checkOf(run, index);
          return {
            id: stage.id,
            title: stage.title,
            roleName: run.roleNames[index],
            ...(stage.parallel ? { parallel: true } : {}),
            ...(stage.required ? { required: true } : {}),
            state,
            ...(note ? { note: shown(note) } : {}),
            ...(check ? { check: check.listed } : {}),
          };
        }),
      }));
    return {
      type: 'workflowsLoaded',
      available: reason === null,
      ...(reason !== null ? { unavailableReason: reason } : {}),
      workflows: workflowCatalog().map(workflowListing),
      runs,
    };
  }

  /** Every office hears the catalog and the runs as they are now. */
  broadcast(): void {
    this.deps.store.broadcast({ ...this.statusMessage() });
  }

  /** Answer an office's Workflow message; false when it isn't one. */
  handleMessage(
    msg: Record<string, unknown>,
    reply: (message: { type: 'workflowRejected'; reason: string } | WorkflowCheckOutput) => void,
  ): boolean {
    switch (msg.type) {
      case 'startWorkflow':
        void this.start({
          workflowId: msg.workflowId,
          directoryPath: msg.directoryPath,
          request: msg.request,
          palette: msg.palette,
        }).then((outcome) => {
          if (!outcome.ok) reply({ type: 'workflowRejected', reason: outcome.reason });
        });
        return true;
      case 'stopWorkflow':
        if (typeof msg.crewId === 'string') this.stop(msg.crewId);
        return true;
      case 'skipWorkflowStage':
        if (typeof msg.crewId === 'string' && typeof msg.stageId === 'string') {
          this.skipByUser(msg.crewId, msg.stageId);
        }
        return true;
      case 'requestWorkflowCheckOutput': {
        const output =
          typeof msg.crewId === 'string' && typeof msg.stageId === 'string'
            ? this.checkOutput(msg.crewId, msg.stageId)
            : undefined;
        if (output) reply(output);
        return true;
      }
      default:
        return false;
    }
  }

  // ── Start / stop ──────────────────────────────────────────

  /**
   * The user starts a run: the Workflow's lead Role is launched into the
   * Directory, in a new Crew, and sent to the `workflow` tool. Resolves once
   * the lead has joined, or with why nothing started.
   */
  async start(asked: WorkflowStart): Promise<WorkflowStartOutcome> {
    const unavailable = this.deps.unavailable();
    if (unavailable !== null) return { ok: false, reason: unavailable };
    const workflow =
      typeof asked.workflowId === 'string'
        ? workflowCatalog().find((candidate) => candidate.id === asked.workflowId)
        : undefined;
    if (!workflow) {
      return { ok: false, reason: 'There is no such workflow on this host any more.' };
    }
    const request = typeof asked.request === 'string' ? asked.request.trim() : '';
    if (!request) {
      return { ok: false, reason: 'A workflow starts from a request: write what you need.' };
    }
    if (request.length > MAX_WORKFLOW_REQUEST_CHARS) {
      return {
        ok: false,
        reason: `The request is longer than ${MAX_WORKFLOW_REQUEST_CHARS} characters. Write the essential here and give the rest to the lead in its terminal.`,
      };
    }
    if (request.includes('\u0000')) {
      return { ok: false, reason: 'The request cannot hold a NUL character.' };
    }
    if (typeof asked.directoryPath !== 'string' || !asked.directoryPath) {
      return { ok: false, reason: 'A workflow starts in a Directory.' };
    }
    const palette =
      typeof asked.palette === 'number' && Number.isInteger(asked.palette) && asked.palette >= 0
        ? asked.palette
        : undefined;

    const place = this.deps.crews.startForLaunch();
    if (!place) {
      return { ok: false, reason: this.deps.unavailable() ?? 'No Crew can be started now.' };
    }
    const crewId = place.launch.crew.id;
    // Listed before its lead launches: the lead's first call may come before
    // the launch is reported as joined.
    this.runs.set(crewId, {
      crewId,
      order: this.nextOrder++,
      workflow,
      roleNames: workflow.stages.map((stage) => roleNameOf(stage.role)),
      request,
      directory: asked.directoryPath,
      stages: initialStages(workflow.stages),
      checks: workflow.stages.map(() => undefined),
    });
    this.broadcast();

    let outcome: AgentLaunchOutcome;
    try {
      outcome = await this.deps.launch({
        directory: asked.directoryPath,
        palette,
        roleId: workflow.lead,
        crew: place.launch,
        // The Workflow's own model for its lead wins over its Role's.
        asks: {
          firstMessage: WORKFLOW_FIRST_MESSAGE,
          ...(workflow.model !== undefined ? { model: workflow.model } : {}),
        },
      });
      // A launch that outlived its answer may still bring the lead: the start
      // is decided, and the Crew's place given back, once it is over.
      if (!outcome.ok && outcome.underway) await outcome.underway;
    } catch (err) {
      outcome = { ok: false, reason: err instanceof Error ? err.message : String(err) };
    } finally {
      place.done();
    }

    const run = this.runs.get(crewId);
    if (run?.leadAgentId !== undefined) {
      // Its lead is in the office: a launch reported late is still a start.
      if (!outcome.ok) console.warn(`[Pixel Agents] Workflows: ${outcome.reason}`);
      console.log(
        `[Pixel Agents] Workflows: ${workflow.name} started, led by agent ${run.leadAgentId}`,
      );
      return { ok: true };
    }
    if (!run) {
      // Its lead came and went (or the user stopped it) while the launch settled.
      return outcome.ok
        ? { ok: true }
        : { ok: false, reason: `The lead couldn't start: ${outcome.reason}` };
    }
    this.runs.delete(crewId);
    this.broadcast();
    return {
      ok: false,
      reason: outcome.ok
        ? `The lead launched without the Pixel Office MCP, so it cannot run a workflow. Agent ${outcome.id} is in the office as a plain agent.`
        : `The lead couldn't start: ${outcome.reason}`,
    };
  }

  /** The user stopped the run of Crew `crewId`: it is over, and so is its Crew. */
  stop(crewId: string): boolean {
    if (!this.forget(crewId)) return false;
    this.deps.crews.end(crewId);
    return true;
  }

  /** The user ended Crew `crewId` from its own panel: a run it was working is over. */
  crewEnded(crewId: string): void {
    this.forget(crewId);
  }

  // ── The tool (workflow) ───────────────────────────────────

  view(caller: number): WorkflowView {
    const crewId = this.crewIdOf(caller);
    const run = crewId !== undefined ? this.runs.get(crewId) : undefined;
    if (!run) {
      const wasStopped = crewId !== undefined && this.stopped.has(crewId);
      return { running: false, note: wasStopped ? WORKFLOW_STOPPED_NOTE : NO_WORKFLOW_NOTE };
    }
    const youLead = run.leadAgentId === caller;
    const { workflow } = run;
    return {
      running: true,
      youLead,
      leadAgentId: run.leadAgentId ?? null,
      workflow: {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        brief: workflow.brief,
      },
      request: run.request,
      finished: isRunFinished(run.stages),
      stages: workflow.stages.map((stage, index) => {
        const { state, note } = run.stages[index];
        const check = this.checkOf(run, index);
        return {
          id: stage.id,
          title: stage.title,
          role: { id: stage.role, name: run.roleNames[index] },
          parallel: stage.parallel === true,
          brief: stage.brief,
          ...(stage.model !== undefined ? { model: stage.model } : {}),
          required: stage.required === true,
          ...(check
            ? {
                check: {
                  ...check.listed,
                  ...(check.command !== undefined ? { command: check.command } : {}),
                },
              }
            : {}),
          state,
          ...(note ? { note } : {}),
        };
      }),
      ...(youLead ? { rules: WORKFLOW_LEAD_RULES } : { note: workflowMemberNote(run.leadAgentId) }),
    };
  }

  /**
   * The model an agent `caller` launches as Role `roleId` runs on by its
   * Workflow: the one named by the first stage that Role owns and that is not
   * closed yet, when `caller` leads a run. An agent keeps the model it was
   * launched with, so the stage it is launched for decides.
   */
  stageModel(caller: number, roleId: string): { model: string; stageTitle: string } | undefined {
    const crewId = this.crewIdOf(caller);
    const run = crewId !== undefined ? this.runs.get(crewId) : undefined;
    if (!run || run.leadAgentId !== caller) return undefined;
    const index = run.workflow.stages.findIndex(
      (stage, at) => stage.role === roleId && !isStageClosed(run.stages[at].state),
    );
    const stage = index < 0 ? undefined : run.workflow.stages[index];
    return stage?.model === undefined ? undefined : { model: stage.model, stageTitle: stage.title };
  }

  /** The run `caller` leads, or why it moves no stage. */
  private ledBy(caller: number): { ok: true; run: RunRecord } | { ok: false; reason: string } {
    const crewId = this.crewIdOf(caller);
    const run = crewId !== undefined ? this.runs.get(crewId) : undefined;
    if (!run) {
      const wasStopped = crewId !== undefined && this.stopped.has(crewId);
      return { ok: false, reason: wasStopped ? WORKFLOW_STOPPED_NOTE : NO_WORKFLOW_NOTE };
    }
    if (run.leadAgentId !== caller) {
      return {
        ok: false,
        reason: `Only this workflow's lead${run.leadAgentId !== undefined ? ` (agent ${run.leadAgentId})` : ''} reports its stages: tell it what you did and how you verified it (send_message), and it will.`,
      };
    }
    return { ok: true, run };
  }

  /** A run's stages after a move that was allowed. */
  private moved(run: RunRecord, stages: StageProgress[]): void {
    const wasFinished = isRunFinished(run.stages);
    run.stages = stages;
    if (!wasFinished && isRunFinished(run.stages)) {
      console.log(`[Pixel Agents] Workflows: ${run.workflow.name} finished`);
    }
  }

  /**
   * The lead starts or skips a stage of its run (workflowProgress.ts holds the
   * rules; a finish is `finish`, since the office may have a Check to run).
   */
  move(
    caller: number,
    move: Exclude<StageMove, 'finish'>,
    stageId: string,
    note?: string,
  ): WorkflowMoveOutcome {
    const led = this.ledBy(caller);
    if (!led.ok) return led;
    const { run } = led;
    const outcome = moveStage(run.workflow.stages, run.stages, move, stageId, note);
    if (!outcome.ok) return outcome;
    // A stage that starts again, or is left out, has no Check to show for it.
    this.dropCheck(
      run,
      run.workflow.stages.findIndex((stage) => stage.id === stageId),
    );
    this.moved(run, outcome.stages);
    this.broadcast();
    return { ok: true, view: this.view(caller) };
  }

  /**
   * The lead reports a stage finished. A stage that names a Check the user
   * set up is closed by the office: its command runs (in the run's Directory,
   * or in the Worktree of the Crew's agent `agentId`, whose work the stage
   * is), and the stage is done only if it passes. The call waits for it up to
   * CHECK_FINISH_HOLD_SECONDS; a Check still running then is waited for by
   * finishing again. Any other stage is closed on the lead's note.
   */
  async finish(
    caller: number,
    stageId: string,
    note?: string,
    options: { agentId?: number; signal?: AbortSignal } = {},
  ): Promise<WorkflowMoveOutcome> {
    const led = this.ledBy(caller);
    if (!led.ok) return led;
    const { run } = led;
    const index = run.workflow.stages.findIndex((stage) => stage.id === stageId);
    const under = index < 0 ? undefined : run.checks[index];
    if (under && !under.cancelled) {
      if (!under.result) {
        // Under way: it closes the stage with the lead's latest note.
        if (note?.trim()) under.note = note.trim();
        return this.awaitCheck(caller, run, index, under, options.signal);
      }
      // It ended while nobody waited for it: the lead hears of it now.
      if (!under.reported) return this.checkOutcome(caller, run, index, under);
    }

    const allowed = moveStage(run.workflow.stages, run.stages, 'finish', stageId, note);
    if (!allowed.ok) return allowed;
    const stage = run.workflow.stages[index];
    const definition =
      stage.check === undefined
        ? undefined
        : this.deps.checks?.forDirectory(stage.check, run.directory);
    if (!definition) {
      this.dropCheck(run, index);
      this.moved(run, allowed.stages);
      this.broadcast();
      return {
        ok: true,
        view: this.view(caller),
        ...(stage.check !== undefined ? { note: checkNotSetUpNote(stage.check) } : {}),
      };
    }
    const folder = this.checkFolder(run, options.agentId);
    if (!folder.ok) return folder;
    const record = this.startCheck(run, index, definition, folder.path, note?.trim() ?? '');
    this.broadcast();
    return this.awaitCheck(caller, run, index, record, options.signal);
  }

  // ── The user's own moves (the Workflow panel) ─────────────

  /**
   * The user skips a stage that is not closed, from the office: the one way a
   * required stage is left out, and the way past a Check that cannot pass. A
   * Check running for it is ended; one that already ran stays on show.
   */
  skipByUser(crewId: string, stageId: string): boolean {
    const run = this.runs.get(crewId);
    if (!run) return false;
    const outcome = moveStage(
      run.workflow.stages,
      run.stages,
      'skip',
      stageId,
      WORKFLOW_USER_SKIP_NOTE,
      'user',
    );
    if (!outcome.ok) return false;
    const index = run.workflow.stages.findIndex((stage) => stage.id === stageId);
    const under = run.checks[index];
    if (under && !under.result) this.dropCheck(run, index);
    this.moved(run, outcome.stages);
    console.log(`[Pixel Agents] Workflows: the user skipped ${stageId} of ${run.workflow.name}`);
    this.broadcast();
    return true;
  }

  /** A stage's Check as the office last ran it, for the office that asks:
   *  its command, where it ran and its output (so far, while it runs). */
  checkOutput(crewId: string, stageId: string): WorkflowCheckOutput | undefined {
    const run = this.runs.get(crewId);
    const index = run ? run.workflow.stages.findIndex((stage) => stage.id === stageId) : -1;
    const check = run && index >= 0 ? this.checkOf(run, index) : undefined;
    if (!run || !check) return undefined;
    const under = run.checks[index];
    const whole = under?.result ?? under?.process?.output();
    const text = under?.result ? under.result.output : (under?.process?.output().text ?? '');
    const tail = outputTail(text, CHECK_OUTPUT_FOR_OFFICE_CHARS);
    return {
      type: 'workflowCheckOutput',
      crewId,
      stageId,
      name: check.listed.name,
      ...(check.command !== undefined ? { command: check.command } : {}),
      ...(under ? { directory: under.cwd } : {}),
      state: check.listed.state,
      ...(check.listed.exitCode !== undefined ? { exitCode: check.listed.exitCode } : {}),
      ...(check.listed.seconds !== undefined ? { seconds: check.listed.seconds } : {}),
      output: tail.text,
      ...(tail.truncated || whole?.truncated ? { truncated: true } : {}),
    };
  }

  // ── Checks ────────────────────────────────────────────────

  /**
   * The Check of stage `index` as it stands: how its last run went, else
   * whether the user's file gives it a command now. None for a stage that
   * names no Check.
   */
  private checkOf(
    run: RunRecord,
    index: number,
  ): { listed: WorkflowStageCheck; command?: string } | undefined {
    const id = run.workflow.stages[index]?.check;
    if (id === undefined) return undefined;
    const under = run.checks[index];
    if (under) {
      const { result } = under;
      const state: WorkflowCheckState = !result ? 'running' : result.passed ? 'passed' : 'failed';
      return {
        listed: {
          id,
          name: under.name,
          state,
          ...(result?.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
          ...(result ? { seconds: result.seconds } : {}),
        },
        command: under.command,
      };
    }
    const definition = this.deps.checks?.forDirectory(id, run.directory);
    return definition
      ? { listed: { id, name: definition.name, state: 'pending' }, command: definition.command }
      : { listed: { id, name: id, state: 'notSetUp' } };
  }

  /**
   * Where a stage's Check runs: the run's Directory, or, when the lead names
   * the colleague whose work the stage is and that agent works in a Worktree,
   * that Worktree. Never a path an agent wrote: only a folder the office put
   * an agent of this Crew in.
   */
  private checkFolder(
    run: RunRecord,
    agentId: number | undefined,
  ): { ok: true; path: string } | { ok: false; reason: string } {
    if (agentId === undefined) return { ok: true, path: run.directory };
    if (this.crewIdOf(agentId) !== run.crewId) {
      return {
        ok: false,
        reason: `Agent ${agentId} is not in your Crew: agent_id names the colleague whose work this stage is (list_agents shows them). Leave it out to check the workflow's own Directory.`,
      };
    }
    return { ok: true, path: this.deps.store.get(agentId)?.worktree?.path ?? run.directory };
  }

  /** Run stage `index`'s Check, after the ones asked for before it. */
  private startCheck(
    run: RunRecord,
    index: number,
    definition: CheckDefinition,
    cwd: string,
    note: string,
  ): StageCheckRun {
    const record: StageCheckRun = {
      id: definition.id,
      name: definition.name,
      command: definition.command,
      cwd,
      note,
      reported: false,
      cancelled: false,
      ended: Promise.resolve(),
    };
    const turn = this.checkQueue.then(async () => {
      if (record.cancelled) return;
      try {
        const process = this.deps.checks?.start({
          command: definition.command,
          cwd,
          timeoutSeconds: definition.timeoutSeconds,
        });
        if (!process) throw new Error('this office runs no checks');
        record.process = process;
        record.result = await process.result;
      } catch (err) {
        record.result = {
          passed: false,
          ended: 'notStarted',
          seconds: 0,
          output: `The check could not be run: ${err instanceof Error ? err.message : String(err)}`,
          truncated: false,
        };
      }
      record.process = undefined;
      this.checkEnded(run, index, record);
    });
    record.ended = turn;
    this.checkQueue = turn;
    run.checks[index] = record;
    return record;
  }

  /** A Check ended: one that passed closes its stage, with the note its lead
   *  finished it with. The office does it, whether or not anyone is waiting. */
  private checkEnded(run: RunRecord, index: number, record: StageCheckRun): void {
    // The run is over, or the stage moved on without it: nothing to close.
    if (this.runs.get(run.crewId) !== run || run.checks[index] !== record || record.cancelled) {
      return;
    }
    const stage = run.workflow.stages[index];
    console.log(
      `[Pixel Agents] Workflows: the ${record.name} check of ${stage.id} (${run.workflow.name}) ${record.result?.passed ? 'passed' : 'failed'}`,
    );
    if (record.result?.passed) {
      const outcome = moveStage(run.workflow.stages, run.stages, 'finish', stage.id, record.note);
      if (outcome.ok) this.moved(run, outcome.stages);
    }
    this.broadcast();
  }

  /** Wait for a Check under way, as long as a tool call may be held. */
  private async awaitCheck(
    caller: number,
    run: RunRecord,
    index: number,
    record: StageCheckRun,
    signal?: AbortSignal,
  ): Promise<WorkflowMoveOutcome> {
    const started = Date.now();
    let ended = false;
    await Promise.race([
      record.ended.then(() => {
        ended = true;
      }),
      holdFor(CHECK_FINISH_HOLD_SECONDS * 1000, signal),
    ]);
    if (this.runs.get(run.crewId) !== run) return { ok: false, reason: WORKFLOW_STOPPED_NOTE };
    // The stage moved on without it (the user skipped it): the stages say so.
    if (run.checks[index] !== record || record.cancelled) {
      return { ok: true, view: this.view(caller) };
    }
    if (!ended || !record.result) {
      const waited = Math.round((Date.now() - started) / 1000);
      return {
        ok: true,
        view: this.view(caller),
        note: checkRunningNote(record.name, run.workflow.stages[index].id, waited),
      };
    }
    return this.checkOutcome(caller, run, index, record);
  }

  /** How an ended Check went, told to the lead (once). */
  private checkOutcome(
    caller: number,
    run: RunRecord,
    index: number,
    record: StageCheckRun & { result?: CheckResult },
  ): WorkflowMoveOutcome {
    record.reported = true;
    const { result } = record;
    if (result?.passed) {
      return {
        ok: true,
        view: this.view(caller),
        note: checkPassedNote(record.name, record.command, result.seconds),
      };
    }
    const tail = outputTail(result?.output ?? '', CHECK_OUTPUT_FOR_LEAD_CHARS);
    return {
      ok: false,
      reason: checkFailedReason({
        stageId: run.workflow.stages[index].id,
        name: record.name,
        command: record.command,
        folder: record.cwd,
        ended: result?.ended ?? 'notStarted',
        exitCode: result?.exitCode,
        seconds: result?.seconds ?? 0,
        output: tail.text,
        truncated: tail.truncated || result?.truncated === true,
      }),
    };
  }

  /** Stage `index` has no Check to show any more; one under way is ended. */
  private dropCheck(run: RunRecord, index: number): void {
    const under = run.checks[index];
    if (!under) return;
    under.cancelled = true;
    under.process?.cancel();
    run.checks[index] = undefined;
  }

  /** A run that is over runs no Check. */
  private cancelChecks(run: RunRecord): void {
    run.checks.forEach((_, index) => this.dropCheck(run, index));
  }

  // ── Internals ─────────────────────────────────────────────

  /** The Crew an agent works in: its own, or, for a Teammate (part of its
   *  Lead's work), its Lead's. */
  private crewIdOf(agentId: number): string | undefined {
    const { store } = this.deps;
    const agent = store.get(agentId);
    if (!agent) return undefined;
    if (agent.crew) return agent.crew.id;
    return agent.leadAgentId === undefined ? undefined : store.get(agent.leadAgentId)?.crew?.id;
  }

  private forget(crewId: string): boolean {
    const run = this.runs.get(crewId);
    if (!run) return false;
    this.runs.delete(crewId);
    this.cancelChecks(run);
    this.stopped.add(crewId);
    console.log(`[Pixel Agents] Workflows: the user stopped ${run.workflow.name}`);
    this.broadcast();
    return true;
  }
}
