/**
 * Workflows, pure (CONTEXT.md "Workflow"): how one kind of request (a new
 * feature, a bug fix, a deep security or quality analysis...) is handled, as an
 * ordered list of stages, each owned by a Role.
 *
 * Data and validation, safe on both sides of the wire: what a Workflow is, the
 * host's own workflows.json read entry by entry, the catalog those make with
 * the built-in ones, the order its stages run in, and the `workflowsLoaded`
 * list as an office takes it off the wire. The catalog itself and the runs are
 * the server's (server/src/workflows/); the wire carries what the office
 * shows, never what a stage's owner is told.
 */

import { isRecord } from './isRecord.js';
import type {
  Workflow,
  WorkflowRun,
  WorkflowRunStage,
  WorkflowsLoaded,
  WorkflowSource,
  WorkflowStage,
  WorkflowStageState,
} from './messages.js';
import { isModelName, isRoleId, MODEL_NAME_PROBLEM } from './roles.js';

export type { Workflow, WorkflowRun, WorkflowRunStage, WorkflowSource, WorkflowStageState };

/** One stage of a Workflow, as the catalog holds it. */
export interface WorkflowStageDefinition {
  /** Permanent within its Workflow: what the lead names when it reports. */
  id: string;
  title: string;
  /** The id of the Role that owns the stage. */
  role: string;
  /** What its owner does, and what closes it: told to the run's lead. */
  brief: string;
  /** It may run at the same time as the stage listed before it. */
  parallel?: boolean;
  /** The model the agent its lead launches for it runs on, in the CLI's own
   *  names and aliases (absent = its Role's, else the user's default). An
   *  agent keeps the model it was launched with, so this counts for the stage
   *  its Role is first launched for. */
  model?: string;
}

/** A Workflow as the catalog holds it. */
export interface WorkflowDefinition {
  /** Permanent id: what a start names. */
  id: string;
  name: string;
  description: string;
  /** The id of the Role its runs are led by. */
  lead: string;
  /** What the lead is told of the Workflow as a whole ('' = nothing more). */
  brief: string;
  /** The model a run's lead is launched on (absent = its Role's, else the
   *  user's default). */
  model?: string;
  stages: WorkflowStageDefinition[];
}

/** A catalog entry with where it came from. */
export type CatalogWorkflow = WorkflowDefinition & { source: WorkflowSource };

/** The Role a Workflow that names no lead is led by: the coordinator. */
export const DEFAULT_WORKFLOW_LEAD = 'agile-project-manager';

/** Upper bounds, so a runaway file can't flood the drawer or a lead's context. */
export const MAX_WORKFLOWS = 30;
export const MAX_WORKFLOW_STAGES = 12;
export const MAX_WORKFLOW_NAME_CHARS = 40;
export const MAX_WORKFLOW_DESCRIPTION_CHARS = 200;
export const MAX_WORKFLOW_BRIEF_CHARS = 4000;
export const MAX_STAGE_TITLE_CHARS = 60;
export const MAX_STAGE_BRIEF_CHARS = 2000;

/** The longest request a run is started with: checked by the office's request
 *  dialog and again by the server. It reaches the lead through the `workflow`
 *  tool, so it is bounded by what a tool reply should hold, not by a command line. */
export const MAX_WORKFLOW_REQUEST_CHARS = 4000;

/** A Workflow's id and a stage's: the same shape as a Role's (lower-case
 *  letters, digits and hyphens, starting with a letter). */
export const isWorkflowId = isRoleId;

/** One line of text: trimmed, non-empty, within `max`, no control characters. */
function lineOf(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (text.length === 0 || text.length > max) return undefined;
  return /[\u0000-\u001f\u007f]/.test(text) ? undefined : text;
}

