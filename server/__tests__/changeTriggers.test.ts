/**
 * Change triggers, on their own: the path patterns a stage and a trigger are
 * written with (core/src/pathGlobs.ts), what a triggers.json may hold
 * (core/src/changeTriggers.ts, changeTriggerCatalog.ts), what git says of a
 * checkout (changeGit.ts, a real repository), the rules of the watch
 * (changeTriggers.ts, with git and the clock in the test's hands) and a run
 * started for a change (workflows.ts `startForChange`, over a real store).
 * The whole of it over a composed server is officeMcpWorkflows.test.ts.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ChangeTriggerDefinition,
  DEFAULT_CHANGE_WORKFLOW,
  MAX_CHANGE_TRIGGERS,
  parseChangeTriggers,
  TRIGGER_DEFAULT_RUNS_PER_HOUR,
  TRIGGER_DEFAULT_SETTLE_SECONDS,
} from '../../core/src/changeTriggers.js';
import {
  isPathGlob,
  MAX_PATH_GLOBS,
  nameSelector,
  parsePathGlobs,
  pathSelected,
  touchesPaths,
} from '../../core/src/pathGlobs.js';
import { parseWorkflows, parseWorkflowsLoaded, PATHS_PROBLEM } from '../../core/src/workflows.js';
import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import {
  CHANGE_TRIGGER_RATE_WINDOW_MS,
  CHANGE_TRIGGER_RETRY_MS,
  PIXEL_AGENTS_DIR,
  TRIGGERS_FILE_NAME,
  WORKFLOW_CHANGE_SKIP_NOTE,
  WORKFLOWS_FILE_NAME,
} from '../src/constants.js';
import { Crews } from '../src/crews.js';
import type { AgentLaunch, AgentLaunchOutcome } from '../src/mcp/officeOperations.js';
import type { AgentState } from '../src/types.js';
import {
  type ChangeSince,
  changeSince,
  type CheckoutHead,
  headOf,
} from '../src/workflows/changeGit.js';
import { changeTriggerCatalog } from '../src/workflows/changeTriggerCatalog.js';
import { ChangeTriggers } from '../src/workflows/changeTriggers.js';
import {
  changeRequest,
  WORKFLOW_CHANGE_FIRST_MESSAGE,
  WORKFLOW_CHANGE_LEAD_RULES,
  WORKFLOW_LEAD_RULES,
} from '../src/workflows/workflowCopy.js';
import { changeHasWork, initialStagesForChange } from '../src/workflows/workflowProgress.js';
import { Workflows } from '../src/workflows/workflows.js';
import { clearTestHome } from './helpers/removeTempDir.js';

/** A commit's full name, for a test: `commit(3)` is 000…003. */
const commit = (n: number): string => n.toString(16).padStart(40, '0');

// ── Path patterns ───────────────────────────────────────────────

