/**
 * What the office says of a Role, pure (Node-tested): its tooltip in the
 * launch drawer. The Roles themselves are the server's (roleStore.ts).
 */

import type { Role } from '../../../core/src/messages.js';

/** A Role's tooltip in the drawer: what it does, then the Playbooks its agents
 *  are launched with (hover only: the drawer is too narrow to print them). */
export function roleTitle(role: Pick<Role, 'description' | 'playbooks'>): string | undefined {
  const lines: string[] = [];
  if (role.description) lines.push(role.description);
  if (role.playbooks && role.playbooks.length > 0) {
    lines.push(`Playbooks: ${role.playbooks.join(', ')}.`);
  }
  return lines.length > 0 ? lines.join('\n') : undefined;
}