/** A brief: one string, or lines to join (JSON has no multi-line strings). */
function briefOf(value: unknown, max: number): string | undefined {
  const text =
    Array.isArray(value) && value.every((line) => typeof line === 'string')
      ? value.join('\n')
      : value;
  if (typeof text !== 'string') return undefined;
  const brief = text.trim();
  return brief.length > 0 && brief.length <= max ? brief : undefined;
}

const STAGE_KEYS = new Set(['id', 'title', 'role', 'brief', 'parallel', 'model']);
const WORKFLOW_KEYS = new Set(['id', 'name', 'description', 'lead', 'brief', 'model', 'stages']);

/** One stage of a workflows.json entry: the stage, or why not. */
function parseStage(value: unknown, first: boolean): WorkflowStageDefinition | string {
  if (!isRecord(value)) return 'not an object';
  if (!isWorkflowId(value.id)) {
    return 'its "id" must be lower-case letters, digits and hyphens, starting with a letter';
  }
  const unknown = Object.keys(value).find((key) => !STAGE_KEYS.has(key));
  if (unknown !== undefined) return `unknown field "${unknown}"`;
  const title = lineOf(value.title, MAX_STAGE_TITLE_CHARS);
  if (title === undefined) {
    return `"title" must be 1-${MAX_STAGE_TITLE_CHARS} characters on one line`;
  }
  if (!isRoleId(value.role)) return '"role" must be the id of a Role';
  const stage: WorkflowStageDefinition = { id: value.id, title, role: value.role, brief: '' };
  if (value.brief !== undefined) {
    const brief = briefOf(value.brief, MAX_STAGE_BRIEF_CHARS);
    if (brief === undefined) {
      return `"brief" must be text (or a list of lines) of 1-${MAX_STAGE_BRIEF_CHARS} characters`;
    }
    stage.brief = brief;
  }
  if (value.parallel !== undefined) {
    if (typeof value.parallel !== 'boolean') return '"parallel" must be true or false';
    if (value.parallel && first) {
      return '"parallel" means alongside the stage before it, and the first stage has none';
    }
    if (value.parallel) stage.parallel = true;
  }
  if (value.model !== undefined) {
    if (!isModelName(value.model)) return MODEL_NAME_PROBLEM;
    stage.model = value.model;
  }
  return stage;
}

/** One workflows.json entry, checked field by field: the Workflow, or why not. */
function parseWorkflow(value: unknown): WorkflowDefinition | string {
  if (!isRecord(value)) return 'not an object';
  if (!isWorkflowId(value.id)) {
    return 'its "id" must be lower-case letters, digits and hyphens, starting with a letter';
  }
  const unknown = Object.keys(value).find((key) => !WORKFLOW_KEYS.has(key));
  if (unknown !== undefined) return `unknown field "${unknown}"`;
  const name = lineOf(value.name, MAX_WORKFLOW_NAME_CHARS);
  if (name === undefined) {
    return `"name" must be 1-${MAX_WORKFLOW_NAME_CHARS} characters on one line`;
  }
  const workflow: WorkflowDefinition = {
    id: value.id,
    name,
    description: '',
    lead: DEFAULT_WORKFLOW_LEAD,
    brief: '',
    stages: [],
  };
  if (value.description !== undefined) {
    const description = lineOf(value.description, MAX_WORKFLOW_DESCRIPTION_CHARS);
    if (description === undefined) {
      return `"description" must be 1-${MAX_WORKFLOW_DESCRIPTION_CHARS} characters on one line`;
    }
    workflow.description = description;
  }
  if (value.lead !== undefined) {
    if (!isRoleId(value.lead)) return '"lead" must be the id of a Role';
    workflow.lead = value.lead;
  }
  if (value.brief !== undefined) {
    const brief = briefOf(value.brief, MAX_WORKFLOW_BRIEF_CHARS);
    if (brief === undefined) {
      return `"brief" must be text (or a list of lines) of 1-${MAX_WORKFLOW_BRIEF_CHARS} characters`;
    }
    workflow.brief = brief;
  }
  if (value.model !== undefined) {
    if (!isModelName(value.model)) return MODEL_NAME_PROBLEM;
    workflow.model = value.model;
  }
  if (!Array.isArray(value.stages) || value.stages.length === 0) {
    return '"stages" must list at least one stage';
  }
  if (value.stages.length > MAX_WORKFLOW_STAGES) {
    return `"stages" lists more than ${MAX_WORKFLOW_STAGES} stages`;
  }
  const seen = new Set<string>();
  for (const [index, raw] of (value.stages as unknown[]).entries()) {
    const stage = parseStage(raw, index === 0);
    if (typeof stage === 'string') return `stages[${index}]: ${stage}`;
    if (seen.has(stage.id)) return `stages[${index}]: "${stage.id}" is listed twice`;
    seen.add(stage.id);
    workflow.stages.push(stage);
  }
  return workflow;
}

