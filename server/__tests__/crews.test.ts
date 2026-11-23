/**
 * Crews, on their own: the rules a Crew's agents are held to at call time
 * (server/src/crews.ts), over a real store with agents put in by hand. What a
 * launch gives a Crew's agent, and the tools refusing through these rules, is
 * officeMcpCrews.test.ts.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { parseAgentCrew, parseCrewsLoaded } from '../../core/src/crews.js';
import { restoredAgentInit, toPersistedAgent } from '../src/agentPersistence.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { CREW_EVENTS_KEPT, CREW_MAX_AGENTS } from '../src/constants.js';
import { type CrewPlace, Crews } from '../src/crews.js';
import type { AgentState } from '../src/types.js';

describe('Crews', () => {
  let store: AgentStateStore;
  let crews: Crews;
  let sent: Array<Record<string, unknown>>;
  let unavailable: string | null;
  let nextId: number;

  function setUp(maxAgents?: number): void {
    store = new AgentStateStore();
    sent = [];
    unavailable = null;
    nextId = 1;
    store.on('broadcast', (message) => sent.push(message));
    crews = new Crews({ store, unavailable: () => unavailable, maxAgents, now: () => 1000 });
  }
  afterEach(() => crews?.dispose());

  /** An agent joining the office, as a launch admits it: in `place`'s Crew when given. */
  function join(place?: CrewPlace, more: Partial<AgentState> = {}): number {
    const id = nextId++;
    store.set(
      id,
      createAgentState({
        id,
        sessionId: `session-${id}`,
        projectDir: '/tmp/p',
        jsonlFile: `/tmp/p/session-${id}.jsonl`,
        isExternal: false,
        directoryName: 'proj',
        crew: place?.launch.crew,
        ...more,
      }),
    );
    place?.done();
    return id;
  }

  /** A Crew started by the user, with its first agent in the office. */
  function started(): number {
    return join(crews.startForLaunch());
  }

  /** An agent launched by `caller` (launch_agent), in its Crew when it has one. */
  function launchedBy(caller: number): number {
    const joining = crews.joinFor(caller);
    if (!joining.ok) throw new Error(joining.reason);
    return join(joining.place);
  }

  const listed = () => crews.statusMessage().crews;

  it('the user starts a Crew with a launch; an agent launched by one of its agents is in it', () => {
    setUp();
    const starter = started();
    const colleague = launchedBy(starter);
    const third = launchedBy(colleague);

    const [crew] = listed();
    expect(listed()).toHaveLength(1);
    expect(crew.ended).toBe(false);
    expect(crew.members).toEqual([
      { agentId: starter, label: 'proj' },
      { agentId: colleague, label: 'proj', launchedBy: starter },
      { agentId: third, label: 'proj', launchedBy: colleague },
    ]);
    expect(store.get(colleague)!.crew).toEqual({ id: crew.id, launchedBy: starter });
    // Every office heard of each of them as it joined.
    expect(sent.filter((m) => m.type === 'crewsLoaded')).toHaveLength(3);
    expect(crews.statusMessage()).toMatchObject({ available: true, maxAgents: CREW_MAX_AGENTS });
  });

  it('an agent in no Crew launches like any other: no place, and its agent is in none', () => {
    setUp();
    const plain = join();
    expect(crews.joinFor(plain)).toEqual({ ok: true });
    const other = launchedBy(plain);
    expect(store.get(other)!.crew).toBeUndefined();
    expect(listed()).toEqual([]);
  });

  it('starts none where the office cannot: the launch goes on without a Crew', () => {
    setUp();
    unavailable = 'The Pixel Agents Office MCP is off.';
    expect(crews.startForLaunch()).toBeUndefined();
    expect(crews.statusMessage()).toMatchObject({
      available: false,
      unavailableReason: 'The Pixel Agents Office MCP is off.',
      crews: [],
    });
  });

  it('holds only so many agents at a time, launches under way counted, and frees a place when one leaves', () => {
    setUp(3);
    const starter = started();
    const second = launchedBy(starter);
    // A launch still under way holds its place.
    const pending = crews.joinFor(second);
    expect(pending.ok && pending.place).toBeTruthy();
    const full = crews.joinFor(starter);
    expect(full).toMatchObject({ ok: false });
    expect(!full.ok && full.reason).toMatch(/has 3 agents, the most one Crew holds/);
    expect(!full.ok && full.reason).toMatch(/close_agent/);

    // That launch failed: its place is free again.
    if (pending.ok) pending.place!.done();
    const third = launchedBy(starter);
    expect(crews.joinFor(third)).toMatchObject({ ok: false });

    // One whose part is done leaves: room for another.
    store.delete(second);
    expect(crews.joinFor(third)).toMatchObject({ ok: true });
  });

  it('a Crew whose first launch failed is forgotten, and one is listed until its last agent leaves', () => {
    setUp();
    crews.startForLaunch()!.done();
    expect(listed()).toEqual([]);

    const starter = started();
    const colleague = launchedBy(starter);
    store.delete(starter);
    // The agent the user started it with left: the others are still a Crew.
    expect(listed()[0].members.map((m) => m.agentId)).toEqual([colleague]);
    expect(crews.joinFor(colleague)).toMatchObject({ ok: true });
    store.delete(colleague);
    expect(listed()).toEqual([]);
  });

  it("its agents reach only each other; an agent in no Crew is the user's to ask, and is held to nothing here", () => {
    setUp();
    const starter = started();
    const colleague = launchedBy(starter);
    const outsider = join();
    const otherCrew = started();

    for (const doing of ['read', 'message', 'close'] as const) {
      expect(crews.reachProblem(starter, colleague, doing)).toBeNull();
      expect(crews.reachProblem(colleague, starter, doing)).toBeNull();
      expect(crews.reachProblem(starter, starter, doing)).toBeNull();
      expect(crews.reachProblem(starter, outsider, doing)).toMatch(
        new RegExp(`Agent ${outsider} is not in your Crew`),
      );
      expect(crews.reachProblem(starter, otherCrew, doing)).toMatch(/not in your Crew/);
      // Its CLI asked the user before the call: nothing more is asked here.
      expect(crews.reachProblem(outsider, starter, doing)).toBeNull();
    }
    expect(crews.reachProblem(starter, outsider, 'read')).toMatch(/read the terminal of only/);
  });

  it("a Teammate is part of its Lead's work: reached by its Lead's Crew", () => {
    setUp();
    const starter = started();
    const lead = launchedBy(starter);
    const teammate = join(undefined, { leadAgentId: lead, agentName: 'reviewer' });
    const strangersTeammate = join(undefined, { leadAgentId: join(), agentName: 'x' });

    expect(crews.reachProblem(starter, teammate, 'read')).toBeNull();
    expect(crews.reachProblem(starter, strangersTeammate, 'read')).toMatch(/not in your Crew/);
  });

  it("never types into an agent waiting on the user's permission", () => {
    setUp();
    const starter = started();
    const colleague = launchedBy(starter);
    const outsider = join();
    expect(crews.promptProblem(starter, colleague)).toBeNull();

    store.get(colleague)!.permissionSent = true;
    expect(crews.promptProblem(starter, colleague)).toMatch(/Only the user answers that/);
    // An agent in no Crew asked the user before its send_message ran.
    expect(crews.promptProblem(outsider, colleague)).toBeNull();
  });

  it('the user ends a Crew: its agents run on, but launch, message and close no one; reading stays', () => {
    setUp();
    const starter = started();
    const colleague = launchedBy(starter);
    const crewId = listed()[0].id;

    expect(crews.handleMessage({ type: 'endCrew', crewId: 'no-such-crew' })).toBe(true);
    expect(listed()[0].ended).toBe(false);
    expect(crews.handleMessage({ type: 'endCrew', crewId })).toBe(true);
    expect(crews.handleMessage({ type: 'somethingElse' })).toBe(false);

    expect(listed()[0]).toMatchObject({ id: crewId, ended: true });
    expect(store.has(starter) && store.has(colleague)).toBe(true);
    expect(store.get(colleague)!.crew).toEqual({ id: crewId, launchedBy: starter, ended: true });
    const refused = crews.joinFor(starter);
    expect(!refused.ok && refused.reason).toMatch(/The user ended your Crew/);
    expect(crews.reachProblem(starter, colleague, 'message')).toMatch(
      /no longer message each other/,
    );
    expect(crews.reachProblem(starter, colleague, 'close')).toMatch(/no longer close each other/);
    expect(crews.reachProblem(starter, colleague, 'read')).toBeNull();
    expect(crews.reachProblem(starter, starter, 'close')).toBeNull();
    // Ending twice changes nothing.
    expect(crews.end(crewId)).toBe(false);
  });

  it('keeps what its agents did to each other, the newest only, named as they were then', () => {
    setUp();
    const starter = join(crews.startForLaunch(), {
      nickname: 'boss',
      role: { id: 'agile-project-manager', name: 'Agile Project Manager', color: 'purple' },
    });
    const colleague = launchedBy(starter);
    const outsider = join();

    crews.note('launched', starter, [colleague], { gist: 'Pick up story 1' });
    crews.note('messaged', starter, [colleague], { gist: 'Daily?' });
    crews.note('closed', starter, [colleague], { toNames: ['proj (as it was)'] });
    // An agent in no Crew leaves no line.
    crews.note('messaged', outsider, [starter], { gist: 'hi' });

    expect(listed()[0].events).toEqual([
      {
        at: 1000,
        kind: 'launched',
        fromId: starter,
        from: 'boss (Agile Project Manager)',
        toIds: [colleague],
        to: ['proj'],
        gist: 'Pick up story 1',
      },
      {
        at: 1000,
        kind: 'messaged',
        fromId: starter,
        from: 'boss (Agile Project Manager)',
        toIds: [colleague],
        to: ['proj'],
        gist: 'Daily?',
      },
      {
        at: 1000,
        kind: 'closed',
        fromId: starter,
        from: 'boss (Agile Project Manager)',
        toIds: [colleague],
        to: ['proj (as it was)'],
      },
    ]);

    for (let i = 0; i < CREW_EVENTS_KEPT + 5; i++) {
      crews.note('messaged', starter, [colleague], { gist: `message ${i}` });
    }
    const events = listed()[0].events;
    expect(events).toHaveLength(CREW_EVENTS_KEPT);
    expect(events.at(-1)!.gist).toBe(`message ${CREW_EVENTS_KEPT + 4}`);
  });

  it('an agent whose terminal outlived the server keeps its Crew, ended or not', () => {
    setUp();
    const starter = started();
    const colleague = launchedBy(starter);
    crews.end(listed()[0].id);

    // What is saved of them, read back by a new server.
    const saved = [starter, colleague].map((id) => toPersistedAgent(store.get(id)!)!);
    expect(saved[1].crew).toEqual({ id: saved[0].crew!.id, launchedBy: starter, ended: true });
    crews.dispose();
    setUp();
    for (const record of saved) {
      store.set(record.id, createAgentState({ ...restoredAgentInit(record), isExternal: false }));
    }

    expect(listed()).toHaveLength(1);
    expect(listed()[0]).toMatchObject({ ended: true });
    expect(listed()[0].members.map((m) => m.agentId)).toEqual([starter, colleague]);
    expect(crews.joinFor(starter)).toMatchObject({ ok: false });
  });
});

