/**
 * Workflows, on their own: what a workflows.json may hold, the catalog it
 * makes with the built-in ones, the order the stages are held to
 * (workflowProgress.ts) and a run's life (workflows.ts), over a real store
 * with agents put in by hand and a launch that only says how it went. A run
 * started from an office and worked through the `workflow` tool by a launched
 * agent is officeMcpWorkflows.test.ts.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closedStageCount,
  MAX_WORKFLOW_REQUEST_CHARS,
  MAX_WORKFLOW_STAGES,
  MAX_WORKFLOWS,
  mergeWorkflowCatalog,
  parseWorkflows,
  parseWorkflowsLoaded,
  stageSteps,
  type WorkflowDefinition,
} from '../../core/src/workflows.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import {
  CREW_PREAPPROVED_TOOLS,
  PIXEL_AGENTS_DIR,
  ROLES_FILE_NAME,
  WORKFLOW_SHOWN_TEXT_MAX_CHARS,
  WORKFLOWS_FILE_NAME,
} from '../src/constants.js';
import { Crews } from '../src/crews.js';
import type { AgentLaunch, AgentLaunchOutcome } from '../src/mcp/officeOperations.js';
import { BUILTIN_ROLES } from '../src/roles/builtinRoles.js';
import { FEATURE_GUIDE } from '../src/tutorial/featureGuide.js';
import type { AgentState } from '../src/types.js';
import { BUILTIN_WORKFLOWS } from '../src/workflows/builtinWorkflows.js';
import { workflowCatalog, workflowListing } from '../src/workflows/workflowCatalog.js';
import {
  NO_WORKFLOW_NOTE,
  WORKFLOW_CHANGE_FIRST_MESSAGE,
  WORKFLOW_FIRST_MESSAGE,
  WORKFLOW_LEAD_RULES,
  WORKFLOW_STOPPED_NOTE,
} from '../src/workflows/workflowCopy.js';
import { initialStages, isRunFinished, moveStage } from '../src/workflows/workflowProgress.js';
import { Workflows } from '../src/workflows/workflows.js';
import { clearTestHome } from './helpers/removeTempDir.js';
import { isTeamRole } from './helpers/teamRoles.js';

const ROLE_IDS = new Set(BUILTIN_ROLES.map((role) => role.id));

/** A workflows.json entry that passes, with what a test changes. */
function entry(more: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'hotfix',
    name: 'Hotfix',
    stages: [
      { id: 'fix', title: 'Fix it', role: 'developer' },
      { id: 'check', title: 'Check it', role: 'qa-engineer' },
    ],
    ...more,
  };
}

describe('parseWorkflows (workflows.json)', () => {
  it('reads an entry with only what it needs: led by the coordinator, no description or briefs', () => {
    const parsed = parseWorkflows({ workflows: [entry()] });
    expect(parsed.problems).toEqual([]);
    expect(parsed.workflows).toEqual([
      {
        id: 'hotfix',
        name: 'Hotfix',
        description: '',
        lead: 'agile-project-manager',
        brief: '',
        stages: [
          { id: 'fix', title: 'Fix it', role: 'developer', brief: '' },
          { id: 'check', title: 'Check it', role: 'qa-engineer', brief: '' },
        ],
      },
    ]);
  });

  it('reads everything an entry may say; a brief is text or a list of lines', () => {
    const parsed = parseWorkflows({
      workflows: [
        entry({
          description: '  Out the door today.  ',
          lead: 'developer',
          brief: ['Keep it small.', 'No refactors.'],
          stages: [
            { id: 'fix', title: 'Fix it', role: 'developer', brief: 'One commit.' },
            { id: 'check', title: 'Check it', role: 'qa-engineer', parallel: true },
            { id: 'ship', title: 'Ship it', role: 'devsecops-engineer', parallel: false },
          ],
        }),
      ],
    });
    expect(parsed.problems).toEqual([]);
    const [workflow] = parsed.workflows;
    expect(workflow).toMatchObject({
      description: 'Out the door today.',
      lead: 'developer',
      brief: 'Keep it small.\nNo refactors.',
    });
    expect(workflow.stages).toEqual([
      { id: 'fix', title: 'Fix it', role: 'developer', brief: 'One commit.' },
      { id: 'check', title: 'Check it', role: 'qa-engineer', brief: '', parallel: true },
      { id: 'ship', title: 'Ship it', role: 'devsecops-engineer', brief: '' },
    ]);
  });

  it('a stage may be required and name the check that closes it; neither takes anything else', () => {
    const parsed = parseWorkflows({
      workflows: [
        entry({
          stages: [
            { id: 'fix', title: 'Fix it', role: 'developer', required: false },
            { id: 'check', title: 'Check it', role: 'qa-engineer', required: true, check: 'tests' },
          ],
        }),
        entry({
          id: 'wordy',
          stages: [{ id: 'fix', title: 'Fix it', role: 'developer', required: 'yes' }],
        }),
        entry({
          id: 'command',
          // A stage names a check, it never carries a command.
          stages: [{ id: 'fix', title: 'Fix it', role: 'developer', check: 'npm test' }],
        }),
      ],
    });
    expect(parsed.workflows).toHaveLength(1);
    expect(parsed.workflows[0].stages).toEqual([
      { id: 'fix', title: 'Fix it', role: 'developer', brief: '' },
      {
        id: 'check',
        title: 'Check it',
        role: 'qa-engineer',
        brief: '',
        required: true,
        check: 'tests',
      },
    ]);
    expect(parsed.problems).toEqual([
      'workflows[1]: stages[0]: "required" must be true or false',
      expect.stringMatching(/workflows\[2\]: stages\[0\]: "check" must be the id of a check/),
    ]);
  });

  it("a Workflow may name its lead's model and a stage its owner's; one that is no model name is refused", () => {
    const parsed = parseWorkflows({
      workflows: [
        entry({
          model: 'sonnet',
          stages: [
            { id: 'fix', title: 'Fix it', role: 'developer', model: 'claude-haiku-5-5' },
            { id: 'check', title: 'Check it', role: 'qa-engineer' },
          ],
        }),
        entry({ id: 'flagged', model: '--dangerously-skip-permissions' }),
        entry({
          id: 'spaced',
          stages: [{ id: 'fix', title: 'Fix it', role: 'developer', model: 'opus; rm -rf /' }],
        }),
      ],
    });
    expect(parsed.workflows).toHaveLength(1);
    expect(parsed.workflows[0].model).toBe('sonnet');
    expect(parsed.workflows[0].stages.map((stage) => stage.model)).toEqual([
      'claude-haiku-5-5',
      undefined,
    ]);
    expect(parsed.problems).toEqual([
      expect.stringMatching(/workflows\[1\]: "model" must be a model name or alias/),
      expect.stringMatching(/workflows\[2\]: stages\[0\]: "model" must be a model name or alias/),
    ]);
  });

  it('leaves a bad entry out, says why, and keeps the rest', () => {
    const stage = { id: 'fix', title: 'Fix it', role: 'developer' };
    const bad: Array<[Record<string, unknown> | string, RegExp]> = [
      ['a string', /not an object/],
      [entry({ id: 'Hot Fix' }), /"id" must be lower-case/],
      [entry({ name: '' }), /"name" must be 1-40 characters/],
      [entry({ name: 'two\nlines' }), /"name" must be/],
      [entry({ nmae: 'typo' }), /unknown field "nmae"/],
      [entry({ description: 7 }), /"description" must be/],
      [entry({ lead: 'The Boss' }), /"lead" must be the id of a Role/],
      [entry({ brief: '' }), /"brief" must be text/],
      [entry({ stages: [] }), /"stages" must list at least one stage/],
      [
        entry({ stages: Array.from({ length: MAX_WORKFLOW_STAGES + 1 }, () => stage) }),
        /lists more than 12 stages/,
      ],
      [entry({ stages: [stage, stage] }), /stages\[1\]: "fix" is listed twice/],
      [
        entry({ stages: [{ ...stage, parallel: true }] }),
        /stages\[0\]: "parallel" means alongside/,
      ],
      [entry({ stages: [{ ...stage, parallel: 'yes' }] }), /"parallel" must be true or false/],
      [entry({ stages: [{ ...stage, role: 'QA' }] }), /"role" must be the id of a Role/],
      [entry({ stages: [{ ...stage, title: undefined }] }), /"title" must be 1-60/],
      [entry({ stages: [{ ...stage, owner: 'x' }] }), /stages\[0\]: unknown field "owner"/],
    ];
    for (const [raw, why] of bad) {
      const parsed = parseWorkflows({ workflows: [raw, entry({ id: 'good' })] });
      expect(parsed.workflows.map((w) => w.id)).toEqual(['good']);
      expect(parsed.problems).toHaveLength(1);
      expect(parsed.problems[0]).toMatch(/^workflows\[0\]: /);
      expect(parsed.problems[0]).toMatch(why);
    }
  });

  it('keeps the first of an id listed twice, reads only so many, and refuses another shape', () => {
    const twice = parseWorkflows({ workflows: [entry(), entry({ name: 'Second' })] });
    expect(twice.workflows.map((w) => w.name)).toEqual(['Hotfix']);
    expect(twice.problems[0]).toMatch(/"hotfix" is listed twice; the first one is used/);

    const many = parseWorkflows({
      workflows: Array.from({ length: MAX_WORKFLOWS + 2 }, (_, i) => entry({ id: `w${i}` })),
    });
    expect(many.workflows).toHaveLength(MAX_WORKFLOWS);
    expect(many.problems).toEqual([`only the first ${MAX_WORKFLOWS} workflows are read`]);

    for (const raw of [null, [], { workflows: 'x' }, { roles: [] }]) {
      expect(parseWorkflows(raw)).toEqual({
        workflows: [],
        problems: ['expected an object with a "workflows" list'],
      });
    }
  });
});

