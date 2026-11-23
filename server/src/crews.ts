/**
 * Crews (CONTEXT.md "Crew"): the agents the user set free to work together.
 * One owner per office server, composed into the Pixel Office MCP feature
 * (composeOfficeMcp.ts), since a Crew works through that MCP's tools.
 *
 * - Started only by an office: a launch carrying `crew` (the launch drawer's
 *   switch). Never by an agent: no tool starts one.
 * - Joined only by being launched by one of its agents (launch_agent): the
 *   new agent carries the Crew for its life (`AgentState.crew`).
 * - What it gives is given at launch, by the launcher: the Crew's terms in the
 *   agent's instructions, the team tools called without a permission prompt
 *   (`CREW_PREAPPROVED_TOOLS`) and the CLI's own "ask before anything risky"
 *   mode. None of that can be taken back from a running process, so the limits
 *   are held HERE, at call time, whatever the agent was told:
 *     - a Crew holds at most `CREW_MAX_AGENTS` agents at a time;
 *     - its agents read, message and close only each other;
 *     - they never answer a colleague's permission prompt;
 *     - once the user ended it, they no longer launch, message or close anyone.
 * - Ended by the user (`endCrew`): its agents run on, without the freedom.
 *
 * Who is in a Crew is the store's fact (each agent's `crew`, persisted with
 * it); what its agents did to each other is kept here, in memory, for the
 * office's Crew panel.
 */

import { randomUUID } from 'crypto';

import type { AgentCrew } from '../../core/src/crews.js';
import type { Crew, CrewEvent, CrewEventKind, CrewsLoaded } from '../../core/src/messages.js';
import type { AgentStateStore } from './agentStateStore.js';
import { CREW_EVENTS_KEPT, CREW_MAX_AGENTS } from './constants.js';
import { agentLabel } from './mcp/agentLabel.js';
import type { AgentState } from './types.js';

export interface CrewsDeps {
  store: AgentStateStore;
  /** Why this office can't start a Crew now, in plain words; null when it can. */
  unavailable(): string | null;
  /** How many agents one Crew holds at a time (default: `CREW_MAX_AGENTS`). */
  maxAgents?: number;
  now?: () => number;
}

/** What a launch into a Crew is given. */
export interface CrewLaunch {
  /** What the launched agent carries. */
  crew: AgentCrew;
  /** How many agents the Crew holds at a time (its agents are told). */
  maxAgents: number;
}

/** A place in a Crew held for a launch under way. */
export interface CrewPlace {
  launch: CrewLaunch;
  /**
   * The launch is over. A place is the agent's own from the moment it joins
   * the office (counted once, as a member), so this gives back only the place
   * of a launch that brought no agent into the Crew: call it when the launch
   * itself has ended, not when its caller stopped waiting for it.
   */
  done(): void;
}

/** A place held for a launch that has not brought its agent yet. */
interface HeldPlace {
  /** Who asked for the launch: what its agent will carry. */
  launchedBy: number | undefined;
}

/** What one agent of a Crew does to another agent. */
export type CrewReach = 'read' | 'message' | 'close';

interface CrewRecord {
  id: string;
  /** Start order: the order Crews are listed in. */
  order: number;
  ended: boolean;
  /** Its agents in the office. */
  members: Set<number>;
  /** The places of launches under way, oldest first: each becomes its agent's
   *  when the agent joins, or is given back when its launch brought none. */
  places: HeldPlace[];
  events: CrewEvent[];
}

const REACH_VERB: Record<CrewReach, string> = {
  read: 'read the terminal of',
  message: 'message',
  close: 'close',
};

export class Crews {
  private readonly records = new Map<string, CrewRecord>();
  private nextOrder = 1;
  private readonly detach: () => void;

  constructor(private readonly deps: CrewsDeps) {
    const { store } = deps;
    const onAdded = (id: number, agent: AgentState): void => {
      if (this.admit(id, agent)) this.broadcast();
    };
    const onRemoved = (id: number): void => {
      if (this.dismiss(id)) this.broadcast();
    };
    store.on('agentAdded', onAdded);
    store.on('agentRemoved', onRemoved);
    this.detach = () => {
      store.off('agentAdded', onAdded);
      store.off('agentRemoved', onRemoved);
    };
    // Agents already in the office (restored before this was composed).
    for (const [id, agent] of store) this.admit(id, agent);
  }

  dispose(): void {
    this.detach();
  }

  /** How many agents one Crew holds at a time. */
  get maxAgents(): number {
    return this.deps.maxAgents ?? CREW_MAX_AGENTS;
  }

  // ── The wire ──────────────────────────────────────────────

