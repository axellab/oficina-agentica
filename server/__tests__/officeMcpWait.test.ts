/**
 * wait_for_agents through the Pixel Office MCP's main seam: a composed
 * standalone server, agents launched as the office launches them (mock-claude
 * in a real PTY), and the MCP SDK's client holding one call open with an
 * agent's own token. The mock reports no turns of its own, so the turn ends
 * are the store's reports, as the CLI's hooks would make them. The rules
 * alone are agentWaits.test.ts.
 */

import { describe, expect, it } from 'vitest';

import { useStandaloneOffice, waitFor } from './helpers/officeMcpHarness.js';

describe('wait_for_agents (composed server, mock-claude in a PTY)', () => {
  const h = useStandaloneOffice({
    name: 'pxl-office-wait',
    // The mock reads its terminal like Claude Code's TUI and records what is typed.
    env: { PIXEL_AGENTS_MOCK_STDIN: 'record' },
    launch: true,
    grant: true,
  });

  const launch = () => h.launchAgent({ clientName: (id) => `agent-${id}` });
  const call = h.callToolCaught;
  /** The CLI's Stop for agent `id`: its turn ended. */
  const turnEnds = (id: number): void =>
    h.store.setAgentStatus(id, { active: false, awaitingInput: false });

  it('answers with the screen read_agent_terminal would give, and only on the turn after a Message', async () => {
    const a = await launch();
    const b = await launch();
    const settled = await h.settled(a.client, b.id);

    // Nothing handed to it, no turn running: one call, its screen and token.
    const idle = await call(a.client, 'wait_for_agents', { agent_ids: [b.id] });
    expect(idle.isError).toBe(false);
    expect(idle.value).toMatchObject({
      timed_out: false,
      agents: [
        { agent_id: b.id, turn_ended: true, screen: settled.screen, screen_token: settled.token },
      ],
    });
    expect(idle.value).not.toHaveProperty('next');

    // The token it gave is the one send_message takes.
    const [delivery] = await h.sendMessage(a.client, {
      to: [b.id],
      text: 'review the fix',
      gist: 'review the fix',
      screen_tokens: { [b.id]: idle.value!.agents[0].screen_token },
    });
    expect(delivery).toMatchObject({ agent_id: b.id, delivered: true });

    // Handed work, no turn ended since: the wait runs out, saying who to wait for again.
    const early = await call(a.client, 'wait_for_agents', {
      agent_ids: [b.id],
      timeout_seconds: 2,
    });
    expect(early.value).toMatchObject({
      timed_out: true,
      agents: [{ agent_id: b.id, turn_ended: false }],
      next: expect.stringMatching(new RegExp(`agent ${b.id}\\b.*wait_for_agents again`)),
    });
    expect(early.value!.agents[0]).not.toHaveProperty('screen');

    // The turn ends while a wait is held open: it answers then, with the screen as it is.
    const held = call(a.client, 'wait_for_agents', { agent_ids: [b.id], until: 'all' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    turnEnds(b.id);
    const answered = await held;
    expect(answered.value).toMatchObject({
      timed_out: false,
      agents: [{ agent_id: b.id, status: 'done', turn_ended: true }],
    });
    expect(answered.value!.agents[0].screen).toContain('review the fix');
  });

  it('an agent launched with a first message is waited for until its first turn ends', async () => {
    const a = await launch();
    const reply = await call(a.client, 'launch_agent', {
      directory: h.workspace,
      first_message: 'write the tests',
    });
    expect(reply.isError).toBe(false);
    const launchedId: number = reply.value!.agent_id;

    const early = await call(a.client, 'wait_for_agents', {
      agent_ids: [launchedId],
      timeout_seconds: 2,
    });
    expect(early.value).toMatchObject({
      timed_out: true,
      agents: [{ agent_id: launchedId, turn_ended: false }],
    });

    turnEnds(launchedId);
    const ended = await call(a.client, 'wait_for_agents', { agent_ids: [launchedId] });
    expect(ended.value).toMatchObject({
      timed_out: false,
      agents: [{ agent_id: launchedId, turn_ended: true }],
    });
  });

  it('an agent that leaves the office ends the wait for it', async () => {
    const a = await launch();
    const b = await launch();
    h.store.setAgentStatus(b.id, { active: true });

    const held = call(a.client, 'wait_for_agents', { agent_ids: [b.id] });
    await new Promise((resolve) => setTimeout(resolve, 300));
    h.send({ type: 'closeAgent', id: b.id });
    await waitFor(() => !h.store.has(b.id), 'the agent to leave');

    const answered = await held;
    expect(answered.value).toMatchObject({
      timed_out: false,
      agents: [{ agent_id: b.id, left: true }],
    });
  });

  it('refuses a wait for oneself and for an agent that is not there', async () => {
    const a = await launch();

    const own = await call(a.client, 'wait_for_agents', { agent_ids: [a.id] });
    expect(own.isError).toBe(true);
    expect(own.text).toMatch(/cannot wait for yourself/);

    const nobody = await call(a.client, 'wait_for_agents', { agent_ids: [9999] });
    expect(nobody.isError).toBe(true);
    expect(nobody.text).toMatch(/no agent 9999/);
  });
});
