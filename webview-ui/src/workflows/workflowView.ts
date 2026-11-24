/**
 * What the office says of a Workflow and its runs, pure (Node-tested): the
 * panel's counts, a stage's words, how the request dialog numbers the stages
 * and how the drawer groups the Workflows by their lead. The order itself is
 * core's (`stageSteps`).
 */

import type {
  Workflow,
  WorkflowChangeTrigger,
  WorkflowChangeTriggerState,
  WorkflowCheckState,
  WorkflowRun,
  WorkflowRunStage,
  WorkflowStageCheck,
  WorkflowStageState,
} from '../../../core/src/messages.js';
import {
  closedStageCount,
  isStageClosed,
  MAX_WORKFLOW_REQUEST_CHARS,
  stageSteps,
} from '../../../core/src/workflows.js';

/** A stage's state in words (its tooltip, and what a screen reader hears). */
export const STAGE_STATE_LABEL: Record<WorkflowStageState, string> = {
  pending: 'To do',
  active: 'In progress',
  done: 'Done',
  skipped: 'Skipped',
};

/** A run's stages closed against all of them: "2 / 6". */
export function runProgress(run: Pick<WorkflowRun, 'stages'>): string {
  return `${closedStageCount(run.stages)} / ${run.stages.length}`;
}

/** The panel's header count: the one run's progress, else how many runs there are. */
export function panelCount(runs: readonly WorkflowRun[]): string {
  return runs.length === 1 ? runProgress(runs[0]) : `${runs.length}`;
}

/** Where a Change trigger stands, in a word or two. */
export const TRIGGER_STATE_LABEL: Record<WorkflowChangeTriggerState, string> = {
  watching: 'watching',
  settling: 'new commits',
  running: 'reviewing',
  waiting: 'waiting',
  paused: 'paused',
  problem: 'cannot watch',
};

/**
 * The panel's header while no run is under way and the host has Change
 * triggers: what they are doing as a whole. One that cannot watch is said
 * first, since it is the one that needs the user.
 */
export function triggersSummary(
  triggers: readonly Pick<WorkflowChangeTrigger, 'state'>[],
  paused: boolean,
): string {
  if (paused) return TRIGGER_STATE_LABEL.paused;
  for (const state of ['problem', 'waiting', 'running', 'settling'] as const) {
    if (triggers.some((trigger) => trigger.state === state)) return TRIGGER_STATE_LABEL[state];
  }
  return TRIGGER_STATE_LABEL.watching;
}

/** A Change trigger's row in one line (its tooltip). */
export function triggerTitle(trigger: WorkflowChangeTrigger): string {
  const parts = [
    `${trigger.directoryName}: a ${trigger.workflowName} run for each change`,
    TRIGGER_STATE_LABEL[trigger.state],
  ];
  if (trigger.note) parts.push(trigger.note);
  return parts.join(' · ');
}

/** How long a Check ran, as the office writes it: "under 1 s", "42 s", "3 min 5 s". */
export function checkSpan(seconds: number): string {
  if (seconds < 1) return 'under 1 s';
  if (seconds < 60) return `${seconds} s`;
  const rest = seconds % 60;
  return rest === 0
    ? `${Math.floor(seconds / 60)} min`
    : `${Math.floor(seconds / 60)} min ${rest} s`;
}

/** What a stage's Check has to say for itself, after its name. */
const CHECK_STATE_WORDS: Record<WorkflowCheckState, string> = {
  notSetUp: 'not set up',
  pending: 'not run yet',
  running: 'running',
  passed: 'passed',
  failed: 'failed',
};

/**
 * A stage's Check on one line: "Tests · passed in 42 s", "Tests · failed
 * (exit 1) in 3 s", "tests · not set up". The office ran it, so the line
 * says how it went, never what anyone said of it.
 */
