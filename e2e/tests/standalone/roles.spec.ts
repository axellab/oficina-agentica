import fs from 'node:fs';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../fixtures/standalone';
import { initGitRepo } from '../../helpers/git';
import { preToolUseBash } from '../../helpers/hooks';
import {
  arrangeNextClaudeInvocation,
  claudeScenario,
  waitForClaudeHookSetup,
} from '../../helpers/mock-claude';
import { expectOverlayCount, expectOverlayVisibleWithTexts } from '../../helpers/office';
import {
  addDirectory,
  confirmNewWorktree,
  openLaunchDrawer,
  setSettings,
} from '../../helpers/webview';

/**
 * Roles: the launch drawer offers the parts of a delivery team, and an agent
 * launched as one is told that Role's instructions and wears its name.
 *
 * Terminal-driven, so it follows the scenario-builder rule (e2e/README.md
 * "Mocking model & rules"): the mock performs all timed actions; the test only
 * hovers, clicks and observes. What the coding agent was told is observed at
 * the process boundary, the way conversations.spec.ts observes a resume: the
 * command line the mock was started with, and the file that line names.
 */

/** The built-in Roles, in the order the drawer lists them under "None". */
const BUILTIN_ROLE_NAMES = [
  'Architect',
  'Developer',
  'QA Engineer',
  'DevSecOps Engineer',
  'Security Engineer',
  'Cloud Engineer',
  'Agile Project Manager',
];

/** The drawer's Role row: its accessible name says the Role the launch gets. */
function rolePicker(drawer: Locator): Locator {
  return drawer.getByTestId('role-picker');
}

/** Open the Role row and pick `name` ("None" = no Role). */
async function pickRole(drawer: Locator, name: string): Promise<void> {
  await rolePicker(drawer).click();
  await drawer.getByTestId('role-options').getByRole('button', { name, exact: true }).click();
  await expect(rolePicker(drawer)).toHaveAccessibleName(`Role: ${name}`);
}

/** The mock's invocation log, empty until its first launch writes it. */
function invocations(logFile: string): string {
  try {
    return fs.readFileSync(logFile, 'utf8');
  } catch {
    return '';
  }
}

async function reload(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  // Park the pointer away from the launch button: the drawer opens on hover,
  // and a mouse already on the remounted button may produce no enter event.
  await page.mouse.move(0, 0);
}

