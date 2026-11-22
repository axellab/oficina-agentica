/**
 * The Roles an agent can be launched as, as the server last sent them
 * (`rolesLoaded`), outside React like usage/usageStore.ts: the launch drawer
 * of either shell reads the same list (useRoles) with nothing threaded through
 * the shells' props. Empty until the server sends one, and for good where no
 * launch is possible (a read-only office is never sent the list).
 */

import { useSyncExternalStore } from 'react';

import { parseRoleListing, type Role } from '../../../core/src/roles.js';

const NO_ROLES: readonly Role[] = [];

let roles: readonly Role[] = NO_ROLES;
const listeners = new Set<() => void>();

/** Take a Roles message (useExtensionMessages). Returns whether it was one.
 *  Entries that are not Roles are left out; a list that is not one empties it. */
export function handleRolesMessage(msg: { type?: unknown; [key: string]: unknown }): boolean {
  if (msg.type !== 'rolesLoaded') return false;
  const listed = Array.isArray(msg.roles) ? msg.roles : [];
  roles = listed.flatMap((entry) => parseRoleListing(entry) ?? []);
  for (const listener of listeners) listener();
  return true;
}

/** The Roles of this office, in the server's order; the same array until a
 *  message replaces it. */
export function listedRoles(): readonly Role[] {
  return roles;
}

function subscribeRoles(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The Roles of this office, re-rendering when the server sends a new list. */
export function useRoles(): readonly Role[] {
  return useSyncExternalStore(subscribeRoles, listedRoles);
}

/** Tests only: forget the list. */
export function resetRoleStoreForTests(): void {
  roles = NO_ROLES;
}
