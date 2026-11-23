/**
 * The built-in Workflows: how the team handles each kind of request. Data
 * only. The host replaces or adds to them in workflows.json
 * (workflowCatalog.ts).
 *
 * A Workflow is an ordered list of stages, each owned by a Role. Its `brief`
 * and each stage's are what the run's lead is told through the `workflow`
 * tool (what the stage's owner does, and what closes it): the lead hands each
 * stage to an agent of that Role and reports how it went. A `parallel` stage
 * may run at the same time as the stage listed before it.
 */

import { DEFAULT_WORKFLOW_LEAD, type WorkflowDefinition } from '../../../core/src/workflows.js';

const lines = (...text: string[]): string => text.join('\n');

/** What every analysis says of itself: it changes nothing. */
const ANALYSIS_ONLY =
  'This is an analysis: nobody changes product code, configuration or infrastructure. What it delivers is the report; fixing what it finds is a new request the user decides on.';

/** How a finding is written, so the triage can rank them and the user can act on them. */
const FINDING_SHAPE =
  'A finding says where it is (file and line, resource, pipeline step), what is wrong, the evidence (the code, the command and its output), what it costs or risks, and what would fix it.';

export const BUILTIN_WORKFLOWS: readonly WorkflowDefinition[] = [
  {
    id: 'new-feature',
    name: 'New feature',
    description: 'From a request to a tested, reviewed change ready to merge.',
    lead: DEFAULT_WORKFLOW_LEAD,
    brief: lines(
      'The request is a new capability. The run ends with the change on a branch of its own (never on the default branch), tested and reviewed, and a report the user can decide to merge from.',
      'Keep the change as small as the request allows. What the request leaves open and only the user can decide (scope, a deadline, a risk to accept), ask the user once, early, in your own terminal.',
    ),
    stages: [
      {
        id: 'requirements',
        title: 'Requirements',
        role: 'agile-project-manager',
        brief:
          'Turn the request into user stories with acceptance criteria that can be checked, and say what is explicitly left out. Closed when the stories are written where the team keeps them (or in your note) and nothing in them contradicts the request.',
      },
      {
        id: 'design',
        title: 'Design',
        role: 'architect',
        brief:
          'Read the code the feature touches and write the technical plan: the components and contracts that change, the data that flows, the decisions taken with the alternatives rejected, and the steps to build it in. Closed when the plan covers every story and names its risks.',
      },
      {
        id: 'implementation',
        title: 'Implementation',
        role: 'developer',
        brief:
          'Build the plan on a branch of its own, in small commits, with the unit tests each step needs. Launch the Developer into a new Worktree (launch_agent with `worktree`) so the change stays apart from the main checkout. Closed when the code builds, the checks the repository runs (types, lint, tests) pass, and the commits are on the branch.',
      },
      {
        id: 'testing',
        title: 'Testing',
        role: 'qa-engineer',
        brief:
          "Test the change against the acceptance criteria: the cases a user would hit, the edges and the failures, and the suites the repository already has. A defect goes back to the Developer (start the implementation stage again) with the steps to reproduce it. Closed when every criterion has a test or a recorded check that passes on the branch's last commit.",
      },
      {
        id: 'security-review',
        title: 'Security review',
        role: 'security-engineer',
        parallel: true,
        brief:
          'Review the change for what it exposes: new inputs and how they are validated, authentication and authorization on every new path, secrets, dependencies added. Closed when each finding is fixed, or accepted by the user in so many words.',
      },
      {
        id: 'delivery',
        title: 'Delivery',
        role: 'devsecops-engineer',
        brief:
          "Make the change ready to ship: the pipeline passes on the branch, what the change needs to run (configuration, migrations, flags) is written down, and a pull request is opened when the repository uses them. Nothing is merged or deployed: that is the user's call. Closed when the branch is ready for the user to merge.",
      },
      {
        id: 'report',
        title: 'Report',
        role: 'agile-project-manager',
        brief:
          'Report to the user in your own terminal: what was asked, what was built and where (branch, pull request), how each acceptance criterion was verified, what is left out or open, and what you recommend next.',
      },
    ],
  },
  {
    id: 'bug-fix',
    name: 'Bug fix',
    description: 'Reproduce a bug, find its cause, fix it and prove it stays fixed.',
    lead: DEFAULT_WORKFLOW_LEAD,
    brief: lines(
      'The request is something that works wrongly. The run ends with the cause found, the smallest fix for it on a branch of its own with a test that fails without it, and a report.',
      'Fix the cause, not the symptom, and nothing else: an improvement noticed on the way goes in the report, not in the change.',
    ),
    stages: [
      {
        id: 'reproduce',
        title: 'Reproduce',
        role: 'qa-engineer',
        brief:
          'Reproduce the bug: the shortest steps that show it, what was expected and what happens, the version and environment, and a failing automated test where one can be written. Closed when anyone can see the bug by following the steps. If it cannot be reproduced, say what was tried and ask the user for what is missing.',
      },
      {
        id: 'diagnosis',
        title: 'Diagnosis',
        role: 'developer',
        brief:
          'Find the root cause, with evidence: the line, the condition, the commit that brought it in. A guess is not a diagnosis. Closed when the cause explains every symptom of the reproduction.',
      },
      {
        id: 'fix',
        title: 'Fix',
        role: 'developer',
        brief:
          'Make the smallest change that removes the cause, on a branch of its own, with a regression test that fails before it and passes after. Closed when the checks the repository runs pass and the commits are on the branch.',
      },
      {
        id: 'verification',
        title: 'Verification',
        role: 'qa-engineer',
        brief:
          "Follow the reproduction again on the fixed branch, run the regression test and the suites around the change, and look for what the fix could have broken nearby. A failure goes back to the Developer (start the fix stage again). Closed when the reproduction no longer shows the bug on the branch's last commit.",
      },
      {
        id: 'security-check',
        title: 'Security check',
        role: 'security-engineer',
        parallel: true,
        brief:
          'Say whether the bug could be used against the system (and since when), and whether the fix opens anything. Skip it, with a note saying why, when the bug is nowhere near a trust boundary. Closed when the answer is written, with the evidence.',
      },
      {
        id: 'report',
        title: 'Report',
        role: 'agile-project-manager',
        brief:
          'Report to the user in your own terminal: the bug, its cause, the fix and where it is (branch, pull request), how it was verified, whether it had a security side, and anything else the team noticed and did not touch.',
      },
    ],
  },
  {
    id: 'security-review',
    name: 'Deep security analysis',
    description: 'A threat model and a ranked list of security findings, with evidence.',
    lead: DEFAULT_WORKFLOW_LEAD,
    brief: lines(
      'The request is a deep look at how the system could be attacked. The run ends with a report: the threat model and the findings, ranked, each with its evidence and what would fix it.',
      ANALYSIS_ONLY,
      FINDING_SHAPE,
      'A secret found in the code or its history is reported by where it is, never copied into a note or a message.',
    ),
    stages: [
      {
        id: 'threat-model',
        title: 'Threat model',
        role: 'security-engineer',
        brief:
          'Set the scope from the request and model the threats: what is worth protecting, who could want it, the trust boundaries and entry points, and the paths an attacker would try first. Closed when the model says where the next stages should look hardest.',
      },
      {
        id: 'code-review',
        title: 'Code review',
        role: 'security-engineer',
        brief:
          'Review the code along the threat model: how every input is validated, authentication and authorization on every path, session and secret handling, cryptography, injection, unsafe deserialization, error messages that say too much. Closed when every entry point of the model was read and each finding has its evidence.',
      },
      {
        id: 'supply-chain',
        title: 'Dependencies and pipeline',
        role: 'devsecops-engineer',
        parallel: true,
        brief:
          'Review what the code is built from and how: dependencies with known vulnerabilities or no maintainer, pinned versions and lock files, secrets in the repository and its history, what the pipeline runs with which permissions, and how a release is made and signed. Closed when each finding has its evidence.',
      },
      {
        id: 'infrastructure',
        title: 'Infrastructure',
        role: 'cloud-engineer',
        parallel: true,
        brief:
          'Review where it runs, from what the repository holds (infrastructure as code, deployment and container files): identities and their permissions, what is reachable from the network, encryption in transit and at rest, logging and backups. Skip it, with a note, when the repository describes no infrastructure. Closed when each finding has its evidence.',
      },
      {
        id: 'architecture',
        title: 'Architecture',
        role: 'architect',
        parallel: true,
        brief:
          'Review the design for weaknesses no single file shows: trust placed in the wrong component, checks that can be bypassed by another path, missing isolation between tenants or privileges, a failure that leaves the system open. Closed when each finding has its evidence.',
      },
      {
        id: 'triage',
        title: 'Triage',
        role: 'security-engineer',
        brief:
          'Bring the findings together: drop duplicates and what does not hold up when checked again, rank the rest by how likely it is to be used and what it would cost (critical, high, medium, low), and order the fixes. Closed when every finding left has a severity and a reason for it.',
      },
      {
        id: 'report',
        title: 'Report',
        role: 'agile-project-manager',
        brief:
          'Report to the user in your own terminal: the scope, the threat model in short, the findings by severity with where each one is and what would fix it, what was not looked at, and the fixes you recommend starting with. Offer to write it to a file in the repository if the user wants to keep it.',
      },
    ],
  },
  {
    id: 'quality-review',
    name: 'Deep quality analysis',
    description: 'How healthy the code, its tests and its pipeline are, with a ranked plan.',
    lead: DEFAULT_WORKFLOW_LEAD,
    brief: lines(
      'The request is a deep look at the quality of the system: how well it is tested, how easy it is to change, and how reliably it is built. The run ends with a report: the findings, ranked by the risk they carry and what fixing them costs.',
      ANALYSIS_ONLY,
      FINDING_SHAPE,
      'Measure before judging: run the suites, the linters and the coverage the repository already has, and report the numbers with the commands that produced them.',
    ),
    stages: [
      {
        id: 'scope',
        title: 'Scope',
        role: 'qa-engineer',
        brief:
          'Set the scope from the request: which parts of the system, which qualities matter most here (correctness, maintainability, performance, operability), and what "good" would look like. Run what the repository already runs (tests, coverage, lint, type checks) and record the starting numbers. Closed when the next stages know where to look and against what.',
      },
      {
        id: 'tests',
        title: 'Tests',
        role: 'qa-engineer',
        brief:
          'Assess the tests: what the suites cover and what they do not (by behaviour, not only by lines), tests that pass without checking anything, flaky and slow ones, and the risky paths with no test at all. Closed when each finding has its evidence.',
      },
      {
        id: 'code-health',
        title: 'Code health',
        role: 'developer',
        parallel: true,
        brief:
          'Assess the code: the hardest parts to change and why (size, complexity, duplication), dead code, errors swallowed or handled inconsistently, lint and type debt, and comments or documents that no longer match what the code does. Closed when each finding has its evidence.',
      },
      {
        id: 'architecture',
        title: 'Architecture',
        role: 'architect',
        parallel: true,
        brief:
          'Assess the structure: boundaries that leak, dependencies that point the wrong way, modules that change together and should be one (or the reverse), and decisions the code has outgrown. Closed when each finding has its evidence.',
      },
      {
        id: 'pipeline',
        title: 'Build and pipeline',
        role: 'devsecops-engineer',
        parallel: true,
        brief:
          'Assess how the code is built and checked: what the pipeline verifies and what it lets through, how long it takes and where, whether a build can be repeated, and what a developer has to know by heart to work on it. Closed when each finding has its evidence.',
      },
      {
        id: 'triage',
        title: 'Triage',
        role: 'qa-engineer',
        brief:
          'Bring the findings together: drop duplicates and what does not hold up when checked again, rank the rest by the risk it carries and the cost of fixing it, and group them into steps that can be taken one at a time. Closed when every finding left has a priority and a reason for it.',
      },
      {
        id: 'report',
        title: 'Report',
        role: 'agile-project-manager',
        brief:
          'Report to the user in your own terminal: the scope and the starting numbers, the findings by priority with where each one is and what would fix it, what was not looked at, and the first steps you recommend. Offer to write it to a file in the repository if the user wants to keep it.',
      },
    ],
  },
];
