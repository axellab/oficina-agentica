/**
 * The office's Workflows: what a `workflowsLoaded` or `workflowRejected`
 * message leaves in the store (workflowStore), and what the Workflow panel and
 * the request dialog print (workflowView): a run's progress, a stage's words,
 * the stages numbered by step, the Workflows under the Role that leads them,
 * and whether a request may be sent.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { beforeEach, test } from 'vitest';

import type {
  Workflow,
  WorkflowRun,
  WorkflowRunStage,
  WorkflowStageCheck,
} from '../../core/src/messages.js';
import { MAX_WORKFLOW_REQUEST_CHARS } from '../../core/src/workflows.js';
import {
  checkOutputView,
  closeCheckOutput,
  dismissWorkflowRejection,
  handleWorkflowsMessage,
  openCheckOutput,
  resetWorkflowStoreForTests,
  workflowRejection,
  workflowsLoaded,
} from '../src/workflows/workflowStore.js';
import {
  canSkipStage,
  checkHasOutput,
  checkLine,
  checkSpan,
  numberedStages,
  panelCount,
  requestProblem,
  runProgress,
  stageMarksTitle,
  stageTitle,
  workflowsByLead,
} from '../src/workflows/workflowView.js';

beforeEach(() => resetWorkflowStoreForTests());

const BUG_FIX: Workflow = {
  id: 'bug-fix',
  name: 'Bug fix',
  description: 'Reproduce it, fix it, prove it stays fixed.',
  source: 'builtin',
  leadRoleId: 'agile-project-manager',
  leadRoleName: 'Agile Project Manager',
  stages: [
    { id: 'reproduce', title: 'Reproduce', roleName: 'QA Engineer' },
    { id: 'fix', title: 'Fix', roleName: 'Developer' },
    { id: 'verify', title: 'Verify', roleName: 'QA Engineer' },
    { id: 'security', title: 'Security check', roleName: 'Security Engineer', parallel: true },
    { id: 'report', title: 'Report', roleName: 'Agile Project Manager' },
  ],
};

function stage(id: string, state: WorkflowRunStage['state'], note?: string): WorkflowRunStage {
  const listed = BUG_FIX.stages.find((candidate) => candidate.id === id);
  assert.ok(listed, `no stage ${id}`);
  const { id: stageId, title, roleName, parallel } = listed;
  return {
    id: stageId,
    title,
    roleName,
    ...(parallel ? { parallel } : {}),
    state,
    ...(note ? { note } : {}),
  };
}

function runOf(stages: WorkflowRunStage[], more: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    crewId: 'crew-1',
    workflowId: 'bug-fix',
    name: 'Bug fix',
    request: 'The export button does nothing on Safari.',
    finished: false,
    stages,
    ...more,
  };
}

function loaded(more: Record<string, unknown> = {}) {
  return { type: 'workflowsLoaded', available: true, workflows: [BUG_FIX], runs: [], ...more };
}

// ── The store ───────────────────────────────────────────────────

test('nothing is known of Workflows until the server lists them', () => {
  assert.equal(workflowsLoaded(), null);
});

test('workflowsLoaded replaces the list and the runs', () => {
  assert.equal(handleWorkflowsMessage(loaded()), true);
  assert.deepEqual(workflowsLoaded()?.workflows, [BUG_FIX]);
  assert.deepEqual(workflowsLoaded()?.runs, []);

  const run = runOf([stage('reproduce', 'active')]);
  handleWorkflowsMessage(loaded({ runs: [run] }));
  assert.deepEqual(workflowsLoaded()?.runs, [run]);
});

test('why no Workflow can be started is kept for the drawer to say', () => {
  handleWorkflowsMessage(loaded({ available: false, unavailableReason: 'Turn the MCP on.' }));

  assert.equal(workflowsLoaded()?.available, false);
  assert.equal(workflowsLoaded()?.unavailableReason, 'Turn the MCP on.');
});

test('a Workflow or a run that is not one is left out; the rest still list', () => {
  handleWorkflowsMessage(
    loaded({
      workflows: [{ id: 'broken' }, BUG_FIX],
      runs: [{ crewId: 7 }, runOf([stage('fix', 'done', 'Patched the handler.')])],
    }),
  );

  assert.deepEqual(
    workflowsLoaded()?.workflows.map((workflow) => workflow.id),
    ['bug-fix'],
  );
  assert.equal(workflowsLoaded()?.runs.length, 1);
  assert.equal(workflowsLoaded()?.runs[0].stages[0].note, 'Patched the handler.');
});

test('a list with nothing in it is still a list; another message is not ours', () => {
  handleWorkflowsMessage(loaded());

  assert.equal(handleWorkflowsMessage({ type: 'workflowsLoaded', workflows: 'none' }), true);
  assert.deepEqual(workflowsLoaded()?.workflows, []);
  assert.equal(workflowsLoaded()?.available, false);

  const list = workflowsLoaded();
  assert.equal(handleWorkflowsMessage({ type: 'crewsLoaded' }), false);
  assert.equal(workflowsLoaded(), list);
});

test('a refused start is kept until dismissed, and never touches the list', () => {
  handleWorkflowsMessage(loaded());
  const list = workflowsLoaded();
  assert.equal(workflowRejection(), null);

  assert.equal(
    handleWorkflowsMessage({ type: 'workflowRejected', reason: 'The lead could not launch.' }),
    true,
  );
  assert.deepEqual(workflowRejection(), { reason: 'The lead could not launch.' });
  assert.equal(workflowsLoaded(), list);

  dismissWorkflowRejection();
  assert.equal(workflowRejection(), null);
  assert.equal(workflowsLoaded(), list);
});

test('a refusal with no reason still says something', () => {
  handleWorkflowsMessage({ type: 'workflowRejected' });

  assert.deepEqual(workflowRejection(), { reason: 'It did not start.' });
});

test('a required stage and its Check ride the list and the runs; a Check that is not one is left out', () => {
  const verify = { ...BUG_FIX.stages[2], required: true, check: 'tests' };
  const listed = { ...BUG_FIX, stages: [BUG_FIX.stages[0], BUG_FIX.stages[1], verify] };
  const check = { id: 'tests', name: 'Unit tests', state: 'failed', exitCode: 1, seconds: 3 };
  handleWorkflowsMessage(
    loaded({
      workflows: [listed],
      runs: [
        {
          ...runOf([]),
          stages: [
            { ...stage('verify', 'active'), required: true, check },
            // A state there is none of: the stage still lists, with no Check.
            { ...stage('security', 'pending'), check: { ...check, state: 'skipped' } },
          ],
        },
      ],
    }),
  );

  assert.deepEqual(workflowsLoaded()?.workflows[0].stages[2], verify);
  const [verifying, security] = workflowsLoaded()?.runs[0].stages ?? [];
  assert.equal(verifying.required, true);
  assert.deepEqual(verifying.check, check);
  assert.equal(security.check, undefined);
  assert.equal(security.required, undefined);
});

test("a Check's output is kept only while this office looks at that stage", () => {
  const answer = {
    type: 'workflowCheckOutput',
    crewId: 'crew-1',
    stageId: 'verify',
    name: 'Unit tests',
    command: 'npm test',
    directory: '/repos/shop',
    state: 'failed',
    exitCode: 1,
    seconds: 3,
    output: '1 failed: export.spec',
  };

  // Nobody asked: the answer is ours to take, and nothing is shown.
  assert.equal(handleWorkflowsMessage(answer), true);
  assert.equal(checkOutputView(), null);

  openCheckOutput('crew-1', 'verify');
  assert.deepEqual(checkOutputView(), { crewId: 'crew-1', stageId: 'verify', output: null });
  // Another stage's answer is not this one's.
  handleWorkflowsMessage({ ...answer, stageId: 'security' });
  handleWorkflowsMessage({ ...answer, crewId: 'crew-2' });
  assert.equal(checkOutputView()?.output, null);
  // One that is not an answer leaves the dialog waiting.
  handleWorkflowsMessage({ ...answer, state: 'skipped' });
  assert.equal(checkOutputView()?.output, null);

  handleWorkflowsMessage(answer);
  assert.equal(checkOutputView()?.output?.output, '1 failed: export.spec');
  assert.equal(checkOutputView()?.output?.command, 'npm test');
  // A refresh replaces it.
  handleWorkflowsMessage({ ...answer, state: 'passed', exitCode: 0, output: '3 passed' });
  assert.equal(checkOutputView()?.output?.state, 'passed');

  closeCheckOutput();
  assert.equal(checkOutputView(), null);
  handleWorkflowsMessage(answer);
  assert.equal(checkOutputView(), null);
});

// ── The panel ───────────────────────────────────────────────────

test('a run counts its closed stages against all of them', () => {
  const run = runOf([
    stage('reproduce', 'done'),
    stage('fix', 'active'),
    stage('verify', 'pending'),
    stage('security', 'skipped'),
    stage('report', 'pending'),
  ]);

  // Done and skipped are both closed; in progress is not.
  assert.equal(runProgress(run), '2 / 5');
});

test('the header counts the one run, else how many runs there are', () => {
  const first = runOf([stage('reproduce', 'done'), stage('fix', 'pending')]);
  const second = runOf([stage('reproduce', 'pending')], { crewId: 'crew-2' });

  assert.equal(panelCount([first]), '1 / 2');
  assert.equal(panelCount([first, second]), '2');
});

test("a stage's tooltip says its Role, its state and its note", () => {
  assert.equal(stageTitle(stage('fix', 'active')), 'Fix · Developer · In progress');
  assert.equal(
    stageTitle(stage('fix', 'done', 'Patched the handler.')),
    'Fix · Developer · Done · Patched the handler.',
  );
  assert.equal(
    stageTitle(stage('security', 'skipped')),
    'Security check · Security Engineer · Skipped',
  );
});

test("a Check's line says how the office's own run of it went", () => {
  const check = (state: WorkflowStageCheck['state'], more: Partial<WorkflowStageCheck> = {}) =>
    checkLine({ id: 'tests', name: 'Unit tests', state, ...more });

  assert.equal(check('notSetUp'), 'Unit tests · not set up');
  assert.equal(check('pending'), 'Unit tests · not run yet');
  assert.equal(check('running', { seconds: 12 }), 'Unit tests · running');
  assert.equal(check('passed', { exitCode: 0, seconds: 42 }), 'Unit tests · passed in 42 s');
  assert.equal(check('passed'), 'Unit tests · passed');
  assert.equal(
    check('failed', { exitCode: 1, seconds: 185 }),
    'Unit tests · failed (exit 1) in 3 min 5 s',
  );
  // Out of time, or stopped: no exit code to name.
  assert.equal(check('failed', { seconds: 600 }), 'Unit tests · failed in 10 min');
  assert.equal(check('failed'), 'Unit tests · failed');

  assert.equal(checkSpan(0), 'under 1 s');
  assert.equal(checkSpan(1), '1 s');
  assert.equal(checkSpan(59), '59 s');
  assert.equal(checkSpan(60), '1 min');
  assert.equal(checkSpan(3599), '59 min 59 s');
});

test('a Check has an output once it ran, and a stage is skipped only while it is open', () => {
  const check = (state: WorkflowStageCheck['state']): WorkflowStageCheck => ({
    id: 'tests',
    name: 'Unit tests',
    state,
  });

  assert.equal(checkHasOutput(undefined), false);
  assert.equal(checkHasOutput(check('notSetUp')), false);
  assert.equal(checkHasOutput(check('pending')), false);
  assert.equal(checkHasOutput(check('running')), true);
  assert.equal(checkHasOutput(check('passed')), true);
  assert.equal(checkHasOutput(check('failed')), true);

  assert.equal(canSkipStage({ state: 'pending' }), true);
  assert.equal(canSkipStage({ state: 'active' }), true);
  assert.equal(canSkipStage({ state: 'done' }), false);
  assert.equal(canSkipStage({ state: 'skipped' }), false);
});

test("a stage's tooltip says it is required and how its Check went", () => {
  assert.equal(
    stageTitle({
      ...stage('verify', 'active'),
      required: true,
      check: { id: 'tests', name: 'Unit tests', state: 'failed', exitCode: 1, seconds: 3 },
    }),
    'Verify · QA Engineer · In progress · Required · Check: Unit tests · failed (exit 1) in 3 s',
  );
  assert.equal(
    stageTitle({
      ...stage('verify', 'done', 'Green on the branch.'),
      check: { id: 'tests', name: 'tests', state: 'notSetUp' },
    }),
    'Verify · QA Engineer · Done · Green on the branch. · Check: tests · not set up',
  );
});

// ── The request dialog ──────────────────────────────────────────

test('stages that run at the same time share a number', () => {
  assert.deepEqual(
    numberedStages(BUG_FIX).map((listed) => [listed.step, listed.id, listed.parallel]),
    [
      [1, 'reproduce', false],
      [2, 'fix', false],
      [3, 'verify', false],
      [3, 'security', true],
      [4, 'report', false],
    ],
  );
});

test('a first stage marked parallel has nothing to run beside', () => {
  const stages = [
    { id: 'a', title: 'A', roleName: 'Developer', parallel: true },
    { id: 'b', title: 'B', roleName: 'Developer' },
  ];

  assert.deepEqual(
    numberedStages({ stages }).map((listed) => [listed.step, listed.parallel]),
    [
      [1, false],
      [2, false],
    ],
  );
});

test('the request dialog says which stages are required and which the office closes', () => {
  const stages = [
    { id: 'fix', title: 'Fix', roleName: 'Developer' },
    { id: 'verify', title: 'Verify', roleName: 'QA Engineer', required: true, check: 'tests' },
    { id: 'security', title: 'Security', roleName: 'Security Engineer', parallel: true },
  ];
  const listed = numberedStages({ stages });

  assert.deepEqual(
    listed.map((entry) => [entry.id, entry.required, entry.check]),
    [
      ['fix', false, undefined],
      ['verify', true, 'tests'],
      ['security', false, undefined],
    ],
  );
  assert.equal(stageMarksTitle(listed[0]), undefined);
  assert.equal(
    stageMarksTitle(listed[1]),
    'Required: only you can skip it · Closed by the office running your "tests" check, where you set one up',
  );
  assert.equal(stageMarksTitle(listed[2]), 'Runs at the same time as the stage above');
});

test('the drawer lists the Workflows under the Role that leads them, in the order sent', () => {
  const led = (id: string, leadRoleId: string, leadRoleName: string) => ({
    id,
    leadRoleId,
    leadRoleName,
  });
  const groups = workflowsByLead([
    led('new-feature', 'agile-project-manager', 'Agile Project Manager'),
    led('bug-fix', 'agile-project-manager', 'Agile Project Manager'),
    led('pipeline-troubleshooting', 'devsecops-engineer', 'DevSecOps Engineer'),
    led('threat-model', 'security-engineer', 'Security Engineer'),
    // One of the user's, listed last by the server, joins its lead's own.
    led('release', 'devsecops-engineer', 'DevSecOps Engineer'),
    // A Role of the user's that goes by another's name keeps its own Workflows.
    led('platform-release', 'platform-engineer', 'DevSecOps Engineer'),
  ]);

  assert.deepEqual(
    groups.map((group) => [
      group.leadRoleId,
      group.leadRoleName,
      group.workflows.map((workflow) => workflow.id),
    ]),
    [
      ['agile-project-manager', 'Agile Project Manager', ['new-feature', 'bug-fix']],
      ['devsecops-engineer', 'DevSecOps Engineer', ['pipeline-troubleshooting', 'release']],
      ['security-engineer', 'Security Engineer', ['threat-model']],
      ['platform-engineer', 'DevSecOps Engineer', ['platform-release']],
    ],
  );
  assert.deepEqual(workflowsByLead([]), []);
});

test('a request must say something and fit', () => {
  assert.match(requestProblem('') ?? '', /Write what you need/);
  assert.match(requestProblem('   \n ') ?? '', /Write what you need/);
  assert.equal(requestProblem('Fix the Safari export button.'), null);
  assert.equal(requestProblem('x'.repeat(MAX_WORKFLOW_REQUEST_CHARS)), null);
  assert.match(
    requestProblem('x'.repeat(MAX_WORKFLOW_REQUEST_CHARS + 1)) ?? '',
    new RegExp(`under ${MAX_WORKFLOW_REQUEST_CHARS} characters`),
  );
  // Surrounding blank space is not part of the request.
  assert.equal(requestProblem(` ${'x'.repeat(MAX_WORKFLOW_REQUEST_CHARS)} `), null);
});
