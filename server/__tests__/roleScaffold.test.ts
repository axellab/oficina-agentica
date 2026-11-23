import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlaybookDefinition, RoleDefinition } from '../../core/src/roles.js';
import type { WorkflowDefinition, WorkflowStageDefinition } from '../../core/src/workflows.js';
import { parseRoleFile } from '../src/roles/kitFormat.js';
import { roleKitProblems } from '../src/roles/kitRules.js';
import { findRoleKitsDir, readRoleKits } from '../src/roles/roleKits.js';
import {
  type NewRoleAsk,
  type NewRolePlan,
  PLACEHOLDERS,
  planNewRole,
  readNewRoleAsk,
  templateLeftovers,
  writeNewRole,
} from '../src/roles/roleScaffold.js';
import { removeTempDir } from './helpers/removeTempDir.js';
import { TEAM_ROLE_IDS } from './helpers/teamRoles.js';

/**
 * A Role nobody foresaw, made from the template (`npm run new-role`): the
 * house rules every Role is held to (kitRules.ts, pure), and the command's own
 * work (roleScaffold.ts) over real folders: the repository's template, and a
 * copy of the Roles that ship, in a temp dir.
 */

/** The template the repository ships. */
const TEMPLATE_DIR = path.resolve(__dirname, '..', '..', 'role-template');

/** The Roles that ship, in the repository. */
const SHIPPED_ROLES_DIR = findRoleKitsDir()!;

// ── The house rules ─────────────────────────────────────────────

const playbook = (over: Partial<PlaybookDefinition> = {}): PlaybookDefinition => ({
  id: 'cut-release',
  name: 'Cut a release',
  description: 'Tag a release from the default branch. Use when asked to release.',
  tools: ['git'],
  instructions: '## 1. Check\n\nRun `git status`.',
  ...over,
});

const role = (id: string, over: Partial<RoleDefinition> = {}): RoleDefinition => ({
  id,
  name: id,
  description: `Does ${id}.`,
  color: 'gray',
  prompt: `Be ${id}.`,
  contract: '### Accepts\n\n- A request.',
  playbooks: [playbook()],
  ...over,
});

const stage = (
  id: string,
  owner: string,
  brief: string,
  over: Partial<WorkflowStageDefinition> = {},
): WorkflowStageDefinition => ({ id, title: id, role: owner, brief, ...over });

const REPORT = 'Report to the user in your own terminal what was released and what is left.';
const WORK = 'Run your Cut a release playbook. Closed when the tag is named in your note.';

const workflow = (lead: string, over: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  id: `${lead}-release`,
  name: 'Release',
  description: 'Notes, checks and a tag.',
  lead,
  brief: 'The request names the version.',
  stages: [stage('work', lead, WORK), stage('report', lead, REPORT)],
  ...over,
});