describe('path patterns (what a stage is for, which branches a trigger watches)', () => {
  const selects = (globs: string[], file: string): boolean => touchesPaths([file], globs);

  it('a name alone is looked for at any depth, a folder holds everything under it', () => {
    expect(selects(['*.md'], 'README.md')).toBe(true);
    expect(selects(['*.md'], 'docs/guide/intro.md')).toBe(true);
    expect(selects(['*.md'], 'docs/intro.mdx')).toBe(false);
    expect(selects(['package.json'], 'web/package.json')).toBe(true);
    expect(selects(['docs/'], 'docs/a/b.png')).toBe(true);
    expect(selects(['docs/'], 'web/docs/a.md')).toBe(true);
    expect(selects(['docs/'], 'docs.md')).toBe(false);
    expect(selects(['Dockerfile*'], 'api/Dockerfile.prod')).toBe(true);
  });

  it('a pattern with a folder in it is read from the root; a leading slash anchors a name', () => {
    expect(selects(['src/*.ts'], 'src/a.ts')).toBe(true);
    expect(selects(['src/*.ts'], 'src/deep/a.ts')).toBe(false);
    expect(selects(['src/*.ts'], 'web/src/a.ts')).toBe(false);
    expect(selects(['src/**'], 'src/deep/er/a.ts')).toBe(true);
    expect(selects(['src/**/*.test.ts'], 'src/a.test.ts')).toBe(true);
    expect(selects(['src/**/*.test.ts'], 'src/x/y/a.test.ts')).toBe(true);
    expect(selects(['**/migrations/*.sql'], 'migrations/1.sql')).toBe(true);
    expect(selects(['/README.md'], 'README.md')).toBe(true);
    expect(selects(['/README.md'], 'docs/README.md')).toBe(false);
    expect(selects(['a?.ts'], 'ab.ts')).toBe(true);
    expect(selects(['a?.ts'], 'a/.ts')).toBe(false);
  });

  it('reads every other character as itself', () => {
    expect(selects(['a.b'], 'axb')).toBe(false);
    expect(selects(['a+b(1)[2].ts'], 'a+b(1)[2].ts')).toBe(true);
    expect(selects(['*.c++'], 'x.c++')).toBe(true);
    expect(selects(['a|b'], 'a')).toBe(false);
  });

  it('no character in a file name takes it out of a pattern: git allows a line break in one', () => {
    for (const odd of ['a\nb.ts', 'a\rb.ts', 'a\u2028b.ts', 'a\u2029b.ts', '\n.ts']) {
      expect(selects(['src/**'], `src/${odd}`)).toBe(true);
      expect(selects(['src/'], `src/deep/${odd}`)).toBe(true);
      expect(selects(['src/**/*.ts'], `src/de\nep/${odd}`)).toBe(true);
      expect(selects(['*.ts'], `we\nb/${odd}`)).toBe(true);
      expect(selects(['src/*.ts'], `src/${odd}`)).toBe(true);
      // Left out like any other file, too.
      expect(selects(['src/**', '!*.ts'], `src/${odd}`)).toBe(false);
      expect(selects(['!src/'], `src/de\nep/${odd}`)).toBe(false);
    }
    expect(selects(['a?.ts'], 'a\n.ts')).toBe(true);
    expect(pathSelected('release/2\n1', nameSelector(['release/**']))).toBe(true);
  });

  it('a pattern with ! leaves out what it matches; with nothing else, everything else is taken in', () => {
    const notDocs = ['!*.md', '!docs/'];
    expect(touchesPaths(['README.md', 'docs/a.png'], notDocs)).toBe(false);
    expect(touchesPaths(['README.md', 'src/a.ts'], notDocs)).toBe(true);
    const sourceNotTests = ['src/**', '!*.test.ts'];
    expect(touchesPaths(['src/a.test.ts'], sourceNotTests)).toBe(false);
    expect(touchesPaths(['src/a.test.ts', 'src/a.ts'], sourceNotTests)).toBe(true);
    expect(touchesPaths(['web/a.ts'], sourceNotTests)).toBe(false);
    expect(touchesPaths([], ['**'])).toBe(false);
  });

  it("a branch is matched by its whole name, so `main` is never another branch's last word", () => {
    const watched = nameSelector(['main', 'release/*', '!release/old']);
    expect(pathSelected('main', watched)).toBe(true);
    expect(pathSelected('feature/main', watched)).toBe(false);
    expect(pathSelected('release/2.1', watched)).toBe(true);
    expect(pathSelected('release/2.1/hotfix', watched)).toBe(false);
    expect(pathSelected('release/old', watched)).toBe(false);
    expect(pathSelected('wip/x', nameSelector(['!wip/**']))).toBe(false);
    expect(pathSelected('main', nameSelector(['!wip/**']))).toBe(true);
  });

  it('says what a pattern is: no blank space, brace or comma, and something to match', () => {
    for (const good of ['*.md', 'src/**', '!docs/', '/README.md', 'a?b']) {
      expect(isPathGlob(good), good).toBe(true);
    }
    for (const bad of [
      '',
      '!',
      '/',
      '!!a',
      'a b',
      'a,b',
      '{a}',
      'a\tb',
      7,
      null,
      'x'.repeat(201),
    ]) {
      expect(isPathGlob(bad), String(bad)).toBe(false);
    }
    expect(parsePathGlobs('*.md')).toEqual(['*.md']);
    expect(parsePathGlobs(['src/**', '!*.md'])).toEqual(['src/**', '!*.md']);
    expect(parsePathGlobs([])).toBeUndefined();
    expect(parsePathGlobs(['a', 'a'])).toBeUndefined();
    expect(parsePathGlobs(['a', 'b c'])).toBeUndefined();
    expect(
      parsePathGlobs(Array.from({ length: MAX_PATH_GLOBS + 1 }, (_, i) => `f${i}`)),
    ).toBeUndefined();
  });
});

// ── The stages a change touches ─────────────────────────────────

describe("a stage's paths (workflows.json) and the stages of a run a change started", () => {
  const workflowWith = (paths: unknown) => ({
    workflows: [
      {
        id: 'review',
        name: 'Review',
        stages: [{ id: 'code', title: 'Code', role: 'developer', paths }],
      },
    ],
  });

  it('reads one pattern or a list of them, and says what is wrong with anything else', () => {
    expect(parseWorkflows(workflowWith('src/**')).workflows[0].stages[0].paths).toEqual(['src/**']);
    expect(parseWorkflows(workflowWith(['src/**', '!*.md'])).workflows[0].stages[0].paths).toEqual([
      'src/**',
      '!*.md',
    ]);
    for (const bad of [[], ['a b'], 7, ['a', 'a'], '{src,lib}/**']) {
      const parsed = parseWorkflows(workflowWith(bad));
      expect(parsed.workflows).toEqual([]);
      expect(parsed.problems).toEqual([`workflows[0]: stages[0]: ${PATHS_PROBLEM}`]);
    }
  });

  const stages = parseWorkflows({
    workflows: [
      {
        id: 'review',
        name: 'Review',
        stages: [
          { id: 'scope', title: 'Scope', role: 'agile-project-manager' },
          { id: 'code', title: 'Code', role: 'developer', paths: ['!*.md'] },
          {
            id: 'security',
            title: 'Security',
            role: 'security-engineer',
            required: true,
            paths: ['!*.md'],
          },
          { id: 'infra', title: 'Infra', role: 'cloud-engineer', paths: ['*.tf', 'infra/'] },
          { id: 'report', title: 'Report', role: 'agile-project-manager' },
        ],
      },
    ],
  }).workflows[0].stages;

  it('the office leaves out the stages whose files the change does not touch, required or not', () => {
    const skipped = { state: 'skipped', note: 'Left out.' };
    const pending = { state: 'pending' };
    expect(initialStagesForChange(stages, ['src/a.ts', 'README.md'], 'Left out.')).toEqual([
      { id: 'scope', ...pending },
      { id: 'code', ...pending },
      { id: 'security', ...pending },
      { id: 'infra', ...skipped },
      { id: 'report', ...pending },
    ]);
    expect(initialStagesForChange(stages, ['infra/main.tf', 'README.md'], 'Left out.')).toEqual([
      { id: 'scope', ...pending },
      { id: 'code', ...pending },
      { id: 'security', ...pending },
      { id: 'infra', ...pending },
      { id: 'report', ...pending },
    ]);
    expect(
      initialStagesForChange(stages, ['README.md'], 'Left out.').map((stage) => stage.state),
    ).toEqual(['pending', 'skipped', 'skipped', 'skipped', 'pending']);
  });

  it('a file name with a line break in it leaves no stage out that is for its folder', () => {
    const states = (files: string[]): string[] =>
      initialStagesForChange(stages, files, 'Left out.').map((stage) => stage.state);
    expect(states(['infra/net\nwork.yml'])).toEqual(Array(5).fill('pending'));
    expect(states(['src/a\nb.ts'])).toEqual([
      'pending',
      'pending',
      'pending',
      'skipped',
      'pending',
    ]);
    expect(changeHasWork([stages[3]], ['infra/net\nwork.yml'])).toBe(true);
  });

  it('a change that touches no file any stage is for gives the Workflow nothing to do', () => {
    expect(changeHasWork(stages, ['src/a.ts'])).toBe(true);
    expect(changeHasWork(stages, ['README.md', 'docs/a.md'])).toBe(false);
    // A Workflow that names no paths is for every change.
    expect(changeHasWork([stages[0], stages[4]], ['README.md'])).toBe(true);
  });
});