/** What a workflows.json holds: the entries that passed, and one line per
 *  problem (for the host's log: a hand-edited file should say what is wrong). */
export interface ParsedWorkflows {
  workflows: WorkflowDefinition[];
  problems: string[];
}

/**
 * The entries of a workflows.json (`{ "workflows": [ ... ] }`). Lenient per
 * entry: one bad entry is left out and reported, the rest still load. An id
 * listed twice keeps its first entry.
 */
export function parseWorkflows(value: unknown): ParsedWorkflows {
  if (!isRecord(value) || !Array.isArray(value.workflows)) {
    return { workflows: [], problems: ['expected an object with a "workflows" list'] };
  }
  const workflows: WorkflowDefinition[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  const entries: unknown[] = value.workflows;
  if (entries.length > MAX_WORKFLOWS) {
    problems.push(`only the first ${MAX_WORKFLOWS} workflows are read`);
  }
  entries.slice(0, MAX_WORKFLOWS).forEach((raw, index) => {
    const entry = parseWorkflow(raw);
    if (typeof entry === 'string') {
      problems.push(`workflows[${index}]: ${entry}`);
    } else if (seen.has(entry.id)) {
      problems.push(`workflows[${index}]: "${entry.id}" is listed twice; the first one is used`);
    } else {
      seen.add(entry.id);
      workflows.push(entry);
    }
  });
  return { workflows, problems };
}

/** The catalog: the built-in Workflows in their order, each replaced whole by
 *  the host's entry of the same id, then the Workflows the host adds, in its
 *  order. A Workflow naming a Role the host does not have is left out. */
export interface MergedWorkflowCatalog {
  workflows: CatalogWorkflow[];
  problems: string[];
}

export function mergeWorkflowCatalog(
  builtin: readonly WorkflowDefinition[],
  own: readonly WorkflowDefinition[],
  roleIds: ReadonlySet<string>,
): MergedWorkflowCatalog {
  const byId = new Map(own.map((entry) => [entry.id, entry]));
  const problems: string[] = [];
  const merged: CatalogWorkflow[] = builtin.map((workflow) => {
    const replacement = byId.get(workflow.id);
    byId.delete(workflow.id);
    return replacement ? { ...replacement, source: 'user' } : { ...workflow, source: 'builtin' };
  });
  for (const entry of byId.values()) merged.push({ ...entry, source: 'user' });
  const workflows = merged.filter((workflow) => {
    const missing = [workflow.lead, ...workflow.stages.map((stage) => stage.role)].find(
      (role) => !roleIds.has(role),
    );
    if (missing === undefined) return true;
    problems.push(`"${workflow.id}": there is no role "${missing}" on this host`);
    return false;
  });
  return { workflows, problems };
}

// ── The order of the stages ─────────────────────────────────

/**
 * Each stage's step: stages of one step may run at the same time, and a step
 * starts once every stage of the steps before it is done or skipped. A stage
 * opens a new step unless it is `parallel`, which puts it in the step of the
 * stage listed before it.
 */
export function stageSteps(stages: readonly { parallel?: boolean }[]): number[] {
  let step = -1;
  return stages.map((stage, index) => {
    if (index === 0 || !stage.parallel) step++;
    return step;
  });
}

/** Whether a stage in this state needs nothing more. */
export function isStageClosed(state: WorkflowStageState): boolean {
  return state === 'done' || state === 'skipped';
}

/** How many of a run's stages are done or skipped (the panel's header). */
export function closedStageCount(stages: readonly { state: WorkflowStageState }[]): number {
  return stages.filter((stage) => isStageClosed(stage.state)).length;
}

// ── The wire, as an office reads it ─────────────────────────

const STAGE_STATES: readonly string[] = ['pending', 'active', 'done', 'skipped'];

function parseListedStage(raw: unknown): WorkflowStage | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.title !== 'string' || typeof raw.roleName !== 'string') return null;
  const stage: WorkflowStage = { id: raw.id, title: raw.title, roleName: raw.roleName };
  if (raw.parallel === true) stage.parallel = true;
  return stage;
}

