import fs from 'node:fs';
import path from 'node:path';

import type { Locator } from '@playwright/test';

import { expect, test } from '../../fixtures/standalone';
import {
  arrangeNextClaudeInvocation,
  claudeScenario,
  waitForClaudeHookSetup,
} from '../../helpers/mock-claude';
import { openLaunchDrawer, setSettings } from '../../helpers/webview';

/**
 * Workflows: the launch drawer's Workflow row hands one request to a Crew led
 * by the Workflow's own Role; the user writes what they need, the lead takes it
 * through the stages, and the office shows each stage as it moves.
 *
 * The agents' side of the wire is the mock claude's (e2e/README.md "Mocking
 * model & rules"): its scenario calls the Pixel Office MCP's tools the way
 * Claude Code's MCP client would, with the endpoint and token of the
 * `--mcp-config` file the office launched it with. The test only clicks and
 * reads the page, plus the command lines the agents were started with.
 */

/** The drawer's Workflow row: its accessible name says what the next press starts. */
function workflowPicker(drawer: Locator): Locator {
  return drawer.getByTestId('workflow-picker');
}

/** A stage's row in the Workflow panel. */
function stageRow(panel: Locator, stageId: string): Locator {
  return panel.locator(`[data-testid="workflow-stage"][data-stage-id="${stageId}"]`);
}

/** The mock's invocation log, empty until its first launch writes it. */
function invocations(logFile: string): string {
  try {
    return fs.readFileSync(logFile, 'utf8');
  } catch {
    return '';
  }
}

