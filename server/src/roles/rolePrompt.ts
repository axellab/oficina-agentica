/**
 * What an agent launched as a Role is told: the team charter (who else is in
 * the office and how the Roles work together) followed by the Role's own
 * standing instructions. Pure text: writing it where the coding agent reads it
 * is roleCatalog.ts.
 */

import type { RoleDefinition } from '../../../core/src/roles.js';

/** How the Roles work together, whatever the Role. */
const WORKING_AGREEMENTS: readonly string[] = [
  'Stay in your role. When a task belongs to another role, say which one and hand it over instead of doing its work yourself.',
  'A handoff is a short note: what was asked, what you did, what you verified and how, what is left, and anything the next role must not miss.',
  'Do not assume another role is running right now. If this session has tools for messaging the other agents in the office, use them; otherwise hand off through the human (give them the note to pass on) or through the repository (an issue, a pull request, a file the team agreed on).',
  "The repository's own instructions (CLAUDE.md, contributing guides, decision records) come before these.",
  'Back what you report with evidence: the commands you ran and their real results, the files you read. Say what you did not verify.',
  'Never weaken a security control, skip a failing check or touch production to get something done faster. Ask the human.',
  'Answer in the language the human writes in.',
];

/** One line of the roster: the Role's name, what it does, and which one is the reader. */
function rosterLine(role: RoleDefinition, own: boolean): string {
  const what = role.description ? `: ${role.description}` : '';
  return `- ${role.name}${own ? ' (you)' : ''}${what}`;
}

/**
 * The instructions added to the coding agent's own for an agent launched as
 * `role`, in an office whose catalog is `catalog` (the roster names every
 * Role, so each agent knows whom to hand work to).
 */
export function composeRolePrompt(
  role: RoleDefinition,
  catalog: readonly RoleDefinition[],
): string {
  return [
    '# Your place in the office',
    '',
    `You are one of a team of AI coding agents that deliver software together with a human. Each agent is launched as a role, and yours is ${role.name}. The human sets the goals and has the last word.`,
    '',
    '## The team',
    '',
    ...catalog.map((other) => rosterLine(other, other.id === role.id)),
    '',
    '## Working agreements',
    '',
    ...WORKING_AGREEMENTS.map((agreement) => `- ${agreement}`),
    '',
    `## Your role: ${role.name}`,
    '',
    role.prompt,
  ].join('\n');
}
