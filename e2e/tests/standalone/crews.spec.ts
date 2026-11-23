import fs from 'node:fs';
import path from 'node:path';

import type { Locator } from '@playwright/test';

import { expect, test } from '../../fixtures/standalone';
import {
  arrangeNextClaudeInvocation,
  claudeScenario,
  waitForClaudeHookSetup,
} from '../../helpers/mock-claude';
import { expectOverlayCount, expectOverlayVisibleWithTexts } from '../../helpers/office';
import { openLaunchDrawer, setSettings } from '../../helpers/webview';

/**
 * Crews: the launch drawer's switch sets an agent free to launch the others it
 * needs and work with them without asking the user; the office marks them,
 * shows who launched whom, and lets the user end it.
 *
 * The agents' side of the wire is the mock claude's (e2e/README.md "Mocking
 * model & rules"): its scenario calls the Pixel Office MCP's tools the way
 * Claude Code's MCP client would, with the endpoint and token of the
 * `--mcp-config` file the office launched it with. The test only clicks and
 * reads the page, plus the command lines the agents were started with.
 */

/** The drawer's Crew switch: its accessible name says what the next launch gets. */
function crewSwitch(drawer: Locator): Locator {
  return drawer.getByTestId('crew-switch');
}

/** The mock's invocation log, empty until its first launch writes it. */
function invocations(logFile: string): string {
  try {
    return fs.readFileSync(logFile, 'utf8');
  } catch {
    return '';
  }
}

test.describe('Standalone / crews', () => {
  // The agents run in the server's PTYs (POSIX only, as terminal.spec.ts).
  test.skip(process.platform === 'win32', 'PTY spawn of the .cmd mock shim is untested on Windows');
  test.use({
    standaloneOptions: {
      mockClaude: true,
      // The user allowed the Pixel Office MCP in the Intro: a Crew works through it.
      seedConfig: { officeMcpConsent: 'granted' },
      // The mock reads its terminal like Claude Code's TUI and shows what is typed.
      hostEnv: { PIXEL_AGENTS_MOCK_STDIN: 'record' },
    },
  });

  test('a Crew: its first agent launches a colleague without asking, the office marks both and says who launched whom, and End Crew stops it @area:standalone', async ({
    page,
    standalone,
  }) => {
    test.setTimeout(150_000);
    const firstMessage = 'Pick up story 1';
    await setSettings(page, { alwaysShowLabels: true });
    await waitForClaudeHookSetup(standalone.tmpHome);

    // The manager: once running, it launches the Developer the work needs.
    // Much later (after the test ended the Crew) it tries to launch one more.
    await arrangeNextClaudeInvocation(
      standalone.tmpHome,
      claudeScenario('crew manager')
        .at(1_000)
        .callOfficeMcp(
          'launch_agent',
          { directory: standalone.workspaceDir, role: 'Developer', first_message: firstMessage },
          { saveAs: 'launched' },
        )
        .at(45_000)
        .callOfficeMcp(
          'launch_agent',
          { directory: standalone.workspaceDir, role: 'QA Engineer' },
          { saveAs: 'refused' },
        )
        .holdOpenFor(120_000)
        .build(),
    );
    // The Developer it launches: it only shows its prompt and what is typed.
    await arrangeNextClaudeInvocation(
      standalone.tmpHome,
      claudeScenario('crew developer').holdOpenFor(120_000).build(),
    );

    // Off until switched on: a plain launch stays what it always was.
    const drawer = await openLaunchDrawer(page);
    await expect(crewSwitch(drawer)).toHaveAccessibleName('Crew: off');
    await crewSwitch(drawer).click();
    await expect(crewSwitch(drawer)).toHaveAccessibleName('Crew: on');
    await expect(crewSwitch(drawer)).toHaveAttribute('aria-checked', 'true');

    // The switch and the Role are both the next launch's.
    await drawer.getByTestId('role-picker').click();
    await drawer
      .getByTestId('role-options')
      .getByRole('button', { name: 'Agile Project Manager', exact: true })
      .click();
    await expect(crewSwitch(drawer)).toHaveAccessibleName('Crew: on');
    const directoryName = path.basename(standalone.workspaceDir);
    await drawer.getByRole('button', { name: directoryName, exact: true }).click();

    // The manager walks over to the Developer it launched, saying what it asked.
    const gistBubble = page.locator('[data-testid="agent-gist"][data-agent-id="1"]');
    await expect(gistBubble).toBeVisible({ timeout: 30_000 });
    await expect(gistBubble).toContainText(firstMessage);

    // Both wear the Crew's mark: on their cards and over their characters.
    const managerCard = page.getByTitle('Agent 1 · Agile Project Manager · Crew', { exact: true });
    const developerCard = page.getByTitle('Agent 2 · Developer · Crew', { exact: true });
    await expect(managerCard).toBeVisible({ timeout: 15_000 });
    await expect(developerCard).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('card-crew')).toHaveCount(2);
    await expectOverlayCount(page, 2);
    await expectOverlayVisibleWithTexts(page, ['Agile Project Manager', 'Crew', directoryName]);
    await expectOverlayVisibleWithTexts(page, ['Developer', 'Crew', directoryName]);

    // Both were started free: the Crew's terms in their instructions, the
    // tools they reach each other with allowed, and no prompt per edit.
    const prompts = path.join(standalone.tmpHome, '.pixel-agents', 'role-prompts');
    const managerPrompt = path.join(prompts, 'agile-project-manager.crew.md');
    const developerPrompt = path.join(prompts, 'developer.crew.md');
    await expect
      .poll(() => invocations(standalone.mockLogFile))
      .toContain(`--append-system-prompt-file ${developerPrompt}`);
    const log = invocations(standalone.mockLogFile);
    expect(log).toContain(`--append-system-prompt-file ${managerPrompt}`);
    expect(log).toContain('--permission-mode auto');
    expect(log).toContain('mcp__pixel-office__launch_agent');
    expect(fs.readFileSync(developerPrompt, 'utf8')).toContain('## Your Crew');

    // The Developer got the manager's first message, saying who asks.
    await developerCard.click();
    await expect(page.locator('.xterm:visible')).toContainText(
      `(Agile Project Manager), agent 1] ${firstMessage}`,
      { timeout: 15_000 },
    );

    // The panel: shut it counts the Crew's agents; open it lists each under
    // the one that launched it, and what they did to each other.
    const panel = page.getByTestId('crew-panel');
    await expect(panel).toContainText('Crew');
    await expect(panel).toContainText('2 / 8');
    await panel.getByRole('button', { name: 'Show the Crew' }).click();
    const members = panel.getByTestId('crew-member');
    await expect(members).toHaveCount(2);
    await expect(members.nth(0)).toContainText('Agile Project Manager');
    await expect(members.nth(1)).toContainText('Developer');
    await expect(members.nth(1)).toHaveAttribute('data-launched-by', '1');
    const launched = panel.locator('[data-testid="crew-event"][data-kind="launched"]');
    await expect(launched).toHaveCount(1);
    await expect(launched).toContainText('launched');
    await expect(launched).toContainText(firstMessage);

    // End Crew is asked once; the agents stay, without the mark.
    await panel.getByRole('button', { name: 'End Crew' }).click();
    await expect(panel).toContainText('End this Crew?');
    await panel.getByRole('button', { name: 'End Crew' }).click();
    await expect(panel.getByTestId('crew')).toHaveAttribute('data-ended', 'true');
    await expect(page.getByTestId('card-crew')).toHaveCount(0);
    await expect(page.getByTestId('agent-crew')).toHaveCount(0);
    await expect(page.getByTitle('Agent 1 · Agile Project Manager', { exact: true })).toBeVisible();
    await expect(page.getByTitle('Agent 2 · Developer', { exact: true })).toBeVisible();

    // And the manager's next launch is refused: no third agent joins.
    await page.getByTitle('Agent 1 · Agile Project Manager', { exact: true }).click();
    await expect(page.locator('.xterm:visible')).toContainText('The user ended your Crew', {
      timeout: 90_000,
    });
    await expect(page.locator('[title^="Agent 3"]')).toHaveCount(0);
  });
});