describe('the house rules', () => {
  const sound = () => ({
    roles: [role('release-manager'), role('agile-project-manager')],
    workflows: [workflow('release-manager'), workflow('agile-project-manager')],
  });

  it('find nothing in Roles built like the rest', () => {
    expect(roleKitProblems(sound())).toEqual([]);
  });

  it('a Role has a Contract, a Playbook and a Workflow it leads', () => {
    const bare = role('bare', { contract: undefined, playbooks: undefined });
    expect(roleKitProblems({ roles: [bare], workflows: [] })).toEqual([
      'bare/CONTRACT.md: missing, and every Role has a Contract',
      'bare/playbooks: every Role has at least one Playbook',
      'bare/workflows: every Role leads at least one Workflow',
    ]);
  });

  it('a Playbook says when to run it, and numbers its steps from the first', () => {
    const kits = sound();
    kits.roles[0] = role('release-manager', {
      playbooks: [
        playbook(),
        playbook({ id: 'announce', name: 'Announce', description: 'Tell everyone.' }),
        playbook({ id: 'notes', name: 'Notes', instructions: '## 2. Write\n\nWrite them.' }),
      ],
    });
    expect(roleKitProblems(kits)).toEqual([
      expect.stringMatching(
        /^release-manager\/playbooks\/announce\.md: its description must say when to run it/,
      ),
      expect.stringMatching(/^release-manager\/playbooks\/notes\.md: its steps must be numbered/),
    ]);
  });

  it("a Playbook's sections are its steps, each the next number, whatever its code blocks hold", () => {
    const steps = (instructions: string): string[] =>
      roleKitProblems({
        roles: [role('release-manager', { playbooks: [playbook({ instructions })] })],
        workflows: [workflow('release-manager')],
      });
    const problem = (found: string, expected: number) => [
      `release-manager/playbooks/cut-release.md: its steps must be numbered sections, from "## 1. " and each the next number: "## ${found}" stands where "## ${expected}. " is expected`,
    ];
    const one = '## 1. Check\n\nRun `git status`.\n\n';

    expect(
      steps(`Tag a release.\n\n${one}## 2. Tag\n\nTag it.\n\n## 3. Report\n\nSay so.`),
    ).toEqual([]);
    // No section at all is no step at all.
    expect(steps('Run `git status`, then tag it.')).toEqual([
      'release-manager/playbooks/cut-release.md: its steps must be numbered sections, from "## 1. "',
    ]);
    // Out of order, one skipped, one that lost its number, one before the first.
    expect(steps(`${one}## 3. Report\n\nSay so.\n\n## 2. Tag\n\nTag it.`)).toEqual(
      problem('3. Report', 2),
    );
    expect(steps(`${one}## 3. Report\n\nSay so.`)).toEqual(problem('3. Report', 2));
    expect(steps(`${one}## Tag\n\nTag it.\n\n## 3. Report\n\nSay so.`)).toEqual(problem('Tag', 2));
    expect(steps(`## Before you start\n\nRead this.\n\n${one}`)).toEqual(
      problem('Before you start', 1),
    );
    expect(steps(`${one}## 2.\n\nA number and nothing after it.`)).toEqual(problem('2.', 2));
    // A smaller heading is part of its step.
    expect(steps(`${one}### If it is dirty\n\nStop.\n\n## 2. Tag\n\nTag it.`)).toEqual([]);

    // A line of a code block is not a section, in either kind of fence, and a
    // fence inside a longer one does not end it.
    const fenced = (open: string, close = open): string =>
      `${one}${open}markdown\n## 7. A file the step shows\n\`\`\`\n## Not a section\n${close}\n\n## 2. Tag\n\nTag it.`;
    expect(steps(fenced('````'))).toEqual([]);
    expect(steps(fenced('~~~'))).toEqual([]);
    // And a step missing after the block is still found.
    expect(steps(`${one}\`\`\`bash\n## 2. In a script\n\`\`\`\n\n## 3. Report\n\nSay so.`)).toEqual(
      problem('3. Report', 2),
    );
  });

  it('a Workflow briefs its lead, and each stage has an owner there is and says what closes it', () => {
    const kits = sound();
    kits.workflows[0] = workflow('release-manager', {
      brief: '  ',
      stages: [
        stage('work', 'release-manager', WORK),
        stage('checks', 'nobody', 'Run the pipeline and say what it printed, line by line.'),
        stage('smoke', 'agile-project-manager', 'Walk the main paths.'),
        stage('report', 'release-manager', REPORT),
      ],
    });
    expect(roleKitProblems(kits)).toEqual([
      expect.stringMatching(
        /^release-manager\/workflows\/release-manager-release\.md: it must tell its lead what the run is for/,
      ),
      expect.stringMatching(/stage "checks" is owned by "nobody", which is no Role$/),
      expect.stringMatching(/stage "smoke" must say what its owner does and what closes it$/),
    ]);
  });

  it("a stage sends its owner only to a Playbook that Role has, and a Role's own Workflow sends it to one", () => {
    const kits = sound();
    kits.roles.push(role('qa-engineer', { playbooks: [playbook({ name: 'Smoke test' })] }));
    kits.workflows.push(workflow('qa-engineer'));
    // The lead's stage names a Playbook that is the release manager's, not its own.
    expect(roleKitProblems(kits)).toEqual([
      expect.stringMatching(
        /^qa-engineer\/workflows\/qa-engineer-release\.md: stage "work" sends the qa-engineer to a "Cut a release" playbook it does not have$/,
      ),
    ]);

    // Every Playbook a stage names is looked for, not only the first.
    const sent = (brief: string): string[] =>
      roleKitProblems({
        roles: sound().roles,
        workflows: [
          workflow('release-manager', {
            stages: [
              stage('work', 'release-manager', brief),
              stage('report', 'release-manager', REPORT),
            ],
          }),
          workflow('agile-project-manager'),
        ],
      });
    const missing = (name: string) =>
      expect.stringMatching(
        new RegExp(
          `stage "work" sends the release-manager to a "${name}" playbook it does not have$`,
        ),
      );
    expect(
      sent('Run your Cut a release playbook. Then run it again: Run your Cut a release playbook.'),
    ).toEqual([]);
    expect(sent('Run your Cut a release playbook. Run your Announce playbook, step 1.')).toEqual([
      missing('Announce'),
    ]);
    expect(
      sent(
        'Run your Notes playbook, then Run your Cut a release playbook. Run your Notes playbook.',
      ),
    ).toEqual([missing('Notes')]);
    expect(sent('Run your Notes playbook to the end. Run your Announce playbook.')).toEqual([
      missing('Notes'),
      missing('Announce'),
    ]);

    // Sending nobody anywhere is fine for the coordinator, whose stages are
    // other Roles', and a problem for any other lead.
    const unsent = (lead: string): WorkflowDefinition =>
      workflow(lead, {
        stages: [
          stage('work', lead, 'Do the work the request names, and note what you did.'),
          stage('report', lead, REPORT),
        ],
      });
    expect(
      roleKitProblems({ roles: sound().roles, workflows: [unsent('agile-project-manager')] }),
    ).toEqual(['release-manager/workflows: every Role leads at least one Workflow']);
    expect(
      roleKitProblems({
        roles: sound().roles,
        workflows: [unsent('release-manager'), workflow('agile-project-manager')],
      }),
    ).toEqual([
      expect.stringMatching(
        /one of its lead's own stages must send it to one of its Playbooks \("Run your <Name> playbook"\)$/,
      ),
    ]);
  });

  it("a Workflow ends on its lead's report, a step of its own", () => {
    const ending = (stages: WorkflowStageDefinition[]): string[] =>
      roleKitProblems({
        roles: sound().roles,
        workflows: [workflow('release-manager', { stages }), workflow('agile-project-manager')],
      });
    const work = stage('work', 'release-manager', WORK);
    const problem = [
      expect.stringMatching(
        /it must end on its lead's report, a last stage "## <step>\. Report \(release-manager\)"/,
      ),
    ];
    expect(ending([work])).toEqual(problem);
    expect(ending([work, stage('report', 'agile-project-manager', REPORT)])).toEqual(problem);
    expect(ending([work, stage('report', 'release-manager', REPORT, { parallel: true })])).toEqual(
      problem,
    );
    expect(ending([work, stage('report', 'release-manager', REPORT)])).toEqual([]);
  });
});

