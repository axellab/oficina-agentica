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

import type { Workflow, WorkflowRun, WorkflowRunStage } from '../../core/src/messages.js';
import { MAX_WORKFLOW_REQUEST_CHARS } from '../../core/src/workflows.js';
import {
  dismissWorkflowRejection,
  handleWorkflowsMessage,
  resetWorkflowStoreForTests,
  workflowRejection,
  workflowsLoaded,
} from '../src/workflows/workflowStore.js';
import {
  numberedStages,
  panelCount,
  requestProblem,
  runProgress,
  stageTitle,
  workflowsByLead,
} from '../src/workflows/workflowView.js';

beforeEach(() => resetWorkflowStoreForTests());

const BUG_FIX: Workflow = {
  id: 'bug-fix',
  name: 'Bug fix',
  description: 'Reproduce it, fix it, prove it stays fixed.',
  source: 'builtin',
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
  return { ...listed, state, ...(note ? { note } : {}) };
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

test('the drawer lists the Workflows under the Role that leads them, in the order sent', () => {
  const led = (id: string, leadRoleName: string) => ({ id, leadRoleName });
  const groups = workflowsByLead([
    led('new-feature', 'Agile Project Manager'),
    led('bug-fix', 'Agile Project Manager'),
    led('pipeline-troubleshooting', 'DevSecOps Engineer'),
    led('threat-model', 'Security Engineer'),
    // One of the user's, listed last by the server, joins its lead's own.
    led('release', 'DevSecOps Engineer'),
  ]);

  assert.deepEqual(
    groups.map((group) => [group.leadRoleName, group.workflows.map((workflow) => workflow.id)]),
    [
      ['Agile Project Manager', ['new-feature', 'bug-fix']],
      ['DevSecOps Engineer', ['pipeline-troubleshooting', 'release']],
      ['Security Engineer', ['threat-model']],
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
