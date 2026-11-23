/**
 * Crews, pure (CONTEXT.md "Crew"): what an agent carries of its Crew, read
 * back from a saved file, and the `crewsLoaded` list as an office takes it off
 * the wire. The rules (who may start one, who joins, what its agents may do to
 * each other) are the server's, server/src/crews.ts.
 */

import { isRecord } from './isRecord.js';
import type { Crew, CrewEvent, CrewMember, CrewsLoaded } from './messages.js';

/** What an agent carries of its Crew, for its life. */
export interface AgentCrew {
  /** The Crew's id. */
  id: string;
  /** The agent that launched it; absent for the one the user started the Crew with. */
  launchedBy?: number;
  /** The user ended the Crew: its agents run on, without a Crew's freedom. */
  ended?: boolean;
}

function isAgentId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** An agent's Crew as a saved file gives it, or undefined when it isn't one
 *  (a hand-edited or older file restores the agent with no Crew, never junk). */
export function parseAgentCrew(raw: unknown): AgentCrew | undefined {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return undefined;
  const crew: AgentCrew = { id: raw.id };
  if (isAgentId(raw.launchedBy)) crew.launchedBy = raw.launchedBy;
  if (raw.ended === true) crew.ended = true;
  return crew;
}

function parseMember(raw: unknown): CrewMember | null {
  if (!isRecord(raw) || !isAgentId(raw.agentId) || typeof raw.label !== 'string') return null;
  const member: CrewMember = { agentId: raw.agentId, label: raw.label };
  if (typeof raw.roleName === 'string' && raw.roleName) member.roleName = raw.roleName;
  if (isAgentId(raw.launchedBy)) member.launchedBy = raw.launchedBy;
  return member;
}

const EVENT_KINDS: readonly string[] = ['launched', 'messaged', 'closed'];

function parseEvent(raw: unknown): CrewEvent | null {
  if (!isRecord(raw)) return null;
  const { at, kind, fromId, from, toIds, to, gist } = raw;
  if (typeof at !== 'number' || typeof kind !== 'string' || !EVENT_KINDS.includes(kind)) {
    return null;
  }
  if (!isAgentId(fromId) || typeof from !== 'string') return null;
  if (!Array.isArray(toIds) || !toIds.every(isAgentId)) return null;
  if (!Array.isArray(to) || !to.every((label) => typeof label === 'string')) return null;
  const event: CrewEvent = {
    at,
    kind: kind as CrewEvent['kind'],
    fromId,
    from,
    toIds: [...toIds],
    to: [...(to as string[])],
  };
  if (typeof gist === 'string' && gist) event.gist = gist;
  return event;
}

function parseCrew(raw: unknown): Crew | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const members = Array.isArray(raw.members) ? raw.members : [];
  const events = Array.isArray(raw.events) ? raw.events : [];
  return {
    id: raw.id,
    ended: raw.ended === true,
    members: members.flatMap((member) => parseMember(member) ?? []),
    events: events.flatMap((event) => parseEvent(event) ?? []),
  };
}

/**
 * A `crewsLoaded` message as an office keeps it, or null when it isn't one.
 * Lenient per entry, like the Roles list: a Crew, member or event that is not
 * one is left out and the rest kept.
 */
export function parseCrewsLoaded(raw: unknown): CrewsLoaded | null {
  if (!isRecord(raw) || raw.type !== 'crewsLoaded') return null;
  const crews = Array.isArray(raw.crews) ? raw.crews : [];
  const loaded: CrewsLoaded = {
    type: 'crewsLoaded',
    available: raw.available === true,
    maxAgents: isAgentId(raw.maxAgents) && raw.maxAgents > 0 ? raw.maxAgents : 0,
    crews: crews.flatMap((crew) => parseCrew(crew) ?? []),
  };
  if (typeof raw.unavailableReason === 'string' && raw.unavailableReason) {
    loaded.unavailableReason = raw.unavailableReason;
  }
  return loaded;
}

/** The Crew agent `agentId` is in, among `crews`. */
export function crewOfAgent(crews: readonly Crew[], agentId: number): Crew | undefined {
  return crews.find((crew) => crew.members.some((member) => member.agentId === agentId));
}
