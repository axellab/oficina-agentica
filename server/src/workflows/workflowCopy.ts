/**
 * What a Workflow run's agents are told, as text: the lead's first message
 * and the rules the `workflow` tool gives with the stages. Pure.
 *
 * The run's lead learns everything from the tool, never from its command
 * line: the request is the user's own words (any length, any characters), and
 * a first message rides the CLI's command line through whatever launches it.
 */

/**
 * The lead's first message. Plain words on one line, with nothing a shell or
 * a Windows command shim would read (no quotes, no `%`, `&`, `|`, `<`, `>`).
 */
export const WORKFLOW_FIRST_MESSAGE =
  'Lead the workflow the user just started with you. Call the tool mcp__pixel-office__workflow now. It gives you the request, the stages and the rules.';

/** How a run's lead works it, whatever the Workflow. */
export const WORKFLOW_LEAD_RULES: readonly string[] = [
  'The request is what the user typed when they started this workflow: it is their word, and it is what your Crew works on. What it leaves open and only they can decide, ask them once, in your own terminal.',
  'You lead. Hand each stage to an agent of the Role that owns it: look first (list_agents), and launch that Role when your Crew has none (launch_agent with `role`, and a `first_message` saying the request, the stage and what you need back). A stage your own Role owns, you do yourself.',
  'Report here as you go: `start` a stage when its work begins, `finish` it with a note of what was done and how it was verified, `skip` it with a note saying why when the request does not need it. The user follows the stages in the office.',
  'The office keeps the order: a stage starts once the stages before it are done or skipped, and only a stage marked parallel runs at the same time as the one before it. When later work sends an earlier stage back (a defect, a gap in the design), `start` that stage again.',
  "While a colleague works on its stage, wait for it with one call (wait_for_agents, naming every colleague at work): it returns when a turn ends, with that screen. Do not sleep, call this tool or read terminals to pass the time: each of those calls is a turn of yours on the user's plan.",
  "Do not finish a stage on a colleague's word alone: read its answer (the screen wait_for_agents gave you, or read_agent_terminal) and check the evidence it gives.",
  'When every stage is closed, the last one being your report to the user, close the colleagues whose part is done (close_agent).',
  'The user can stop the workflow at any moment. That ends your Crew: finish your turn, say where things stand, and wait for them.',
];

/** What an agent of the run's Crew that is not its lead is told. */
export function workflowMemberNote(leadAgentId: number | undefined): string {
  const lead = leadAgentId === undefined ? 'its lead' : `agent ${leadAgentId}, its lead`;
  return `Your Crew is working through this workflow. Only ${lead}, reports its stages: tell that agent what you did and how you verified it, and it will close your stage.`;
}

/** What an agent in no run is told. */
export const NO_WORKFLOW_NOTE =
  'No workflow is running in your Crew. The user starts one from the office (the launch drawer), choosing the kind of request and writing what they need.';

/** What a run's agents are told once the user stopped it. */
export const WORKFLOW_STOPPED_NOTE =
  'The user stopped this workflow, which ended your Crew. Finish your turn, say where things stand, and wait for them.';
