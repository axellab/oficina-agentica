import { z } from 'zod';

import { CHECK_FINISH_HOLD_SECONDS, WORKFLOW_NOTE_MAX_CHARS } from '../../constants.js';
import type { WorkflowMoveOutcome, WorkflowView } from '../../workflows/workflows.js';
import { defineTool, ok, refuse, type ToolResult } from '../tool.js';

/** A run as its agents read it: the tool's own field names. `checkNote`:
 *  what the office did about the Check of the stage just finished. */
function described(view: WorkflowView, checkNote?: string): Record<string, unknown> {
  if (!view.running) return { running: false, note: view.note };
  return {
    running: true,
    ...(checkNote !== undefined ? { check_note: checkNote } : {}),
    you_lead: view.youLead,
    lead_agent_id: view.leadAgentId,
    workflow: view.workflow,
    request: view.request,
    ...(view.change
      ? {
          change: {
            from: view.change.base,
            to: view.change.head,
            commits: view.change.commits,
            files: view.change.files,
          },
        }
      : {}),
    finished: view.finished,
    stages: view.stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      role: stage.role,
      parallel: stage.parallel,
      what_to_do: stage.brief,
      ...(stage.model !== undefined ? { model: stage.model } : {}),
      required: stage.required,
      ...(stage.check
        ? {
            check: {
              id: stage.check.id,
              name: stage.check.name,
              state: stage.check.state,
              ...(stage.check.command !== undefined ? { command: stage.check.command } : {}),
              ...(stage.check.exitCode !== undefined ? { exit_code: stage.check.exitCode } : {}),
              ...(stage.check.seconds !== undefined ? { seconds: stage.check.seconds } : {}),
            },
          }
        : {}),
      state: stage.state,
      ...(stage.note ? { note: stage.note } : {}),
    })),
    ...(view.rules ? { rules: view.rules } : {}),
    ...(view.note ? { note: view.note } : {}),
  };
}

/** A move's outcome as the tool answers it. */
function answered(outcome: WorkflowMoveOutcome): ToolResult {
  return outcome.ok ? ok(described(outcome.view, outcome.note)) : refuse(outcome.reason);
}

export const workflow = defineTool({
  name: 'workflow',
  title: 'Workflow',
  description:
    'A workflow run: one request of the user that your Crew handles stage by stage. The user starts one from ' +
    'the office, choosing the kind of request (new feature, bug fix, deep security or quality analysis, or ' +
    'one of their own) and writing what they need; no agent starts one. ' +
    "`status` (default): whether your Crew runs one, and if so the `request` (the user's own words; in a " +
    "run the office's change trigger started for new commits, the office's, with the `change`: the commits " +
    '`from`..`to` to read with git, how many there are and how many files they touch), the ' +
    'workflow (name, what it is for), who leads it, and every stage in order: its `id`, title, the Role that ' +
    'owns it, `what_to_do`, whether it may run in `parallel` with the stage before it, its `state` (pending | ' +
    'active | done | skipped) and the note it was closed with, and the `model` the stage names when it names ' +
    "one (the office launches the stage's Role on it by itself), whether it is `required` (the lead " +
    'cannot skip it: only the user can, from the office) and its `check` when it names one: a command the ' +
    'user set up that the OFFICE runs to close the stage (`state`: notSetUp | pending | running | passed | ' +
    'failed, with its `command`, `exit_code` and `seconds`). The lead also gets the `rules`. ' +
    'Only the lead (the agent the user started the workflow with) reports the stages: `start` with ' +
    '`stage_id` when its work begins (a stage starts once the stages before it are done or skipped; a done ' +
    'stage can be started again when later work sends it back), `finish` with `stage_id` and a `note` of ' +
    'what was done and how it was verified, `skip` with `stage_id` and a `note` saying why the request does ' +
    'not need it (refused for a required stage). A `finish` of a stage whose check is set up does not ' +
    "close it: the office runs the check, in the workflow's Directory or, with `agent_id`, in the Worktree " +
    `of that colleague, and closes the stage only if it passes. The call waits up to ${CHECK_FINISH_HOLD_SECONDS} s ` +
    'and answers with `check_note`; when the check is still running, call `finish` again to wait for it. ' +
    'A failed check answers with its output and leaves the stage active. The office shows the user each ' +
    'stage as it moves.',
  input: {
    action: z.enum(['status', 'start', 'finish', 'skip']).optional().describe('Default status.'),
    stage_id: z.string().min(1).optional().describe('start, finish, skip: the stage.'),
    note: z
      .string()
      .max(WORKFLOW_NOTE_MAX_CHARS)
      .optional()
      .describe(
        'finish: what was done and how it was verified. skip: why the request does not need the stage.',
      ),
    agent_id: z
      .number()
      .int()
      .optional()
      .describe(
        "finish: the colleague of your Crew in whose Worktree the work under check sits: the stage's check runs there instead of the workflow's Directory.",
      ),
  },
  // Only the run's own progress, which its user started: allowed while read-only.
  changes: false,
  uses: ['workflows'],
  run: async (args, { caller, office, signal }) => {
    const action = args.action ?? 'status';
    if (action === 'status') return ok(described(office.workflows.view(caller)));
    if (args.stage_id === undefined) return refuse(`${action} needs stage_id: the stage's id.`);
    if (action === 'finish') {
      return answered(
        await office.workflows.finish(caller, args.stage_id, args.note, {
          agentId: args.agent_id,
          signal,
        }),
      );
    }
    return answered(office.workflows.move(caller, action, args.stage_id, args.note));
  },
});
