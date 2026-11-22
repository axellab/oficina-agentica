import fs from 'node:fs';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../fixtures/standalone';
import { preToolUseBash } from '../../helpers/hooks';
import {
  arrangeNextClaudeInvocation,
  claudeScenario,
  waitForClaudeHookSetup,
} from '../../helpers/mock-claude';
import { expectOverlayCount, expectOverlayVisibleWithTexts } from '../../helpers/office';
import { openLaunchDrawer, setSettings } from '../../helpers/webview';

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

    // The Role row swaps the Directories for the Roles: "None", then the team.
    await rolePicker(drawer).click();
    await expect(drawer.getByTestId('role-option')).toHaveText(['None', ...BUILTIN_ROLE_NAMES]);
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
    await expect(drawer.getByTestId('role-option')).toHaveText([
      'None',
      ...BUILTIN_ROLE_NAMES.map((name) => (name === 'Developer' ? 'Rust Developer' : name)),
      'Technical Writer',
    ]);
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
});
