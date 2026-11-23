/**
 * The Crews as the server last listed them (`crewsLoaded`), outside React like
 * roles/roleStore.ts: the launch drawer's switch, the agents' marks and the
 * Crew panel read the same list with nothing threaded through the shells'
 * props. Null until the server sends one, and for good where the office
 * launches no agents itself (VS Code): no Crew is offered or shown there.
 */

import { useSyncExternalStore } from 'react';

import { crewOfAgent, parseCrewsLoaded } from '../../../core/src/crews.js';
import type { Crew, CrewsLoaded } from '../../../core/src/messages.js';

let loaded: CrewsLoaded | null = null;
const listeners = new Set<() => void>();

/** Take a Crews message (useExtensionMessages). Returns whether it was one.
 *  A message that is not a list leaves the last one standing. */
export function handleCrewsMessage(msg: { type?: unknown; [key: string]: unknown }): boolean {
  if (msg.type !== 'crewsLoaded') return false;
  const parsed = parseCrewsLoaded(msg);
  if (!parsed) return true;
  loaded = parsed;
  for (const listener of listeners) listener();
  return true;
}

/** The server's last list; the same object until a message replaces it. */
export function crewsLoaded(): CrewsLoaded | null {
  return loaded;
}

function subscribeCrews(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The Crews of this office, re-rendering when the server sends a new list. */
export function useCrews(): CrewsLoaded | null {
  return useSyncExternalStore(subscribeCrews, crewsLoaded);
}

/** The Crew `agentId` is free in: one the user has not ended. An ended Crew's
 *  agents are ordinary agents again, so they wear no mark. */
export function activeCrewOf(list: CrewsLoaded | null, agentId: number): Crew | undefined {
  const crew = list ? crewOfAgent(list.crews, agentId) : undefined;
  return crew && !crew.ended ? crew : undefined;
}

/** Tests only: forget the list. */
export function resetCrewStoreForTests(): void {
  loaded = null;
}