describe('mergeWorkflowCatalog', () => {
  const own = (more: Record<string, unknown> = {}): WorkflowDefinition =>
    parseWorkflows({ workflows: [entry(more)] }).workflows[0];

  it('lists the built-in Workflows, then the host adds its own after them', () => {
    const merged = mergeWorkflowCatalog(BUILTIN_WORKFLOWS, [own()], ROLE_IDS);
    expect(merged.problems).toEqual([]);
    expect(merged.workflows.map((w) => [w.id, w.source])).toEqual([
      ...BUILTIN_WORKFLOWS.map((w) => [w.id, 'builtin']),
      ['hotfix', 'user'],
    ]);
    // The ones a request usually starts from come first.
    expect(merged.workflows.slice(0, 4).map((w) => w.id)).toEqual([
      'new-feature',
      'bug-fix',
      'security-review',
      'quality-review',
    ]);
  });

  it('an entry with a built-in id replaces it whole, in its place', () => {
    const merged = mergeWorkflowCatalog(BUILTIN_WORKFLOWS, [own({ id: 'bug-fix' })], ROLE_IDS);
    expect(merged.workflows.map((w) => w.id)).toEqual(BUILTIN_WORKFLOWS.map((w) => w.id));
    const replaced = merged.workflows[1];
    expect(replaced).toMatchObject({ id: 'bug-fix', name: 'Hotfix', source: 'user', brief: '' });
    expect(replaced.stages.map((s) => s.id)).toEqual(['fix', 'check']);
  });

  it('leaves out a Workflow naming a Role this host does not have, and says which', () => {
    const merged = mergeWorkflowCatalog(
      BUILTIN_WORKFLOWS,
      [own({ lead: 'release-manager' }), own({ id: 'ok' })],
      ROLE_IDS,
    );
    expect(merged.workflows.map((w) => w.id)).toContain('ok');
    expect(merged.workflows.map((w) => w.id)).not.toContain('hotfix');
    expect(merged.problems).toEqual(['"hotfix": there is no role "release-manager" on this host']);

    // The built-in ones are held to it too: none is listed without its lead's Role.
    const rolesOf = (w: WorkflowDefinition): string[] => [w.lead, ...w.stages.map((s) => s.role)];
    const without = (role: string): string[] =>
      BUILTIN_WORKFLOWS.filter((w) => !rolesOf(w).includes(role)).map((w) => w.id);
    const noLead = new Set([...ROLE_IDS].filter((id) => id !== 'agile-project-manager'));
    const fewer = mergeWorkflowCatalog(BUILTIN_WORKFLOWS, [], noLead);
    expect(fewer.workflows.map((w) => w.id)).toEqual(without('agile-project-manager'));
    expect(fewer.workflows.map((w) => w.id)).not.toContain('new-feature');
    expect(fewer.problems).toHaveLength(BUILTIN_WORKFLOWS.length - fewer.workflows.length);
    // A stage's Role counts like the lead's.
    const noQa = new Set([...ROLE_IDS].filter((id) => id !== 'qa-engineer'));
    const noQaIds = mergeWorkflowCatalog(BUILTIN_WORKFLOWS, [], noQa).workflows.map((w) => w.id);
    expect(noQaIds).toEqual(without('qa-engineer'));
    expect(noQaIds).toContain('security-review');
    expect(noQaIds).not.toContain('bug-fix');
  });
});