  statusMessage(): CrewsLoaded {
    const reason = this.deps.unavailable();
    const crews: Crew[] = [];
    for (const record of [...this.records.values()].sort((a, b) => a.order - b.order)) {
      const members = this.membersOf(record);
      // A Crew whose first launch is still under way has no one to show yet.
      if (members.length === 0) continue;
      crews.push({
        id: record.id,
        ended: record.ended,
        members: members.map(([agentId, agent]) => ({
          agentId,
          label: agentLabel(agent) ?? `agent ${agentId}`,
          ...(agent.role ? { roleName: agent.role.name } : {}),
          ...(agent.crew?.launchedBy !== undefined ? { launchedBy: agent.crew.launchedBy } : {}),
        })),
        events: record.events.map((event) => ({ ...event })),
      });
    }
    return {
      type: 'crewsLoaded',
      available: reason === null,
      ...(reason !== null ? { unavailableReason: reason } : {}),
      maxAgents: this.maxAgents,
      crews,
    };
  }

  /** Every office hears the list as it is now. */
  broadcast(): void {
    this.deps.store.broadcast({ ...this.statusMessage() });
  }

  /** Answer an office's Crew message; false when it isn't one. */
  handleMessage(msg: Record<string, unknown>): boolean {
    if (msg.type !== 'endCrew') return false;
    if (typeof msg.crewId === 'string') this.end(msg.crewId);
    return true;
  }

  // ── Starting, joining, ending ─────────────────────────────

  /**
   * The user's launch starts a Crew: the place its first agent takes, or
   * undefined where none can be started now (the agent then launches without
   * one, which the office shows; a launch that did nothing would show nothing).
   */
  startForLaunch(): CrewPlace | undefined {
    const reason = this.deps.unavailable();
    if (reason !== null) {
      console.warn(`[Pixel Agents] Crews: launching without a Crew. ${reason}`);
      return undefined;
    }
    return this.hold(this.record(randomUUID(), false), undefined);
  }

  /**
   * A launch asked by agent `caller` (launch_agent): no place when it is in no
   * Crew (a launch like any other: its CLI asked the user), a place in its
   * Crew for the new agent, or why its Crew takes no one.
   */
  joinFor(caller: number): { ok: true; place?: CrewPlace } | { ok: false; reason: string } {
    const crew = this.deps.store.get(caller)?.crew;
    if (!crew) return { ok: true };
    const record = this.records.get(crew.id);
    if (!record || record.ended || crew.ended) {
      return {
        ok: false,
        reason:
          'The user ended your Crew, so you can no longer launch agents. Tell the user what you need: they can launch it from the office.',
      };
    }
    const size = this.membersOf(record).length + record.places.length;
    if (size >= this.maxAgents) {
      return {
        ok: false,
        reason: `Your Crew has ${size} agents, the most one Crew holds at a time. Close one whose part is done (close_agent) and launch again, or do the work with the agents it has.`,
      };
    }
    return { ok: true, place: this.hold(record, caller) };
  }

  /** The user ended Crew `crewId`: its agents run on, without a Crew's freedom. */
  end(crewId: string): boolean {
    const record = this.records.get(crewId);
    if (!record || record.ended) return false;
    record.ended = true;
    for (const [, agent] of this.membersOf(record)) {
      agent.crew = { ...agent.crew, id: record.id, ended: true };
    }
    this.deps.store.persist();
    console.log(`[Pixel Agents] Crews: the user ended a Crew of ${record.members.size} agent(s)`);
    this.broadcast();
    return true;
  }

  // ── What a Crew's agent may do ────────────────────────────

  /**
   * Why agent `caller` may not do this to agent `target`, or null when it may.
   * Only a Crew's agent is held to anything here: its team tools run without
   * a permission prompt, so nobody else is asked. Its own terminal is its own.
   */
  reachProblem(caller: number, target: number, doing: CrewReach): string | null {
    const { store } = this.deps;
    const crew = store.get(caller)?.crew;
    if (!crew || caller === target) return null;
    const verb = REACH_VERB[doing];
    const theirs = store.get(target);
    if (!theirs) return null; // No such agent: the tool says so itself.
    if (this.crewIdOf(theirs) !== crew.id) {
      return `Agent ${target} is not in your Crew: a Crew's agents ${verb} only each other. It is the user's to ask.`;
    }
    // Reading stays: it changes nothing, and an agent may still report on its colleagues.
    if (doing !== 'read' && this.ended(crew)) {
      return `The user ended your Crew: its agents no longer ${verb} each other. Finish your turn, say where things stand, and wait for the user.`;
    }
    return null;
  }

  /**
   * Why a Crew's agent may not type into agent `target` now, or null: a
   * permission prompt is the user's to answer, whoever is on the Crew.
   */
  promptProblem(caller: number, target: number): string | null {
    const { store } = this.deps;
    if (!store.get(caller)?.crew) return null;
    const leaveIt =
      'Only the user answers that: leave it, and carry on with what does not depend on it.';
    if (store.get(target)?.permissionSent) {
      return `Agent ${target} is waiting for the user to allow something. ${leaveIt}`;
    }
    // A Teammate's prompt opens in its Lead's terminal, and it is the Teammate
    // that is marked as waiting (hookEventHandler's handlePermissionRequest).
    for (const [id, agent] of store) {
      if (agent.leadAgentId === target && agent.permissionSent) {
        return `Agent ${target}'s terminal is where its Teammate, agent ${id}, is waiting for the user to allow something. ${leaveIt}`;
      }
    }
    return null;
  }

