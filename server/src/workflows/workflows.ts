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
 * - Ended when the user stops it (`stopWorkflow`, which ends its Crew), when
 *   the user ends its Crew, or when its lead leaves the office. A run whose
 *   stages are all closed stays listed, finished, until then.
 *
 * Memory only, like the tutorial's run: a run lives as long as this server
 * and its lead. The request never rides a command line: the lead's first
 * message only sends it to the tool (workflowCopy.ts).
 */

import type { WorkflowRun, WorkflowsLoaded } from '../../../core/src/messages.js';
import type { CatalogWorkflow } from '../../../core/src/workflows.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { WORKFLOW_REQUEST_MAX_CHARS, WORKFLOW_SHOWN_TEXT_MAX_CHARS } from '../constants.js';
import type { CrewPlace } from '../crews.js';
import type { AgentLaunch, AgentLaunchOutcome } from '../mcp/officeOperations.js';
import type { AgentState } from '../types.js';
import { roleNameOf, workflowCatalog, workflowListing } from './workflowCatalog.js';
import {
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
        state: StageProgress['state'];
        note?: string;
      }>;
      /** How the lead works the run; for the lead alone. */
      rules?: readonly string[];
      /** What an agent that is not the lead is told. */
      note?: string;
    };

export type WorkflowMoveOutcome = { ok: true; view: WorkflowView } | { ok: false; reason: string };

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
  /** Absent while the lead is still launching. */
  leadAgentId?: number;
  stages: StageProgress[];
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
          return {
            id: stage.id,
            title: stage.title,
            roleName: run.roleNames[index],
            ...(stage.parallel ? { parallel: true } : {}),
            state,
            ...(note ? { note: shown(note) } : {}),
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
    reply: (message: { type: 'workflowRejected'; reason: string }) => void,
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
    if (request.length > WORKFLOW_REQUEST_MAX_CHARS) {
      return {
        ok: false,
        reason: `The request is longer than ${WORKFLOW_REQUEST_MAX_CHARS} characters. Write the essential here and give the rest to the lead in its terminal.`,
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
      stages: initialStages(workflow.stages),
    });
    this.broadcast();

    let outcome: AgentLaunchOutcome;
    try {
      outcome = await this.deps.launch({
        directory: asked.directoryPath,
        palette,
        roleId: workflow.lead,
        crew: place.launch,
        asks: { firstMessage: WORKFLOW_FIRST_MESSAGE },
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
        return {
          id: stage.id,
          title: stage.title,
          role: { id: stage.role, name: run.roleNames[index] },
          parallel: stage.parallel === true,
          brief: stage.brief,
          state,
          ...(note ? { note } : {}),
        };
      }),
      ...(youLead ? { rules: WORKFLOW_LEAD_RULES } : { note: workflowMemberNote(run.leadAgentId) }),
    };
  }

  /** The lead moves a stage of its run (workflowProgress.ts holds the rules). */
  move(caller: number, move: StageMove, stageId: string, note?: string): WorkflowMoveOutcome {
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
    const outcome = moveStage(run.workflow.stages, run.stages, move, stageId, note);
    if (!outcome.ok) return outcome;
    const wasFinished = isRunFinished(run.stages);
    run.stages = outcome.stages;
    if (!wasFinished && isRunFinished(run.stages)) {
      console.log(`[Pixel Agents] Workflows: ${run.workflow.name} finished`);
    }
    this.broadcast();
    return { ok: true, view: this.view(caller) };
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
    this.stopped.add(crewId);
    console.log(`[Pixel Agents] Workflows: the user stopped ${run.workflow.name}`);
    this.broadcast();
    return true;
  }
}