// ── triggers.json ───────────────────────────────────────────────

describe('parseChangeTriggers (triggers.json)', () => {
  it('reads an entry with only its Directory: the built-in review, every branch, the default pace', () => {
    expect(parseChangeTriggers({ triggers: [{ directory: ' ~/code/billing ' }] })).toEqual({
      triggers: [
        {
          directory: '~/code/billing',
          workflow: DEFAULT_CHANGE_WORKFLOW,
          settleSeconds: TRIGGER_DEFAULT_SETTLE_SECONDS,
          maxRunsPerHour: TRIGGER_DEFAULT_RUNS_PER_HOUR,
          enabled: true,
        },
      ],
      problems: [],
    });
  });

  it('reads everything an entry may say', () => {
    const entry = {
      directory: '/srv/app',
      workflow: 'security-review',
      branches: ['main', 'release/*'],
      settleSeconds: 60,
      maxRunsPerHour: 1,
      enabled: false,
    };
    expect(parseChangeTriggers({ triggers: [entry] }).triggers).toEqual([entry]);
    expect(
      parseChangeTriggers({ triggers: [{ directory: '/srv/app', branches: 'main' }] }).triggers[0]
        .branches,
    ).toEqual(['main']);
  });

  it('leaves a bad entry out, says what is wrong with it, and keeps the rest', () => {
    const parsed = parseChangeTriggers({
      triggers: [
        { directory: '/srv/a' },
        'nope',
        { directory: '' },
        { directory: '/srv/b', command: 'rm -rf /' },
        { directory: '/srv/c', workflow: 'Not An Id' },
        { directory: '/srv/d', branches: ['a b'] },
        { directory: '/srv/e', settleSeconds: 1 },
        { directory: '/srv/f', maxRunsPerHour: 0 },
        { directory: '/srv/g', enabled: 'yes' },
        { directory: '/srv/a', workflow: 'bug-fix' },
      ],
    });
    expect(parsed.triggers.map((trigger) => trigger.directory)).toEqual(['/srv/a']);
    expect(parsed.problems).toEqual([
      'triggers[1]: not an object',
      expect.stringMatching(/^triggers\[2\]: "directory" must be the path of the Directory/),
      'triggers[3]: unknown field "command"',
      'triggers[4]: "workflow" must be the id of a Workflow',
      expect.stringMatching(/^triggers\[5\]: "branches" must be a branch pattern/),
      'triggers[6]: "settleSeconds" must be a whole number from 5 to 3600',
      'triggers[7]: "maxRunsPerHour" must be a whole number from 1 to 30',
      'triggers[8]: "enabled" must be true or false',
      'triggers[9]: "/srv/a" is listed twice; the first one is used',
    ]);
  });

  it('is not a list, or too long a one; a Directory is one however its path is written', () => {
    expect(parseChangeTriggers(null).problems).toEqual([
      'expected an object with a "triggers" list',
    ]);
    const many = Array.from({ length: MAX_CHANGE_TRIGGERS + 2 }, (_, i) => ({
      directory: `/srv/${i}`,
    }));
    const parsed = parseChangeTriggers({ triggers: many });
    expect(parsed.triggers).toHaveLength(MAX_CHANGE_TRIGGERS);
    expect(parsed.problems).toEqual([`only the first ${MAX_CHANGE_TRIGGERS} triggers are read`]);
    const same = parseChangeTriggers(
      { triggers: [{ directory: '/srv/a' }, { directory: '/srv/a/' }] },
      (a, b) => path.resolve(a) === path.resolve(b),
    );
    expect(same.triggers).toHaveLength(1);
  });
});

