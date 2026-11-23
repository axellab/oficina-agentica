/**
 * Crews through the Pixel Office MCP's main seam: a composed standalone
 * server, agents launched over /ws as the office launches them (one of them
 * starting a Crew) — mock-claude in a real PTY — and the MCP SDK's client
 * calling the team tools with an agent's own token. Asserted from outside:
 * the argv each mock-claude was started with, what the tools answer, and the
 * `crewsLoaded` every office is sent. The rules themselves, one by one, are
 * crews.test.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { CREW_MAX_AGENTS, CREW_PREAPPROVED_TOOLS } from '../src/constants.js';
import { agentLabel, messageTag } from '../src/mcp/agentLabel.js';
import { type Json, useStandaloneOffice, waitFor } from './helpers/officeMcpHarness.js';

describe('Crews through the Pixel Office MCP (composed server, mock-claude in a PTY)', () => {
  const h = useStandaloneOffice({
    name: 'pxl-office-crews',
    env: { PIXEL_AGENTS_MOCK_STDIN: 'record' },
    launch: true,
    close: true,
    forwardHooks: true,
    grant: true,
  });

  // ── Helpers ─────────────────────────────────────────────────

  type McpClient = Awaited<ReturnType<typeof h.mcpClient>>;
  interface Agent {
    id: number;
    sessionId: string;
    args: string[];
    client: McpClient;
  }

  function startOf(sessionId: string): ReturnType<typeof h.starts>[number] {
    const found = h.starts().find((s) => s.sessionId === sessionId);
    if (!found) throw new Error(`no start for ${sessionId}`);
    return found;
  }

  /** An agent launched from the office's drawer, connected as itself. */
  async function fromDrawer(how: { roleId?: string; crew?: boolean } = {}): Promise<Agent> {
    const before = h.starts().length;
    h.send({ type: 'launchAgent', directoryPath: h.workspace, ...how });
    const start = await waitFor(() => h.starts()[before], 'mock-claude to start');
    const id = [...h.store].find(([, a]) => a.sessionId === start.sessionId)![0];
    const configPath = start.args[start.args.indexOf('--mcp-config') + 1];
    const client = await h.mcpClient(h.tokenIn(configPath), `agent-${id}`);
    return { id, sessionId: start.sessionId, args: start.args, client };
  }

  /** An agent launched by `by` with launch_agent, connected as itself. */
  async function launchedBy(by: Agent, args: Json = {}): Promise<Agent & { reply: Json }> {
    const reply = await h.callToolCaught(by.client, 'launch_agent', { directory: 'proj', ...args });
    expect(reply.isError, reply.text).toBe(false);
    const value = reply.value!;
    const start = startOf(value.session_id as string);
    const configPath = start.args[start.args.indexOf('--mcp-config') + 1];
    const client = await h.mcpClient(h.tokenIn(configPath), `agent-${value.agent_id}`);
    return {
      id: value.agent_id as number,
      sessionId: start.sessionId,
      args: start.args,
      client,
      reply: value,
    };
  }

  const promptFile = (stem: string): string =>
    path.join(h.home, '.pixel-agents', 'role-prompts', `${stem}.md`);
  const flag = (args: string[], name: string): string | undefined =>
    args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  /** The tools a start pre-approves (`--allowedTools`, up to the next flag). */
  function allowedTools(args: string[]): string[] {
    const at = args.indexOf('--allowedTools');
    if (at === -1) return [];
    const rest = args.slice(at + 1);
    const end = rest.findIndex((arg) => arg.startsWith('--'));
    return end === -1 ? rest : rest.slice(0, end);
  }
  const crewTools = CREW_PREAPPROVED_TOOLS.map((tool) => `mcp__pixel-office__${tool}`);

  /** The newest `crewsLoaded` the office was sent. */
  const crewsNow = (): Json => h.received.filter((m) => m.type === 'crewsLoaded').at(-1)!;
  const crewNow = (): Json => (crewsNow().crews as Json[])[0];
  const refusal = async (client: McpClient, tool: string, args: Json): Promise<string> => {
    const reply = await h.callToolCaught(client, tool, args);
    expect(reply.isError, JSON.stringify(reply.value)).toBe(true);
    return reply.text;
  };

  // ── Starting one ────────────────────────────────────────────

  it("a launch with `crew` starts a Crew: its terms in the agent's instructions, the team tools pre-approved, risky actions still asked", async () => {
    // Before any launch the office is told it can start one.
    await waitFor(() => crewsNow()?.available === true, 'the office to be told a Crew can start');
    expect(crewsNow()).toMatchObject({ available: true, maxAgents: CREW_MAX_AGENTS, crews: [] });

    const manager = await fromDrawer({ roleId: 'agile-project-manager', crew: true });

    // Its instructions are its Role's, with the Crew's terms in place of "ask before launching".
    expect(flag(manager.args, '--append-system-prompt-file')).toBe(
      promptFile('agile-project-manager.crew'),
    );
    const prompt = fs.readFileSync(promptFile('agile-project-manager.crew'), 'utf8');
    expect(prompt).toContain('## Your Crew');
    expect(prompt).toContain(`at most ${CREW_MAX_AGENTS} agents at a time`);
    expect(prompt).toContain('never answer a permission prompt');
    expect(prompt).not.toContain('only when the human asked for it');
    expect(prompt).toContain('## Your role: Agile Project Manager');
    // The team tools run without a permission prompt; the CLI still asks before anything risky.
    expect(allowedTools(manager.args)).toEqual(crewTools);
    expect(flag(manager.args, '--permission-mode')).toBe('auto');
    expect(manager.args).not.toContain('--dangerously-skip-permissions');

    // Every office is told who is in it.
    await waitFor(() => (crewsNow().crews as Json[]).length === 1, 'the Crew to be listed');
    const crew = crewNow();
    expect(crew).toMatchObject({ ended: false, events: [] });
    expect(crew.members).toEqual([
      {
        agentId: manager.id,
        label: agentLabel(h.store.get(manager.id)!),
        roleName: 'Agile Project Manager',
      },
    ]);
    expect(h.store.get(manager.id)!.crew).toEqual({ id: crew.id });
    const mine = (await h.listAgents(manager.client)).find((a) => a.id === manager.id)!;
    expect(mine.crew).toEqual({ id: crew.id, launched_by: null, ended: false });

    // The same Role launched plainly keeps the plain instructions, and asks as always.
    const plain = await fromDrawer({ roleId: 'agile-project-manager' });
    expect(flag(plain.args, '--append-system-prompt-file')).toBe(
      promptFile('agile-project-manager'),
    );
    expect(fs.readFileSync(promptFile('agile-project-manager'), 'utf8')).toContain(
      'only when the human asked for it',
    );
    expect(allowedTools(plain.args)).toEqual([]);
    expect(plain.args).not.toContain('--permission-mode');
    expect(h.store.get(plain.id)!.crew).toBeUndefined();
    expect((crewsNow().crews as Json[])[0].members).toHaveLength(1);
  });

  it('with no Role, the first agent of a Crew is still told its terms', async () => {
    const starter = await fromDrawer({ crew: true });
    expect(flag(starter.args, '--append-system-prompt-file')).toBe(promptFile('_crew'));
    const prompt = fs.readFileSync(promptFile('_crew'), 'utf8');
    expect(prompt).toContain('you were launched without one');
    expect(prompt).toContain('## Your Crew');
    expect(prompt).toContain('- Developer:');
    expect(allowedTools(starter.args)).toEqual(crewTools);
  });

  it("where the office skips permissions, a Crew's agents do too: that setting is the user's", async () => {
    h.send({ type: 'setBypassPermissions', enabled: true });
    await waitFor(
      () => h.received.some((m) => m.type === 'bypassPermissionsUpdated' && m.enabled === true),
      'the setting to land',
    );
    const starter = await fromDrawer({ crew: true });
    expect(starter.args).toContain('--dangerously-skip-permissions');
    expect(starter.args).not.toContain('--permission-mode');
    expect(allowedTools(starter.args)).toEqual(crewTools);
  });

  it('no Crew is started while the Pixel Office MCP is read-only: the agent launches without one', async () => {
    h.send({ type: 'setOfficeMcpReadOnly', readOnly: true });
    await waitFor(() => crewsNow()?.available === false, 'the office to be told');
    expect(crewsNow().unavailableReason).toMatch(/read-only in Settings/);

    const starter = await fromDrawer({ crew: true });
    expect(h.store.get(starter.id)!.crew).toBeUndefined();
    expect(allowedTools(starter.args)).toEqual([]);
    expect(starter.args).not.toContain('--append-system-prompt-file');
    expect(crewsNow().crews).toEqual([]);
  });

  // ── Working together ────────────────────────────────────────

  it('its agents launch each other without asking: the new agent is in the Crew, and the office shows who launched whom', async () => {
    const manager = await fromDrawer({ roleId: 'agile-project-manager', crew: true });

    const developer = await launchedBy(manager, {
      role: 'developer',
      first_message: 'Pick up story 1:\n the plan is in docs/plan.md',
    });
    const crewId = h.store.get(manager.id)!.crew!.id;
    expect(developer.reply.crew).toEqual({ id: crewId, launched_by: manager.id });
    expect(developer.reply).not.toHaveProperty('notes');
    expect(h.store.get(developer.id)!.crew).toEqual({ id: crewId, launchedBy: manager.id });
    // It was launched as a Crew's agent: the Crew's terms, the team tools, risky actions asked.
    expect(flag(developer.args, '--append-system-prompt-file')).toBe(promptFile('developer.crew'));
    expect(allowedTools(developer.args)).toEqual(crewTools);
    expect(flag(developer.args, '--permission-mode')).toBe('auto');
    // Its first message is its launcher's word, tagged as a Message is.
    const tag = messageTag(
      manager.id,
      agentLabel(h.store.get(manager.id)!),
      'Agile Project Manager',
    );
    expect(developer.args.slice(-2)).toEqual([
      '--',
      `${tag}Pick up story 1:\n the plan is in docs/plan.md`,
    ]);

    // The agent it launched launches too, with no Role: still the Crew's.
    const helper = await launchedBy(developer);
    expect(helper.reply.crew).toEqual({ id: crewId, launched_by: developer.id });
    expect(flag(helper.args, '--append-system-prompt-file')).toBe(promptFile('_crew'));

    // The office: who is in it, who launched whom, and the launcher walking over.
    await waitFor(() => (crewNow().members as Json[]).length === 3, 'the three to be listed');
    const crew = crewNow();
    expect((crew.members as Json[]).map((m) => [m.agentId, m.launchedBy])).toEqual([
      [manager.id, undefined],
      [developer.id, manager.id],
      [helper.id, developer.id],
    ]);
    await waitFor(() => (crewNow().events as Json[]).length === 2, 'both launches to be noted');
    expect(crewNow().events).toEqual([
      expect.objectContaining({
        kind: 'launched',
        fromId: manager.id,
        toIds: [developer.id],
        from: `${agentLabel(h.store.get(manager.id)!)} (Agile Project Manager)`,
        to: [`${agentLabel(h.store.get(developer.id)!)} (Developer)`],
        gist: 'Pick up story 1: the plan is in docs/plan.md',
      }),
      expect.objectContaining({
        kind: 'launched',
        fromId: developer.id,
        toIds: [helper.id],
        gist: 'Welcome!',
      }),
    ]);
    expect(h.received).toContainEqual({
      type: 'agentMessageShow',
      fromId: manager.id,
      toIds: [developer.id],
      gist: 'Pick up story 1: the plan is in docs/plan.md',
    });
  });

  it('an agent in no Crew launches agents that are in none', async () => {
    const plain = await fromDrawer();
    const other = await launchedBy(plain, { role: 'developer' });
    expect(other.reply).not.toHaveProperty('crew');
    expect(h.store.get(other.id)!.crew).toBeUndefined();
    expect(flag(other.args, '--append-system-prompt-file')).toBe(promptFile('developer'));
    expect(allowedTools(other.args)).toEqual([]);
  });

  it("its agents read and message only each other, and never one waiting on the user's permission", async () => {
    const manager = await fromDrawer({ roleId: 'agile-project-manager', crew: true });
    const developer = await launchedBy(manager, { role: 'developer' });
    const outsider = await fromDrawer();

    // Outside the Crew: no screen, no message.
    const read = await h.callJson(manager.client, 'read_agent_terminal', { agent_id: outsider.id });
    expect(read).not.toHaveProperty('screen');
    expect(read.no_screen).toMatch(new RegExp(`Agent ${outsider.id} is not in your Crew`));
    const [kept] = await h.sendMessage(manager.client, { to: [outsider.id], text: 'hello' });
    expect(kept).toMatchObject({ agent_id: outsider.id, delivered: false });
    expect(kept.reason).toMatch(/not in your Crew/);
    expect(kept).not.toHaveProperty('screen');
    expect(h.typedInto(outsider.sessionId)).toEqual([]);

    // Inside it: read, then message, and the office's Crew panel has the line.
    const { token } = await h.settled(manager.client, developer.id);
    const [sent] = await h.sendMessage(manager.client, {
      to: [developer.id],
      text: 'Daily: done, next, blocked?',
      gist: 'Daily?',
      screen_tokens: { [developer.id]: token },
    });
    expect(sent).toEqual({ agent_id: developer.id, delivered: true });
    await waitFor(
      () => (crewNow().events as Json[]).some((e) => e.kind === 'messaged'),
      'the Message to be noted',
    );
    expect((crewNow().events as Json[]).at(-1)).toMatchObject({
      kind: 'messaged',
      fromId: manager.id,
      toIds: [developer.id],
      gist: 'Daily?',
    });

    // The developer now waits on the user's permission: that answer is not a colleague's.
    await h.hook(developer.id, {
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      message: 'Claude needs your permission to use Bash',
    });
    await waitFor(
      () => h.received.some((m) => m.type === 'agentToolPermission' && m.id === developer.id),
      'the permission bubble',
    );
    const typedBefore = h.typedInto(developer.sessionId).length;
    const again = await h.readTerminal(manager.client, developer.id);
    const [held] = await h.sendMessage(manager.client, {
      to: [developer.id],
      keys: ['enter'],
      screen_tokens: { [developer.id]: again.screen_token },
    });
    expect(held).toMatchObject({ agent_id: developer.id, delivered: false });
    expect(held.reason).toMatch(/waiting for the user to allow something/);
    expect(h.typedInto(developer.sessionId)).toHaveLength(typedBefore);
  });

  it("its agents close only each other: the user's other agents are not theirs to end", async () => {
    const manager = await fromDrawer({ crew: true });
    const developer = await launchedBy(manager, { role: 'developer' });
    const outsider = await fromDrawer();

    expect(await refusal(manager.client, 'close_agent', { agent_id: outsider.id })).toMatch(
      new RegExp(`Agent ${outsider.id} is not in your Crew`),
    );
    expect(h.store.has(outsider.id)).toBe(true);

    const name = `${agentLabel(h.store.get(developer.id)!)} (Developer)`;
    const closed = await h.callJson(manager.client, 'close_agent', { agent_id: developer.id });
    expect(closed).toMatchObject({ agent_id: developer.id, closed: true });
    await waitFor(() => !h.store.has(developer.id), 'the developer to leave');
    await waitFor(() => (crewNow().members as Json[]).length === 1, 'the Crew to shrink');
    expect((crewNow().events as Json[]).at(-1)).toMatchObject({
      kind: 'closed',
      fromId: manager.id,
      toIds: [developer.id],
      to: [name],
    });
  });

  // ── Ending one ──────────────────────────────────────────────

  it('the user ends a Crew: its agents stay, and no longer launch, message or close each other', async () => {
    const manager = await fromDrawer({ crew: true });
    const developer = await launchedBy(manager, { role: 'developer' });
    await waitFor(() => (crewNow()?.members as Json[])?.length === 2, 'the Crew to be listed');
    const starts = h.starts().length;

    h.send({ type: 'endCrew', crewId: crewNow().id });
    await waitFor(() => crewNow().ended === true, 'the end to be told');
    expect(h.store.has(manager.id) && h.store.has(developer.id)).toBe(true);
    expect((crewNow().members as Json[]).map((m) => m.agentId)).toEqual([manager.id, developer.id]);

    expect(await refusal(manager.client, 'launch_agent', { directory: 'proj' })).toMatch(
      /The user ended your Crew, so you can no longer launch agents/,
    );
    expect(h.starts()).toHaveLength(starts);
    const { token } = await h.settled(manager.client, developer.id);
    const [kept] = await h.sendMessage(manager.client, {
      to: [developer.id],
      text: 'still there?',
      screen_tokens: { [developer.id]: token },
    });
    expect(kept).toMatchObject({ delivered: false });
    expect(kept.reason).toMatch(/The user ended your Crew/);
    expect(await refusal(developer.client, 'close_agent', { agent_id: manager.id })).toMatch(
      /The user ended your Crew/,
    );
    // Each still closes itself, and the list says how the Crew stands.
    const mine = (await h.listAgents(developer.client)).find((a) => a.id === developer.id)!;
    expect(mine.crew).toMatchObject({ launched_by: manager.id, ended: true });
    const closed = await h.callJson(developer.client, 'close_agent', {});
    expect(closed).toMatchObject({ agent_id: developer.id, closed: true });
  });

  it('a view-only office is told who is in a Crew, and ends none', async () => {
    const manager = await fromDrawer({ crew: true });
    await waitFor(() => (crewsNow().crews as Json[]).length === 1, 'the Crew to be listed');
    const crewId = crewNow().id as string;

    const watcher = await h.connectOffice({ privileged: false });
    const told = await waitFor(
      () => watcher.received.find((m) => m.type === 'crewsLoaded'),
      'the view-only office to be told',
    );
    expect((told.crews as Json[])[0].members).toEqual([
      expect.objectContaining({ agentId: manager.id }),
    ]);

    h.send({ type: 'endCrew', crewId }, watcher.socket);
    // Its launch is refused the same way: nothing new starts.
    h.send({ type: 'launchAgent', directoryPath: h.workspace, crew: true }, watcher.socket);
    await h.listAgents(manager.client); // a round trip: the refusals have been handled by now
    expect(crewNow().ended).toBe(false);
    expect(h.store.size).toBe(1);
  });
});
