/**
 * What the office says of a Workflow and its runs, pure (Node-tested): the
 * panel's counts, a stage's words, and how the request dialog numbers the
 * stages. The order itself is core's (`stageSteps`).
 */

import type {
  Workflow,
  WorkflowRun,
  WorkflowRunStage,
  WorkflowStageState,
} from '../../../core/src/messages.js';
import {
  closedStageCount,
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

/** A stage's tooltip: everything the row says, on one line. */
export function stageTitle(stage: WorkflowRunStage): string {
  const parts = [stage.title, stage.roleName, STAGE_STATE_LABEL[stage.state]];
  if (stage.note) parts.push(stage.note);
  return parts.join(' · ');
}

/** A Workflow's stages as the request dialog lists them: numbered by step, so
 *  stages that run at the same time share a number. */
export function numberedStages(
  workflow: Pick<Workflow, 'stages'>,
): Array<{ id: string; step: number; title: string; roleName: string; parallel: boolean }> {
  const steps = stageSteps(workflow.stages);
  return workflow.stages.map((stage, index) => ({
    id: stage.id,
    step: steps[index] + 1,
    title: stage.title,
    roleName: stage.roleName,
    parallel: stage.parallel === true && index > 0,
  }));
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
