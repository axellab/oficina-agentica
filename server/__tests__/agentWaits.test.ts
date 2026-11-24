/**
 * Waiting for agents (wait_for_agents), the rules alone: when a waited agent
 * counts as no longer working, what a hand-over changes, and what ends a wait
 * early. Over a real store and Crews, on fake timers (a wait polls and lets a
 * turn's end settle), with the store's own status reports driving it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { TURN_END_SETTLE_MS, WAIT_FOR_AGENTS_POLL_MS } from '../src/constants.js';
import { Crews } from '../src/crews.js';
import { type AgentWaitOutcome, type AgentWaits, createAgentWaits } from '../src/mcp/agentWaits.js';
import { createMessaging, type DeliveryGuard } from '../src/mcp/messaging.js';
import type { AgentWaitResult } from '../src/mcp/officeOperations.js';
import { type AgentTerminals, PLAIN_INPUT_MODES } from '../src/terminal/agentTerminals.js';
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
    const terminals: AgentTerminals = {
      has: () => true,
      screen: async (id) => ({
        text: `screen of ${id}`,
        token: `token-${id}`,
        ...PLAIN_INPUT_MODES,
      }),
      write: (id, bytes) => void written.push([id, bytes]),
    };
    const openGuard: DeliveryGuard = {
      check: async () => ({ ok: true, modes: PLAIN_INPUT_MODES }),
      beforeSubmit: () => null,
    };
    const messaging = () => createMessaging(store, terminals, openGuard, crews, waits);
    beforeEach(() => {
      written = [];
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
  });
});
