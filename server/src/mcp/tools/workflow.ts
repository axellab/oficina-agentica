import { z } from 'zod';

import { WORKFLOW_NOTE_MAX_CHARS } from '../../constants.js';
import type { WorkflowView } from '../../workflows/workflows.js';
import { defineTool, ok, refuse } from '../tool.js';

/** A run as its agents read it: the tool's own field names. */
function described(view: WorkflowView): Record<string, unknown> {
  if (!view.running) return { running: false, note: view.note };
  return {
    running: true,
    you_lead: view.youLead,
    lead_agent_id: view.leadAgentId,
    workflow: view.workflow,
    request: view.request,
    finished: view.finished,
    stages: view.stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      role: stage.role,
      parallel: stage.parallel,
      what_to_do: stage.brief,
      state: stage.state,
      ...(stage.note ? { note: stage.note } : {}),
    })),
    ...(view.rules ? { rules: view.rules } : {}),
    ...(view.note ? { note: view.note } : {}),
  };
}

export const workflow = defineTool({
  name: 'workflow',
  title: 'Workflow',
  description:
    'A workflow run: one request of the user that your Crew handles stage by stage. The user starts one from ' +
    'the office, choosing the kind of request (new feature, bug fix, deep security or quality analysis, or ' +
    'one of their own) and writing what they need; no agent starts one. ' +
    "`status` (default): whether your Crew runs one, and if so the `request` (the user's own words), the " +
    'workflow (name, what it is for), who leads it, and every stage in order: its `id`, title, the Role that ' +
    'owns it, `what_to_do`, whether it may run in `parallel` with the stage before it, its `state` (pending | ' +
    'active | done | skipped) and the note it was closed with. The lead also gets the `rules`. ' +
    'Only the lead (the agent the user started the workflow with) reports the stages: `start` with ' +
    '`stage_id` when its work begins (a stage starts once the stages before it are done or skipped; a done ' +
    'stage can be started again when later work sends it back), `finish` with `stage_id` and a `note` of ' +
    'what was done and how it was verified, `skip` with `stage_id` and a `note` saying why the request does ' +
    'not need it. The office shows the user each stage as it moves.',
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
  },
  // Only the run's own progress, which its user started: allowed while read-only.
  changes: false,
  uses: ['workflows'],
  run: (args, { caller, office }) => {
    const action = args.action ?? 'status';
    if (action === 'status') return ok(described(office.workflows.view(caller)));
    if (args.stage_id === undefined) return refuse(`${action} needs stage_id: the stage's id.`);
    const outcome = office.workflows.move(caller, action, args.stage_id, args.note);
    return outcome.ok ? ok(described(outcome.view)) : refuse(outcome.reason);
  },
});