function parseListedWorkflow(raw: unknown): Workflow | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.name !== 'string' || !raw.name) return null;
  const stages = Array.isArray(raw.stages) ? raw.stages : [];
  return {
    id: raw.id,
    name: raw.name,
    description: typeof raw.description === 'string' ? raw.description : '',
    source: raw.source === 'user' ? 'user' : 'builtin',
    leadRoleId: typeof raw.leadRoleId === 'string' ? raw.leadRoleId : '',
    leadRoleName: typeof raw.leadRoleName === 'string' ? raw.leadRoleName : '',
    stages: stages.flatMap((stage) => parseListedStage(stage) ?? []),
  };
}

function parseRunStage(raw: unknown): WorkflowRunStage | null {
  const listed = parseListedStage(raw);
  if (!listed || !isRecord(raw)) return null;
  if (typeof raw.state !== 'string' || !STAGE_STATES.includes(raw.state)) return null;
  const stage: WorkflowRunStage = { ...listed, state: raw.state as WorkflowStageState };
  if (typeof raw.note === 'string' && raw.note) stage.note = raw.note;
  return stage;
}

function parseRun(raw: unknown): WorkflowRun | null {
  if (!isRecord(raw) || typeof raw.crewId !== 'string' || !raw.crewId) return null;
  if (typeof raw.workflowId !== 'string' || typeof raw.name !== 'string') return null;
  const stages = Array.isArray(raw.stages) ? raw.stages : [];
  const run: WorkflowRun = {
    crewId: raw.crewId,
    workflowId: raw.workflowId,
    name: raw.name,
    request: typeof raw.request === 'string' ? raw.request : '',
    finished: raw.finished === true,
    stages: stages.flatMap((stage) => parseRunStage(stage) ?? []),
  };
  if (typeof raw.leadAgentId === 'number' && Number.isInteger(raw.leadAgentId)) {
    run.leadAgentId = raw.leadAgentId;
  }
  return run;
}

/**
 * A `workflowsLoaded` message as an office keeps it, or null when it isn't
 * one. Lenient per entry, like the Roles and the Crews: a Workflow, run or
 * stage that is not one is left out and the rest kept.
 */
export function parseWorkflowsLoaded(raw: unknown): WorkflowsLoaded | null {
  if (!isRecord(raw) || raw.type !== 'workflowsLoaded') return null;
  const workflows = Array.isArray(raw.workflows) ? raw.workflows : [];
  const runs = Array.isArray(raw.runs) ? raw.runs : [];
  const loaded: WorkflowsLoaded = {
    type: 'workflowsLoaded',
    available: raw.available === true,
    workflows: workflows.flatMap((workflow) => parseListedWorkflow(workflow) ?? []),
    runs: runs.flatMap((run) => parseRun(run) ?? []),
  };
  if (typeof raw.unavailableReason === 'string' && raw.unavailableReason) {
    loaded.unavailableReason = raw.unavailableReason;
  }
  return loaded;
}
