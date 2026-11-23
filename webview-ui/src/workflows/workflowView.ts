/**
 * What the office says of a Workflow and its runs, pure (Node-tested): the
 * panel's counts, a stage's words, how the request dialog numbers the stages
 * and how the drawer groups the Workflows by their lead. The order itself is
 * core's (`stageSteps`).
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