test.describe('Standalone / roles', () => {
  // Same POSIX-only constraint as the terminal spec: the PTY spawns the mock's
  // bash wrapper directly, and the .cmd shim needs a cmd.exe hop.
  test.skip(process.platform === 'win32', 'PTY spawn of the .cmd mock shim is untested on Windows');
  test.use({ standaloneOptions: { mockClaude: true } });

  test('an agent launched as a Role gets its instructions, wears its name, and keeps it across a reload @area:standalone', async ({
    page,
    standalone,
  }) => {
    await setSettings(page, { alwaysShowLabels: true });
    await waitForClaudeHookSetup(standalone.tmpHome);

    await arrangeNextClaudeInvocation(
      standalone.tmpHome,
      claudeScenario('role launch')
        .at(1_000)
        .emitHook(preToolUseBash('{{sessionId}}', 'npm test') as Record<string, unknown>)
        .holdOpenFor(60_000)
        .build(),
    );

    const drawer = await openLaunchDrawer(page);
    // No Role until one is picked: a plain launch stays what it always was.
    await expect(rolePicker(drawer)).toHaveAccessibleName('Role: None');

    // The Role row swaps the Directories for the Roles: "None", then the team
    // (a Role added beside the team's, `npm run new-role`, is listed after it).
    await rolePicker(drawer).click();
    const listed = ['None', ...BUILTIN_ROLE_NAMES];
    await expect
      .poll(async () =>
        (await drawer.getByTestId('role-option-name').allTextContents()).slice(0, listed.length),
      )
      .toEqual(listed);
    await rolePicker(drawer).click();

    await pickRole(drawer, 'QA Engineer');
    const directoryName = path.basename(standalone.workspaceDir);
    await drawer.getByRole('button', { name: directoryName, exact: true }).click();

    // The character wears the Role above what it is doing and where.
    await expectOverlayCount(page, 1);
    await expectOverlayVisibleWithTexts(page, ['QA Engineer', 'Running: npm test', directoryName]);
    await expect(page.getByTestId('agent-role')).toHaveAttribute('data-role-id', 'qa-engineer');

    // The coding agent was started with the Role's instructions: a file named
    // on its command line, holding the team and this Role's part in it.
    const promptFile = path.join(
      standalone.tmpHome,
      '.pixel-agents',
      'role-prompts',
      'qa-engineer.md',
    );
    await expect
      .poll(() => invocations(standalone.mockLogFile))
      .toContain(`--append-system-prompt-file ${promptFile}`);
    const instructions = fs.readFileSync(promptFile, 'utf8');
    expect(instructions).toContain('## Your role: QA Engineer');
    expect(instructions).toContain('- Agile Project Manager: ');

    // The Role is the agent's, not the page's: a reload still shows it.
    await reload(page);
    await expectOverlayCount(page, 1);
    await expectOverlayVisibleWithTexts(page, ['QA Engineer', directoryName]);

    // The pick was the drawer's: opened afresh, the next launch has no Role.
    await expect(rolePicker(await openLaunchDrawer(page))).toHaveAccessibleName('Role: None');
  });

  test("the host's roles.json renames a built-in Role and adds its own @area:standalone", async ({
    page,
    standalone,
  }) => {
    await setSettings(page, { alwaysShowLabels: true });
    await waitForClaudeHookSetup(standalone.tmpHome);

    // The user's file, written while the server runs: it is read again when
    // the next office connects.
    fs.writeFileSync(
      path.join(standalone.tmpHome, '.pixel-agents', 'roles.json'),
      JSON.stringify({
        roles: [
          { id: 'developer', name: 'Rust Developer' },
          {
            id: 'technical-writer',
            name: 'Technical Writer',
            description: 'Keeps the docs true.',
            color: 'pink',
            prompt: ['You are the Technical Writer.', 'Every change ships with its docs.'],
          },
        ],
      }),
    );
    await reload(page);

    const drawer = await openLaunchDrawer(page);
    await rolePicker(drawer).click();
    const names = drawer.getByTestId('role-option-name');
    const team = [
      'None',
      ...BUILTIN_ROLE_NAMES.map((name) => (name === 'Developer' ? 'Rust Developer' : name)),
    ];
    await expect
      .poll(async () => (await names.allTextContents()).slice(0, team.length))
      .toEqual(team);
    // The user's own Role is listed after every built-in one.
    await expect(names.last()).toHaveText('Technical Writer');
    // A Role of the user's own has no Playbooks and says nothing of them; a
    // built-in one they changed keeps its own.
    const writer = drawer.locator('[data-testid="role-option"][data-role-id="technical-writer"]');
    await expect(writer.getByTestId('role-playbooks')).toHaveCount(0);
    await expect(writer).toHaveAttribute('title', 'Keeps the docs true.');
    await expect(
      drawer
        .locator('[data-testid="role-option"][data-role-id="developer"]')
        .getByTestId('role-playbooks'),
    ).toHaveText('2');
    await rolePicker(drawer).click();

    await arrangeNextClaudeInvocation(
      standalone.tmpHome,
      claudeScenario('user role launch')
        .at(1_000)
        .emitHook(preToolUseBash('{{sessionId}}', 'npm test') as Record<string, unknown>)
        .holdOpenFor(60_000)
        .build(),
    );
    await pickRole(drawer, 'Technical Writer');
    const directoryName = path.basename(standalone.workspaceDir);
    await drawer.getByRole('button', { name: directoryName, exact: true }).click();

    await expectOverlayCount(page, 1);
    await expectOverlayVisibleWithTexts(page, ['Technical Writer', 'Running: npm test']);

    // Its instructions are the user's, behind the same team charter, and the
    // team it is told about is the host's (the renamed Role included).
    const promptFile = path.join(
      standalone.tmpHome,
      '.pixel-agents',
      'role-prompts',
      'technical-writer.md',
    );
    await expect
      .poll(() => invocations(standalone.mockLogFile))
      .toContain(`--append-system-prompt-file ${promptFile}`);
    const instructions = fs.readFileSync(promptFile, 'utf8');
    expect(instructions).toContain('Every change ships with its docs.');
    expect(instructions).toContain('- Rust Developer: ');
    expect(instructions).toContain('- Technical Writer (you): Keeps the docs true.');
  });

  test("a Role's Playbooks: the drawer says how many it has, and its agent is launched with them as its skills and with its Contract @area:standalone", async ({
    page,
    standalone,
  }) => {
    await setSettings(page, { alwaysShowLabels: true });
    await waitForClaudeHookSetup(standalone.tmpHome);
    await arrangeNextClaudeInvocation(
      standalone.tmpHome,
      claudeScenario('role with playbooks').holdOpenFor(60_000).build(),
    );

    const drawer = await openLaunchDrawer(page);
    await rolePicker(drawer).click();
    // The DevSecOps Engineer has three; the hover names them under what it does.
    const engineer = drawer.locator(
      '[data-testid="role-option"][data-role-id="devsecops-engineer"]',
    );
    await expect(engineer.getByTestId('role-playbooks')).toHaveText('3');
    await expect(engineer).toHaveAttribute(
      'title',
      /\nPlaybooks: Pipeline troubleshooting, Pipeline hardening, Supply chain audit\.$/,
    );
    // Every Role of the team has its own.
    const developer = drawer.locator('[data-testid="role-option"][data-role-id="developer"]');
    await expect(developer).toHaveAttribute(
      'title',
      /\nPlaybooks: Safe refactor, Dependency upgrade\.$/,
    );
    // In the team's order (a Role added beside the team's counts its own after these).
    const counts = ['2', '2', '2', '3', '2', '2', '2'];
    await expect
      .poll(async () =>
        (await drawer.getByTestId('role-playbooks').allTextContents()).slice(0, counts.length),
      )
      .toEqual(counts);
    await rolePicker(drawer).click();

    await pickRole(drawer, 'DevSecOps Engineer');
    const directoryName = path.basename(standalone.workspaceDir);
    await drawer.getByRole('button', { name: directoryName, exact: true }).click();
    await expectOverlayCount(page, 1);
    await expectOverlayVisibleWithTexts(page, ['DevSecOps Engineer', directoryName]);

    // The coding agent was started with the Role's Playbooks as a plugin of
    // that session alone: a folder under ~/.pixel-agents named on its command
    // line, one skill per Playbook.
    const kits = path.join(standalone.tmpHome, '.pixel-agents', 'role-kits');
    await expect
      .poll(() => invocations(standalone.mockLogFile))
      .toContain(`--plugin-dir ${path.join(kits, 'devsecops-engineer-')}`);
    const [pluginFolder] = fs.readdirSync(kits);
    expect(pluginFolder).toMatch(/^devsecops-engineer-[0-9a-f]{12}$/);
    expect(fs.readdirSync(path.join(kits, pluginFolder, 'skills')).sort()).toEqual([
      'pipeline-hardening',
      'pipeline-troubleshooting',
      'supply-chain-audit',
    ]);
    const troubleshooting = fs.readFileSync(
      path.join(kits, pluginFolder, 'skills', 'pipeline-troubleshooting', 'SKILL.md'),
      'utf8',
    );
    expect(troubleshooting).toContain('name: pipeline-troubleshooting');
    expect(troubleshooting).toContain('Pipeline Doctor');

    // Its instructions hold its Contract and name each Playbook as the CLI lists it.
    const instructions = fs.readFileSync(
      path.join(standalone.tmpHome, '.pixel-agents', 'role-prompts', 'devsecops-engineer.md'),
      'utf8',
    );
    expect(instructions).toContain('## Your contract');
    expect(instructions).toContain('`devsecops-engineer:pipeline-troubleshooting`');
  });

  test('a launch into a new worktree is as the picked Role too @area:standalone', async ({
    page,
    standalone,
  }) => {
    await setSettings(page, { alwaysShowLabels: true });
    await waitForClaudeHookSetup(standalone.tmpHome);

    const repo = path.join(standalone.workspaceDir, 'repo');
    initGitRepo(repo);
    await addDirectory(page, { name: 'Repo', path: repo });

    await arrangeNextClaudeInvocation(
      standalone.tmpHome,
      claudeScenario('role worktree launch')
        .at(1_000)
        .emitHook(preToolUseBash('{{sessionId}}', 'npm test') as Record<string, unknown>)
        .holdOpenFor(60_000)
        .build(),
    );

    // The Role first, then the row's worktree button: the pick waits through
    // the modal that asks for the Worktree's name.
    const drawer = await openLaunchDrawer(page);
    await pickRole(drawer, 'Developer');
    await drawer.getByRole('button', { name: 'Repo', exact: true }).hover();
    await page.getByRole('button', { name: 'New worktree in Repo' }).click();
    const worktree = await confirmNewWorktree(page);

    // One agent, wearing both: the Role above its activity, the Worktree's
    // mark beside its Directory.
    await expectOverlayCount(page, 1);
    await expectOverlayVisibleWithTexts(page, ['Developer', 'Running: npm test', 'Repo']);
    await expect(page.getByTestId('agent-role')).toHaveAttribute('data-role-id', 'developer');
    await expect(page.locator('[data-testid="agent-overlay-worktree"]')).toBeVisible();

    // Its card too: the Role's name and the branch in its title, and the mark.
    await expect(page.locator(`[title$=" · Developer · worktree ${worktree}"]`)).toBeVisible();
    await expect(page.locator('[data-testid="card-worktree"]')).toBeVisible();

    // The coding agent runs in the Worktree, started with the Role's instructions.
    const promptFile = path.join(
      standalone.tmpHome,
      '.pixel-agents',
      'role-prompts',
      'developer.md',
    );
    await expect
      .poll(() => invocations(standalone.mockLogFile))
      .toContain(`--append-system-prompt-file ${promptFile}`);
    expect(fs.existsSync(path.join(repo, '.claude', 'worktrees', worktree))).toBe(true);
  });
});