test.describe('Standalone / workflows', () => {
  // The agents run in the server's PTYs (POSIX only, as terminal.spec.ts).
  test.skip(process.platform === 'win32', 'PTY spawn of the .cmd mock shim is untested on Windows');
  test.use({
    standaloneOptions: {
      mockClaude: true,
      // The user allowed the Pixel Office MCP in the Intro: a Workflow's Crew works through it.
      seedConfig: { officeMcpConsent: 'granted' },
      // The mock reads its terminal like Claude Code's TUI and shows what is typed.
      hostEnv: { PIXEL_AGENTS_MOCK_STDIN: 'record' },
    },
  });

  test('a Workflow: picked in the drawer and given a request, its lead reports the stages, the office shows them moving, and Stop Workflow ends it @area:standalone', async ({
    page,
    standalone,
  }) => {
    test.setTimeout(150_000);
    // Words a shell would trip on: the request never rides a command line.
    const request = `The export button does nothing on Safari. It's 100% reproducible & "urgent".`;
    const reproduced = 'Reproduced on Safari 17.';
    await setSettings(page, { alwaysShowLabels: true });
    await waitForClaudeHookSetup(standalone.tmpHome);

    // The lead: it reads the run, opens the first stage, launches the Role that
    // owns it, closes the stage with what was found (quoting the request as the
    // tool gave it) and opens the next one. Much later (after the test stopped
    // the run) it tries to report once more.
    await arrangeNextClaudeInvocation(
      standalone.tmpHome,
      claudeScenario('workflow lead')
        .at(1_000)
        .callOfficeMcp('workflow', {}, { saveAs: 'run' })
        .at(2_000)
        .callOfficeMcp('workflow', { action: 'start', stage_id: 'reproduce' })
        .at(3_000)
        .callOfficeMcp(
          'launch_agent',
          {
            directory: standalone.workspaceDir,
            role: 'QA Engineer',
            first_message: 'Reproduce the export bug on Safari',
          },
          { saveAs: 'launched' },
        )
        .at(12_000)
        .callOfficeMcp('workflow', {
          action: 'finish',
          stage_id: 'reproduce',
          note: `${reproduced} Asked: {{mcp.run.request}}`,
        })
        .at(13_000)
        .callOfficeMcp('workflow', { action: 'start', stage_id: 'diagnosis' })
        .at(60_000)
        .callOfficeMcp(
          'workflow',
          { action: 'finish', stage_id: 'diagnosis', note: 'Found it.' },
          { saveAs: 'refused' },
        )
        .holdOpenFor(120_000)
        .build(),
    );
    // The QA Engineer it launches: it only shows its prompt and what is typed.
    await arrangeNextClaudeInvocation(
      standalone.tmpHome,
      claudeScenario('workflow qa').holdOpenFor(120_000).build(),
    );

    // None until picked: a plain launch stays what it always was.
    const drawer = await openLaunchDrawer(page);
    await expect(workflowPicker(drawer)).toHaveAccessibleName('Workflow: None');
    await workflowPicker(drawer).click();
    const options = drawer.getByTestId('workflow-option');
    // "None", then the Workflows the office ships with, under the Role that
    // leads each: the coordinator's four first, then a Role's own.
    await expect(options).toHaveText([
      'None',
      'New feature',
      'Bug fix',
      'Deep security analysis',
      'Deep quality analysis',
      'Pipeline troubleshooting',
      'Pipeline hardening',
      'Supply chain audit',
    ]);
    await expect(drawer.getByTestId('workflow-group-lead')).toHaveText([
      'Agile Project Manager',
      'DevSecOps Engineer',
    ]);
    await drawer.locator('[data-testid="workflow-option"][data-workflow-id="bug-fix"]').click();
    await expect(workflowPicker(drawer)).toHaveAccessibleName('Workflow: Bug fix');

    // A run is a Crew led by the Workflow's own Role: both rows say so, locked.
    const rolePicker = drawer.getByTestId('role-picker');
    await expect(rolePicker).toHaveAccessibleName('Role: Agile Project Manager');
    await expect(rolePicker).toHaveAttribute('aria-disabled', 'true');
    const crewSwitch = drawer.getByTestId('crew-switch');
    await expect(crewSwitch).toHaveAccessibleName('Crew: on');
    await expect(crewSwitch).toHaveAttribute('aria-disabled', 'true');

    // Pressing the Directory launches nothing yet: the request comes first.
    const directoryName = path.basename(standalone.workspaceDir);
    await drawer.getByRole('button', { name: directoryName, exact: true }).click();
    const modal = page.getByTestId('workflow-start-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId('workflow-start-where')).toContainText(
      `Runs in ${directoryName}, led by Agile Project Manager`,
    );
    await expect(modal.getByTestId('workflow-start-stages').locator('li')).toHaveCount(6);
    await expect(page.locator('[title^="Agent 1"]')).toHaveCount(0);

    // An empty request starts nothing and says why.
    await modal.getByTestId('workflow-start').click();
    await expect(modal.getByRole('alert')).toContainText('Write what you need');
    await modal.getByTestId('workflow-request-input').fill(request);
    await modal.getByTestId('workflow-start').click();
    await expect(modal).toBeHidden();

    // The lead comes in as the Workflow's Role, with a Crew.
    const leadCard = page.getByTitle('Agent 1 · Agile Project Manager · Crew', { exact: true });
    await expect(leadCard).toBeVisible({ timeout: 30_000 });

    // The panel: shut it counts the stages closed; open it shows the request
    // and every stage with the Role that owns it.
    const panel = page.getByTestId('workflow-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await panel.getByRole('button', { name: 'Show the workflow' }).click();
    const run = panel.getByTestId('workflow-run');
    await expect(run).toHaveAttribute('data-workflow-id', 'bug-fix');
    await expect(run.getByTestId('workflow-request')).toContainText(
      'The export button does nothing',
    );
    await expect(run.getByTestId('workflow-stage')).toHaveCount(6);
    await expect(stageRow(panel, 'reproduce')).toContainText('QA Engineer');

    // The lead hands the first stage to the Role that owns it, without asking.
    const qaCard = page.getByTitle('Agent 2 · QA Engineer · Crew', { exact: true });
    await expect(qaCard).toBeVisible({ timeout: 30_000 });

    // The stages move as the lead reports them.
    await expect(stageRow(panel, 'reproduce')).toHaveAttribute('data-state', 'done', {
      timeout: 30_000,
    });
    // Its note quotes the request: the user's words reached the lead through the tool.
    await expect(stageRow(panel, 'reproduce').getByTestId('workflow-stage-note')).toContainText(
      `${reproduced} Asked: ${request}`,
    );
    await expect(stageRow(panel, 'diagnosis')).toHaveAttribute('data-state', 'active', {
      timeout: 15_000,
    });
    await expect(stageRow(panel, 'fix')).toHaveAttribute('data-state', 'pending');
    await expect(panel).toContainText('1 / 6');

    // The lead was started with a fixed first message, free like any Crew's
    // agent; the user's words never rode a command line.
    const log = invocations(standalone.mockLogFile);
    expect(log).toContain('Lead the workflow the user just started with you');
    expect(log).not.toContain('export button');
    expect(log).toContain('--permission-mode auto');
    expect(log).toContain('mcp__pixel-office__workflow');

    // Stop Workflow is asked once; it ends the run and its Crew, not the agents.
    await panel.getByRole('button', { name: 'Stop Workflow' }).click();
    await expect(panel).toContainText('Stop this workflow?');
    await panel.getByRole('button', { name: 'Stop Workflow' }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId('card-crew')).toHaveCount(0);
    await expect(page.getByTitle('Agent 1 · Agile Project Manager', { exact: true })).toBeVisible();
    await expect(page.getByTitle('Agent 2 · QA Engineer', { exact: true })).toBeVisible();

    // And the lead's next report is refused: the run is over.
    await page.getByTitle('Agent 1 · Agile Project Manager', { exact: true }).click();
    await expect(page.locator('.xterm:visible')).toContainText('The user stopped this workflow', {
      timeout: 90_000,
    });
  });
});

test.describe("Standalone / a Role's own workflows", () => {
  test.skip(process.platform === 'win32', 'PTY spawn of the .cmd mock shim is untested on Windows');
  test.use({
    standaloneOptions: {
      mockClaude: true,
      seedConfig: { officeMcpConsent: 'granted' },
      hostEnv: { PIXEL_AGENTS_MOCK_STDIN: 'record' },
    },
  });

  test('a Workflow a Role leads: picked under its lead, the run is led by that Role, launched with its Playbooks @area:standalone', async ({
    page,
    standalone,
  }) => {
    test.setTimeout(120_000);
    await setSettings(page, { alwaysShowLabels: true });
    await waitForClaudeHookSetup(standalone.tmpHome);

    // The lead: it reads the run and opens its own first stage.
    await arrangeNextClaudeInvocation(
      standalone.tmpHome,
      claudeScenario('pipeline troubleshooting lead')
        .at(1_000)
        .callOfficeMcp('workflow', {}, { saveAs: 'run' })
        .at(2_000)
        .callOfficeMcp('workflow', { action: 'start', stage_id: 'evidence' })
        .holdOpenFor(90_000)
        .build(),
    );

    const drawer = await openLaunchDrawer(page);
    await workflowPicker(drawer).click();
    // The DevSecOps Engineer's own Workflows sit together under its name.
    const own = drawer
      .getByTestId('workflow-group')
      .filter({ has: page.getByTestId('workflow-group-lead').getByText('DevSecOps Engineer') });
    await expect(own.getByTestId('workflow-option')).toHaveText([
      'Pipeline troubleshooting',
      'Pipeline hardening',
      'Supply chain audit',
    ]);
    await own
      .locator('[data-testid="workflow-option"][data-workflow-id="pipeline-troubleshooting"]')
      .click();
    await expect(workflowPicker(drawer)).toHaveAccessibleName('Workflow: Pipeline troubleshooting');
    // The run's lead is the Role the Workflow belongs to.
    const rolePicker = drawer.getByTestId('role-picker');
    await expect(rolePicker).toHaveAccessibleName('Role: DevSecOps Engineer');
    await expect(rolePicker).toHaveAttribute('aria-disabled', 'true');

    const directoryName = path.basename(standalone.workspaceDir);
    await drawer.getByRole('button', { name: directoryName, exact: true }).click();
    const modal = page.getByTestId('workflow-start-modal');
    await expect(modal.getByTestId('workflow-start-where')).toContainText(
      `Runs in ${directoryName}, led by DevSecOps Engineer`,
    );
    await expect(modal.getByTestId('workflow-start-stages').locator('li')).toHaveCount(6);
    await modal
      .getByTestId('workflow-request-input')
      .fill('The CI run of the main branch fails since this morning.');
    await modal.getByTestId('workflow-start').click();
    await expect(modal).toBeHidden();

    await expect(
      page.getByTitle('Agent 1 · DevSecOps Engineer · Crew', { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    const panel = page.getByTestId('workflow-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await panel.getByRole('button', { name: 'Show the workflow' }).click();
    await expect(panel.getByTestId('workflow-run')).toHaveAttribute(
      'data-workflow-id',
      'pipeline-troubleshooting',
    );
    // Its stages, each with the Role that owns it; the lead opened its own first one.
    await expect(panel.getByTestId('workflow-stage')).toHaveCount(6);
    await expect(stageRow(panel, 'evidence')).toContainText('DevSecOps Engineer');
    await expect(stageRow(panel, 'fix')).toContainText('Developer');
    await expect(stageRow(panel, 'verification')).toContainText('QA Engineer');
    await expect(stageRow(panel, 'evidence')).toHaveAttribute('data-state', 'active', {
      timeout: 30_000,
    });

    // The lead was started as its Role: with its Playbooks as that session's
    // skills, free like any Crew's agent, and the request never on a command line.
    const log = invocations(standalone.mockLogFile);
    expect(log).toContain(
      `--plugin-dir ${path.join(standalone.tmpHome, '.pixel-agents', 'role-kits', 'devsecops-engineer-')}`,
    );
    expect(log).toContain('Lead the workflow the user just started with you');
    expect(log).not.toContain('fails since this morning');
    expect(log).toContain('--permission-mode auto');
  });
});

test.describe('Standalone / workflows without the Pixel Office MCP', () => {
  test.skip(process.platform === 'win32', 'PTY spawn of the .cmd mock shim is untested on Windows');
  // The fixture's default: the Pixel Office MCP was declined in the Intro.
  test.use({ standaloneOptions: { mockClaude: true } });

  test('the Workflow row lists nothing to pick and says what it needs; the launch is a plain agent @area:standalone', async ({
    page,
    standalone,
  }) => {
    await waitForClaudeHookSetup(standalone.tmpHome);
    await arrangeNextClaudeInvocation(
      standalone.tmpHome,
      claudeScenario('no workflow').holdOpenFor(30_000).build(),
    );

    const drawer = await openLaunchDrawer(page);
    await expect(workflowPicker(drawer)).toHaveAccessibleName('Workflow: None');
    await expect(workflowPicker(drawer)).toHaveAttribute('aria-disabled', 'true');
    await expect(workflowPicker(drawer)).toHaveAttribute('title', /turn it on in Settings/);
    // Pressed all the same (a disabled control takes no ordinary click): no list opens.
    await workflowPicker(drawer).click({ force: true });
    await expect(drawer.getByTestId('workflow-options')).toHaveCount(0);

    const directoryName = path.basename(standalone.workspaceDir);
    await drawer.getByRole('button', { name: directoryName, exact: true }).click();
    await expect(page.getByTestId('workflow-start-modal')).toHaveCount(0);
    await expect(page.getByTitle('Agent 1', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('workflow-panel')).toHaveCount(0);
  });
});
