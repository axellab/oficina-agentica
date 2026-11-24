/**
 * Waiting for agents (wait_for_agents): one call that returns when a
 * colleague's turn has ended, instead of a caller that keeps looking.
 *
 * An agent's status alone cannot say its turn ended. One that was just handed
 * work (a Message submitted into its terminal, a launch with a first message)
 * still reads `done` until its first tool call, and where the CLI's hooks
 * report the turns, a turn of words only never reads `active` at all. So a
 * hand-over is recorded here (`handedWork`), and turn ends are counted from
 * the store's own reports (`agentStatus`, repeats included): every `done`,
 * and a `waiting for input` that follows `active` (one that follows `done` is
 * the CLI saying, a minute later, that the agent is still idle). An agent
 * handed work is ready once a turn of its own ended after the hand-over.
 *
 * Work handed to an agent in the middle of a turn waits behind that turn, and
 * the CLI then does one of two things nothing reports: it takes the Message
 * into the running turn (one turn end answers both), or it starts the next
 * turn with it as the running one ends (the second end is the answer, and a
 * turn says nothing until its first tool call). So after the running turn's
 * end such a hand-over waits for the next end, or for
 * `QUEUED_HANDOVER_QUIET_MS` with no sign of another turn.
 *
 * A wait holds its caller's request open, so it is bounded (the tool caps the
 * time) and it ends early when nobody is left to answer: the request went
 * away, the caller left the office, or the office is shutting down.
 */

import type { AgentStateStore } from '../agentStateStore.js';
import {
  QUEUED_HANDOVER_QUIET_MS,
  TURN_END_SETTLE_MS,
  WAIT_FOR_AGENTS_POLL_MS,
} from '../constants.js';
import { promptHolderIn } from '../crews.js';
import { pause } from '../pause.js';
import type { AgentTurnStatus } from '../types.js';
import { statusOf } from './agentsView.js';

/**
 * Where a waited agent stands: gone from the office, its turn ended, stopped
 * on a permission prompt (its own or a Teammate's, which opens in its Lead's
 * terminal: only its user answers that, so there is nothing more to wait
 * for), or still working (a turn running, work it was handed that no turn has
 * ended on yet, or a turn's end too fresh to be taken as one).
 */
export type AgentWaitState = 'left' | 'turn ended' | 'permission request' | 'working';

export interface AgentWaitRequest {
  /** The agent that waits. */
  caller: number;
  ids: readonly number[];
  /** Return once one of them is no longer working, or only once none is. */
  until: 'any' | 'all';
  timeoutMs: number;
  /** Aborted when the caller's request is gone. */
  signal?: AbortSignal;
}

export interface AgentWaitOutcome {
  waitedMs: number;
  /** The time ran out (or nobody was left to answer) before the wait was met. */
  timedOut: boolean;
  states: Map<number, AgentWaitState>;
}

export interface AgentWaits {
  /**
   * Work was just handed to agent `id`: only a turn that ends from now on is
   * its answer (`since` "now", the default). Work it was launched with (its
   * first message) was handed as it started, so every turn it has ended
   * counts, one that ended before the launch answered too (`since` "launch").
   * Returns the undo, for a hand-over that did not land.
   */
  handedWork(id: number, since?: 'now' | 'launch'): () => void;
  wait(request: AgentWaitRequest): Promise<AgentWaitOutcome>;
  /** End every wait under way and stop following the store (shutdown). */
  dispose(): void;
}

/** Work handed to an agent, as it stood then. */
interface Handover {
  /** The turn ends the agent had been through. */
  ends: number;
  /** It was working then, so the work waits behind the turn that was running. */
  queued: boolean;
}

