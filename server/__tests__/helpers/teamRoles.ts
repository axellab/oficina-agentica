/**
 * The seven Roles the team ships with, in the order the office lists them.
 *
 * The tests that say what ships (which Roles, Playbooks and Workflows, and what
 * the feature guide names) ask about these seven, so a Role added beside them
 * (`npm run new-role`) breaks none of them: it is held to the house rules
 * instead (kitRules.ts), by the same tests, with no line of TypeScript to add.
 */
export const TEAM_ROLE_IDS: readonly string[] = [
  'architect',
  'developer',
  'qa-engineer',
  'devsecops-engineer',
  'security-engineer',
  'cloud-engineer',
  'agile-project-manager',
];

/** Whether `roleId` is one of the seven. */
export function isTeamRole(roleId: unknown): boolean {
  return typeof roleId === 'string' && TEAM_ROLE_IDS.includes(roleId);
}