/**
 * The Roles reaching each other through the Pixel Office MCP: the agent that
 * coordinates launches a colleague as its Role and asks it for its status.
 *
 * The agent's side of the wire is the mock claude's (e2e/README.md "Mocking
 * model & rules"): its scenario calls the tools the way Claude Code's MCP
 * client would, with the endpoint and token of the `--mcp-config` file the
 * office launched it with. The test only clicks and reads the page, plus the
 * command line the colleague was started with.
 */
test.describe('Standalone / roles over the Pixel Office MCP', () => {
  test.skip(process.platform === 'win32', 'PTY spawn of the .cmd mock shim is untested on Windows');
  test.use({
    standaloneOptions: {
      mockClaude: true,
      // The user allowed the Pixel Office MCP in the Intro: every launch gets it.
      seedConfig: { officeMcpConsent: 'granted' },
      // The mock reads its terminal like Claude Code's TUI and shows what is typed.
      hostEnv: { PIXEL_AGENTS_MOCK_STDIN: 'record' },
    },
  });

  test('the Agile Project Manager launches a Developer as its Role and asks for its status, saying who asks @area:standalone', async ({
    page,
    standalone,
  }) => {
    test.setTimeout(120_000);
    const firstMessage = 'Pick up story 1';
    const text = 'Daily: what is done, what is next, what is blocked?';
    await setSettings(page, { alwaysShowLabels: true });
    await waitForClaudeHookSetup(standalone.tmpHome);

    // The manager: once running, it launches the Role the plan needs with a
    // first message, reads the newcomer's screen and asks it for its status.
    await arrangeNextClaudeInvocation(
      standalone.tmpHome,
      claudeScenario('role manager')
        .at(1_000)
        .callOfficeMcp(
          'launch_agent',
          { directory: standalone.workspaceDir, role: 'Developer', first_message: firstMessage },
          { saveAs: 'launched' },
        )
        // The Developer's screen settles (banner, prompt) before it is read.
        .at(1_000)
        .callOfficeMcp(
          'read_agent_terminal',
          { agent_id: '{{mcp.launched.agent_id}}' },
          { saveAs: 'screen', waitMs: 2_000 },
        )
        .at(1_000)
        .callOfficeMcp(
          'send_message',
          {
            to: ['{{mcp.launched.agent_id}}'],
            text,
            gist: 'Daily: status?',
            screen_tokens: { '{{mcp.launched.agent_id}}': '{{mcp.screen.screen_token}}' },
          },
          { saveAs: 'sent', waitMs: 3_000 },
        )
        .holdOpenFor(90_000)
        .build(),
    );
    // The Developer it launches: it only shows its prompt and what is typed.
    await arrangeNextClaudeInvocation(
      standalone.tmpHome,
      claudeScenario('role developer').holdOpenFor(90_000).build(),
    );

    const drawer = await openLaunchDrawer(page);
    await pickRole(drawer, 'Agile Project Manager');
    const directoryName = path.basename(standalone.workspaceDir);
    await drawer.getByRole('button', { name: directoryName, exact: true }).click();

    // Both are in the office, each marked with its Role: on its card and over
    // its character.
    await expect(page.getByTitle('Agent 1 · Agile Project Manager', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    const developerCard = page.getByTitle('Agent 2 · Developer', { exact: true });
    await expect(developerCard).toBeVisible({ timeout: 30_000 });
    await expectOverlayCount(page, 2);
    await expectOverlayVisibleWithTexts(page, ['Agile Project Manager', directoryName]);
    await expectOverlayVisibleWithTexts(page, ['Developer', directoryName]);

    // The Developer was started as its Role (the instructions file on its
    // command line) with the manager's first message, tagged with who asks.
    const promptFile = path.join(
      standalone.tmpHome,
      '.pixel-agents',
      'role-prompts',
      'developer.md',
    );
    await expect
      .poll(() => invocations(standalone.mockLogFile))
      .toContain(`--append-system-prompt-file ${promptFile}`);
    await developerCard.click();
    const developerTerminal = page.locator('.xterm:visible');
    await expect(developerTerminal).toContainText(
      `(Agile Project Manager), agent 1] ${firstMessage}`,
      { timeout: 15_000 },
    );

    // The manager's question reached the Developer's terminal, tagged with
    // which Role is asking.
    await expect(developerTerminal).toContainText(`(Agile Project Manager), agent 1] ${text}`, {
      timeout: 30_000,
    });
  });
});