describe('core crews', () => {
  it('parseAgentCrew reads a saved Crew, and nothing else as one', () => {
    expect(parseAgentCrew({ id: 'c1', launchedBy: 2, ended: true, more: 'x' })).toEqual({
      id: 'c1',
      launchedBy: 2,
      ended: true,
    });
    expect(parseAgentCrew({ id: 'c1', launchedBy: '2', ended: 'yes' })).toEqual({ id: 'c1' });
    for (const junk of [undefined, null, 'c1', [], {}, { id: '' }, { id: 3 }]) {
      expect(parseAgentCrew(junk)).toBeUndefined();
    }
  });

  it('parseCrewsLoaded keeps what is a Crew and leaves the rest out', () => {
    const loaded = parseCrewsLoaded({
      type: 'crewsLoaded',
      available: true,
      maxAgents: 8,
      crews: [
        {
          id: 'c1',
          ended: false,
          members: [{ agentId: 1, label: 'Byte', roleName: 'Developer' }, { agentId: 'two' }],
          events: [
            { at: 1, kind: 'launched', fromId: 1, from: 'Byte', toIds: [2], to: ['Pip'] },
            { at: 2, kind: 'danced', fromId: 1, from: 'Byte', toIds: [2], to: ['Pip'] },
          ],
        },
        { ended: true },
        'junk',
      ],
    });
    expect(loaded).toEqual({
      type: 'crewsLoaded',
      available: true,
      maxAgents: 8,
      crews: [
        {
          id: 'c1',
          ended: false,
          members: [{ agentId: 1, label: 'Byte', roleName: 'Developer' }],
          events: [{ at: 1, kind: 'launched', fromId: 1, from: 'Byte', toIds: [2], to: ['Pip'] }],
        },
      ],
    });
    expect(parseCrewsLoaded({ type: 'rolesLoaded' })).toBeNull();
    expect(parseCrewsLoaded({ type: 'crewsLoaded' })).toEqual({
      type: 'crewsLoaded',
      available: false,
      maxAgents: 0,
      crews: [],
    });
  });
});
