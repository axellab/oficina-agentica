/**
 * Where a Workflow run's stages stand and the ONE set of rules that moves
 * them, pure:
 *
 * - `start`: a stage begins (or begins again: later work sent it back), once
 *   every stage of the steps before it is done or skipped (core's stageSteps:
 *   a `parallel` stage shares the step of the stage listed before it);
 * - `finish`: an active stage is done, with a note of what was done;
 * - `skip`: a stage the request does not need, with a note saying why.
 *
 * A refusal says what to do instead: its reader is the run's lead, an agent.
 */

import type { WorkflowStageState } from '../../../core/src/messages.js';
import {
  isStageClosed,
  stageSteps,
  type WorkflowStageDefinition,
} from '../../../core/src/workflows.js';

/** One stage of a run: where it stands, and what its lead last said of it. */
export interface StageProgress {
  id: string;
  state: WorkflowStageState;
  /** The lead's note from its finish or skip; gone when it starts again. */
  note?: string;
}

export type StageMove = 'start' | 'finish' | 'skip';

export type StageMoveOutcome =
  { ok: true; stages: StageProgress[] } | { ok: false; reason: string };

/** A run's stages as it starts: every one pending. */
export function initialStages(definition: readonly WorkflowStageDefinition[]): StageProgress[] {
  return definition.map((stage) => ({ id: stage.id, state: 'pending' }));
}

/** Whether every stage is done or skipped. */
export function isRunFinished(stages: readonly StageProgress[]): boolean {
  return stages.every((stage) => isStageClosed(stage.state));
}

/**
 * Move stage `stageId` of a run whose Workflow lists `definition` and whose
 * stages stand as `stages` (same order): the stages after the move, or why it
 * cannot be made.
 */
export function moveStage(
  definition: readonly WorkflowStageDefinition[],
  stages: readonly StageProgress[],
  move: StageMove,
  stageId: string,
  note?: string,
): StageMoveOutcome {
  const index = stages.findIndex((stage) => stage.id === stageId);
  if (index < 0) {
    return {
      ok: false,
      reason: `There is no stage ${stageId} in this workflow: its stages are ${stages.map((stage) => stage.id).join(', ')}.`,
    };
  }
  const stage = stages[index];
  const said = note?.trim();
  const moved = (next: StageProgress): StageMoveOutcome => ({
    ok: true,
    stages: stages.map((other, at) => (at === index ? next : other)),
  });

  switch (move) {
    case 'start': {
      if (stage.state === 'active') return { ok: false, reason: `${stageId} is already active.` };
      const steps = stageSteps(definition);
      const before = stages.filter(
        (other, at) => steps[at] < steps[index] && !isStageClosed(other.state),
      );
      if (before.length > 0) {
        const open = before.map((other) => `${other.id} (${other.state})`).join(', ');
        return {
          ok: false,
          reason: `${stageId} comes after ${open}: finish or skip ${before.length === 1 ? 'it' : 'them'} first. Only a stage marked parallel runs at the same time as the one before it.`,
        };
      }
      return moved({ id: stage.id, state: 'active' });
    }
    case 'finish': {
      if (stage.state === 'pending') {
        return {
          ok: false,
          reason: `${stageId} has not started: start it when its work begins, so the office shows it, and finish it when the work is done.`,
        };
      }
      if (stage.state !== 'active') {
        return {
          ok: false,
          reason: `${stageId} is already ${stage.state}. If later work sent it back, start it again.`,
        };
      }
      if (!said) {
        return {
          ok: false,
          reason: 'A finish needs a note: what was done, and how it was verified.',
        };
      }
      return moved({ id: stage.id, state: 'done', note: said });
    }
    case 'skip': {
      if (isStageClosed(stage.state)) {
        return { ok: false, reason: `${stageId} is already ${stage.state}.` };
      }
      if (!said) {
        return {
          ok: false,
          reason: 'A skip needs a note: why this request does not need the stage.',
        };
      }
      return moved({ id: stage.id, state: 'skipped', note: said });
    }
  }
}