export function createAgentWaits(store: AgentStateStore): AgentWaits {
  /** Turn ends counted per agent since this office started following it. */
  const ends = new Map<number, number>();
  /** Each agent's last reported status: what tells a turn's end from a reminder. */
  const lastStatus = new Map<number, AgentTurnStatus>();
  /** When each agent's last counted turn end was reported. */
  const lastEndAt = new Map<number, number>();
  /** Each agent's last hand-over. */
  const handovers = new Map<number, Handover>();
  let disposed = false;

  const onStatus = (id: number, status: AgentTurnStatus): void => {
    const before = lastStatus.get(id);
    lastStatus.set(id, status);
    if (status === 'done' || (status === 'waiting for input' && before === 'active')) {
      ends.set(id, (ends.get(id) ?? 0) + 1);
      lastEndAt.set(id, Date.now());
    }
  };
  const onRemoved = (id: number): void => {
    ends.delete(id);
    lastStatus.delete(id);
    lastEndAt.delete(id);
    handovers.delete(id);
  };
  store.on('agentStatus', onStatus);
  store.on('agentRemoved', onRemoved);

  function stateOf(id: number, now: number): AgentWaitState {
    const agent = store.get(id);
    if (!agent) return 'left';
    if (promptHolderIn(store, id) !== undefined) return 'permission request';
    if (statusOf(agent) === 'active') return 'working';
    const handover = handovers.get(id);
    if (!handover) return 'turn ended';
    const endedSince = (ends.get(id) ?? 0) - handover.ends;
    if (endedSince <= 0) return 'working';
    if (handover.queued && endedSince === 1) {
      // The turn it waited behind has ended: the answer is that turn if
      // nothing follows it, the next one if one does.
      const quietFor = now - (lastEndAt.get(id) ?? 0);
      return quietFor >= QUEUED_HANDOVER_QUIET_MS ? 'turn ended' : 'working';
    }
    return 'turn ended';
  }

  return {
    handedWork(id, since = 'now') {
      const before = handovers.get(id);
      const mine: Handover =
        since === 'launch'
          ? { ends: 0, queued: false }
          : { ends: ends.get(id) ?? 0, queued: stateOf(id, Date.now()) === 'working' };
      handovers.set(id, mine);
      return () => {
        // A newer hand-over stands on its own.
        if (handovers.get(id) !== mine) return;
        if (before) handovers.set(id, before);
        else handovers.delete(id);
      };
    },

    async wait({ caller, ids, until, timeoutMs, signal }) {
      const started = Date.now();
      // An agent counts once it has stayed out of work for the settle time:
      // the TUI is still drawing when a turn's end is reported, and a turn may
      // start again at once.
      const restingSince = new Map<number, number>();
      let states = new Map<number, AgentWaitState>();
      let timedOut = false;
      // Once the wait is met or out of time, how long it still stays for an
      // agent whose turn just ended: a moment from a sure answer.
      let lastLookAt: number | undefined;
      for (;;) {
        const now = Date.now();
        states = new Map();
        let rested = 0;
        let settling = 0;
        for (const id of ids) {
          const state = stateOf(id, now);
          if (state === 'working') {
            restingSince.delete(id);
            states.set(id, state);
            continue;
          }
          const since = restingSince.get(id) ?? now;
          restingSince.set(id, since);
          if (state === 'left' || now - since >= TURN_END_SETTLE_MS) {
            rested++;
            states.set(id, state);
          } else {
            // Not taken as ended yet, so not told as ended either: a wait
            // that ends now names it among the agents still working.
            settling++;
            states.set(id, 'working');
          }
        }
        const met = until === 'all' ? rested === ids.length : rested > 0;
        const nobodyLeft = signal?.aborted || disposed || !store.has(caller);
        if (!nobodyLeft && (met || now - started >= timeoutMs)) {
          lastLookAt ??= now + TURN_END_SETTLE_MS;
          if (settling > 0 && now < lastLookAt) {
            await pause(WAIT_FOR_AGENTS_POLL_MS);
            continue;
          }
        }
        if (met || nobodyLeft || now - started >= timeoutMs) {
          timedOut = !met;
          break;
        }
        // No longer met (an agent went back to work while the wait stayed).
        lastLookAt = undefined;
        await pause(WAIT_FOR_AGENTS_POLL_MS);
      }
      return { waitedMs: Date.now() - started, timedOut, states };
    },

    dispose() {
      disposed = true;
      store.off('agentStatus', onStatus);
      store.off('agentRemoved', onRemoved);
    },
  };
}