// ── The command ─────────────────────────────────────────────────

describe("the command's arguments", () => {
  it('are the id, the name in passing, and the rest by option', () => {
    expect(readNewRoleAsk(['data-engineer'])).toEqual({ id: 'data-engineer' });
    expect(
      readNewRoleAsk([
        'data-engineer',
        'Data Engineer',
        '--description',
        'Builds the pipelines.',
        '--color',
        'pink',
        '--playbook',
        'Pipeline review',
      ]),
    ).toEqual({
      id: 'data-engineer',
      name: 'Data Engineer',
      description: 'Builds the pipelines.',
      color: 'pink',
      playbook: 'Pipeline review',
    });
    // An option may come first, and --name wins over the name in passing.
    expect(readNewRoleAsk(['--name', 'Data Lead', 'data-engineer', 'Data Engineer'])).toEqual({
      id: 'data-engineer',
      name: 'Data Lead',
    });
  });

  it('say what was not understood', () => {
    expect(readNewRoleAsk([])).toMatch(/^which Role\?/);
    expect(readNewRoleAsk(['--color', 'pink'])).toMatch(/^which Role\?/);
    expect(readNewRoleAsk(['data-engineer', 'Data', 'Engineer'])).toMatch(/the name in quotes/);
    expect(readNewRoleAsk(['data-engineer', '--colour', 'pink'])).toBe('unknown option --colour');
    expect(readNewRoleAsk(['data-engineer', '--color'])).toBe('--color needs a value');
    expect(readNewRoleAsk(['data-engineer', '--color', '--name', 'x'])).toBe(
      '--color needs a value',
    );
  });
});