describe("the host's change triggers (triggers.json in the persistence dir)", () => {
  const file = () => path.join(os.homedir(), PIXEL_AGENTS_DIR, TRIGGERS_FILE_NAME);
  beforeEach(() => {
    clearTestHome(PIXEL_AGENTS_DIR);
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('no file is no trigger: nothing is watched that the user did not write', () => {
    expect(changeTriggerCatalog()).toEqual([]);
  });

  it('reads the file as it stands, again when it changes, and says what is wrong with it', () => {
    fs.writeFileSync(file(), JSON.stringify({ triggers: [{ directory: '~/code/app' }] }));
    expect(changeTriggerCatalog().map((trigger) => trigger.directory)).toEqual(['~/code/app']);
    fs.writeFileSync(
      file(),
      JSON.stringify({
        triggers: [{ directory: '~/code/app' }, { directory: '~/code/app/' }, { directory: 7 }],
      }),
    );
    expect(changeTriggerCatalog()).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/Change triggers: triggers\.json: triggers\[1\]: .* is listed twice/),
    );
    fs.writeFileSync(file(), '{ not json');
    expect(changeTriggerCatalog()).toEqual([]);
  });
});

// ── What git says of a checkout ─────────────────────────────────

describe('what changed in a Directory (a real repository)', () => {
  let repo: string;
  const git = (...args: string[]): string =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.com',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: repo, encoding: 'utf-8' },
    ).trim();
  /** Write files and commit them; the commit's name. */
  function committed(files: Record<string, string>, message = 'change'): string {
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
      fs.writeFileSync(path.join(repo, name), text);
    }
    git('add', '-A');
    git('commit', '--quiet', '-m', message);
    return git('rev-parse', 'HEAD');
  }

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.homedir(), 'change-repo-'));
    git('init', '--quiet', '-b', 'main');
  });

  it('where a checkout stands: its commit and its branch, none on a detached HEAD', async () => {
    // No commit yet: nothing to watch.
    expect(await headOf(repo)).toBeUndefined();
    const first = committed({ 'README.md': '# app\n' });
    expect(await headOf(repo)).toEqual({ commit: first, branch: 'main' });
    git('checkout', '--quiet', '-b', 'feature/x');
    expect(await headOf(repo)).toEqual({ commit: first, branch: 'feature/x' });
    git('checkout', '--quiet', '--detach');
    expect(await headOf(repo)).toEqual({ commit: first });
    // A folder inside the repository, or one that is no repository, is not watched.
    fs.mkdirSync(path.join(repo, 'sub'));
    expect(await headOf(path.join(repo, 'sub'))).toBeUndefined();
    expect(await headOf(path.join(repo, 'nowhere'))).toBeUndefined();
  });

  it('the commits since one it saw, and the paths they touch, however a file is named', async () => {
    const first = committed({ 'README.md': '# app\n', 'src/a.ts': 'a\n' });
    committed({ 'src/a.ts': 'b\n' });
    const head = committed({ 'docs/new guide.md': 'x\n', 'src/deep/ñ.ts': 'y\n' });
    expect(await changeSince(repo, first, head)).toEqual({
      base: first,
      head,
      commits: 2,
      files: ['docs/new guide.md', 'src/a.ts', 'src/deep/ñ.ts'],
    });
    // A file that was deleted is part of the change; a move is its two paths.
    git('mv', 'src/a.ts', 'src/b.ts');
    git('rm', '--quiet', 'README.md');
    git('commit', '--quiet', '-m', 'move');
    const moved = git('rev-parse', 'HEAD');
    expect((await changeSince(repo, head, moved))?.files).toEqual([
      'README.md',
      'src/a.ts',
      'src/b.ts',
    ]);
  });

  // Windows has no such file name.
  it.skipIf(process.platform === 'win32')(
    'a file whose name holds a line break is read whole, and is in the patterns that name its folder',
    async () => {
      const first = committed({ 'README.md': '# app\n' });
      const head = committed({ 'infra/net\nwork.tf': 'x\n' });
      const files = (await changeSince(repo, first, head))?.files ?? [];
      expect(files).toEqual(['infra/net\nwork.tf']);
      expect(touchesPaths(files, ['infra/'])).toBe(true);
      expect(touchesPaths(files, ['infra/**'])).toBe(true);
      expect(touchesPaths(files, ['!infra/'])).toBe(false);
    },
  );

  it('nothing new when history stands or went back; from where they part after a rewrite', async () => {
    const first = committed({ 'a.txt': '1\n' });
    const second = committed({ 'a.txt': '2\n' });
    expect(await changeSince(repo, second, second)).toEqual({
      base: second,
      head: second,
      commits: 0,
      files: [],
    });
    // Reset to an older commit: the checkout holds nothing the watch did not see.
    expect(await changeSince(repo, second, first)).toEqual({
      base: first,
      head: first,
      commits: 0,
      files: [],
    });
    // The last commit rewritten: counted from the commit both have.
    git('reset', '--quiet', '--hard', first);
    const rewritten = committed({ 'b.txt': 'x\n' });
    expect(await changeSince(repo, second, rewritten)).toEqual({
      base: first,
      head: rewritten,
      commits: 1,
      files: ['b.txt'],
    });
  });

  it('asks git nothing with a name that is not a commit, and says nothing of what it cannot compare', async () => {
    const first = committed({ 'a.txt': '1\n' });
    expect(await changeSince(repo, 'main', first)).toBeUndefined();
    expect(await changeSince(repo, first, '--output=/tmp/x')).toBeUndefined();
    expect(await changeSince(repo, commit(1), first)).toBeUndefined();
  });
});