test.describe('Standalone / crews without the Pixel Office MCP', () => {
  test.skip(process.platform === 'win32', 'PTY spawn of the .cmd mock shim is untested on Windows');
  // The fixture's default: the Pixel Office MCP was declined in the Intro.
  test.use({ standaloneOptions: { mockClaude: true } });

  test('the Crew switch stays off and says what it needs; the launch is a plain agent @area:standalone', async ({
    page,
    standalone,
  }) => {
    await waitForClaudeHookSetup(standalone.tmpHome);
    await arrangeNextClaudeInvocation(
      standalone.tmpHome,
      claudeScenario('no crew').holdOpenFor(30_000).build(),
    );

    const drawer = await openLaunchDrawer(page);
    await expect(crewSwitch(drawer)).toHaveAccessibleName('Crew: off');
    await expect(crewSwitch(drawer)).toHaveAttribute('aria-disabled', 'true');
    await expect(crewSwitch(drawer)).toHaveAttribute('title', /turn it on in Settings/);
    // Pressed all the same (a disabled control takes no ordinary click): still off.
    await crewSwitch(drawer).click({ force: true });
    await expect(crewSwitch(drawer)).toHaveAccessibleName('Crew: off');

    const directoryName = path.basename(standalone.workspaceDir);
    await drawer.getByRole('button', { name: directoryName, exact: true }).click();
    await expect(page.getByTitle('Agent 1', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('card-crew')).toHaveCount(0);
    await expect(page.getByTestId('crew-panel')).toHaveCount(0);
  });
});
