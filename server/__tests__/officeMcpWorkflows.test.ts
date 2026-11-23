/**
 * Workflow runs through the Pixel Office MCP's main seam: a composed
 * standalone server, a run started over /ws as the office starts one — its
 * lead a mock-claude in a real PTY — and the MCP SDK's client calling the
 * `workflow` tool with an agent's own token. Asserted from outside: the argv
 * the lead was started with, what the tool answers, and the `workflowsLoaded`
 * and `workflowRejected` the offices are sent. The rules themselves, one by
 * one, are workflows.test.ts.
 */

import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { CREW_PREAPPROVED_TOOLS } from '../src/constants.js';
import { WORKFLOW_FIRST_MESSAGE } from '../src/workflows/workflowCopy.js';
import { type Json, useStandaloneOffice, waitFor } from './helpers/officeMcpHarness.js';

describe('Workflows through the Pixel Office MCP (composed server, mock-claude in a PTY)', () => {
  const h = useStandaloneOffice({
    name: 'pxl-office-workflows',
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

  const REQUEST =
    'The export button does nothing on Safari.\nSee "issue 12" & the logs: 100% of clicks <fail>.';

  /** Connect as the agent a mock-claude start belongs to. */
  async function agentOf(start: ReturnType<typeof h.starts>[number]): Promise<Agent> {
    const id = [...h.store].find(([, a]) => a.sessionId === start.sessionId)![0];
    const configPath = start.args[start.args.indexOf('--mcp-config') + 1];
    const client = await h.mcpClient(h.tokenIn(configPath), `agent-${id}`);
    return { id, sessionId: start.sessionId, args: start.args, client };
  }

  /** A run started from the office: its lead, connected as itself. */
  async function startedRun(more: Json = {}): Promise<Agent> {
    const before = h.starts().length;
    h.send({
      type: 'startWorkflow',
      workflowId: 'bug-fix',
      directoryPath: h.workspace,
      request: REQUEST,
      ...more,
    });
    const start = await waitFor(() => h.starts()[before], 'the lead to start');
    return agentOf(start);
  }

  /** An agent launched by `by` with launch_agent, connected as itself. */
  async function launchedBy(by: Agent, args: Json = {}): Promise<Agent> {
    const reply = await h.callToolCaught(by.client, 'launch_agent', { directory: 'proj', ...args });
    expect(reply.isError, reply.text).toBe(false);
    const sessionId = reply.value!.session_id as string;
    return agentOf(h.starts().find((s) => s.sessionId === sessionId)!);
  }

  const flag = (args: string[], name: string): string | undefined =>
    args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  /** The newest `workflowsLoaded` the office was sent. */
  const loaded = (): Json => h.received.filter((m) => m.type === 'workflowsLoaded').at(-1)!;
  const runsNow = (): Json[] => (loaded()?.runs as Json[] | undefined) ?? [];
  const stagesNow = (): Array<[string, string]> =>
    (runsNow()[0].stages as Json[]).map((s) => [s.id as string, s.state as string]);
  const refusal = async (client: McpClient, args: Json): Promise<string> => {
    const reply = await h.callToolCaught(client, 'workflow', args);
    expect(reply.isError, JSON.stringify(reply.value)).toBe(true);
    return reply.text;
  };

  // ── Starting one ────────────────────────────────────────────

  it('an office is listed the Workflows, and a start launches the lead Role into a new Crew, sent to the tool', async () => {
    await waitFor(() => loaded()?.available === true, 'the office to be told a run can start');
    expect((loaded().workflows as Json[]).map((w) => [w.id, w.name, w.leadRoleName])).toEqual([
      ['new-feature', 'New feature', 'Agile Project Manager'],
      ['bug-fix', 'Bug fix', 'Agile Project Manager'],
      ['security-review', 'Deep security analysis', 'Agile Project Manager'],
      ['quality-review', 'Deep quality analysis', 'Agile Project Manager'],
      ['sprint-planning', 'Sprint planning', 'Agile Project Manager'],
      // Then the ones each other Role leads, in the Roles' order.
      ['architecture-review', 'Architecture review', 'Architect'],
      ['technical-design', 'Technical design', 'Architect'],
      ['safe-refactor', 'Safe refactor', 'Developer'],
      ['dependency-upgrade', 'Dependency upgrade', 'Developer'],
      ['full-regression', 'Full regression', 'QA Engineer'],
      ['flaky-test-hunt', 'Flaky test hunt', 'QA Engineer'],
      ['pipeline-troubleshooting', 'Pipeline troubleshooting', 'DevSecOps Engineer'],
      ['pipeline-hardening', 'Pipeline hardening', 'DevSecOps Engineer'],
      ['supply-chain-audit', 'Supply chain audit', 'DevSecOps Engineer'],
      ['threat-model', 'Threat model', 'Security Engineer'],
      ['vulnerability-review', 'Vulnerability review', 'Security Engineer'],
      ['infrastructure-review', 'Infrastructure review', 'Cloud Engineer'],
      ['cost-review', 'Cost review', 'Cloud Engineer'],
    ]);
    // What an office lists holds no brief: that is the lead's to read.
    expect(JSON.stringify(loaded().workflows)).not.toContain('brief');
    expect(runsNow()).toEqual([]);

    const lead = await startedRun();

    // Launched as the Workflow's lead Role, a Crew's first agent: its terms,
    // the team tools (the workflow tool among them) and risky actions asked.
    expect(flag(lead.args, '--append-system-prompt-file')).toBe(
      path.join(h.home, '.pixel-agents', 'role-prompts', 'agile-project-manager.crew.md'),
    );
    expect(flag(lead.args, '--permission-mode')).toBe('auto');
    expect(lead.args).toContain('mcp__pixel-office__workflow');
    expect(CREW_PREAPPROVED_TOOLS).toContain('workflow');
    // The command line carries the fixed first message, never the request.
    expect(lead.args.slice(-2)).toEqual(['--', WORKFLOW_FIRST_MESSAGE]);
    expect(lead.args.join(' ')).not.toContain('Safari');

    await waitFor(() => runsNow()[0]?.leadAgentId === lead.id, 'the run to name its lead');
    const [run] = runsNow();
    const crewId = h.store.get(lead.id)!.crew!.id;
    expect(run).toMatchObject({
      crewId,
      workflowId: 'bug-fix',
      name: 'Bug fix',
      finished: false,
      // One line, as every office shows it.
      request:
        'The export button does nothing on Safari. See "issue 12" & the logs: 100% of clicks <fail>.',
    });
    expect(stagesNow()).toEqual([
      ['reproduce', 'pending'],
      ['diagnosis', 'pending'],
      ['fix', 'pending'],
      ['verification', 'pending'],
      ['security-check', 'pending'],
      ['report', 'pending'],
    ]);
    // The run is its Crew's: the Crew panel lists the lead too.
    const crews = h.received.filter((m) => m.type === 'crewsLoaded').at(-1)!.crews as Json[];
    expect(crews.map((c) => c.id)).toEqual([crewId]);
    expect(h.received.some((m) => m.type === 'workflowRejected')).toBe(false);
  });

  it('the lead reads the request, the stages and the rules from the tool, and reports each stage in order', async () => {
    const lead = await startedRun();

    const status = await h.callJson(lead.client, 'workflow');
    expect(status).toMatchObject({
      running: true,
      you_lead: true,
      lead_agent_id: lead.id,
      // The user's own words, whole.
      request: REQUEST,
      finished: false,
    });
    expect(status.workflow).toMatchObject({ id: 'bug-fix', name: 'Bug fix' });
    expect((status.rules as string[]).join(' ')).toMatch(/launch_agent/);
    const stages = status.stages as Json[];
    expect(stages.map((s) => s.id)).toEqual([
      'reproduce',
      'diagnosis',
      'fix',
      'verification',
      'security-check',
      'report',
    ]);
    expect(stages[0]).toMatchObject({
      title: 'Reproduce',
      role: { id: 'qa-engineer', name: 'QA Engineer' },
      parallel: false,
      state: 'pending',
    });
    expect(stages[0].what_to_do).toEqual(expect.stringMatching(/\w/));
    expect(stages[4]).toMatchObject({ id: 'security-check', parallel: true });

    // A stage is named, and the order is the server's.
    expect(await refusal(lead.client, { action: 'start' })).toMatch(/start needs stage_id/);
    expect(await refusal(lead.client, { action: 'start', stage_id: 'fix' })).toMatch(
      /fix comes after reproduce \(pending\), diagnosis \(pending\): finish or skip them first/,
    );
    expect(await refusal(lead.client, { action: 'finish', stage_id: 'reproduce' })).toMatch(
      /reproduce has not started/,
    );

    const started = await h.callJson(lead.client, 'workflow', {
      action: 'start',
      stage_id: 'reproduce',
    });
    expect((started.stages as Json[])[0].state).toBe('active');
    await waitFor(() => stagesNow()[0][1] === 'active', 'the office to see the stage start');
    expect(await refusal(lead.client, { action: 'finish', stage_id: 'reproduce' })).toMatch(
      /A finish needs a note/,
    );
    const done = await h.callJson(lead.client, 'workflow', {
      action: 'finish',
      stage_id: 'reproduce',
      note: 'Fails on Safari 17: test added, red.',
    });
    expect((done.stages as Json[])[0]).toMatchObject({
      state: 'done',
      note: 'Fails on Safari 17: test added, red.',
    });
    await h.callJson(lead.client, 'workflow', {
      action: 'skip',
      stage_id: 'diagnosis',
      note: 'The test names the cause.',
    });
    await waitFor(() => stagesNow()[1][1] === 'skipped', 'the office to see the skip');
    expect((runsNow()[0].stages as Json[])[0]).toMatchObject({
      state: 'done',
      note: 'Fails on Safari 17: test added, red.',
    });
    expect(stagesNow().slice(0, 3)).toEqual([
      ['reproduce', 'done'],
      ['diagnosis', 'skipped'],
      ['fix', 'pending'],
    ]);
  });

  it('the agents the lead launches read the run; only the lead reports, and an agent outside it has none', async () => {
    const lead = await startedRun();
    const developer = await launchedBy(lead, { role: 'developer' });
    expect(h.store.get(developer.id)!.crew).toMatchObject({ launchedBy: lead.id });
    expect(developer.args).toContain('mcp__pixel-office__workflow');

    const seen = await h.callJson(developer.client, 'workflow');
    expect(seen).toMatchObject({ running: true, you_lead: false, lead_agent_id: lead.id });
    expect(seen.request).toBe(REQUEST);
    expect(seen).not.toHaveProperty('rules');
    expect(seen.note).toMatch(new RegExp(`Only agent ${lead.id}, its lead, reports its stages`));
    expect(await refusal(developer.client, { action: 'start', stage_id: 'reproduce' })).toMatch(
      new RegExp(`Only this workflow's lead \\(agent ${lead.id}\\) reports its stages`),
    );
    expect(stagesNow()[0]).toEqual(['reproduce', 'pending']);

    // An agent the user launched on its own is in no run.
    const before = h.starts().length;
    h.send({ type: 'launchAgent', directoryPath: h.workspace });
    const outsider = await agentOf(await waitFor(() => h.starts()[before], 'mock-claude to start'));
    const none = await h.callJson(outsider.client, 'workflow');
    expect(none).toEqual({
      running: false,
      note: expect.stringMatching(/No workflow is running in your Crew/),
    });
    expect(await refusal(outsider.client, { action: 'start', stage_id: 'reproduce' })).toMatch(
      /No workflow is running in your Crew/,
    );
  });

  // ── Ending one ──────────────────────────────────────────────

  it('Stop ends the run and its Crew: the agents run on, told so, and launch nobody', async () => {
    const lead = await startedRun();
    await waitFor(() => runsNow().length === 1, 'the run to be listed');
    const crewId = h.store.get(lead.id)!.crew!.id;

    h.send({ type: 'stopWorkflow', crewId });
    await waitFor(() => runsNow().length === 0, 'the run to go');
    await waitFor(
      () =>
        (h.received.filter((m) => m.type === 'crewsLoaded').at(-1)!.crews as Json[])[0]?.ended ===
        true,
      'its Crew to end',
    );
    expect(h.store.has(lead.id)).toBe(true);
    expect(await h.callJson(lead.client, 'workflow')).toEqual({
      running: false,
      note: expect.stringMatching(/The user stopped this workflow/),
    });
    expect(await refusal(lead.client, { action: 'start', stage_id: 'reproduce' })).toMatch(
      /The user stopped this workflow/,
    );
    const launch = await h.callToolCaught(lead.client, 'launch_agent', { directory: 'proj' });
    expect(launch.isError).toBe(true);
    expect(launch.text).toMatch(/The user ended your Crew/);
  });

  it('ending its Crew from the Crew panel ends the run too; so does closing its lead', async () => {
    const lead = await startedRun();
    await waitFor(() => runsNow().length === 1, 'the run to be listed');
    h.send({ type: 'endCrew', crewId: h.store.get(lead.id)!.crew!.id });
    await waitFor(() => runsNow().length === 0, 'the run to go with its Crew');
    expect(await h.callJson(lead.client, 'workflow')).toMatchObject({ running: false });

    const second = await startedRun({ workflowId: 'quality-review' });
    await waitFor(() => runsNow()[0]?.leadAgentId === second.id, 'the second run');
    expect(runsNow()[0]).toMatchObject({ workflowId: 'quality-review' });
    h.send({ type: 'closeAgent', id: second.id });
    await waitFor(() => !h.store.has(second.id), 'the lead to leave');
    await waitFor(() => runsNow().length === 0, 'the run to go with its lead');
  });

  // ── What cannot start ───────────────────────────────────────

  it('a start that cannot be is answered to its sender alone, and launches nothing', async () => {
    const other = await h.connectOffice();
    const rejections = (): Json[] => h.received.filter((m) => m.type === 'workflowRejected');
    const before = h.starts().length;

    h.send({
      type: 'startWorkflow',
      workflowId: 'no-such',
      directoryPath: h.workspace,
      request: 'x',
    });
    await waitFor(() => rejections().length === 1, 'the rejection');
    expect(rejections()[0].reason).toMatch(/no such workflow/);

    h.send({
      type: 'startWorkflow',
      workflowId: 'bug-fix',
      directoryPath: h.workspace,
      request: '   ',
    });
    await waitFor(() => rejections().length === 2, 'the second rejection');
    expect(rejections()[1].reason).toMatch(/starts from a request/);

    h.send({
      type: 'startWorkflow',
      workflowId: 'bug-fix',
      directoryPath: path.join(h.workspace, 'no-such-folder'),
      request: 'Fix it',
    });
    await waitFor(() => rejections().length === 3, 'the third rejection');
    expect(rejections()[2].reason).toMatch(/The lead couldn't start: .*neither a Directory nor/);
    // Nothing is left behind: no run, no Crew, no agent.
    await waitFor(() => runsNow().length === 0, 'no run to be left');
    expect(h.received.filter((m) => m.type === 'crewsLoaded').at(-1)!.crews).toEqual([]);
    expect(h.starts()).toHaveLength(before);
    expect(other.received.some((m) => m.type === 'workflowRejected')).toBe(false);
    other.socket.close();
  });

  it('no run starts while the Pixel Office MCP is read-only: the office is told why', async () => {
    h.send({ type: 'setOfficeMcpReadOnly', readOnly: true });
    await waitFor(() => loaded()?.available === false, 'the office to be told');
    expect(loaded().unavailableReason).toMatch(/read-only in Settings/);
    // The Workflows are still listed: the drawer says why none can start.
    expect(loaded().workflows as Json[]).toHaveLength(18);

    const before = h.starts().length;
    h.send({
      type: 'startWorkflow',
      workflowId: 'bug-fix',
      directoryPath: h.workspace,
      request: 'x',
    });
    await waitFor(
      () => h.received.some((m) => m.type === 'workflowRejected'),
      'the start to be refused',
    );
    expect(h.received.find((m) => m.type === 'workflowRejected')!.reason).toMatch(
      /read-only in Settings/,
    );
    expect(h.starts()).toHaveLength(before);
  });

  it('a view-only office is shown the runs and starts or stops none', async () => {
    const lead = await startedRun();
    await waitFor(() => runsNow()[0]?.leadAgentId === lead.id, 'the run to be listed');
    const crewId = h.store.get(lead.id)!.crew!.id;

    const viewer = await h.connectOffice({ privileged: false });
    const seen = await waitFor(
      () => viewer.received.find((m) => m.type === 'workflowsLoaded'),
      'the view-only office to be told',
    );
    expect((seen.runs as Json[])[0]).toMatchObject({ crewId, workflowId: 'bug-fix' });

    const before = h.starts().length;
    viewer.socket.send(
      JSON.stringify({
        type: 'startWorkflow',
        workflowId: 'bug-fix',
        directoryPath: h.workspace,
        request: 'Another one',
      }),
    );
    viewer.socket.send(JSON.stringify({ type: 'stopWorkflow', crewId }));
    // A privileged round trip after them: both were refused by then.
    await h.callJson(lead.client, 'workflow', { action: 'start', stage_id: 'reproduce' });
    await waitFor(() => stagesNow()[0][1] === 'active', 'the stage to start');
    expect(runsNow()).toHaveLength(1);
    expect(h.starts()).toHaveLength(before);
    expect(h.store.get(lead.id)!.crew!.ended).toBeUndefined();
    viewer.socket.close();
  });
});