describe('the built-in Workflows', () => {
  it('pass the rules a workflows.json is held to, and name only built-in Roles', () => {
    const parsed = parseWorkflows({ workflows: BUILTIN_WORKFLOWS });
    expect(parsed.problems).toEqual([]);
    // What the catalog holds is what the file's rules make of it: nothing a
    // user could not have written.
    expect(parsed.workflows).toEqual(BUILTIN_WORKFLOWS);
    expect(mergeWorkflowCatalog(BUILTIN_WORKFLOWS, [], ROLE_IDS).problems).toEqual([]);
  });

  it('cover a new feature, a bug fix, the two deep analyses, the sprint plan and the review of a change, led by the coordinator and listed first', () => {
    const coordinated = BUILTIN_WORKFLOWS.filter((w) => w.lead === 'agile-project-manager');
    expect(coordinated.map((w) => [w.id, w.name])).toEqual([
      ['new-feature', 'New feature'],
      ['bug-fix', 'Bug fix'],
      ['security-review', 'Deep security analysis'],
      ['quality-review', 'Deep quality analysis'],
      ['sprint-planning', 'Sprint planning'],
      ['change-review', 'Change review'],
    ]);
    expect(BUILTIN_WORKFLOWS.slice(0, coordinated.length)).toEqual(coordinated);
  });

  it('each other Role leads the Workflows that are its own job', () => {
    const own = BUILTIN_WORKFLOWS.filter(
      (w) => w.lead !== 'agile-project-manager' && isTeamRole(w.lead),
    );
    expect(own.map((w) => [w.lead, w.id, w.name])).toEqual([
      ['architect', 'architecture-review', 'Architecture review'],
      ['architect', 'technical-design', 'Technical design'],
      ['developer', 'safe-refactor', 'Safe refactor'],
      ['developer', 'dependency-upgrade', 'Dependency upgrade'],
      ['qa-engineer', 'full-regression', 'Full regression'],
      ['qa-engineer', 'flaky-test-hunt', 'Flaky test hunt'],
      ['devsecops-engineer', 'pipeline-troubleshooting', 'Pipeline troubleshooting'],
      ['devsecops-engineer', 'pipeline-hardening', 'Pipeline hardening'],
      ['devsecops-engineer', 'supply-chain-audit', 'Supply chain audit'],
      ['security-engineer', 'threat-model', 'Threat model'],
      ['security-engineer', 'vulnerability-review', 'Vulnerability review'],
      ['cloud-engineer', 'infrastructure-review', 'Infrastructure review'],
      ['cloud-engineer', 'cost-review', 'Cost review'],
    ]);
    // Every Role of the team leads at least one.
    expect(new Set(BUILTIN_WORKFLOWS.map((w) => w.lead))).toEqual(ROLE_IDS);
  });

  it('every one ends on the report of the Role that leads it, and every stage says what closes it', () => {
    for (const workflow of BUILTIN_WORKFLOWS) {
      expect(workflow.description).not.toBe('');
      expect(workflow.brief).not.toBe('');
      const last = workflow.stages.at(-1)!;
      expect(last).toMatchObject({ id: 'report', role: workflow.lead });
      expect(last.parallel).toBeUndefined();
      // Every stage says what its owner does and what closes it.
      for (const stage of workflow.stages) expect(stage.brief.length).toBeGreaterThan(40);
    }
  });

  it('the analyses change nothing and never copy a secret into a finding', () => {
    for (const id of [
      'security-review',
      'quality-review',
      'supply-chain-audit',
      'threat-model',
      'architecture-review',
      'infrastructure-review',
      'cost-review',
    ]) {
      const workflow = BUILTIN_WORKFLOWS.find((w) => w.id === id)!;
      expect(workflow.brief).toMatch(/This is an analysis: nobody changes product code/);
    }
    const audit = BUILTIN_WORKFLOWS.find((w) => w.id === 'supply-chain-audit')!;
    expect(audit.brief).toMatch(/reported by where it is, never copied/);
    const security = BUILTIN_WORKFLOWS.find((w) => w.id === 'security-review')!;
    expect(security.brief).toMatch(/secret/i);
    expect(security.brief).toMatch(/never/i);
  });

  it('are all in the feature guide, stage by stage', () => {
    const topic = FEATURE_GUIDE.find((candidate) => candidate.id === 'workflows')!;
    expect(topic.title).toMatch(/^Workflows/);
    // The guide is prose, the catalog is data: a Workflow or a stage added to
    // the team's must be added there too (one a Role added beside the team
    // leads is listed by the office, not by the guide).
    const body = topic.body.toLowerCase();
    for (const workflow of BUILTIN_WORKFLOWS.filter((w) => isTeamRole(w.lead))) {
      expect(topic.body).toContain(workflow.name);
      for (const stage of workflow.stages) expect(body).toContain(stage.title.toLowerCase());
    }
    expect(topic.body).toContain('workflows.json');
  });
});

