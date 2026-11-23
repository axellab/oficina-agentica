/**
 * What the Crew panel prints, pure: a Crew's agents in the order they were
 * launched by each other, and one line per thing they did to each other.
 */

import type { Crew, CrewEvent, CrewMember } from '../../../core/src/messages.js';

/** One agent of a Crew, and how many launches away from its start it is. */
export interface CrewRow {
  member: CrewMember;
  /** 0 for the agent the user started the Crew with (and for one whose
   *  launcher has left), 1 for an agent it launched, and so on. */
  depth: number;
}

/**
 * A Crew's agents as a list that reads as a tree: each agent directly under
 * the one that launched it, launch order kept among siblings. An agent whose
 * launcher is no longer in the Crew stands at the top, like the first one.
 */
export function crewRows(crew: Crew): CrewRow[] {
  const ids = new Set(crew.members.map((member) => member.agentId));
  const launchedBy = (member: CrewMember): number | null =>
    member.launchedBy !== undefined &&
    member.launchedBy !== member.agentId &&
    ids.has(member.launchedBy)
      ? member.launchedBy
      : null;

  const rows: CrewRow[] = [];
  const listed = new Set<number>();
  const list = (parent: number | null, depth: number): void => {
    for (const member of crew.members) {
      if (listed.has(member.agentId) || launchedBy(member) !== parent) continue;
      listed.add(member.agentId);
      rows.push({ member, depth });
      list(member.agentId, depth + 1);
    }
  };
  list(null, 0);
  // A list that names launchers in a circle has no top: its agents are listed flat.
  for (const member of crew.members) {
    if (!listed.has(member.agentId)) rows.push({ member, depth: 0 });
  }
  return rows;
}

/**
 * One thing a Crew's agent did to another, as a line. An agent still in
 * `crew` goes by its label alone (the list above the events says its Role);
 * one that left keeps the name the server gave it at the time.
 */
export function crewEventLine(event: CrewEvent, crew?: Crew): string {
  const nameOf = (agentId: number, said: string | undefined): string =>
    crew?.members.find((member) => member.agentId === agentId)?.label ?? said ?? `agent ${agentId}`;
  const from = nameOf(event.fromId, event.from);
  const to = event.toIds.map((agentId, index) => nameOf(agentId, event.to[index])).join(', ');
  switch (event.kind) {
    case 'launched':
      return `${from} launched ${to}`;
    case 'closed':
      return `${from} closed ${to}`;
    case 'messaged':
      return `${from} to ${to}`;
    default:
      return `${from}, ${to}`;
  }
}

/** A member's line in a tooltip: its Role, and who launched it. */
export function crewMemberTitle(crew: Crew, member: CrewMember): string {
  const launcher =
    member.launchedBy === undefined
      ? undefined
      : crew.members.find((candidate) => candidate.agentId === member.launchedBy);
  return [
    `Agent ${member.agentId}`,
    ...(member.roleName ? [member.roleName] : []),
    member.launchedBy === undefined
      ? 'started the Crew'
      : `launched by ${launcher?.label ?? `agent ${member.launchedBy}`}`,
  ].join(' · ');
}

/** How many agents the Crews hold between them (the panel's header). */
export function crewAgentCount(crews: readonly Crew[]): number {
  return crews.reduce((count, crew) => count + crew.members.length, 0);
}
