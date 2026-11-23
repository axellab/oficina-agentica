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
import { createLaunching } from '../src/mcp/lifecycle.js';
import { createMessaging, type DeliveryGuard } from '../src/mcp/messaging.js';
import type { OfficeFacts } from '../src/mcp/officeFacts.js';
import { type AgentTerminals, PLAIN_INPUT_MODES } from '../src/terminal/agentTerminals.js';
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

  /** An agent joining the office, as a launch admits it: in `place`'s Crew when
   *  given. `settled: false` leaves its launch under way (the wait for its CLI). */
  function join(place?: CrewPlace, more: Partial<AgentState> = {}, settled = true): number {
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
    if (settled) place?.done();
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

  it("a place is its agent's once it joins: counted once while its launch still waits, and kept by a launch that outlives its answer", () => {
    setUp(3);
    const starter = started();
    // Joined the office, its launch still waiting on its CLI: one agent, not two.
    const joining = crews.joinFor(starter);
    if (!joining.ok) throw new Error(joining.reason);
    const second = join(joining.place, {}, false);
    const third = crews.joinFor(starter);
    expect(third).toMatchObject({ ok: true });
    expect(crews.joinFor(second)).toMatchObject({ ok: false });
    // The wait ending changes nothing: the place was the agent's already.
    joining.place!.done();
    expect(crews.joinFor(second)).toMatchObject({ ok: false });

    // A launch whose answer stopped waiting for it keeps its place until it is
    // over, so the agent it brings later is never one too many.
    const late = third.ok ? third.place! : undefined;
    expect(crews.joinFor(starter)).toMatchObject({ ok: false });
    const latecomer = join(late, {}, false);
    expect(listed()[0].members.map((m) => m.agentId)).toEqual([starter, second, latecomer]);
    expect(crews.joinFor(starter)).toMatchObject({ ok: false });
    late!.done();
    expect(crews.joinFor(starter)).toMatchObject({ ok: false });

    // An agent that left while its launch was still waiting frees its place once.
    store.delete(latecomer);
    expect(crews.joinFor(starter)).toMatchObject({ ok: true });
  });

  it('launch_agent gives its place back when the launch is over, not when its answer stopped waiting', async () => {
    setUp(2);
    const starter = started();
    let finish!: () => void;
    const underway = new Promise<void>((resolve) => (finish = resolve));
    const launching = createLaunching(
      // A launch that fails reads nothing of the office but its agents.
      { store } as OfficeFacts,
      async () => ({ ok: false, reason: 'It may still join.', underway }),
      crews,
      () => {},
    );

    const answer = await launching.launchAgent({ caller: starter, directory: '/tmp/p', asks: {} });
    expect(answer).toEqual({ ok: false, reason: 'It may still join.' });
    // Still on its way: the Crew's second place is not another launch's to take.
    expect(crews.joinFor(starter)).toMatchObject({ ok: false });

    finish();
    await underway;
    await new Promise((resolve) => setImmediate(resolve));
    expect(crews.joinFor(starter)).toMatchObject({ ok: true });
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

  it("a Teammate's permission prompt opens in its Lead's terminal: nobody types there either", () => {
    setUp();
    const starter = started();
    const lead = launchedBy(starter);
    const teammate = join(undefined, { leadAgentId: lead, agentName: 'reviewer' });
    expect(crews.promptProblem(starter, lead)).toBeNull();

    // The hook handler marks the Teammate as waiting, never its Lead.
    store.get(teammate)!.permissionSent = true;
    expect(store.get(lead)!.permissionSent).toBe(false);
    expect(crews.promptProblem(starter, lead)).toMatch(
      new RegExp(`its Teammate, agent ${teammate}, is waiting for the user`),
    );
    expect(crews.promptProblem(starter, lead)).toMatch(/Only the user answers that/);
    // Another agent's Teammate waiting says nothing of this one's terminal.
    expect(crews.promptProblem(lead, starter)).toBeNull();
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

  describe('a Message under way', () => {
    /** What was written to each agent's terminal, and a hook run on every write. */
    function terminalsOf(onWrite: (id: number, bytes: string) => void = () => {}): {
      terminals: AgentTerminals;
      written: Array<[number, string]>;
    } {
      const written: Array<[number, string]> = [];
      return {
        written,
        terminals: {
          has: () => true,
          screen: async () => null,
          write(id, bytes) {
            written.push([id, bytes]);
            onWrite(id, bytes);
          },
        },
      };
    }
    /** A guard that lets everything through, once `gate` (when given) opens. */
    const openGuard = (gate?: Promise<void>): DeliveryGuard => ({
      async check() {
        await gate;
        return { ok: true, modes: PLAIN_INPUT_MODES };
      },
      beforeSubmit: () => null,
    });
    const recipient = (id: number) => ({ id, screenToken: undefined });

    it('keys stop at the one a permission prompt opened before', async () => {
      setUp();
      const starter = started();
      const colleague = launchedBy(starter);
      // The prompt opens as the first key lands.
      const { terminals, written } = terminalsOf((id) => {
        store.get(id)!.permissionSent = true;
      });
      const messaging = createMessaging(store, terminals, openGuard(), crews);

      const [delivery] = await messaging.sendMessage({
        from: starter,
        to: [recipient(colleague)],
        content: { keys: ['down', 'down', 'enter'] },
      });

      expect(written).toHaveLength(1);
      expect(delivery).toMatchObject({ id: colleague, delivered: false });
      expect(!delivery.delivered && delivery.reason).toMatch(/Only the user answers that/);
      expect(!delivery.delivered && delivery.reason).toMatch(/1 of your 3 keys were typed/);
    });

    it('text typed before a prompt opened is left unsubmitted', async () => {
      setUp();
      const starter = started();
      const colleague = launchedBy(starter);
      const { terminals, written } = terminalsOf((id) => {
        store.get(id)!.permissionSent = true;
      });
      const messaging = createMessaging(store, terminals, openGuard(), crews);

      const [delivery] = await messaging.sendMessage({
        from: starter,
        to: [recipient(colleague)],
        content: { text: 'ready for review', submit: true },
      });

      // The paste, and no Enter after it.
      expect(written).toHaveLength(1);
      expect(written[0][1]).toContain('ready for review');
      expect(!delivery.delivered && delivery.reason).toMatch(
        /typed into agent .* but not submitted/,
      );
    });

    it('one that waited its turn is not typed once the user ended the Crew', async () => {
      setUp();
      const starter = started();
      const colleague = launchedBy(starter);
      const { terminals, written } = terminalsOf();
      let open!: () => void;
      const gate = new Promise<void>((resolve) => (open = resolve));
      const messaging = createMessaging(store, terminals, openGuard(gate), crews);

      // Asked while the Crew stood, checked by the guard after it ended.
      const sending = messaging.sendMessage({
        from: starter,
        to: [recipient(colleague)],
        content: { text: 'one more thing', submit: true },
      });
      crews.end(listed()[0].id);
      open();
      const [delivery] = await sending;

      expect(written).toEqual([]);
      expect(!delivery.delivered && delivery.reason).toMatch(/The user ended your Crew/);
    });
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