describe('the order of the stages', () => {
  const definition = BUILTIN_WORKFLOWS.find((w) => w.id === 'new-feature')!.stages;
  const ids = definition.map((stage) => stage.id);

  it('a parallel stage shares the step of the stage before it', () => {
    expect(ids).toEqual([
      'requirements',
      'design',
      'implementation',
      'testing',
      'security-review',
      'delivery',
      'report',
    ]);
    expect(stageSteps(definition)).toEqual([0, 1, 2, 3, 3, 4, 5]);
    expect(stageSteps([{}, { parallel: true }, { parallel: true }, {}])).toEqual([0, 0, 0, 1]);
    // The first stage has nothing to run beside.
    expect(stageSteps([{ parallel: true }, {}])).toEqual([0, 1]);
  });

  /** Apply moves in order, each expected to pass. */
  function after(...moves: Array<[move: 'start' | 'finish' | 'skip', id: string]>) {
    let stages = initialStages(definition);
    for (const [move, id] of moves) {
      const outcome = moveStage(definition, stages, move, id, `${move} ${id}`);
      if (!outcome.ok) throw new Error(outcome.reason);
      stages = outcome.stages;
    }
    return stages;
  }
  const states = (stages: ReturnType<typeof initialStages>) => stages.map((s) => s.state);

  it('starts every stage pending, and moves only the one named', () => {
    expect(states(initialStages(definition))).toEqual(ids.map(() => 'pending'));
    const stages = after(['start', 'requirements']);
    expect(states(stages)).toEqual(['active', ...ids.slice(1).map(() => 'pending')]);
    expect(closedStageCount(stages)).toBe(0);
    expect(isRunFinished(stages)).toBe(false);
  });

  it('a stage starts once the stages before it are done or skipped, and says what it waits for', () => {
    const early = moveStage(definition, initialStages(definition), 'start', 'design');
    expect(early).toMatchObject({ ok: false });
    expect(!early.ok && early.reason).toMatch(
      /design comes after requirements \(pending\): finish or skip it first/,
    );

    const underway = after(['start', 'requirements']);
    const stillEarly = moveStage(definition, underway, 'start', 'design');
    expect(!stillEarly.ok && stillEarly.reason).toMatch(/requirements \(active\)/);

    expect(states(after(['skip', 'requirements'], ['start', 'design']))[1]).toBe('active');
    expect(
      states(after(['start', 'requirements'], ['finish', 'requirements'], ['start', 'design']))[1],
    ).toBe('active');
  });

  it('stages of one step run at the same time; the next waits for all of them', () => {
    const toTesting = after(
      ['skip', 'requirements'],
      ['skip', 'design'],
      ['skip', 'implementation'],
      ['start', 'testing'],
      ['start', 'security-review'],
    );
    expect(states(toTesting).slice(3, 5)).toEqual(['active', 'active']);

    const one = moveStage(definition, toTesting, 'finish', 'testing', 'All green.');
    if (!one.ok) throw new Error(one.reason);
    const early = moveStage(definition, one.stages, 'start', 'delivery');
    expect(!early.ok && early.reason).toMatch(
      /delivery comes after security-review \(active\): finish or skip it first/,
    );
    const both = moveStage(definition, one.stages, 'finish', 'security-review', 'No findings.');
    if (!both.ok) throw new Error(both.reason);
    expect(moveStage(definition, both.stages, 'start', 'delivery')).toMatchObject({ ok: true });
  });

  it('finish needs the stage started and a note; skip needs a note', () => {
    const fresh = initialStages(definition);
    const unstarted = moveStage(definition, fresh, 'finish', 'requirements', 'Done.');
    expect(!unstarted.ok && unstarted.reason).toMatch(/requirements has not started/);

    const active = after(['start', 'requirements']);
    for (const note of [undefined, '', '   ']) {
      const noted = moveStage(definition, active, 'finish', 'requirements', note);
      expect(!noted.ok && noted.reason).toMatch(/A finish needs a note/);
      const skipped = moveStage(definition, fresh, 'skip', 'requirements', note);
      expect(!skipped.ok && skipped.reason).toMatch(/A skip needs a note/);
    }

    const done = moveStage(
      definition,
      active,
      'finish',
      'requirements',
      '  Agreed with the user.  ',
    );
    expect(done.ok && done.stages[0]).toEqual({
      id: 'requirements',
      state: 'done',
      note: 'Agreed with the user.',
    });
    // An active stage the request turns out not to need is skipped too.
    const dropped = moveStage(definition, active, 'skip', 'requirements', 'Already written.');
    expect(dropped.ok && dropped.stages[0]).toMatchObject({ state: 'skipped' });
  });

  it('a closed stage is not closed again, but starts again when later work sends it back', () => {
    const closed = after(['start', 'requirements'], ['finish', 'requirements'], ['skip', 'design']);
    const again = moveStage(definition, closed, 'finish', 'requirements', 'Twice.');
    expect(!again.ok && again.reason).toMatch(
      /requirements is already done\. If later work sent it back, start it again/,
    );
    const skipDone = moveStage(definition, closed, 'skip', 'design', 'Twice.');
    expect(!skipDone.ok && skipDone.reason).toMatch(/design is already skipped/);
    const twice = moveStage(definition, after(['start', 'requirements']), 'start', 'requirements');
    expect(!twice.ok && twice.reason).toMatch(/already active/);

    // Testing found a defect: implementation is worked again, its note gone.
    const toTesting = after(
      ['skip', 'requirements'],
      ['skip', 'design'],
      ['start', 'implementation'],
      ['finish', 'implementation'],
      ['start', 'testing'],
    );
    const back = moveStage(definition, toTesting, 'start', 'implementation');
    if (!back.ok) throw new Error(back.reason);
    expect(back.stages[2]).toEqual({ id: 'implementation', state: 'active' });
    expect(back.stages[3].state).toBe('active');
  });

  it('an unknown stage is refused with the ones there are; all closed is a finished run', () => {
    const unknown = moveStage(definition, initialStages(definition), 'start', 'deploy');
    expect(!unknown.ok && unknown.reason).toBe(
      `There is no stage deploy in this workflow: its stages are ${ids.join(', ')}.`,
    );
    // The user skips what a lead may not (a required stage).
    const all = ids.reduce((stages, id) => {
      const outcome = moveStage(definition, stages, 'skip', id, 'Not needed.', 'user');
      if (!outcome.ok) throw new Error(outcome.reason);
      return outcome.stages;
    }, initialStages(definition));
    expect(isRunFinished(all)).toBe(true);
    expect(closedStageCount(all)).toBe(ids.length);
  });

  it('a required stage is skipped by the user alone: its lead is told to do it or ask them', () => {
    const required = definition.filter((stage) => stage.required).map((stage) => stage.id);
    expect(required).toEqual(['testing', 'security-review']);
    const refused = moveStage(definition, initialStages(definition), 'skip', 'testing', 'No time.');
    expect(!refused.ok && refused.reason).toMatch(
      /testing is a required stage of this workflow: you cannot skip it\..*only they can skip it, from the office/,
    );
    // Not for want of a note, and whatever state it is in.
    const active = after(
      ['skip', 'requirements'],
      ['skip', 'design'],
      ['skip', 'implementation'],
      ['start', 'testing'],
    );
    expect(moveStage(definition, active, 'skip', 'testing', 'No time.')).toMatchObject({
      ok: false,
    });
    const byUser = moveStage(definition, active, 'skip', 'testing', 'Skipped by the user.', 'user');
    if (!byUser.ok) throw new Error(byUser.reason);
    expect(byUser.stages[3]).toEqual({
      id: 'testing',
      state: 'skipped',
      note: 'Skipped by the user.',
    });
    // A stage that is not required is still the lead's to skip.
    expect(moveStage(definition, active, 'skip', 'delivery', 'Nothing to ship.')).toMatchObject({
      ok: true,
    });
  });
});

