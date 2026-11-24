import { z } from 'zod';

import {
  WAIT_FOR_AGENTS_DEFAULT_SECONDS,
  WAIT_FOR_AGENTS_MAX_IDS,
  WAIT_FOR_AGENTS_MAX_SECONDS,
} from '../../constants.js';
import { defineTool, ok, refuse } from '../tool.js';

export const waitForAgents = defineTool({
  name: 'wait_for_agents',
  title: 'Wait for agents',
  description:
    'Wait until agents you handed work to are done with it, in ONE call: it returns when their ' +
    'turn has ended (`until`: "any" of them, the default, or "all"), with the screen and ' +
    '`screen_token` read_agent_terminal would give, so the answer needs no second call. Use it ' +
    'after send_message or launch_agent instead of sleeping, list_agents or reading terminals to ' +
    'see whether a colleague has finished: every one of those calls costs a turn of your own. An ' +
    'agent stopped on a permission prompt is returned too (only its user answers that), and so is ' +
    `one that left. It waits up to \`timeout_seconds\` (default ${WAIT_FOR_AGENTS_DEFAULT_SECONDS}, at most ` +
    `${WAIT_FOR_AGENTS_MAX_SECONDS}); when the time runs out with agents still working it says so, and ` +
    "you call it again for them. An agent of a Crew waits only for its Crew's agents.",
  input: {
    agent_ids: z
      .array(z.number().int())
      .min(1)
      .max(WAIT_FOR_AGENTS_MAX_IDS)
      .describe('The agents to wait for (never yourself).'),
    until: z
      .enum(['any', 'all'])
      .optional()
      .describe(
        'Return when "any" of them is no longer working (default), or only when "all" are.',
      ),
    timeout_seconds: z
      .number()
      .int()
      .min(1)
      .max(WAIT_FOR_AGENTS_MAX_SECONDS)
      .optional()
      .describe(
        `How long to wait at most (default ${WAIT_FOR_AGENTS_DEFAULT_SECONDS}, at most ${WAIT_FOR_AGENTS_MAX_SECONDS}).`,
      ),
  },
  changes: false,
  uses: ['agents', 'messaging'],
  run: async ({ agent_ids, until, timeout_seconds }, { caller, office, signal }) => {
    const ids = [...new Set(agent_ids)];
    const waited = await office.messaging.waitForAgents({
      caller,
      ids,
      until: until ?? 'any',
      timeoutMs: (timeout_seconds ?? WAIT_FOR_AGENTS_DEFAULT_SECONDS) * 1000,
      signal,
    });
    if (!waited.ok) return refuse(waited.reason);
    const activities = new Map(
      office.agents.listAgents().map((agent) => [agent.id, agent.activity] as const),
    );
    const working: number[] = [];
    const agents = waited.agents.map(({ id, state, read, teammatePrompt }) => {
      if (state === 'left' || !read) return { agent_id: id, left: true };
      if (state === 'working') {
        working.push(id);
        const activity = activities.get(id);
        return {
          agent_id: id,
          status: read.status,
          turn_ended: false,
          ...(activity ? { activity } : {}),
          // Not `active`, yet the work it was handed is not answered: it has
          // not begun, it is in a turn that has called no tool yet, or its
          // turn's end is too fresh to be taken as one.
          ...(read.status === 'active'
            ? {}
            : { note: 'No turn that answers the work it was last handed has ended yet.' }),
        };
      }
      return {
        agent_id: id,
        // A Teammate's prompt stops its Lead's terminal, whatever the Lead's own status reads.
        status: state === 'permission request' ? state : read.status,
        turn_ended: state === 'turn ended',
        ...(teammatePrompt !== undefined
          ? {
              note: `Its Teammate, agent ${teammatePrompt}, is waiting in this terminal for the user to allow something. Only the user answers that.`,
            }
          : {}),
        ...(read.screen
          ? { screen: read.screen.text, screen_token: read.screen.token }
          : { no_screen: read.noScreen }),
      };
    });
    return ok({
      waited_seconds: Math.round(waited.waitedMs / 1000),
      timed_out: waited.timedOut,
      agents,
      ...(working.length > 0
        ? {
            next: `Still working: agent${working.length === 1 ? '' : 's'} ${working.join(', ')}. Call wait_for_agents again for ${working.length === 1 ? 'it' : 'them'} when you need ${working.length === 1 ? 'its answer' : 'their answers'}; do not read terminals or sleep in between.`,
          }
        : {}),
    });
  },
});
