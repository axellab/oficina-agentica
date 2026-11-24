/**
 * Waiting for agents (wait_for_agents), the rules alone: when a waited agent
 * counts as no longer working, what a hand-over changes, and what ends a wait
 * early. Over a real store and Crews, on fake timers (a wait polls and lets a
 * turn's end settle), with the store's own status reports driving it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import {
  QUEUED_HANDOVER_QUIET_MS,
  TURN_END_SETTLE_MS,
  WAIT_FOR_AGENTS_POLL_MS,
} from '../src/constants.js';
import { Crews } from '../src/crews.js';
import { type AgentWaitOutcome, type AgentWaits, createAgentWaits } from '../src/mcp/agentWaits.js';
import { createMessaging, type DeliveryGuard } from '../src/mcp/messaging.js';
import type { AgentWaitResult } from '../src/mcp/officeOperations.js';
import {
  type AgentTerminals,
  keyBytes,
  PLAIN_INPUT_MODES,
} from '../src/terminal/agentTerminals.js';
import type { AgentState } from '../src/types.js';

/** Long enough for a rested agent to count: the settle time and a look after it. */
const SETTLED_MS = TURN_END_SETTLE_MS + 2 * WAIT_FOR_AGENTS_POLL_MS;

describe('Waiting for agents', () => {
  let store: AgentStateStore;
  let crews: Crews;
  let waits: AgentWaits;
  let nextId: number;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new AgentStateStore();
    crews = new Crews({ store, unavailable: () => null });
    waits = createAgentWaits(store);
    nextId = 1;
  });
  afterEach(() => {
    waits.dispose();
    crews.dispose();
    vi.useRealTimers();
  });

  function join(more: Partial<AgentState> = {}): number {
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
        ...more,
      }),
    );
    return id;
  }
  const active = (id: number): void => store.setAgentStatus(id, { active: true });
  /** A turn's end as the CLI's Stop (or the transcript) reports it. */
  const done = (id: number): void =>
    store.setAgentStatus(id, { active: false, awaitingInput: false });
  /** The CLI's reminder, a minute on, that an agent is still idle. */
  const idleReminder = (id: number): void =>
    store.setAgentStatus(id, { active: false, awaitingInput: true });
  const pass = (ms: number): Promise<unknown> => vi.advanceTimersByTimeAsync(ms);

  /** A wait under way, and whether it has answered yet. */
  function waiting<T>(promise: Promise<T>): { answered: () => T | undefined } {
    let answer: T | undefined;
    void promise.then((value) => (answer = value));
    return { answered: () => answer };
  }
  const waitFor = (
    caller: number,
    ids: number[],
    more: { until?: 'any' | 'all'; timeoutMs?: number; signal?: AbortSignal } = {},
  ): { answered: () => AgentWaitOutcome | undefined } =>
    waiting(waits.wait({ caller, ids, until: 'any', timeoutMs: 60_000, ...more }));

  // ── When an agent counts ────────────────────────────────────

  it('an agent with no turn running and nothing handed to it counts once it has rested', async () => {
    const lead = join();
    const colleague = join();
    const wait = waitFor(lead, [colleague]);

    await pass(TURN_END_SETTLE_MS - WAIT_FOR_AGENTS_POLL_MS);
    expect(wait.answered()).toBeUndefined();
    await pass(2 * WAIT_FOR_AGENTS_POLL_MS);
    expect(wait.answered()).toMatchObject({ timedOut: false });
    expect(wait.answered()!.states.get(colleague)).toBe('turn ended');
  });

  it('an agent in a turn is waited for until the turn ends', async () => {
    const lead = join();
    const colleague = join();
    active(colleague);
    const wait = waitFor(lead, [colleague]);

    await pass(30_000);
    expect(wait.answered()).toBeUndefined();
    done(colleague);
    await pass(SETTLED_MS);
    expect(wait.answered()!.states.get(colleague)).toBe('turn ended');
    expect(wait.answered()!.waitedMs).toBeGreaterThanOrEqual(30_000);
  });

  it('an agent handed work is working until a turn of its own ends, whatever its status reads', async () => {
    const lead = join();
    const colleague = join();
    done(colleague);
    waits.handedWork(colleague);
    const wait = waitFor(lead, [colleague]);

    // Still `done` from the turn before: the handed work has not begun.
    await pass(5_000);
    expect(wait.answered()).toBeUndefined();
    // The CLI's idle reminder is no turn end.
    idleReminder(colleague);
    await pass(5_000);
    expect(wait.answered()).toBeUndefined();

    active(colleague);
    done(colleague);
    await pass(SETTLED_MS);
    expect(wait.answered()!.states.get(colleague)).toBe('turn ended');
  });

  it('a turn of words only ends on a `done` that follows a `done`', async () => {
    const lead = join();
    const colleague = join();
    done(colleague);
    waits.handedWork(colleague);
    const wait = waitFor(lead, [colleague]);
    await pass(5_000);

    // Hooks report no start for a turn without tools: its Stop is all there is.
    done(colleague);
    await pass(SETTLED_MS);
    expect(wait.answered()!.states.get(colleague)).toBe('turn ended');
  });

  it('a turn cut short by a question counts: `waiting for input` straight after `active`', async () => {
    const lead = join();
    const colleague = join();
    waits.handedWork(colleague);
    active(colleague);
    const wait = waitFor(lead, [colleague]);

    idleReminder(colleague);
    await pass(SETTLED_MS);
    expect(wait.answered()!.states.get(colleague)).toBe('turn ended');
  });

  it('a turn that starts again before it settled is not an end', async () => {
    const lead = join();
    const colleague = join();
    active(colleague);
    const wait = waitFor(lead, [colleague]);

    done(colleague);
    await pass(TURN_END_SETTLE_MS / 2);
    // A Message queued behind the turn: the next one starts at once.
    active(colleague);
    await pass(SETTLED_MS);
    expect(wait.answered()).toBeUndefined();

    done(colleague);
    await pass(SETTLED_MS);
    expect(wait.answered()!.states.get(colleague)).toBe('turn ended');
  });

  it('work handed mid-turn waits behind that turn: its end alone answers only once nothing follows', async () => {
    const lead = join();
    const colleague = join();
    active(colleague);
    waits.handedWork(colleague);
    const wait = waitFor(lead, [colleague], { timeoutMs: 120_000 });

    // The turn that was running ends: the Message may start the next one now,
    // and a turn says nothing until its first tool call.
    done(colleague);
    await pass(SETTLED_MS);
    expect(wait.answered()).toBeUndefined();
    await pass(QUEUED_HANDOVER_QUIET_MS - SETTLED_MS - WAIT_FOR_AGENTS_POLL_MS);
    expect(wait.answered()).toBeUndefined();

    // Nothing followed: the Message was taken into the turn that ended.
    await pass(WAIT_FOR_AGENTS_POLL_MS + SETTLED_MS);
    expect(wait.answered()).toMatchObject({ timedOut: false });
    expect(wait.answered()!.states.get(colleague)).toBe('turn ended');
  });

  it('work handed mid-turn is answered by the turn after, with tools or with words only', async () => {
    const lead = join();
    const withTools = join();
    const wordsOnly = join();
    active(withTools);
    active(wordsOnly);
    waits.handedWork(withTools);
    waits.handedWork(wordsOnly);
    const first = waitFor(lead, [withTools]);
    const second = waitFor(lead, [wordsOnly]);

    done(withTools);
    done(wordsOnly);
    await pass(5_000);
    // The next turn shows itself with a tool call: no quiet time ends the wait.
    active(withTools);
    await pass(QUEUED_HANDOVER_QUIET_MS);
    expect(first.answered()).toBeUndefined();
    expect(second.answered()).toMatchObject({ timedOut: false });
    done(withTools);
    await pass(SETTLED_MS);
    expect(first.answered()!.states.get(withTools)).toBe('turn ended');

    // A next turn of words only: its Stop is the second end.
    const third = join();
    active(third);
    waits.handedWork(third);
    const wait = waitFor(lead, [third]);
    done(third);
    await pass(5_000);
    expect(wait.answered()).toBeUndefined();
    done(third);
    await pass(SETTLED_MS);
    expect(wait.answered()!.states.get(third)).toBe('turn ended');
  });

  it('work handed while earlier work is unanswered waits behind it too', async () => {
    const lead = join();
    const colleague = join();
    done(colleague);
    waits.handedWork(colleague);
    // Its status still reads `done`: the first Message's turn has called no tool.
    waits.handedWork(colleague);
    const wait = waitFor(lead, [colleague]);

    done(colleague);
    await pass(SETTLED_MS);
    expect(wait.answered()).toBeUndefined();
    done(colleague);
    await pass(SETTLED_MS);
    expect(wait.answered()!.states.get(colleague)).toBe('turn ended');
  });

  it('work an agent was launched with counts a first turn that ended before the launch answered', async () => {
    const lead = join();
    const quick = join();
    // Its first turn was short: over while the launch still waited for it to join.
    done(quick);
    waits.handedWork(quick, 'launch');
    const answered = waitFor(lead, [quick]);
    await pass(SETTLED_MS);
    expect(answered.answered()!.states.get(quick)).toBe('turn ended');

    // One whose first turn is still running is waited for.
    const slow = join();
    waits.handedWork(slow, 'launch');
    const wait = waitFor(lead, [slow]);
    await pass(10_000);
    expect(wait.answered()).toBeUndefined();
    done(slow);
    await pass(SETTLED_MS);
    expect(wait.answered()!.states.get(slow)).toBe('turn ended');
  });

  it('a hand-over that did not land is taken back, a newer one stands', async () => {
    const lead = join();
    const colleague = join();
    const notHanded = waits.handedWork(colleague);
    notHanded();
    const first = waitFor(lead, [colleague]);
    await pass(SETTLED_MS);
    expect(first.answered()!.states.get(colleague)).toBe('turn ended');

    const older = waits.handedWork(colleague);
    waits.handedWork(colleague);
    older();
    const second = waitFor(lead, [colleague], { timeoutMs: 3_000 });
    await pass(3_000 + WAIT_FOR_AGENTS_POLL_MS);
    expect(second.answered()).toMatchObject({ timedOut: true });
    expect(second.answered()!.states.get(colleague)).toBe('working');
  });

  it('a permission prompt ends the wait: only its user answers that', async () => {
    const lead = join();
    const colleague = join();
    active(colleague);
    const wait = waitFor(lead, [colleague]);
    await pass(5_000);

    store.get(colleague)!.permissionSent = true;
    await pass(SETTLED_MS);
    expect(wait.answered()!.states.get(colleague)).toBe('permission request');
  });

  it("a Teammate's permission prompt stops the wait for its Lead: it opens in the Lead's terminal", async () => {
    const lead = join();
    const teamLead = join();
    const teammate = join({ leadAgentId: teamLead });
    active(teamLead);
    const wait = waitFor(lead, [teamLead]);
    await pass(5_000);
    expect(wait.answered()).toBeUndefined();

    // Only the Teammate is marked, and its Lead still reads `active`.
    store.get(teammate)!.permissionSent = true;
    await pass(SETTLED_MS);
    expect(wait.answered()).toMatchObject({ timedOut: false });
    expect(wait.answered()!.states.get(teamLead)).toBe('permission request');
  });

  it('an agent that leaves counts at once', async () => {
    const lead = join();
    const colleague = join();
    active(colleague);
    const wait = waitFor(lead, [colleague]);
    await pass(5_000);

    store.delete(colleague);
    await pass(WAIT_FOR_AGENTS_POLL_MS);
    expect(wait.answered()!.states.get(colleague)).toBe('left');
  });

  it('`any` answers on the first, `all` only on the last', async () => {
    const lead = join();
    const first = join();
    const second = join();
    active(first);
    active(second);
    const any = waitFor(lead, [first, second]);
    const all = waitFor(lead, [first, second], { until: 'all' });

    done(first);
    await pass(SETTLED_MS);
    expect(any.answered()).toMatchObject({ timedOut: false });
    expect(any.answered()!.states.get(first)).toBe('turn ended');
    expect(any.answered()!.states.get(second)).toBe('working');
    expect(all.answered()).toBeUndefined();

    done(second);
    await pass(SETTLED_MS);
    expect(all.answered()).toMatchObject({ timedOut: false });
    expect([...all.answered()!.states.values()]).toEqual(['turn ended', 'turn ended']);
  });

  it('a turn that ended a moment ago is not told as ended: the wait stays for it, or names it working', async () => {
    const lead = join();
    const first = join();
    const second = join();
    active(first);
    active(second);
    const any = waitFor(lead, [first, second]);
    done(first);
    await pass(TURN_END_SETTLE_MS);
    // The second ends just as the first comes to count: the wait stays the moment it takes.
    done(second);
    await pass(WAIT_FOR_AGENTS_POLL_MS);
    expect(any.answered()).toBeUndefined();
    await pass(SETTLED_MS);
    expect(any.answered()).toMatchObject({ timedOut: false });
    expect([...any.answered()!.states.values()]).toEqual(['turn ended', 'turn ended']);

    // One that goes back to work in that moment is named working.
    const third = join();
    const fourth = join();
    active(third);
    active(fourth);
    const again = waitFor(lead, [third, fourth]);
    done(third);
    await pass(TURN_END_SETTLE_MS);
    done(fourth);
    await pass(WAIT_FOR_AGENTS_POLL_MS);
    expect(again.answered()).toBeUndefined();
    active(fourth);
    await pass(WAIT_FOR_AGENTS_POLL_MS);
    expect(again.answered()!.states.get(third)).toBe('turn ended');
    expect(again.answered()!.states.get(fourth)).toBe('working');
  });

  it('a wait out of time stays a moment for a turn that just ended, and one cut off names it working', async () => {
    const lead = join();
    const colleague = join();
    active(colleague);
    const wait = waitFor(lead, [colleague], { timeoutMs: 10_000 });
    await pass(10_000 - 2 * WAIT_FOR_AGENTS_POLL_MS);
    done(colleague);
    await pass(3 * WAIT_FOR_AGENTS_POLL_MS);
    // Past its time, and a moment from a sure answer.
    expect(wait.answered()).toBeUndefined();
    await pass(SETTLED_MS);
    expect(wait.answered()).toMatchObject({ timedOut: false });
    expect(wait.answered()!.states.get(colleague)).toBe('turn ended');

    // Nobody left to answer: it ends at once, and the fresh end is not told as one.
    active(colleague);
    const gone = new AbortController();
    const hungUp = waitFor(lead, [colleague], { signal: gone.signal });
    await pass(5_000);
    done(colleague);
    await pass(WAIT_FOR_AGENTS_POLL_MS);
    gone.abort();
    await pass(WAIT_FOR_AGENTS_POLL_MS);
    expect(hungUp.answered()).toMatchObject({ timedOut: true });
    expect(hungUp.answered()!.states.get(colleague)).toBe('working');
  });

  // ── What ends a wait early ──────────────────────────────────

  it('its time running out answers with the agents still working', async () => {
    const lead = join();
    const colleague = join();
    active(colleague);
    const wait = waitFor(lead, [colleague], { timeoutMs: 10_000 });

    await pass(10_000 - WAIT_FOR_AGENTS_POLL_MS);
    expect(wait.answered()).toBeUndefined();
    await pass(2 * WAIT_FOR_AGENTS_POLL_MS);
    expect(wait.answered()).toMatchObject({ timedOut: true });
    expect(wait.answered()!.states.get(colleague)).toBe('working');
  });

  it('it ends when its request is gone, its caller left, or the office shuts down', async () => {
    const lead = join();
    const colleague = join();
    active(colleague);

    const gone = new AbortController();
    const hungUp = waitFor(lead, [colleague], { signal: gone.signal });
    await pass(5_000);
    gone.abort();
    await pass(WAIT_FOR_AGENTS_POLL_MS);
    expect(hungUp.answered()).toMatchObject({ timedOut: true });

    const other = join();
    const left = waitFor(other, [colleague]);
    await pass(5_000);
    store.delete(other);
    await pass(WAIT_FOR_AGENTS_POLL_MS);
    expect(left.answered()).toMatchObject({ timedOut: true });

    const shutDown = waitFor(lead, [colleague]);
    await pass(5_000);
    waits.dispose();
    await pass(WAIT_FOR_AGENTS_POLL_MS);
    expect(shutDown.answered()).toMatchObject({ timedOut: true });
  });

  // ── Through messaging: who may wait, what a Message hands over ──

  describe('through messaging', () => {
    let written: Array<[number, string]>;
    /** What a write does besides landing: a test's own (a turn ending, a throw). */
    let onWrite: (bytes: string) => void;
    const terminals: AgentTerminals = {
      has: () => true,
      screen: async (id) => ({
        text: `screen of ${id}`,
        token: `token-${id}`,
        ...PLAIN_INPUT_MODES,
      }),
      write: (id, bytes) => {
        onWrite(bytes);
        written.push([id, bytes]);
      },
    };
    const openGuard: DeliveryGuard = {
      check: async () => ({ ok: true, modes: PLAIN_INPUT_MODES }),
      beforeSubmit: () => null,
    };
    const messaging = () => createMessaging(store, terminals, openGuard, crews, waits);
    beforeEach(() => {
      written = [];
      onWrite = () => {};
    });

    /** A Crew's first agent and one it launched. */
    function crewOfTwo(): { starter: number; colleague: number } {
      const first = crews.startForLaunch();
      if (!first) throw new Error('no Crew could be started');
      const starter = join({ crew: first.launch.crew });
      first.done();
      const joining = crews.joinFor(starter);
      if (!joining.ok) throw new Error(joining.reason);
      const colleague = join({ crew: joining.place?.launch.crew });
      joining.place?.done();
      return { starter, colleague };
    }
    const ask = (caller: number, ids: number[]): Promise<AgentWaitResult> =>
      messaging().waitForAgents({ caller, ids, until: 'any', timeoutMs: 60_000 });

    it('refuses a wait for oneself, for an agent that is not there, and outside the Crew', async () => {
      const { starter, colleague } = crewOfTwo();
      const outsider = join();

      expect(await ask(starter, [starter])).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/cannot wait for yourself/),
      });
      expect(await ask(starter, [colleague, 99])).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/no agent 99/),
      });
      expect(await ask(starter, [colleague, outsider])).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/not in your Crew/),
      });
      // An agent in no Crew is held to none of it.
      const free = waiting(ask(outsider, [colleague]));
      await pass(SETTLED_MS);
      expect(free.answered()).toMatchObject({ ok: true, timedOut: false });
    });

    it('a submitted Message is work handed over: the wait answers on the turn after it, with the screen', async () => {
      const { starter, colleague } = crewOfTwo();
      done(colleague);
      const office = messaging();
      const sent = office.sendMessage({
        from: starter,
        to: [{ id: colleague, screenToken: undefined }],
        content: { text: 'review the fix', submit: true },
      });
      await pass(1_000);
      expect(await sent).toMatchObject([{ id: colleague, delivered: true }]);

      const wait = waiting(
        office.waitForAgents({
          caller: starter,
          ids: [colleague],
          until: 'any',
          timeoutMs: 60_000,
        }),
      );
      await pass(10_000);
      expect(wait.answered()).toBeUndefined();

      active(colleague);
      done(colleague);
      await pass(SETTLED_MS);
      expect(wait.answered()).toMatchObject({
        ok: true,
        timedOut: false,
        agents: [
          {
            id: colleague,
            state: 'turn ended',
            read: {
              status: 'done',
              screen: { text: `screen of ${colleague}`, token: `token-${colleague}` },
            },
          },
        ],
      });
    });

    it('text left unsubmitted hands nothing over, and an agent still working gives no screen', async () => {
      const { starter, colleague } = crewOfTwo();
      const office = messaging();
      const sent = office.sendMessage({
        from: starter,
        to: [{ id: colleague, screenToken: undefined }],
        content: { text: 'a draft', submit: false },
      });
      await pass(1_000);
      expect(await sent).toMatchObject([{ id: colleague, delivered: true }]);
      const rested = waiting(
        office.waitForAgents({
          caller: starter,
          ids: [colleague],
          until: 'any',
          timeoutMs: 60_000,
        }),
      );
      await pass(SETTLED_MS);
      expect(rested.answered()).toMatchObject({ ok: true, agents: [{ state: 'turn ended' }] });

      active(colleague);
      const busy = waiting(
        office.waitForAgents({ caller: starter, ids: [colleague], until: 'any', timeoutMs: 2_000 }),
      );
      await pass(2_000 + WAIT_FOR_AGENTS_POLL_MS);
      expect(busy.answered()).toMatchObject({
        ok: true,
        timedOut: true,
        agents: [{ id: colleague, state: 'working', read: { status: 'active', screen: null } }],
      });
    });

    it('keys hand work over at their Enter: a turn that ends before it is no answer', async () => {
      const { starter, colleague } = crewOfTwo();
      const office = messaging();
      // The turn that was on screen ends while the keys before the Enter land.
      onWrite = (bytes) => {
        if (bytes === keyBytes('down', PLAIN_INPUT_MODES)) done(colleague);
      };
      const sent = office.sendMessage({
        from: starter,
        to: [{ id: colleague, screenToken: undefined }],
        content: { keys: ['down', 'enter'] },
      });
      await pass(1_000);
      expect(await sent).toMatchObject([{ id: colleague, delivered: true }]);

      const wait = waiting(
        office.waitForAgents({ caller: starter, ids: [colleague], until: 'any', timeoutMs: 5_000 }),
      );
      await pass(5_000 + WAIT_FOR_AGENTS_POLL_MS);
      expect(wait.answered()).toMatchObject({
        ok: true,
        timedOut: true,
        agents: [{ id: colleague, state: 'working' }],
      });
    });

    it('an Enter that landed stays handed over when a later key fails, one that failed is taken back', async () => {
      const { starter, colleague } = crewOfTwo();
      const office = messaging();
      onWrite = (bytes) => {
        if (bytes === keyBytes('down', PLAIN_INPUT_MODES)) throw new Error('terminal gone');
      };
      const sent = office.sendMessage({
        from: starter,
        to: [{ id: colleague, screenToken: undefined }],
        content: { keys: ['enter', 'down'] },
      });
      await pass(1_000);
      expect(await sent).toMatchObject([
        { id: colleague, delivered: false, reason: expect.stringMatching(/1 of your 2 keys/) },
      ]);
      const submitted = waiting(
        office.waitForAgents({ caller: starter, ids: [colleague], until: 'any', timeoutMs: 3_000 }),
      );
      await pass(3_000 + WAIT_FOR_AGENTS_POLL_MS);
      expect(submitted.answered()).toMatchObject({
        timedOut: true,
        agents: [{ state: 'working' }],
      });

      // The other way round: the Enter itself never landed, so nothing was handed.
      const other = join({ crew: store.get(colleague)!.crew });
      onWrite = (bytes) => {
        if (bytes === keyBytes('enter', PLAIN_INPUT_MODES)) throw new Error('terminal gone');
      };
      const failed = office.sendMessage({
        from: starter,
        to: [{ id: other, screenToken: undefined }],
        content: { keys: ['enter'] },
      });
      await pass(1_000);
      expect(await failed).toMatchObject([{ id: other, delivered: false }]);
      const idle = waiting(
        office.waitForAgents({ caller: starter, ids: [other], until: 'any', timeoutMs: 60_000 }),
      );
      await pass(SETTLED_MS);
      expect(idle.answered()).toMatchObject({ timedOut: false, agents: [{ state: 'turn ended' }] });
    });

    it("names the Teammate whose permission prompt stopped its Lead's terminal", async () => {
      const { starter, colleague } = crewOfTwo();
      const teammate = join({ leadAgentId: colleague });
      active(colleague);
      store.get(teammate)!.permissionSent = true;
      const wait = waiting(
        messaging().waitForAgents({
          caller: starter,
          ids: [colleague],
          until: 'any',
          timeoutMs: 60_000,
        }),
      );
      await pass(SETTLED_MS);
      expect(wait.answered()).toMatchObject({
        ok: true,
        timedOut: false,
        agents: [
          {
            id: colleague,
            state: 'permission request',
            teammatePrompt: teammate,
            read: { status: 'active', screen: { text: `screen of ${colleague}` } },
          },
        ],
      });
    });
  });
});