  // ── The panel's events ────────────────────────────────────

  /** How an agent reads in a Crew's events: its label, its Role in brackets. */
  nameOf(agentId: number): string {
    const agent = this.deps.store.get(agentId);
    const label = agent ? agentLabel(agent) : null;
    const role = agent?.role?.name;
    if (label && role) return `${label} (${role})`;
    return label ?? role ?? `agent ${agentId}`;
  }

  /**
   * Agent `fromId` did this to `toIds`: kept for its Crew's panel, the newest
   * `CREW_EVENTS_KEPT`. Nothing when it is in no Crew. `toNames` when the
   * recipients may have left by now (a close).
   */
  note(
    kind: CrewEventKind,
    fromId: number,
    toIds: readonly number[],
    opts: { gist?: string; toNames?: readonly string[] } = {},
  ): void {
    const crew = this.deps.store.get(fromId)?.crew;
    const record = crew && this.records.get(crew.id);
    if (!record || toIds.length === 0) return;
    const event: CrewEvent = {
      at: (this.deps.now ?? Date.now)(),
      kind,
      fromId,
      from: this.nameOf(fromId),
      toIds: [...toIds],
      to: opts.toNames ? [...opts.toNames] : toIds.map((id) => this.nameOf(id)),
      ...(opts.gist ? { gist: opts.gist } : {}),
    };
    record.events.push(event);
    if (record.events.length > CREW_EVENTS_KEPT) {
      record.events.splice(0, record.events.length - CREW_EVENTS_KEPT);
    }
    this.broadcast();
  }

  // ── Internals ─────────────────────────────────────────────

  private ended(crew: AgentCrew): boolean {
    return crew.ended === true || this.records.get(crew.id)?.ended !== false;
  }

  /** The Crew an agent belongs to: its own, or, for a Teammate (part of its
   *  Lead's work, with no Crew of its own), its Lead's. */
  private crewIdOf(agent: AgentState): string | undefined {
    if (agent.crew) return agent.crew.id;
    if (agent.leadAgentId === undefined) return undefined;
    return this.deps.store.get(agent.leadAgentId)?.crew?.id;
  }

  private membersOf(record: CrewRecord): Array<[number, AgentState]> {
    const members: Array<[number, AgentState]> = [];
    for (const id of record.members) {
      const agent = this.deps.store.get(id);
      if (agent) members.push([id, agent]);
    }
    return members;
  }

  private record(id: string, ended: boolean): CrewRecord {
    const record: CrewRecord = {
      id,
      order: this.nextOrder++,
      ended,
      members: new Set(),
      places: [],
      events: [],
    };
    this.records.set(id, record);
    return record;
  }

  private hold(record: CrewRecord, launchedBy: number | undefined): CrewPlace {
    const place: HeldPlace = { launchedBy };
    record.places.push(place);
    return {
      launch: {
        crew: launchedBy === undefined ? { id: record.id } : { id: record.id, launchedBy },
        maxAgents: this.maxAgents,
      },
      done: () => {
        const at = record.places.indexOf(place);
        if (at < 0) return; // Its agent took it, or it was given back already.
        record.places.splice(at, 1);
        this.forgetIfEmpty(record);
      },
    };
  }

  /** An agent joined the office: its Crew's, when it carries one. A Crew this
   *  server never started (an agent whose terminal outlived the last one) is
   *  taken up as its agents say it stands. */
  private admit(id: number, agent: AgentState): boolean {
    const crew = agent.crew;
    if (!crew) return false;
    const record = this.records.get(crew.id) ?? this.record(crew.id, crew.ended === true);
    if (crew.ended && !record.ended) record.ended = true;
    if (record.ended && !crew.ended) agent.crew = { ...crew, ended: true };
    record.members.add(id);
    // The place its launch held is the agent itself from here on: counted once,
    // whatever its launch still waits for (two launches by one agent are told
    // apart by nothing that matters to the count, so the oldest goes).
    const held = record.places.findIndex((place) => place.launchedBy === crew.launchedBy);
    if (held >= 0) record.places.splice(held, 1);
    return true;
  }

  private dismiss(id: number): boolean {
    for (const record of this.records.values()) {
      if (!record.members.delete(id)) continue;
      this.forgetIfEmpty(record);
      return true;
    }
    return false;
  }

  /** A Crew is kept until its last agent left (and no launch is bringing one). */
  private forgetIfEmpty(record: CrewRecord): void {
    if (record.places.length === 0 && record.members.size === 0) this.records.delete(record.id);
  }
}
