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
 * A wait holds its caller's request open, so it is bounded (the tool caps the
 * time) and it ends early when nobody is left to answer: the request went
 * away, the caller left the office, or the office is shutting down.
 */

import type { AgentStateStore } from '../agentStateStore.js';
import { TURN_END_SETTLE_MS, WAIT_FOR_AGENTS_POLL_MS } from '../constants.js';
import { pause } from '../pause.js';
import type { AgentTurnStatus } from '../types.js';
import { statusOf } from './agentsView.js';

/**
 * Where a waited agent stands: gone from the office, its turn ended, stopped
 * on a permission prompt (only its user answers that, so there is nothing more
 * to wait for), or still working (a turn running, or work it was handed that
 * no turn has ended on yet).
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
  /** Work was just handed to agent `id`: only a turn that ends from now on is
   *  its answer. Returns the undo, for a hand-over that did not land. */
  handedWork(id: number): () => void;
  wait(request: AgentWaitRequest): Promise<AgentWaitOutcome>;
  /** End every wait under way and stop following the store (shutdown). */
  dispose(): void;
}

export function createAgentWaits(store: AgentStateStore): AgentWaits {
  /** Turn ends counted per agent since this office started following it. */
  const ends = new Map<number, number>();
  /** Each agent's last reported status: what tells a turn's end from a reminder. */
  const lastStatus = new Map<number, AgentTurnStatus>();
  /** The count of turn ends each agent stood at when it was last handed work. */
  const handovers = new Map<number, { ends: number }>();
  let disposed = false;

  const onStatus = (id: number, status: AgentTurnStatus): void => {
    const before = lastStatus.get(id);
    lastStatus.set(id, status);
    if (status === 'done' || (status === 'waiting for input' && before === 'active')) {
      ends.set(id, (ends.get(id) ?? 0) + 1);
    }
  };
  const onRemoved = (id: number): void => {
    ends.delete(id);
    lastStatus.delete(id);
    handovers.delete(id);
  };
  store.on('agentStatus', onStatus);
  store.on('agentRemoved', onRemoved);

  function stateOf(id: number): AgentWaitState {
    const agent = store.get(id);
    if (!agent) return 'left';
    const status = statusOf(agent);
    if (status === 'permission request') return 'permission request';
    if (status === 'active') return 'working';
    const handover = handovers.get(id);
    return handover && (ends.get(id) ?? 0) <= handover.ends ? 'working' : 'turn ended';
  }

  return {
    handedWork(id) {
      const before = handovers.get(id);
      const mine = { ends: ends.get(id) ?? 0 };
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
      // An agent counts once it has stayed out of work for the settle time: a
      // Message queued behind its turn starts the next one at once.
      const restingSince = new Map<number, number>();
      const states = new Map<number, AgentWaitState>();
      let timedOut = false;
      for (;;) {
        const now = Date.now();
        let rested = 0;
        for (const id of ids) {
          const state = stateOf(id);
          states.set(id, state);
          if (state === 'working') {
            restingSince.delete(id);
            continue;
          }
          const since = restingSince.get(id) ?? now;
          restingSince.set(id, since);
          if (state === 'left' || now - since >= TURN_END_SETTLE_MS) rested++;
        }
        if (until === 'all' ? rested === ids.length : rested > 0) break;
        if (now - started >= timeoutMs || signal?.aborted || disposed || !store.has(caller)) {
          timedOut = true;
          break;
        }
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