// ── The watch ───────────────────────────────────────────────────

describe('the watch of a Directory (git and the clock in the test)', () => {
  const DIR = '/srv/app';
  let now: number;
  let head: CheckoutHead | undefined;
  let definitions: ChangeTriggerDefinition[];
  let unavailable: string | null;
  let workflowNames: Map<string, string>;
  let listed: Set<string>;
  /** What the next start answers; by default a run that is listed. */
  let answer: (() => { ok: true; crewId?: string } | { ok: false; reason: string }) | undefined;
  let started: Array<{ workflowId: string; directoryPath: string; change: ChangeSince }>;
  /** What git says changed: by default one commit touching one source file. */
  let compare: (since: string, to: string) => ChangeSince | undefined;
  let told: number;
  let triggers: ChangeTriggers;

  const trigger = (more: Partial<ChangeTriggerDefinition> = {}): ChangeTriggerDefinition => ({
    directory: DIR,
    workflow: 'change-review',
    settleSeconds: 20,
    maxRunsPerHour: 4,
    enabled: true,
    ...more,
  });
  const status = () => triggers.status().triggers[0];
  const seconds = (count: number): void => {
    now += count * 1000;
  };
  /** A new commit on the branch checked out. */
  const push = (n: number, branch = 'main'): void => {
    head = { commit: commit(n), branch };
  };

  beforeEach(() => {
    now = 1_000_000;
    head = { commit: commit(1), branch: 'main' };
    definitions = [trigger()];
    unavailable = null;
    workflowNames = new Map([['change-review', 'Change review']]);
    listed = new Set();
    answer = undefined;
    started = [];
    compare = (since, to) => ({ base: since, head: to, commits: 1, files: ['src/a.ts'] });
    told = 0;
    triggers = new ChangeTriggers({
      definitions: () => definitions,
      resolve: (directory) => ({ path: directory, name: path.basename(directory) }),
      git: {
        headOf: async () => head,
        changeSince: async (_directory, since, to) => compare(since, to),
      },
      unavailable: () => unavailable,
      workflowName: (id) => workflowNames.get(id),
      start: async (workflowId, directoryPath, change) => {
        started.push({ workflowId, directoryPath, change });
        if (answer) return answer();
        const crewId = `crew-${started.length}`;
        listed.add(crewId);
        return { ok: true, crewId };
      },
      isListed: (crewId) => listed.has(crewId),
      now: () => now,
      onChange: () => {
        told++;
      },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    triggers.dispose();
    vi.restoreAllMocks();
  });

  it('what the checkout holds when the watch begins is not a change', async () => {
    expect(triggers.status()).toEqual({
      triggers: [
        {
          directoryName: 'app',
          workflowId: 'change-review',
          workflowName: 'Change review',
          state: 'watching',
        },
      ],
      paused: false,
    });
    await triggers.tick();
    seconds(3600);
    await triggers.tick();
    expect(started).toEqual([]);
    expect(status().state).toBe('watching');
  });

  it('a new commit starts a run once it has stood for a while; commits that come together are one change', async () => {
    await triggers.tick();
    push(2);
    await triggers.tick();
    expect(status().state).toBe('settling');
    seconds(15);
    push(3);
    await triggers.tick();
    seconds(19);
    await triggers.tick();
    // The newest commit has not stood for 20 seconds yet.
    expect(started).toEqual([]);
    expect(status().state).toBe('settling');
    seconds(1);
    await triggers.tick();
    expect(started).toEqual([
      {
        workflowId: 'change-review',
        directoryPath: DIR,
        change: { base: commit(1), head: commit(3), commits: 1, files: ['src/a.ts'] },
      },
    ]);
    expect(status().state).toBe('running');
    // Handed to a run: not started again.
    seconds(600);
    await triggers.tick();
    expect(started).toHaveLength(1);
  });

  it('one run per Directory: later commits wait for it to leave the office, and are reviewed together', async () => {
    await triggers.tick();
    push(2);
    await triggers.tick();
    seconds(20);
    await triggers.tick();
    expect(started).toHaveLength(1);

    push(3);
    await triggers.tick();
    seconds(60);
    push(4);
    await triggers.tick();
    seconds(60);
    await triggers.tick();
    expect(started).toHaveLength(1);
    expect(status()).toMatchObject({
      state: 'waiting',
      note: expect.stringMatching(
        /^New commits wait for the review before them: stop that workflow/,
      ),
    });

    // The user read the report and stopped the run (or closed its lead).
    listed.clear();
    await triggers.tick();
    expect(started).toHaveLength(2);
    expect(started[1].change).toMatchObject({ base: commit(2), head: commit(4) });
    expect(status().state).toBe('running');
    listed.clear();
    await triggers.tick();
    expect(status().state).toBe('watching');
  });

  it('a start that fails is tried again later, not at every look', async () => {
    await triggers.tick();
    push(2);
    await triggers.tick();
    seconds(20);
    answer = () => ({ ok: false, reason: 'No Crew can be started now.' });
    await triggers.tick();
    expect(started).toHaveLength(1);
    expect(status()).toMatchObject({
      state: 'waiting',
      note: expect.stringMatching(/^A review could not be started/),
    });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('no run was started for a change: No Crew can be started now.'),
    );
    seconds(5);
    await triggers.tick();
    expect(started).toHaveLength(1);
    answer = undefined;
    seconds(CHANGE_TRIGGER_RETRY_MS / 1000);
    await triggers.tick();
    expect(started).toHaveLength(2);
    // The same change: nothing was handed to a run the first time.
    expect(started[1].change).toMatchObject({ base: commit(1), head: commit(2) });
  });

  it('starts no more runs in an hour than the trigger may', async () => {
    definitions = [trigger({ maxRunsPerHour: 2 })];
    await triggers.tick();
    for (const n of [2, 3]) {
      push(n);
      await triggers.tick();
      seconds(20);
      await triggers.tick();
      listed.clear();
    }
    expect(started).toHaveLength(2);
    push(4);
    await triggers.tick();
    seconds(20);
    await triggers.tick();
    expect(started).toHaveLength(2);
    expect(status()).toMatchObject({
      state: 'waiting',
      note: 'It started 2 reviews in the last hour, the most it may: the next one waits.',
    });
    seconds(CHANGE_TRIGGER_RATE_WINDOW_MS / 1000);
    await triggers.tick();
    expect(started).toHaveLength(3);
    expect(started[2].change).toMatchObject({ base: commit(3), head: commit(4) });
  });

  it('a change its Workflow has nothing to do for starts no run and is not looked at again', async () => {
    await triggers.tick();
    push(2);
    await triggers.tick();
    seconds(20);
    answer = () => ({ ok: true });
    await triggers.tick();
    expect(started).toHaveLength(1);
    expect(status().state).toBe('watching');
    seconds(600);
    await triggers.tick();
    expect(started).toHaveLength(1);
    // The next change is counted from there, and does not use up the hour's runs.
    answer = undefined;
    push(3);
    await triggers.tick();
    seconds(20);
    await triggers.tick();
    expect(started[1].change).toMatchObject({ base: commit(2), head: commit(3) });
  });

  it('nothing to read starts nothing: history that went back, or two commits git cannot compare', async () => {
    await triggers.tick();
    push(2);
    compare = (_since, to) => ({ base: to, head: to, commits: 0, files: [] });
    await triggers.tick();
    seconds(20);
    await triggers.tick();
    expect(started).toEqual([]);
    expect(status().state).toBe('watching');
    push(3);
    compare = () => undefined;
    await triggers.tick();
    seconds(20);
    await triggers.tick();
    expect(started).toEqual([]);
    // The watch goes on from where it stands.
    compare = (since, to) => ({ base: since, head: to, commits: 1, files: ['a'] });
    push(4);
    await triggers.tick();
    seconds(20);
    await triggers.tick();
    expect(started[0].change).toMatchObject({ base: commit(3), head: commit(4) });
  });

  it('watches the branches it names: another one, or none, reviews nothing, and the watch begins anew', async () => {
    definitions = [trigger({ branches: ['main', 'release/*'] })];
    await triggers.tick();
    push(2, 'feature/x');
    await triggers.tick();
    seconds(60);
    push(3, 'feature/x');
    await triggers.tick();
    seconds(60);
    await triggers.tick();
    expect(started).toEqual([]);
    expect(status()).toMatchObject({
      state: 'watching',
      note: 'The branch checked out here is not one this trigger watches.',
    });
    // Back on main, with what was merged meanwhile: where the watch begins.
    push(4, 'main');
    await triggers.tick();
    seconds(60);
    await triggers.tick();
    expect(started).toEqual([]);
    expect(status()).toEqual(expect.not.objectContaining({ note: expect.anything() }));
    // A branch it names, checked out with nothing new: the watch moves there.
    push(4, 'release/2');
    await triggers.tick();
    push(5, 'release/2');
    await triggers.tick();
    seconds(20);
    await triggers.tick();
    expect(started).toHaveLength(1);
    expect(started[0].change).toMatchObject({ base: commit(4), head: commit(5) });
    listed.clear();
    head = { commit: commit(6) };
    await triggers.tick();
    expect(status()).toMatchObject({
      state: 'watching',
      note: 'No branch is checked out here: nothing is reviewed until one is.',
    });
  });

  it('paused by the user, nothing starts; the watch begins anew at the resume', async () => {
    await triggers.tick();
    push(2);
    await triggers.tick();
    triggers.setPaused(true);
    expect(triggers.status()).toMatchObject({ paused: true, triggers: [{ state: 'paused' }] });
    seconds(60);
    await triggers.tick();
    expect(started).toEqual([]);
    triggers.setPaused(false);
    await triggers.tick();
    seconds(60);
    await triggers.tick();
    // What was committed while paused is not reviewed.
    expect(started).toEqual([]);
    expect(triggers.status()).toMatchObject({ paused: false, triggers: [{ state: 'watching' }] });
    push(3);
    await triggers.tick();
    seconds(20);
    await triggers.tick();
    expect(started[0].change).toMatchObject({ base: commit(2), head: commit(3) });
  });

  it('says why when it cannot watch, and begins anew once it can', async () => {
    await triggers.tick();
    unavailable = 'The Pixel Agents Office MCP is read-only in Settings.';
    push(2);
    await triggers.tick();
    expect(status()).toMatchObject({ state: 'problem', note: unavailable });
    unavailable = null;
    workflowNames.clear();
    await triggers.tick();
    expect(status()).toMatchObject({
      state: 'problem',
      workflowName: 'change-review',
      note: 'There is no workflow "change-review" on this host.',
    });
    workflowNames.set('change-review', 'Change review');
    head = undefined;
    await triggers.tick();
    expect(status()).toMatchObject({
      state: 'problem',
      note: 'This Directory is not the root of a git repository with a commit: there is nothing to watch.',
    });
    push(3);
    await triggers.tick();
    seconds(60);
    await triggers.tick();
    expect(started).toEqual([]);
    expect(status().state).toBe('watching');
  });

  it('lists the triggers that are switched on, and tells the offices only when something changed', async () => {
    definitions = [
      trigger(),
      trigger({ directory: '/srv/off', enabled: false }),
      trigger({ directory: '/srv/web', workflow: 'security-review' }),
    ];
    expect(triggers.status().triggers.map((entry) => entry.directoryName)).toEqual(['app', 'web']);
    await triggers.tick();
    // Told once: the second trigger names a Workflow the host does not have.
    expect(told).toBe(1);
    await triggers.tick();
    await triggers.tick();
    expect(told).toBe(1);
    push(2);
    await triggers.tick();
    expect(told).toBe(2);
    // Taken out of the file: no longer watched, no longer listed.
    definitions = [];
    await triggers.tick();
    expect(triggers.status().triggers).toEqual([]);
    expect(told).toBe(3);
  });

  it('never looks twice at once: a look asked for while one runs is that one', async () => {
    let asked = 0;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = new ChangeTriggers({
      definitions: () => definitions,
      resolve: (directory) => ({ path: directory, name: 'app' }),
      git: {
        headOf: async () => {
          asked++;
          await held;
          return head;
        },
        changeSince: async () => undefined,
      },
      unavailable: () => null,
      workflowName: () => 'Change review',
      start: async () => ({ ok: true }),
      isListed: () => false,
      now: () => now,
      onChange: () => {},
    });
    const first = slow.tick();
    const second = slow.tick();
    expect(second).toBe(first);
    release();
    await first;
    expect(asked).toBe(1);
    slow.dispose();
  });
});

// ── A run started for a change ──────────────────────────────────

describe('a Workflow run a change started', () => {
  let store: AgentStateStore;
  let crews: Crews;
  let workflows: Workflows;
  let launches: AgentLaunch[];
  let nextId: number;
  let unavailable: string | null;
  let paused: boolean[];

  const CHANGE = {
    base: commit(1),
    head: commit(2),
    commits: 2,
    files: ['src/a.ts', 'README.md'],
  };

  function join(crew?: AgentState['crew']): number {
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
      }),
    );
    return id;
  }

  beforeEach(() => {
    clearTestHome(PIXEL_AGENTS_DIR);
    fs.mkdirSync(path.join(os.homedir(), PIXEL_AGENTS_DIR), { recursive: true });
    fs.writeFileSync(
      path.join(os.homedir(), PIXEL_AGENTS_DIR, WORKFLOWS_FILE_NAME),
      JSON.stringify({
        workflows: [
          {
            id: 'review',
            name: 'Review',
            stages: [
              { id: 'scope', title: 'Scope', role: 'agile-project-manager' },
              { id: 'code', title: 'Code', role: 'developer', paths: ['!*.md', '!docs/'] },
              {
                id: 'security',
                title: 'Security',
                role: 'security-engineer',
                parallel: true,
                required: true,
                paths: ['!*.md', '!docs/'],
              },
              {
                id: 'infra',
                title: 'Infrastructure',
                role: 'cloud-engineer',
                parallel: true,
                required: true,
                paths: ['*.tf'],
              },
              { id: 'report', title: 'Report', role: 'agile-project-manager' },
            ],
          },
        ],
      }),
    );
    store = new AgentStateStore();
    launches = [];
    nextId = 1;
    unavailable = null;
    paused = [];
    crews = new Crews({ store, unavailable: () => unavailable });
    workflows = new Workflows({
      store,
      crews,
      unavailable: () => unavailable,
      launch: async (request: AgentLaunch): Promise<AgentLaunchOutcome> => {
        launches.push(request);
        return { ok: true, id: join(request.crew?.crew) };
      },
      changeTriggers: {
        status: () => ({
          triggers: [
            {
              directoryName: 'proj',
              workflowId: 'review',
              workflowName: 'Review',
              state: 'running',
            },
          ],
          paused: false,
        }),
        setPaused: (value) => {
          paused.push(value);
        },
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

  const run = () => workflows.statusMessage().runs[0];

  it("its request is the office's own words: commit names and counts, nothing a repository says", () => {
    expect(changeRequest({ ...CHANGE, files: 2 })).toBe(
      "Review the change in this Directory: 2 commits touching 2 files (0000000000..0000000000). Started by the office's change trigger, not typed by the user.",
    );
    expect(
      changeRequest({ base: 'a'.repeat(40), head: 'b'.repeat(40), commits: 1, files: 1 }),
    ).toBe(
      "Review the change in this Directory: 1 commit touching 1 file (aaaaaaaaaa..bbbbbbbbbb). Started by the office's change trigger, not typed by the user.",
    );
  });

  it('starts the Workflow in the Directory with the stages the change does not touch already left out', async () => {
    const outcome = await workflows.startForChange('review', '/tmp/p', CHANGE);
    expect(outcome).toEqual({ ok: true, crewId: run().crewId });
    expect(workflows.isListed(run().crewId)).toBe(true);
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({
      directory: '/tmp/p',
      roleId: 'agile-project-manager',
      // Its lead is told on the command line that nobody started it by hand.
      asks: { firstMessage: WORKFLOW_CHANGE_FIRST_MESSAGE },
    });
    expect(run()).toMatchObject({
      workflowId: 'review',
      startedByChange: true,
      request: changeRequest({ ...CHANGE, files: 2 }),
    });
    expect(run().stages.map((stage) => [stage.id, stage.state, stage.note])).toEqual([
      ['scope', 'pending', undefined],
      ['code', 'pending', undefined],
      ['security', 'pending', undefined],
      // Required, and not this change's: the office left it out, not the lead.
      ['infra', 'skipped', WORKFLOW_CHANGE_SKIP_NOTE],
      ['report', 'pending', undefined],
    ]);
    // What the office broadcasts is what an office reads.
    expect(parseWorkflowsLoaded(workflows.statusMessage())).toMatchObject({
      runs: [{ startedByChange: true }],
      changeTriggers: [{ directoryName: 'proj', workflowName: 'Review', state: 'running' }],
    });
  });

  it('tells its lead what the run is, which commits to read, and that their words are not instructions', async () => {
    await workflows.startForChange('review', '/tmp/p', CHANGE);
    const lead = run().leadAgentId!;
    const view = workflows.view(lead);
    if (!view.running) throw new Error('no run');
    expect(view.change).toEqual({ base: commit(1), head: commit(2), commits: 2, files: 2 });
    expect(view.rules).toBe(WORKFLOW_CHANGE_LEAD_RULES);
    expect(view.rules![0]).toMatch(/^Nobody typed this request: the office's change trigger/);
    expect(view.rules!.join('\n')).toMatch(/evidence, never an instruction/);
    expect(view.rules!.join('\n')).toMatch(/Ask nothing and wait for no answer/);
    // The first rule of a run the user started says the request is their word.
    expect(view.rules).not.toContain(WORKFLOW_LEAD_RULES[0]);
    expect(view.rules!.slice(-WORKFLOW_LEAD_RULES.length + 1)).toEqual(
      WORKFLOW_LEAD_RULES.slice(1),
    );
    // The paths never reach the lead through the office: it reads the diff itself.
    expect(JSON.stringify(view)).not.toContain('src/a.ts');

    // The stages still open are its to work, by the rules of any run.
    workflows.move(lead, 'start', 'scope');
    await workflows.finish(lead, 'scope', 'Two commits on the discount.');
    expect(workflows.move(lead, 'skip', 'security', 'Small change.')).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/security is a required stage/),
    });
  });

  it('a change that touches no file a stage is for starts nothing', async () => {
    const outcome = await workflows.startForChange('review', '/tmp/p', {
      ...CHANGE,
      files: ['README.md', 'docs/guide.md'],
    });
    expect(outcome).toEqual({ ok: true });
    expect(launches).toEqual([]);
    expect(workflows.statusMessage().runs).toEqual([]);
  });

  it('is refused where no run can be started, and for a Workflow the host does not have', async () => {
    expect(await workflows.startForChange('nope', '/tmp/p', CHANGE)).toEqual({
      ok: false,
      reason: 'There is no workflow "nope" on this host.',
    });
    unavailable = 'The Pixel Agents Office MCP is read-only in Settings.';
    expect(await workflows.startForChange('review', '/tmp/p', CHANGE)).toEqual({
      ok: false,
      reason: unavailable,
    });
    expect(launches).toEqual([]);
  });

  it('the same Workflow started by the user has every stage, and their request', async () => {
    const outcome = await workflows.start({
      workflowId: 'review',
      directoryPath: '/tmp/p',
      request: 'Review the last two commits.',
    });
    expect(outcome.ok).toBe(true);
    expect(run().startedByChange).toBeUndefined();
    expect(run().stages.every((stage) => stage.state === 'pending')).toBe(true);
    const view = workflows.view(run().leadAgentId!);
    if (!view.running) throw new Error('no run');
    expect(view.change).toBeUndefined();
    expect(view.rules).toBe(WORKFLOW_LEAD_RULES);
    // Stopped: no longer in the office.
    const { crewId } = run();
    workflows.stop(crewId);
    expect(workflows.isListed(crewId)).toBe(false);
  });

  it("the user's pause reaches the watch; anything but true or false does not", () => {
    const reply = vi.fn();
    expect(workflows.handleMessage({ type: 'setChangeTriggersPaused', paused: true }, reply)).toBe(
      true,
    );
    workflows.handleMessage({ type: 'setChangeTriggersPaused', paused: 'yes' }, reply);
    workflows.handleMessage({ type: 'setChangeTriggersPaused', paused: false }, reply);
    expect(paused).toEqual([true, false]);
    expect(reply).not.toHaveBeenCalled();
  });
});
