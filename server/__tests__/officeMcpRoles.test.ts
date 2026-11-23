/**
 * Roles through the Pixel Office MCP's main seam: a composed standalone
 * server, agents launched over /ws as the office launches them (some as a
 * Role) — mock-claude in a real PTY, recording what is typed into it — and the
 * MCP SDK's client calling list_roles, list_agents, launch_agent and
 * send_message with an agent's own token. Asserted from outside: what the
 * client gets back, the argv each mock-claude was started with, the protocol
 * messages broadcast, and the bytes that reached a recipient's PTY.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { normalizeProjectPath } from '../../core/src/normalizeProjectPath.js';
import { getCharacterProfiles } from '../src/characterProfilesStore.js';
import { agentLabel, messageTag } from '../src/mcp/agentLabel.js';
import { BUILTIN_ROLES } from '../src/roles/builtinRoles.js';
import { type Json, useStandaloneOffice, waitFor } from './helpers/officeMcpHarness.js';
import { isTeamRole, TEAM_ROLE_IDS } from './helpers/teamRoles.js';

const ESC = '\x1b';
const RESUMED = '3b1d5c7e-2a4f-4e6b-9c8d-0f1e2d3c4b5a';

describe('Roles through the Pixel Office MCP (composed server, mock-claude in a PTY)', () => {
  const h = useStandaloneOffice({
    name: 'pxl-office-roles',
    // The mock reads its terminal like Claude Code's TUI and records what is typed.
    env: { PIXEL_AGENTS_MOCK_STDIN: 'record' },
    launch: true,
    grant: true,
  });

  // ── Helpers ─────────────────────────────────────────────────

  type McpClient = Awaited<ReturnType<typeof h.mcpClient>>;

  function startOf(sessionId: string): ReturnType<typeof h.starts>[number] {
    const found = h.starts().find((s) => s.sessionId === sessionId);
    if (!found) throw new Error(`no start for ${sessionId}`);
    return found;
  }

  /** An agent launched from the office's drawer (as `roleId` when given),
   *  connected as itself. */
  async function fromDrawer(
    roleId?: string,
  ): Promise<{ id: number; sessionId: string; client: McpClient }> {
    const before = h.starts().length;
    h.send({ type: 'launchAgent', directoryPath: h.workspace, ...(roleId ? { roleId } : {}) });
    const start = await waitFor(() => h.starts()[before], 'mock-claude to start');
    const id = [...h.store].find(([, a]) => a.sessionId === start.sessionId)![0];
    const configPath = start.args[start.args.indexOf('--mcp-config') + 1];
    const client = await h.mcpClient(h.tokenIn(configPath), `agent-${id}`);
    return { id, sessionId: start.sessionId, client };
  }

  async function launched(client: McpClient, args: Json): Promise<Json> {
    const reply = await h.callToolCaught(client, 'launch_agent', args);
    expect(reply.isError, reply.text).toBe(false);
    return reply.value!;
  }

  async function roles(client: McpClient): Promise<Json[]> {
    const reply = await h.callTool(client, 'list_roles', {});
    expect(reply.isError, reply.text).toBe(false);
    return (reply.value as { roles: Json[] }).roles;
  }

  /** The file a start's `--append-system-prompt-file` names, or null. */
  function rolePromptOf(sessionId: string): string | null {
    const { args } = startOf(sessionId);
    const at = args.indexOf('--append-system-prompt-file');
    return at === -1 ? null : args[at + 1];
  }

  const promptFile = (roleId: string): string =>
    path.join(h.home, '.pixel-agents', 'role-prompts', `${roleId}.md`);

  // ── list_roles / list_agents ────────────────────────────────

  it("list_roles is the team in the office's order, with who holds each Role; list_agents says each agent's", async () => {
    const manager = await fromDrawer('agile-project-manager');
    const plain = await fromDrawer();

    const listed = await roles(manager.client);
    expect(listed.map((role) => role.id).filter(isTeamRole)).toEqual(TEAM_ROLE_IDS);
    const byId = new Map(listed.map((role) => [role.id as string, role]));
    expect(byId.get('agile-project-manager')).toEqual({
      id: 'agile-project-manager',
      name: 'Agile Project Manager',
      description: expect.stringContaining('Coordinates the team'),
      source: 'builtin',
      agents: [manager.id],
      playbooks: [
        { name: 'Daily', description: expect.stringContaining('daily meeting') },
        { name: 'Sprint planning', description: expect.stringContaining('Plan a sprint') },
      ],
    });
    expect(byId.get('developer')!.agents).toEqual([]);
    // A Role's Playbooks, by name and what each is for: what a colleague asks it for.
    const playbooks = byId.get('devsecops-engineer')!.playbooks as Json[];
    expect(playbooks.map((playbook) => playbook.name)).toEqual([
      'Pipeline troubleshooting',
      'Pipeline hardening',
      'Supply chain audit',
    ]);
    expect(playbooks[0].description).toMatch(/Pipeline Doctor/);
    expect(Object.keys(playbooks[0]).sort()).toEqual(['description', 'name']);
    // What the office is never told, an agent isn't either.
    for (const role of listed) {
      expect(role).not.toHaveProperty('prompt');
      expect(role).not.toHaveProperty('model');
      expect(role).not.toHaveProperty('contract');
    }

    const agents = await h.listAgents(plain.client);
    expect(agents.find((a) => a.id === manager.id)!.role).toEqual({
      id: 'agile-project-manager',
      name: 'Agile Project Manager',
    });
    expect(agents.find((a) => a.id === plain.id)!.role).toBeNull();
  });

  it('lists a Role the user wrote in roles.json, and one of the team they changed', async () => {
    fs.mkdirSync(path.join(h.home, '.pixel-agents'), { recursive: true });
    fs.writeFileSync(
      path.join(h.home, '.pixel-agents', 'roles.json'),
      JSON.stringify({
        roles: [
          { id: 'tech-writer', name: 'Technical Writer', prompt: 'Write the docs.' },
          { id: 'developer', description: 'Builds it, our way.' },
        ],
      }),
    );
    const caller = await fromDrawer();

    const listed = await roles(caller.client);
    expect(listed.at(-1)).toEqual({
      id: 'tech-writer',
      name: 'Technical Writer',
      description: '',
      source: 'user',
      agents: [],
      playbooks: [],
    });
    expect(listed.find((role) => role.id === 'developer')).toMatchObject({
      description: 'Builds it, our way.',
      source: 'user',
    });

    const reply = await launched(caller.client, { directory: 'proj', role: 'Technical Writer' });
    expect(reply.role).toEqual({ id: 'tech-writer', name: 'Technical Writer' });
    expect(rolePromptOf(reply.session_id)).toBe(promptFile('tech-writer'));
    // The user's own Role has no Playbooks: its agent is handed no plugin folder.
    expect(startOf(reply.session_id).args).not.toContain('--plugin-dir');
    expect((await roles(caller.client)).at(-1)!.agents).toEqual([reply.agent_id]);
  });

  it('the feature guide has a roles topic that names the whole team and the tools it works together with', async () => {
    const caller = await fromDrawer();

    const topic = await h.callJson(caller.client, 'get_feature_guide', { topic: 'roles' });
    expect(topic.title).toMatch(/^Roles/);
    // The guide is prose, the catalog is data: a Role added to the team must be added here too.
    for (const role of BUILTIN_ROLES.filter((candidate) => isTeamRole(candidate.id))) {
      expect(topic.body).toContain(role.name);
    }
    for (const tool of ['list_roles', 'list_agents', 'send_message', 'launch_agent']) {
      expect(topic.body).toContain(tool);
    }
    // Its example of a tagged Message is the tag a Message really gets.
    expect(topic.body).toContain(messageTag(1, 'Byte', 'Agile Project Manager').trim());

    const all = await h.callJson(caller.client, 'get_feature_guide', {});
    expect((all.topics as Json[]).map((t) => t.id)).toContain('roles');
  });

  // ── launch_agent ────────────────────────────────────────────

  it('launches a colleague as a Role, named by id or by name: its instructions, its mark, its first message', async () => {
    const manager = await fromDrawer('agile-project-manager');

    const reply = await launched(manager.client, {
      directory: 'proj',
      role: 'developer',
      first_message: 'Pick up story 1: the plan is in docs/plan.md',
    });
    expect(reply.role).toEqual({ id: 'developer', name: 'Developer' });
    expect(reply).not.toHaveProperty('notes');
    // The CLI was started with the Role's instructions, as a file, and its first message last.
    const { args } = startOf(reply.session_id);
    expect(rolePromptOf(reply.session_id)).toBe(promptFile('developer'));
    // Tagged as a Message from its launcher is: a colleague's request, not the user's.
    const tag = messageTag(
      manager.id,
      agentLabel(h.store.get(manager.id)!),
      'Agile Project Manager',
    );
    expect(args.slice(-2)).toEqual(['--', `${tag}Pick up story 1: the plan is in docs/plan.md`]);
    const prompt = fs.readFileSync(promptFile('developer'), 'utf8');
    expect(prompt).toContain('yours is Developer');
    expect(prompt).toContain('- Agile Project Manager:');
    // Every office marks it, and the agents see it.
    expect(h.received).toContainEqual(
      expect.objectContaining({
        type: 'agentCreated',
        id: reply.agent_id,
        role: { id: 'developer', name: 'Developer', color: 'blue' },
      }),
    );
    expect(h.store.get(reply.agent_id)!.role).toEqual({
      id: 'developer',
      name: 'Developer',
      color: 'blue',
    });

    // By name, whatever its case.
    const tester = await launched(manager.client, { directory: 'proj', role: ' qa engineer ' });
    expect(tester.role).toEqual({ id: 'qa-engineer', name: 'QA Engineer' });
    expect(rolePromptOf(tester.session_id)).toBe(promptFile('qa-engineer'));

    const listed = await roles(manager.client);
    expect(listed.find((role) => role.id === 'developer')!.agents).toEqual([reply.agent_id]);
    expect(listed.find((role) => role.id === 'qa-engineer')!.agents).toEqual([tester.agent_id]);

    // Without a Role: a plain agent, as before.
    const plain = await launched(manager.client, { directory: 'proj' });
    expect(plain.role).toBeNull();
    expect(rolePromptOf(plain.session_id)).toBeNull();
  });

  it("a model the launch names wins over the Role's own", async () => {
    fs.mkdirSync(path.join(h.home, '.pixel-agents'), { recursive: true });
    fs.writeFileSync(
      path.join(h.home, '.pixel-agents', 'roles.json'),
      JSON.stringify({ roles: [{ id: 'architect', model: 'opus' }] }),
    );
    const caller = await fromDrawer();

    const usual = await launched(caller.client, { directory: 'proj', role: 'architect' });
    const usualArgs = startOf(usual.session_id).args;
    expect(usualArgs[usualArgs.indexOf('--model') + 1]).toBe('opus');

    const asked = await launched(caller.client, {
      directory: 'proj',
      role: 'architect',
      model: 'sonnet',
    });
    const askedArgs = startOf(asked.session_id).args;
    expect(askedArgs.filter((arg) => arg === '--model')).toHaveLength(1);
    expect(askedArgs[askedArgs.indexOf('--model') + 1]).toBe('sonnet');
  });

  it("a Role's Playbooks are handed to its agent as skills of that session, and to no other", async () => {
    // From the drawer and from a colleague alike.
    const engineer = await fromDrawer('devsecops-engineer');
    const engineerArgs = startOf(engineer.sessionId).args;
    expect(engineerArgs.filter((arg) => arg === '--plugin-dir')).toHaveLength(1);
    const pluginDir = engineerArgs[engineerArgs.indexOf('--plugin-dir') + 1];
    expect(path.dirname(pluginDir)).toBe(path.join(h.home, '.pixel-agents', 'role-kits'));
    expect(path.basename(pluginDir)).toMatch(/^devsecops-engineer-[0-9a-f]{12}$/);
    expect(
      JSON.parse(fs.readFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'))
        .name,
    ).toBe('devsecops-engineer');
    expect(fs.readdirSync(path.join(pluginDir, 'skills')).sort()).toEqual([
      'pipeline-hardening',
      'pipeline-troubleshooting',
      'supply-chain-audit',
    ]);
    const troubleshooting = fs.readFileSync(
      path.join(pluginDir, 'skills', 'pipeline-troubleshooting', 'SKILL.md'),
      'utf8',
    );
    expect(troubleshooting).toMatch(/^---\nname: pipeline-troubleshooting\ndescription: /);
    expect(troubleshooting).toContain('gh run view');
    // Its instructions name each one the way the CLI lists it, with its Contract.
    const prompt = fs.readFileSync(promptFile('devsecops-engineer'), 'utf8');
    expect(prompt).toContain('## Your contract');
    expect(prompt).toContain('`devsecops-engineer:pipeline-troubleshooting`');

    const colleague = await launched(engineer.client, {
      directory: 'proj',
      role: 'devsecops-engineer',
    });
    const colleagueArgs = startOf(colleague.session_id).args;
    expect(colleagueArgs[colleagueArgs.indexOf('--plugin-dir') + 1]).toBe(pluginDir);

    // Another Role is handed its own Playbooks, never a colleague's; an agent with no Role, none.
    const developer = await launched(engineer.client, { directory: 'proj', role: 'developer' });
    const developerArgs = startOf(developer.session_id).args;
    expect(developerArgs.filter((arg) => arg === '--plugin-dir')).toHaveLength(1);
    const developerDir = developerArgs[developerArgs.indexOf('--plugin-dir') + 1];
    expect(path.basename(developerDir)).toMatch(/^developer-[0-9a-f]{12}$/);
    expect(fs.readdirSync(path.join(developerDir, 'skills')).sort()).toEqual([
      'dependency-upgrade',
      'safe-refactor',
    ]);
    const plain = await launched(engineer.client, { directory: 'proj' });
    expect(startOf(plain.session_id).args).not.toContain('--plugin-dir');
    // The Developer still knows what its colleague can run.
    expect(fs.readFileSync(promptFile('developer'), 'utf8')).toContain(
      'Playbooks: Pipeline troubleshooting, Pipeline hardening, Supply chain audit.',
    );
  });

  it('refuses a Role the office does not have, naming the ones it has, and launches nothing', async () => {
    const caller = await fromDrawer();
    const before = h.store.size;
    const starts = h.starts().length;

    const reply = await h.callToolCaught(caller.client, 'launch_agent', {
      directory: 'proj',
      role: 'wizard',
    });
    expect(reply.isError).toBe(true);
    expect(reply.text).toMatch(/no Role wizard/);
    expect(reply.text).toMatch(/architect \(Architect\), developer \(Developer\)/);
    expect(reply.text).toMatch(/list_roles/);
    expect(h.store.size).toBe(before);
    expect(h.starts()).toHaveLength(starts);
  });

  it('refuses a name several Roles go by, naming their ids, and launches the one an id names', async () => {
    fs.mkdirSync(path.join(h.home, '.pixel-agents'), { recursive: true });
    fs.writeFileSync(
      path.join(h.home, '.pixel-agents', 'roles.json'),
      JSON.stringify({
        roles: [{ id: 'our-qa', name: 'QA Engineer', prompt: 'Test it our way.' }],
      }),
    );
    const caller = await fromDrawer();
    const before = h.store.size;
    const starts = h.starts().length;

    const reply = await h.callToolCaught(caller.client, 'launch_agent', {
      directory: 'proj',
      role: 'qa engineer',
    });
    expect(reply.isError).toBe(true);
    expect(reply.text).toMatch(
      /2 Roles in this office are called qa engineer: qa-engineer, our-qa\./,
    );
    expect(reply.text).toMatch(/by its id/);
    expect(h.store.size).toBe(before);
    expect(h.starts()).toHaveLength(starts);

    // An id names one Role only, whatever the others are called.
    const ours = await launched(caller.client, { directory: 'proj', role: 'our-qa' });
    expect(ours.role).toEqual({ id: 'our-qa', name: 'QA Engineer' });
    expect(rolePromptOf(ours.session_id)).toBe(promptFile('our-qa'));
    const team = await launched(caller.client, { directory: 'proj', role: 'qa-engineer' });
    expect(team.role).toEqual({ id: 'qa-engineer', name: 'QA Engineer' });
    expect(rolePromptOf(team.session_id)).toBe(promptFile('qa-engineer'));
  });

  it('a resumed conversation comes back as the Role it had, unless the launch names another', async () => {
    const caller = await fromDrawer();
    const projectDir = path.join(h.home, '.claude', 'projects', normalizeProjectPath(h.workspace));
    fs.mkdirSync(projectDir, { recursive: true });
    const transcript = `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } })}\n`;
    const other = RESUMED.replace(/a$/, 'b');
    fs.writeFileSync(path.join(projectDir, `${RESUMED}.jsonl`), transcript);
    fs.writeFileSync(path.join(projectDir, `${other}.jsonl`), transcript);
    // What the office remembers of both conversations: the Role their agents had.
    fs.writeFileSync(
      path.join(h.home, '.pixel-agents', 'conversations.json'),
      JSON.stringify({ [RESUMED]: { roleId: 'qa-engineer' }, [other]: { roleId: 'qa-engineer' } }),
    );

    const same = await launched(caller.client, { directory: 'proj', resume_session_id: RESUMED });
    expect(same.role).toEqual({ id: 'qa-engineer', name: 'QA Engineer' });
    expect(startOf(RESUMED).args.slice(0, 2)).toEqual(['--resume', RESUMED]);
    expect(rolePromptOf(RESUMED)).toBe(promptFile('qa-engineer'));

    const changed = await launched(caller.client, {
      directory: 'proj',
      resume_session_id: other,
      role: 'security-engineer',
    });
    expect(changed.role).toEqual({ id: 'security-engineer', name: 'Security Engineer' });
    expect(rolePromptOf(other)).toBe(promptFile('security-engineer'));
  });

  // ── send_message ────────────────────────────────────────────

  it("a Message says which Role is asking, after the sender's name", async () => {
    const manager = await fromDrawer('agile-project-manager');
    const developer = await fromDrawer('developer');
    const name = getCharacterProfiles()[h.store.get(manager.id)!.palette!].name!;

    const { token } = await h.settled(manager.client, developer.id);
    const results = await h.sendMessage(manager.client, {
      to: [developer.id],
      text: 'Daily: done, next, blocked?',
      screen_tokens: { [developer.id]: token },
    });
    expect(results).toEqual([{ agent_id: developer.id, delivered: true }]);
    await waitFor(() => h.typedInto(developer.sessionId).length >= 2, 'the text and its Enter');
    expect(h.typedInto(developer.sessionId)).toEqual([
      `${ESC}[200~[From ${name} (Agile Project Manager), agent ${manager.id}] Daily: done, next, blocked?${ESC}[201~`,
      '\r',
    ]);
  });
});

describe('messageTag', () => {
  it('names a sender by what it has: a name and a Role, either alone, or only its id', () => {
    expect(messageTag(3, 'Byte', 'Developer')).toBe('[From Byte (Developer), agent 3] ');
    expect(messageTag(3, 'Byte')).toBe('[From Byte, agent 3] ');
    expect(messageTag(3, null, 'Developer')).toBe('[From Developer, agent 3] ');
    expect(messageTag(3, null)).toBe('[From agent 3] ');
  });
});