describe('a new Role, made from the template', () => {
  let dir: string;
  let rolesDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-role-scaffold-'));
    rolesDir = path.join(dir, 'roles');
    fs.mkdirSync(rolesDir);
  });

  afterEach(() => {
    removeTempDir(dir);
  });

  /** The Roles that ship, copied where a test may add to them. */
  const besideTheTeam = (): void => {
    for (const id of TEAM_ROLE_IDS) {
      fs.cpSync(path.join(SHIPPED_ROLES_DIR, id), path.join(rolesDir, id), { recursive: true });
    }
  };

  const planned = (ask: NewRoleAsk, templateDir = TEMPLATE_DIR): NewRolePlan => {
    const result = planNewRole(rolesDir, templateDir, ask);
    if ('problems' in result) throw new Error(result.problems.join('\n'));
    return result.plan;
  };

  const refused = (ask: NewRoleAsk, templateDir = TEMPLATE_DIR): string[] => {
    const result = planNewRole(rolesDir, templateDir, ask);
    if ('plan' in result) throw new Error(`a plan was made for ${ask.id}`);
    return result.problems;
  };

  const text = (file: string): string => fs.readFileSync(path.join(rolesDir, file), 'utf-8');

  /** Every file under the Roles' folder, from it. */
  const filesIn = (root: string): string[] =>
    fs
      .readdirSync(root, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
      .map((file) => file.split(path.sep).join('/'))
      .sort();

  it('is a whole Role beside the team: read with no problem, built by the house rules', () => {
    besideTheTeam();
    const plan = planned({
      id: 'data-engineer',
      description: 'Builds and checks the data pipelines.',
    });
    // Planning writes nothing.
    expect(fs.existsSync(path.join(rolesDir, 'data-engineer'))).toBe(false);

    const written = writeNewRole(rolesDir, plan);
    expect(written.map((file) => path.relative(rolesDir, file).split(path.sep).join('/'))).toEqual([
      'data-engineer/ROLE.md',
      'data-engineer/CONTRACT.md',
      'data-engineer/playbooks/data-engineer-review.md',
      'data-engineer/workflows/data-engineer-review.md',
    ]);

    const kits = readRoleKits(rolesDir);
    expect(kits.problems).toEqual([]);
    expect(roleKitProblems(kits)).toEqual([]);
    // Listed after the team, in a colour none of them has.
    expect(kits.roles.map((r) => r.id)).toEqual([...TEAM_ROLE_IDS, 'data-engineer']);
    const made = kits.roles.at(-1)!;
    expect(made).toMatchObject({
      name: 'Data Engineer',
      description: 'Builds and checks the data pipelines.',
      color: 'pink',
    });
    expect(text('data-engineer/ROLE.md')).toMatch(/^order: 80$/m);
    expect(made.contract).toBeDefined();
    expect(made.playbooks!.map((p) => [p.id, p.name, p.tools])).toEqual([
      ['data-engineer-review', 'Data Engineer review', ['git']],
    ]);
    // Its Workflow is its own, and the second look is another Role's.
    const led = kits.workflows.filter((w) => w.lead === 'data-engineer');
    expect(led.map((w) => [w.id, w.name])).toEqual([
      ['data-engineer-review', 'Data Engineer review'],
    ]);
    expect(led[0].stages.map((s) => [s.id, s.role])).toEqual([
      ['scope', 'data-engineer'],
      ['findings', 'data-engineer'],
      ['second-look', 'qa-engineer'],
      ['report', 'data-engineer'],
    ]);
    expect(kits.workflows.at(-1)).toBe(led[0]);
    // What it is told names its colleagues, and no placeholder is left.
    expect(made.prompt).toContain('You are the Data Engineer of this team.');
    expect(made.prompt).toContain('Hand the QA Engineer what you want checked');
    expect(made.prompt).toContain('the Agile Project Manager anything that changes the plan');
    for (const file of plan.files) expect(file.text, file.path).not.toMatch(/\{\{|\}\}/);
  });

  it('takes its name, colour and first Playbook as asked', () => {
    besideTheTeam();
    const plan = planned({
      id: 'data-engineer',
      name: 'Data Lead',
      color: 'gray',
      playbook: 'Pipeline review',
    });
    expect(plan).toMatchObject({
      name: 'Data Lead',
      color: 'gray',
      playbook: { id: 'pipeline-review', name: 'Pipeline review' },
    });
    expect(plan.files.map((file) => file.path)).toEqual([
      'data-engineer/ROLE.md',
      'data-engineer/CONTRACT.md',
      'data-engineer/playbooks/pipeline-review.md',
      'data-engineer/workflows/pipeline-review.md',
    ]);
    writeNewRole(rolesDir, plan);
    const kits = readRoleKits(rolesDir);
    expect(kits.problems).toEqual([]);
    // With no description given, a stand-in the Role's author replaces.
    expect(kits.roles.at(-1)!.description).toBe("Does the Data Lead's part of the team's work.");
    expect(kits.workflows.at(-1)!.stages[0].brief).toMatch(/^Run your Pipeline review playbook/);
  });

  it('stands alone where there is no other Role: it takes its own second look', () => {
    const plan = planned({ id: 'data-engineer' });
    expect(plan.color).toBe('red');
    writeNewRole(rolesDir, plan);

    const kits = readRoleKits(rolesDir);
    expect(kits.problems).toEqual([]);
    expect(roleKitProblems(kits)).toEqual([]);
    expect(text('data-engineer/ROLE.md')).toMatch(/^order: 10$/m);
    expect(kits.workflows[0].stages.map((s) => s.role)).toEqual(Array(4).fill('data-engineer'));
    expect(kits.roles[0].prompt).toContain(
      'Hand a colleague what you want checked, and whoever coordinates the team anything',
    );
  });

  it.each([
    'Owns the lake: ingestion, models and their tests.',
    'Keeps "the lake" and its jobs running.',
    "It's the team's own data plumber, isn't it.",
    'Mixes "double" quotes with one that\'s single.',
    '#1 at pipelines, [mostly] on time.',
    'yes',
    'Ends with a colon:',
    'Says C:\\data is not a path it owns.',
  ])('writes the description %j so it reads back the same', (description) => {
    const plan = planned({ id: 'data-engineer', description });
    const read = parseRoleFile('data-engineer', plan.files[0].text);
    expect(read).toMatchObject({ role: { description } });
    // And in the Role's own instructions, as it was typed.
    expect(plan.files[0].text).toContain(`in one line: ${description}\n`);
  });

  it('is refused, with the reason, when it could not be told apart or read', () => {
    besideTheTeam();
    const before = filesIn(rolesDir);

    expect(refused({ id: 'Data Engineer' })).toEqual([
      expect.stringMatching(/^"Data Engineer" cannot be a Role's id: lower-case letters/),
    ]);
    expect(refused({ id: '../etc' })).toHaveLength(1);
    expect(refused({ id: 'developer' })).toEqual([
      expect.stringMatching(/developer is already there: a Role is never overwritten$/),
    ]);
    expect(refused({ id: 'coder', name: 'developer' })).toEqual([
      expect.stringMatching(/^the Role "developer" is already called "Developer"/),
    ]);
    expect(refused({ id: 'data-engineer', color: 'teal' })).toEqual([
      expect.stringMatching(/^"teal" is not a Role's colour: red, orange, /),
    ]);
    // A Workflow's id is its own across the Roles.
    expect(refused({ id: 'data-engineer', playbook: 'Threat model' })).toEqual([
      expect.stringMatching(/^a Workflow "threat-model" is already there/),
    ]);
    expect(refused({ id: 'data-engineer', playbook: '2024 review' })).toEqual([
      expect.stringMatching(/^"2024 review" makes no id for a Playbook/),
    ]);
    // Every reason at once, so the command is run again only once.
    expect(
      refused({
        id: 'data-engineer',
        name: 'x'.repeat(41),
        description: 'two\nlines',
        color: 'teal',
        playbook: 'x'.repeat(41),
      }),
    ).toEqual([
      expect.stringMatching(/^its name must be 1-40 characters on one line$/),
      expect.stringMatching(/^its description must be 1-200 characters on one line$/),
      expect.stringMatching(/^"teal" is not a Role's colour/),
      expect.stringMatching(/^its first Playbook's name must be 1-40 characters on one line/),
    ]);

    // And a refusal leaves the folder as it was.
    expect(filesIn(rolesDir)).toEqual(before);
    expect(refused({ id: 'data-engineer' }, path.join(dir, 'no-template'))).toEqual([
      expect.stringMatching(/^the template's ROLE\.md cannot be read/),
      expect.stringMatching(/^the template's CONTRACT\.md cannot be read/),
      expect.stringMatching(/^the template's playbooks\/playbook\.md cannot be read/),
      expect.stringMatching(/^the template's workflows\/workflow\.md cannot be read/),
    ]);
    expect(planNewRole(path.join(dir, 'missing'), TEMPLATE_DIR, { id: 'data-engineer' })).toEqual({
      problems: [expect.stringMatching(/^there is no Roles' folder at /)],
    });
  });

  it('is listed after every Role there is, by the order the office reads of each', () => {
    besideTheTeam();
    const withOrder = (id: string, order: string | undefined): void => {
      const file = path.join(rolesDir, id, 'ROLE.md');
      const line = order === undefined ? '' : `order: ${order}\n`;
      fs.writeFileSync(file, fs.readFileSync(file, 'utf-8').replace(/^order: .*\n/m, line));
    };
    const nextOrder = (): string =>
      /^order: (.*)$/m.exec(planned({ id: 'data-engineer' }).files[0].text)![1];
    expect(nextOrder()).toBe('80');

    // A quoted order is an order like any other.
    withOrder('qa-engineer', "'200'");
    expect(nextOrder()).toBe('210');
    // A Role that writes none is listed after the ones that do: the new Role
    // goes after it too.
    withOrder('developer', undefined);
    expect(nextOrder()).toBe('1010');
    writeNewRole(rolesDir, planned({ id: 'data-engineer' }));
    const kits = readRoleKits(rolesDir);
    expect(kits.problems).toEqual([]);
    expect(kits.roles.map((r) => r.id).slice(-3)).toEqual([
      'qa-engineer',
      'developer',
      'data-engineer',
    ]);

    // There is no order after the last one.
    withOrder('architect', '9995');
    expect(/^order: (.*)$/m.exec(planned({ id: 'ml-engineer' }).files[0].text)![1]).toBe('9999');
  });

  it('never writes into a folder that is there: one that appeared since the plan is left as it was', () => {
    const plan = planned({ id: 'data-engineer' });
    fs.mkdirSync(path.join(rolesDir, 'data-engineer'));
    fs.writeFileSync(path.join(rolesDir, 'data-engineer', 'CONTRACT.md'), 'mine');

    expect(() => writeNewRole(rolesDir, plan)).toThrow(/EEXIST/);
    // Not a file of the plan beside it: the next run is told the folder is there.
    expect(filesIn(rolesDir)).toEqual(['data-engineer/CONTRACT.md']);
    expect(text('data-engineer/CONTRACT.md')).toBe('mine');

    // An empty folder is somebody's too, and stays empty.
    const other = planned({ id: 'ml-engineer' });
    fs.mkdirSync(path.join(rolesDir, 'ml-engineer'));
    expect(() => writeNewRole(rolesDir, other)).toThrow(/EEXIST/);
    expect(fs.readdirSync(path.join(rolesDir, 'ml-engineer'))).toEqual([]);
  });

  it('writes the whole Role or nothing: a write that fails takes back what it made', () => {
    besideTheTeam();
    const before = filesIn(rolesDir);
    const plan = planned({ id: 'data-engineer' });
    // The last file cannot be written: its name is taken by the one before it.
    const broken: NewRolePlan = { ...plan, files: [...plan.files, plan.files.at(-1)!] };

    expect(() => writeNewRole(rolesDir, broken)).toThrow(/EEXIST/);
    expect(fs.existsSync(path.join(rolesDir, 'data-engineer'))).toBe(false);
    expect(filesIn(rolesDir)).toEqual(before);
    // So the same command, run again, makes the Role.
    expect(writeNewRole(rolesDir, planned({ id: 'data-engineer' }))).toHaveLength(4);
    expect(readRoleKits(rolesDir).problems).toEqual([]);
  });

  describe('from a template someone changed', () => {
    let templateDir: string;

    /** The repository's template, with one file's text changed. */
    const changed = (file: string, change: (was: string) => string): void => {
      const target = path.join(templateDir, file);
      fs.writeFileSync(target, change(fs.readFileSync(target, 'utf-8')));
    };

    beforeEach(() => {
      templateDir = path.join(dir, 'role-template');
      fs.cpSync(TEMPLATE_DIR, templateDir, { recursive: true });
    });

    it('carries the change into the new Role', () => {
      changed('CONTRACT.md', (was) =>
        was.replace('### Hands over\n', '### Hands over\n\n- To {{the-reviewer}}, always.'),
      );
      besideTheTeam();
      writeNewRole(rolesDir, planned({ id: 'data-engineer' }, templateDir));
      expect(text('data-engineer/CONTRACT.md')).toContain('- To the QA Engineer, always.');
    });

    it('makes no Role when the template asks for something nothing gives, naming it', () => {
      changed('ROLE.md', (was) => `${was}\nAsk {{the-boss}} and {{team}}.\n`);
      expect(refused({ id: 'data-engineer' }, templateDir)).toEqual([
        expect.stringMatching(
          /^the template's ROLE\.md asks for \{\{team\}\}, \{\{the-boss\}\}, which nothing gives \(it takes: id, name, /,
        ),
      ]);
      expect(fs.existsSync(path.join(rolesDir, 'data-engineer'))).toBe(false);
    });

    it.each(['{{Name}}', '{{role_name}}', '{{ name }}', '{{name.upper}}', '{{}}'])(
      'makes no Role when the template holds %s: a misspelt placeholder never reaches an agent',
      (misspelt) => {
        changed('playbooks/playbook.md', (was) => `${was}\nAsk ${misspelt} for the rest.\n`);
        const inBraces = misspelt.slice(2, -2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        expect(refused({ id: 'data-engineer' }, templateDir)).toEqual([
          expect.stringMatching(
            new RegExp(
              `^the template's playbooks/playbook\\.md asks for \\{\\{${inBraces}\\}\\}, which nothing gives`,
            ),
          ),
        ]);
        expect(fs.existsSync(path.join(rolesDir, 'data-engineer'))).toBe(false);
      },
    );

    it('makes no Role when what it would write cannot be read, or breaks a house rule', () => {
      changed('CONTRACT.md', (was) => was.replace('### Never', '### Never ever'));
      expect(refused({ id: 'data-engineer' }, templateDir)).toEqual([
        expect.stringMatching(/^data-engineer\/CONTRACT\.md: its sections must be exactly/),
      ]);

      fs.cpSync(TEMPLATE_DIR, templateDir, { recursive: true, force: true });
      changed('playbooks/playbook.md', (was) => was.replace('. Use when ', '. For when '));
      changed('workflows/workflow.md', (was) =>
        was.replace('Run your {{playbook}} playbook', 'Do'),
      );
      expect(refused({ id: 'data-engineer' }, templateDir)).toEqual([
        expect.stringMatching(
          /^data-engineer\/playbooks\/data-engineer-review\.md: its description must say when to run it/,
        ),
        expect.stringMatching(
          /^data-engineer\/workflows\/data-engineer-review\.md: one of its lead's own stages must send it/,
        ),
      ]);
      expect(fs.existsSync(path.join(rolesDir, 'data-engineer'))).toBe(false);
    });
  });

  describe("the lines still the template's", () => {
    it('are counted per file, and a file made the Role’s own is no longer listed', () => {
      besideTheTeam();
      writeNewRole(rolesDir, planned({ id: 'data-engineer' }));

      const fresh = templateLeftovers(rolesDir, TEMPLATE_DIR, 'data-engineer');
      expect(fresh.map((leftover) => leftover.file)).toEqual([
        'data-engineer/ROLE.md',
        'data-engineer/CONTRACT.md',
        'data-engineer/playbooks/data-engineer-review.md',
        'data-engineer/workflows/data-engineer-review.md',
      ]);
      for (const { file, lines } of fresh) expect(lines, file).toBeGreaterThan(3);

      // Its Contract rewritten but for one line, and a Playbook of its own added.
      const contract = path.join(rolesDir, 'data-engineer', 'CONTRACT.md');
      const kept = '- To the human: every decision that is theirs to take.';
      expect(fs.readFileSync(contract, 'utf-8')).toContain(kept);
      fs.writeFileSync(
        contract,
        `### Accepts\n\n- A dataset and what it must hold.\n\n### Hands over\n\n${kept}\n`,
      );
      fs.writeFileSync(
        path.join(rolesDir, 'data-engineer', 'playbooks', 'backfill.md'),
        '---\nname: Backfill\n---\n\n## 1. Plan\n\nSay which partitions are rewritten, and by which job.',
      );
      const now = templateLeftovers(rolesDir, TEMPLATE_DIR, 'data-engineer');
      expect(now.find((leftover) => leftover.file.endsWith('CONTRACT.md'))).toEqual({
        file: 'data-engineer/CONTRACT.md',
        lines: 1,
      });
      expect(now.map((leftover) => leftover.file)).not.toContain(
        'data-engineer/playbooks/backfill.md',
      );
    });

    it('are none in the Roles that ship: the template copies no line of theirs', () => {
      for (const id of TEAM_ROLE_IDS) {
        expect(templateLeftovers(SHIPPED_ROLES_DIR, TEMPLATE_DIR, id), id).toEqual([]);
      }
      // And a Role that is not there, or a template that is not, lists nothing.
      expect(templateLeftovers(SHIPPED_ROLES_DIR, TEMPLATE_DIR, 'nobody')).toEqual([]);
      expect(templateLeftovers(SHIPPED_ROLES_DIR, path.join(dir, 'none'), 'developer')).toEqual([]);
    });
  });
});

describe('the template the repository ships', () => {
  const ROLE_FILES = ['CONTRACT.md', 'ROLE.md', 'playbooks/playbook.md', 'workflows/workflow.md'];
  const template = (file: string): string =>
    fs.readFileSync(path.join(TEMPLATE_DIR, file), 'utf-8');

  it('is the four files of a Role and a page on them, asking only for what the command gives', () => {
    const files = fs
      .readdirSync(TEMPLATE_DIR, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(TEMPLATE_DIR, path.join(entry.parentPath, entry.name)))
      .map((file) => file.split(path.sep).join('/'));
    expect(files.sort()).toEqual([...ROLE_FILES, 'README.md'].sort());

    const asked = new Set(
      ROLE_FILES.flatMap((file) =>
        [...template(file).matchAll(/\{\{([^}]*)\}\}/g)].map((match) => match[1]),
      ),
    );
    // Every placeholder there is has a use, none is asked for that is not
    // given, and the page names each one.
    expect([...asked].sort()).toEqual(Object.keys(PLACEHOLDERS).sort());
    for (const placeholder of Object.keys(PLACEHOLDERS)) {
      expect(template('README.md')).toContain(`\`{{${placeholder}}}\``);
    }
  });

  it('says nothing to an agent that is not meant for it: no note to the author, no to-do', () => {
    // Whatever a Role's file holds after its front matter is told to its agents.
    for (const file of ROLE_FILES) {
      expect(template(file), file).not.toMatch(/TODO|FIXME|<!--|replace this|edit this|template/i);
    }
  });
});
