/**
 * The Roles of this host, as the Pixel Office MCP describes them (list_roles),
 * and the ONE resolver of the Role a launch names (launch_agent's `role`): an
 * agent that coordinates the others (the Agile Project Manager) launches a
 * colleague as its Role through it. The catalog itself is roles/roleCatalog.ts.
 */

import type { AgentStateStore } from '../agentStateStore.js';
import { roleCatalog } from '../roles/roleCatalog.js';
import type { AgentState } from '../types.js';
import type { OfficeAgent, RoleOps } from './officeOperations.js';

/** An agent's Role as the tools report it: its id and name, or null. */
export function roleOf(agent: Pick<AgentState, 'role'>): OfficeAgent['role'] {
  return agent.role ? { id: agent.role.id, name: agent.role.name } : null;
}

/**
 * The Role `ref` names: by id, else by name, ignoring case and the spaces
 * around it. Unlike the drawer's launch (where an id the catalog lost launches
 * a plain agent), an agent naming no Role is told so, with the Roles there
 * are: it can ask again, and a colleague launched with no instructions would
 * not be the one it meant.
 *
 * Ids are unique, names are not: `roles.json` may give a Role of its own, or
 * one of the team, a name another Role has. A name several Roles go by picks
 * none of them: the caller is told their ids and names the one it means.
 */
export function roleNamed(
  ref: string,
): { ok: true; id: string; name: string } | { ok: false; reason: string } {
  const catalog = roleCatalog();
  const asked = ref.trim();
  const wanted = asked.toLowerCase();
  const byId = catalog.find((candidate) => candidate.id === wanted);
  if (byId) return { ok: true, id: byId.id, name: byId.name };
  const byName = catalog.filter((candidate) => candidate.name.toLowerCase() === wanted);
  if (byName.length === 1) return { ok: true, id: byName[0].id, name: byName[0].name };
  if (byName.length > 1) {
    const ids = byName.map((candidate) => candidate.id).join(', ');
    return {
      ok: false,
      reason: `${byName.length} Roles in this office are called ${asked}: ${ids}. Name the one you mean by its id. list_roles says what each one does.`,
    };
  }
  const known = catalog.map((candidate) => `${candidate.id} (${candidate.name})`).join(', ');
  return {
    ok: false,
    reason: `There is no Role ${asked || '""'} in this office. The Roles are: ${known}. list_roles says what each one does.`,
  };
}

export function createRoleOps(store: AgentStateStore): RoleOps {
  return {
    listRoles() {
      const holders = new Map<string, number[]>();
      for (const [id, agent] of store) {
        if (!agent.role) continue;
        const ids = holders.get(agent.role.id) ?? [];
        ids.push(id);
        holders.set(agent.role.id, ids);
      }
      return roleCatalog().map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        source: role.source,
        agents: holders.get(role.id) ?? [],
      }));
    },
  };
}