export function checkLine(check: WorkflowStageCheck): string {
  const words = CHECK_STATE_WORDS[check.state];
  if (check.state === 'passed' && check.seconds !== undefined) {
    return `${check.name} · ${words} in ${checkSpan(check.seconds)}`;
  }
  if (check.state === 'failed') {
    const exit = check.exitCode !== undefined ? ` (exit ${check.exitCode})` : '';
    const span = check.seconds !== undefined ? ` in ${checkSpan(check.seconds)}` : '';
    return `${check.name} · ${words}${exit}${span}`;
  }
  return `${check.name} · ${words}`;
}

/** Whether a Check has an output an office can ask for: it ran, or is running. */
export function checkHasOutput(check: WorkflowStageCheck | undefined): boolean {
  return check !== undefined && check.state !== 'notSetUp' && check.state !== 'pending';
}

/** Whether the user may still skip a stage: one that is not closed. */
export function canSkipStage(stage: Pick<WorkflowRunStage, 'state'>): boolean {
  return !isStageClosed(stage.state);
}

/** A stage's tooltip: everything the row says, on one line. */
export function stageTitle(stage: WorkflowRunStage): string {
  const parts = [stage.title, stage.roleName, STAGE_STATE_LABEL[stage.state]];
  if (stage.required) parts.push('Required');
  if (stage.note) parts.push(stage.note);
  if (stage.check) parts.push(`Check: ${checkLine(stage.check)}`);
  return parts.join(' · ');
}

/** A Workflow's stages as the request dialog lists them: numbered by step, so
 *  stages that run at the same time share a number. */
export function numberedStages(workflow: Pick<Workflow, 'stages'>): Array<{
  id: string;
  step: number;
  title: string;
  roleName: string;
  parallel: boolean;
  /** Its lead cannot skip it. */
  required: boolean;
  /** The id of the Check the office runs to close it. */
  check?: string;
}> {
  const steps = stageSteps(workflow.stages);
  return workflow.stages.map((stage, index) => ({
    id: stage.id,
    step: steps[index] + 1,
    title: stage.title,
    roleName: stage.roleName,
    parallel: stage.parallel === true && index > 0,
    required: stage.required === true,
    ...(stage.check ? { check: stage.check } : {}),
  }));
}

/** What the request dialog says of a stage's marks, in its tooltip. */
export function stageMarksTitle(stage: {
  parallel: boolean;
  required: boolean;
  check?: string;
}): string | undefined {
  const parts: string[] = [];
  if (stage.parallel) parts.push('Runs at the same time as the stage above');
  if (stage.required) parts.push('Required: only you can skip it');
  if (stage.check) {
    parts.push(`Closed by the office running your "${stage.check}" check, where you set one up`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** The Workflows one Role leads, as the drawer lists them together. */
export interface WorkflowGroup<T> {
  leadRoleId: string;
  leadRoleName: string;
  workflows: T[];
}

/** The Workflows as the drawer lists them: under the Role that leads them, the
 *  leads in the order their first Workflow is listed (the coordinator's come
 *  first from the server; one of the user's joins its lead's own). A lead is
 *  its Role's id, never its name: two Roles may go by one name, and each
 *  keeps its own Workflows. */
export function workflowsByLead<T extends Pick<Workflow, 'leadRoleId' | 'leadRoleName'>>(
  workflows: readonly T[],
): Array<WorkflowGroup<T>> {
  const groups = new Map<string, WorkflowGroup<T>>();
  for (const workflow of workflows) {
    const group = groups.get(workflow.leadRoleId);
    if (group) group.workflows.push(workflow);
    else {
      groups.set(workflow.leadRoleId, {
        leadRoleId: workflow.leadRoleId,
        leadRoleName: workflow.leadRoleName,
        workflows: [workflow],
      });
    }
  }
  return [...groups.values()];
}

/** Why a request cannot be sent as it is, or null when it can. */
export function requestProblem(request: string): string | null {
  const text = request.trim();
  if (!text) return 'Write what you need: the workflow starts from it.';
  if (text.length > MAX_WORKFLOW_REQUEST_CHARS) {
    return `Keep it under ${MAX_WORKFLOW_REQUEST_CHARS} characters: the lead can be told the rest in its terminal.`;
  }
  return null;
}