describe('what a run tells its agents', () => {
  it('the first message is plain words a command line carries whole in any shell', () => {
    // Letters, digits, spaces and the few marks no shell or Windows command
    // shim reads: the request itself never rides the command line.
    // The one of a run a Change trigger started is held to the same.
    for (const message of [WORKFLOW_FIRST_MESSAGE, WORKFLOW_CHANGE_FIRST_MESSAGE]) {
      expect(message).toMatch(/^[A-Za-z0-9 ._,-]+$/);
      expect(message).toContain('mcp__pixel-office__workflow');
      expect(message).not.toMatch(/\s{2,}/);
    }
    expect(WORKFLOW_CHANGE_FIRST_MESSAGE).not.toContain('the user just started');
  });

  it("a Crew's agents call the workflow tool without a permission prompt", () => {
    expect(CREW_PREAPPROVED_TOOLS).toContain('workflow');
  });
});

describe('the host catalog (workflows.json)', () => {
  const dir = () => path.join(os.homedir(), PIXEL_AGENTS_DIR);
  function writeFile(name: string, content: unknown): void {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(
      path.join(dir(), name),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearTestHome(PIXEL_AGENTS_DIR);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    clearTestHome(PIXEL_AGENTS_DIR);
  });

  it('is the built-in Workflows where the host has no file', () => {
    expect(workflowCatalog().map((w) => [w.id, w.source])).toEqual(
      BUILTIN_WORKFLOWS.map((w) => [w.id, 'builtin']),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("lays the host's file over them, and an edit applies to the next read", () => {
    writeFile(WORKFLOWS_FILE_NAME, { workflows: [entry()] });
    expect(workflowCatalog().map((w) => w.id)).toEqual([
      ...BUILTIN_WORKFLOWS.map((w) => w.id),
      'hotfix',
    ]);
    writeFile(WORKFLOWS_FILE_NAME, { workflows: [entry({ id: 'bug-fix', name: 'Our bug fix' })] });
    const catalog = workflowCatalog();
    expect(catalog.map((w) => w.id)).toEqual(BUILTIN_WORKFLOWS.map((w) => w.id));
    expect(catalog[1]).toMatchObject({ name: 'Our bug fix', source: 'user' });
  });

  it('a file that is not JSON, or an entry that is wrong, is logged and left out', () => {
    writeFile(WORKFLOWS_FILE_NAME, '{ "workflows": [ oops');
    expect(workflowCatalog().map((w) => w.id)).toEqual(BUILTIN_WORKFLOWS.map((w) => w.id));
    expect(warn.mock.calls.flat().join(' ')).toMatch(/workflows\.json is not valid JSON/);

    warn.mockClear();
    writeFile(WORKFLOWS_FILE_NAME, { workflows: [entry({ nmae: 'x' }), entry({ id: 'fine' })] });
    expect(workflowCatalog().map((w) => w.id)).toContain('fine');
    expect(warn.mock.calls.flat().join(' ')).toMatch(/workflows\[0\]: unknown field "nmae"/);
  });

  it("names Roles as the host's roles.json does, and follows a Role it adds", () => {
    writeFile(WORKFLOWS_FILE_NAME, {
      workflows: [
        entry({ id: 'release', lead: 'release-manager' }),
        entry({ stages: [{ id: 'fix', title: 'Fix it', role: 'developer' }] }),
      ],
    });
    // No such Role yet: the Workflow that names it is left out, and logged.
    expect(workflowCatalog().map((w) => w.id)).not.toContain('release');
    expect(warn.mock.calls.flat().join(' ')).toMatch(/there is no role "release-manager"/);

    writeFile(ROLES_FILE_NAME, {
      roles: [
        { id: 'release-manager', name: 'Release Manager', prompt: 'You cut releases.' },
        { id: 'developer', name: 'Rust Developer' },
      ],
    });
    const catalog = workflowCatalog();
    const release = catalog.find((w) => w.id === 'release')!;
    expect(workflowListing(release)).toMatchObject({
      leadRoleId: 'release-manager',
      leadRoleName: 'Release Manager',
    });
    // What an office lists: Roles by name, and nothing a stage's owner is told.
    const hotfix = workflowListing(catalog.find((w) => w.id === 'hotfix')!);
    expect(hotfix).toEqual({
      id: 'hotfix',
      name: 'Hotfix',
      description: '',
      source: 'user',
      leadRoleId: 'agile-project-manager',
      leadRoleName: 'Agile Project Manager',
      stages: [{ id: 'fix', title: 'Fix it', roleName: 'Rust Developer' }],
    });
  });
});

describe('Workflows (the runs)', () => {
  let store: AgentStateStore;
  let crews: Crews;
  let workflows: Workflows;
  let sent: Array<Record<string, unknown>>;
  let unavailable: string | null;
  let nextId: number;
  /** The launches asked, and how the next one goes. */
  let launches: AgentLaunch[];
  let launching: (request: AgentLaunch) => Promise<AgentLaunchOutcome>;

  /** An agent joining the office, in `crew` when given. */
  function join(crew?: AgentState['crew'], more: Partial<AgentState> = {}): number {
    const id = nextId++;
    store.set(
      id,
      createAgentState({
        id,
        sessionId: `session-${id}`,
        projectDir: '/tmp/p',
        jsonlFile: `/tmp/p/session-${id}.jsonl`,
        isExternal: false,
        directoryName: 'proj',
        crew,
        ...more,
      }),
    );
    return id;
  }

  beforeEach(() => {
    clearTestHome(PIXEL_AGENTS_DIR);
    store = new AgentStateStore();
    sent = [];
    unavailable = null;
    nextId = 1;
    launches = [];
    store.on('broadcast', (message) => sent.push(message));
    crews = new Crews({ store, unavailable: () => unavailable });
    // The surface's launch: the lead joins the office in the Crew it was given.
    launching = async (request) => ({ ok: true, id: join(request.crew?.crew) });
    workflows = new Workflows({
      store,
      crews,
      unavailable: () => unavailable,
      launch: (request) => {
        launches.push(request);
        return launching(request);
      },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    workflows.dispose();
    crews.dispose();
    vi.restoreAllMocks();
  });

  const ask = (more: Record<string, unknown> = {}) =>
    workflows.start({
      workflowId: 'bug-fix',
      directoryPath: '/tmp/p',
      request: 'The export button does nothing on Safari.',
      ...more,
    });
  const runs = () => workflows.statusMessage().runs;
  /** The run's lead, once started. */
  async function started(more: Record<string, unknown> = {}): Promise<number> {
    const outcome = await ask(more);
    if (!outcome.ok) throw new Error(outcome.reason);
    return runs().at(-1)!.leadAgentId!;
  }

  it("a start launches the Workflow's lead Role into a new Crew, sent to the tool, and lists the run", async () => {
    expect(workflows.statusMessage()).toMatchObject({ available: true, runs: [] });
    expect(workflows.statusMessage().workflows.map((w) => w.id)).toEqual(
      BUILTIN_WORKFLOWS.map((w) => w.id),
    );

    const lead = await started({ palette: 3 });

    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({
      directory: '/tmp/p',
      palette: 3,
      roleId: 'agile-project-manager',
      // The request is not in it: the lead reads it from the tool.
      asks: { firstMessage: WORKFLOW_FIRST_MESSAGE },
    });
    const crewId = launches[0].crew!.crew.id;
    expect(store.get(lead)!.crew).toEqual({ id: crewId });
    expect(crews.statusMessage().crews.map((c) => c.id)).toEqual([crewId]);

    const [run] = runs();
    expect(run).toMatchObject({
      crewId,
      workflowId: 'bug-fix',
      name: 'Bug fix',
      leadAgentId: lead,
      request: 'The export button does nothing on Safari.',
      finished: false,
    });
    expect(run.stages.map((s) => [s.id, s.roleName, s.state, s.parallel])).toEqual([
      ['reproduce', 'QA Engineer', 'pending', undefined],
      ['diagnosis', 'Developer', 'pending', undefined],
      ['fix', 'Developer', 'pending', undefined],
      ['verification', 'QA Engineer', 'pending', undefined],
      ['security-check', 'Security Engineer', 'pending', true],
      ['report', 'Agile Project Manager', 'pending', undefined],
    ]);
    // Every office heard of it, and reads it back as it was sent.
    const last = sent.filter((m) => m.type === 'workflowsLoaded').at(-1)!;
    expect(parseWorkflowsLoaded(JSON.parse(JSON.stringify(last)))).toEqual(
      workflows.statusMessage(),
    );
  });

  it("a Workflow's model is its lead's, and a stage's the one its owner is launched on while that stage is open", async () => {
    fs.mkdirSync(path.join(os.homedir(), PIXEL_AGENTS_DIR), { recursive: true });
    fs.writeFileSync(
      path.join(os.homedir(), PIXEL_AGENTS_DIR, 'workflows.json'),
      JSON.stringify({
        workflows: [
          {
            id: 'triage',
            name: 'Triage',
            model: 'sonnet',
            stages: [
              { id: 'look', title: 'Look', role: 'qa-engineer', model: 'haiku' },
              { id: 'fix', title: 'Fix', role: 'developer' },
              { id: 'look-again', title: 'Look again', role: 'qa-engineer', model: 'opus' },
              { id: 'report', title: 'Report', role: 'agile-project-manager' },
            ],
          },
        ],
      }),
    );

    const lead = await started({ workflowId: 'triage' });
    expect(launches[0].asks).toEqual({ firstMessage: WORKFLOW_FIRST_MESSAGE, model: 'sonnet' });
    // A built-in Workflow names none: its lead runs on its Role's, or the user's default.
    await started();
    expect(launches[1].asks).toEqual({ firstMessage: WORKFLOW_FIRST_MESSAGE });

    // The first stage of that Role still open decides: an agent keeps its model.
    expect(workflows.stageModel(lead, 'qa-engineer')).toEqual({
      model: 'haiku',
      stageTitle: 'Look',
    });
    expect(workflows.stageModel(lead, 'developer')).toBeUndefined();
    expect(workflows.stageModel(lead, 'security-engineer')).toBeUndefined();
    workflows.move(lead, 'start', 'look');
    expect(workflows.stageModel(lead, 'qa-engineer')).toMatchObject({ model: 'haiku' });
    await workflows.finish(lead, 'look', 'Seen it fail.');
    expect(workflows.stageModel(lead, 'qa-engineer')).toEqual({
      model: 'opus',
      stageTitle: 'Look again',
    });
    // The lead reads it with the stage; an agent that leads no run launches as ever.
    const view = workflows.view(lead);
    expect(view.running && view.stages.map((stage) => stage.model)).toEqual([
      'haiku',
      undefined,
      'opus',
      undefined,
    ]);
    const member = join(store.get(lead)!.crew && { ...store.get(lead)!.crew!, launchedBy: lead });
    expect(workflows.stageModel(member, 'qa-engineer')).toBeUndefined();
    expect(workflows.stageModel(join(), 'qa-engineer')).toBeUndefined();
  });

  it('the run is listed before its lead joins: its first call finds it', async () => {
    let seenAtLaunch: unknown;
    launching = async (request) => {
      seenAtLaunch = runs().map((run) => [run.crewId, run.leadAgentId]);
      return { ok: true, id: join(request.crew?.crew) };
    };
    await started();
    expect(seenAtLaunch).toEqual([[launches[0].crew!.crew.id, undefined]]);
  });

  it('refuses a start that names no Workflow, no request, too long a one, or no Directory', async () => {
    const refused: Array<[Record<string, unknown>, RegExp]> = [
      [{ workflowId: 'no-such' }, /no such workflow/],
      [{ workflowId: 7 }, /no such workflow/],
      [{ request: '   ' }, /starts from a request/],
      [{ request: undefined }, /starts from a request/],
      [{ request: 'x'.repeat(MAX_WORKFLOW_REQUEST_CHARS + 1) }, /longer than 4000 characters/],
      [{ request: 'a\u0000b' }, /NUL/],
      [{ directoryPath: '' }, /starts in a Directory/],
      [{ directoryPath: undefined }, /starts in a Directory/],
    ];
    for (const [more, why] of refused) {
      const outcome = await ask(more);
      expect(outcome).toMatchObject({ ok: false });
      expect(!outcome.ok && outcome.reason).toMatch(why);
    }
    expect(launches).toEqual([]);
    expect(runs()).toEqual([]);
    expect(crews.statusMessage().crews).toEqual([]);
    // The longest request there is passes whole.
    const longest = 'x'.repeat(MAX_WORKFLOW_REQUEST_CHARS);
    const lead = await started({ request: `  ${longest}\n` });
    const view = workflows.view(lead);
    expect(view.running && view.request).toBe(longest);
  });

  it('starts none where no Crew can be: the office is told why', async () => {
    unavailable = 'The Pixel Office MCP is off: turn it on in Settings.';
    expect(workflows.statusMessage()).toMatchObject({
      available: false,
      unavailableReason: unavailable,
    });
    expect(await ask()).toEqual({ ok: false, reason: unavailable });
    expect(launches).toEqual([]);
  });

  it('a lead that could not start leaves no run and no Crew', async () => {
    launching = async () => ({ ok: false, reason: "The agent's terminal could not start." });
    expect(await ask()).toEqual({
      ok: false,
      reason: "The lead couldn't start: The agent's terminal could not start.",
    });
    expect(runs()).toEqual([]);
    expect(crews.statusMessage().crews).toEqual([]);

    launching = async () => {
      throw new Error('spawn failed');
    };
    expect(await ask()).toEqual({ ok: false, reason: "The lead couldn't start: spawn failed" });
    expect(runs()).toEqual([]);
  });

  it('a lead launched without the Pixel Office MCP cannot run one: said so, and no run', async () => {
    launching = async () => ({ ok: true, id: join() });
    const outcome = await ask();
    expect(!outcome.ok && outcome.reason).toMatch(
      /launched without the Pixel Office MCP.*Agent 1 is in the office as a plain agent/,
    );
    expect(runs()).toEqual([]);
  });

  it('a launch reported late is still a start once its lead is in the office', async () => {
    // Joined, but its CLI had not drawn within the time limit.
    launching = async (request) => {
      join(request.crew?.crew);
      return { ok: false, reason: "Agent 1 was launched, but its CLI hasn't started within 15 s." };
    };
    expect(await ask()).toEqual({ ok: true });
    expect(runs()[0]).toMatchObject({ leadAgentId: 1 });
  });

  it('a launch that outlives its answer is waited for: the lead it brings later leads the run', async () => {
    let finish!: () => void;
    const underway = new Promise<void>((resolve) => (finish = resolve));
    let crew: AgentState['crew'];
    launching = async (request) => {
      crew = request.crew?.crew;
      return { ok: false, reason: 'It may still join.', underway };
    };
    const asking = ask();
    await new Promise((resolve) => setImmediate(resolve));
    // Still on its way: the run stands, with no lead yet.
    expect(runs()).toMatchObject([{ finished: false }]);
    expect(runs()[0].leadAgentId).toBeUndefined();

    const lead = join(crew);
    finish();
    expect(await asking).toEqual({ ok: true });
    expect(runs()[0].leadAgentId).toBe(lead);
  });

  it('the lead reads the request whole, the stages with what to do, and the rules; then reports each stage', async () => {
    const request = 'Line one.\n\n  "Quoted" & <odd> %PATH% $(chars) `too`.';
    const lead = await started({ request });

    const view = workflows.view(lead);
    if (!view.running) throw new Error('no run');
    expect(view).toMatchObject({ youLead: true, leadAgentId: lead, request, finished: false });
    expect(view.workflow).toMatchObject({ id: 'bug-fix', name: 'Bug fix' });
    expect(view.workflow.brief).not.toBe('');
    expect(view.rules).toEqual(WORKFLOW_LEAD_RULES);
    expect(view.note).toBeUndefined();
    expect(view.stages[0]).toMatchObject({
      id: 'reproduce',
      role: { id: 'qa-engineer', name: 'QA Engineer' },
      parallel: false,
      state: 'pending',
    });
    expect(view.stages[0].brief).not.toBe('');
    expect(view.stages[4]).toMatchObject({ id: 'security-check', parallel: true });
    // Every office is shown the request on one line.
    expect(runs()[0].request).toBe('Line one. "Quoted" & <odd> %PATH% $(chars) `too`.');

    const before = sent.length;
    const startedStage = workflows.move(lead, 'start', 'reproduce');
    expect(startedStage.ok && startedStage.view.running && startedStage.view.stages[0].state).toBe(
      'active',
    );
    expect(sent.slice(before).map((m) => m.type)).toEqual(['workflowsLoaded']);
    const note = `Fails on Safari 17.\n${'x'.repeat(WORKFLOW_SHOWN_TEXT_MAX_CHARS)}`;
    expect(await workflows.finish(lead, 'reproduce', note)).toMatchObject({ ok: true });
    const stage = runs()[0].stages[0];
    expect(stage.state).toBe('done');
    // The office's copy of a note is one line, cut short; the lead keeps it whole.
    expect(stage.note).toHaveLength(WORKFLOW_SHOWN_TEXT_MAX_CHARS);
    expect(stage.note!.endsWith('…')).toBe(true);
    const again = workflows.view(lead);
    expect(again.running && again.stages[0].note).toBe(note);

    // The order is the server's, whatever the lead was told.
    const early = workflows.move(lead, 'start', 'fix');
    expect(!early.ok && early.reason).toMatch(/fix comes after diagnosis \(pending\)/);
    expect(runs()[0].stages[2].state).toBe('pending');
  });

  it("only the lead moves a stage; the Crew's other agents, and their Teammates, read where things stand", async () => {
    const lead = await started();
    const crewId = store.get(lead)!.crew!.id;
    const developer = join({ id: crewId, launchedBy: lead });
    const teammate = join(undefined, { leadAgentId: developer, agentName: 'reviewer' });
    const outsider = join();

    for (const member of [developer, teammate]) {
      const view = workflows.view(member);
      if (!view.running) throw new Error('no run');
      expect(view).toMatchObject({ youLead: false, leadAgentId: lead });
      expect(view.rules).toBeUndefined();
      expect(view.note).toMatch(new RegExp(`Only agent ${lead}, its lead, reports its stages`));
      const moved = workflows.move(member, 'start', 'reproduce');
      expect(!moved.ok && moved.reason).toMatch(
        new RegExp(`Only this workflow's lead \\(agent ${lead}\\) reports its stages`),
      );
    }
    expect(runs()[0].stages[0].state).toBe('pending');

    expect(workflows.view(outsider)).toEqual({ running: false, note: NO_WORKFLOW_NOTE });
    expect(workflows.move(outsider, 'start', 'reproduce')).toEqual({
      ok: false,
      reason: NO_WORKFLOW_NOTE,
    });
    expect(workflows.view(999)).toEqual({ running: false, note: NO_WORKFLOW_NOTE });
    // An agent a member launches is not the lead, though it carries the Crew.
    expect(runs()[0].leadAgentId).toBe(lead);
  });

  it('a run with every stage closed stays listed, finished, until it is stopped', async () => {
    const lead = await started();
    const crewId = store.get(lead)!.crew!.id;
    for (const stage of runs()[0].stages) {
      // A required stage is the user's to skip (the panel), the rest the lead's.
      if (stage.required) expect(workflows.skipByUser(crewId, stage.id)).toBe(true);
      else
        expect(workflows.move(lead, 'skip', stage.id, 'Not needed.')).toMatchObject({ ok: true });
    }
    expect(runs()[0]).toMatchObject({ finished: true });
    const view = workflows.view(lead);
    expect(view.running && view.finished).toBe(true);
    // Later work may still send a stage back.
    expect(workflows.move(lead, 'start', 'fix')).toMatchObject({ ok: true });
    expect(runs()[0]).toMatchObject({ finished: false });
  });

  it('the user stops a run: it is gone, its Crew is ended, and its agents are told', async () => {
    const lead = await started();
    const crewId = store.get(lead)!.crew!.id;
    const developer = join({ id: crewId, launchedBy: lead });

    expect(workflows.handleMessage({ type: 'stopWorkflow', crewId }, () => {})).toBe(true);
    expect(runs()).toEqual([]);
    expect(crews.statusMessage().crews[0]).toMatchObject({ id: crewId, ended: true });
    expect(store.get(lead)!.crew).toMatchObject({ ended: true });
    for (const agent of [lead, developer]) {
      expect(workflows.view(agent)).toEqual({ running: false, note: WORKFLOW_STOPPED_NOTE });
      expect(workflows.move(agent, 'start', 'reproduce')).toEqual({
        ok: false,
        reason: WORKFLOW_STOPPED_NOTE,
      });
    }
    // Stopping what is not running does nothing.
    expect(workflows.stop(crewId)).toBe(false);
    expect(workflows.stop('no-such-crew')).toBe(false);
  });

  it('ending its Crew from the Crew panel ends the run; so does its lead leaving the office', async () => {
    const lead = await started();
    const crewId = store.get(lead)!.crew!.id;
    crews.end(crewId);
    workflows.crewEnded(crewId);
    expect(runs()).toEqual([]);
    expect(workflows.view(lead)).toEqual({ running: false, note: WORKFLOW_STOPPED_NOTE });

    const second = await started();
    const developer = join({ id: store.get(second)!.crew!.id, launchedBy: second });
    expect(runs()).toHaveLength(1);
    // A colleague leaving changes nothing; the lead leaving ends it.
    store.delete(developer);
    expect(runs()).toHaveLength(1);
    store.delete(second);
    expect(runs()).toEqual([]);
  });

  it('several runs are listed in the order they were started, each its own Crew', async () => {
    const first = await started();
    const second = await started({ workflowId: 'security-review', request: 'Audit the API.' });
    expect(runs().map((run) => [run.workflowId, run.leadAgentId])).toEqual([
      ['bug-fix', first],
      ['security-review', second],
    ]);
    expect(store.get(first)!.crew!.id).not.toBe(store.get(second)!.crew!.id);
    // Each lead moves only its own run.
    expect(workflows.move(second, 'start', 'threat-model')).toMatchObject({ ok: true });
    expect(runs()[0].stages.every((s) => s.state === 'pending')).toBe(true);
  });

  it("a run keeps the Workflow it started from, whatever the host's file says later", async () => {
    const dir = path.join(os.homedir(), PIXEL_AGENTS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, WORKFLOWS_FILE_NAME), JSON.stringify({ workflows: [entry()] }));
    const lead = await started({ workflowId: 'hotfix' });
    fs.writeFileSync(
      path.join(dir, WORKFLOWS_FILE_NAME),
      JSON.stringify({
        workflows: [entry({ stages: [{ id: 'x', title: 'X', role: 'architect' }] })],
      }),
    );
    expect(
      workflows
        .statusMessage()
        .workflows.at(-1)!
        .stages.map((s) => s.id),
    ).toEqual(['x']);
    expect(runs()[0].stages.map((s) => s.id)).toEqual(['fix', 'check']);
    expect(workflows.move(lead, 'start', 'fix')).toMatchObject({ ok: true });
  });

  it('answers only its own messages, and a refused start goes back to its sender', async () => {
    const replies: Array<Record<string, unknown>> = [];
    const reply = (message: object) => replies.push({ ...message });
    expect(workflows.handleMessage({ type: 'endCrew', crewId: 'x' }, reply)).toBe(false);
    expect(workflows.handleMessage({ type: 'launchAgent' }, reply)).toBe(false);

    expect(
      workflows.handleMessage(
        { type: 'startWorkflow', workflowId: 'bug-fix', directoryPath: '/tmp/p', request: '' },
        reply,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    expect(replies[0]).toEqual({
      type: 'workflowRejected',
      reason: 'A workflow starts from a request: write what you need.',
    });

    expect(
      workflows.handleMessage(
        {
          type: 'startWorkflow',
          workflowId: 'bug-fix',
          directoryPath: '/tmp/p',
          request: 'Fix it',
        },
        reply,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(runs()).toHaveLength(1));
    expect(replies).toHaveLength(1);
  });
});
