/**
 * The built-in Roles as they ship: one folder per Role (roles/<role id>/ in
 * the repository, dist/assets/roles/ in a build), read once. A folder holds
 * the Role's definition, its Contract, its Playbooks and the Workflows it
 * leads, each a Markdown file (kitFormat.ts says what each must look like).
 *
 * Lenient like roles.json: a file with a mistake is left out and reported, and
 * the rest still load. The shipped folders are held to "no problem at all" by
 * test (roleKits.test.ts), so a problem here means a build that lost a file or
 * a checkout someone is editing.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  isRoleId,
  MAX_ROLE_PLAYBOOKS,
  type PlaybookDefinition,
  type RoleDefinition,
} from '../../../core/src/roles.js';
import {
  DEFAULT_WORKFLOW_LEAD,
  isWorkflowId,
  type WorkflowDefinition,
} from '../../../core/src/workflows.js';
import { ROLE_KITS_DIST_DIR } from '../constants.js';
import {
  type KitPlaybook,
  type KitWorkflow,
  parseContract,
  parsePlaybookFile,
  parseRoleFile,
  parseWorkflowFile,
} from './kitFormat.js';

const LOG_PREFIX = '[Pixel Agents] Roles:';

export const ROLE_FILE = 'ROLE.md';
export const CONTRACT_FILE = 'CONTRACT.md';
export const PLAYBOOKS_DIR = 'playbooks';
export const WORKFLOWS_DIR = 'workflows';

/** The repository's folder of Roles, from a checkout's root. */
const SOURCE_DIR = 'roles';

/** What the Roles' folders hold. */
export interface RoleKits {
  /** The Roles, in the order the office lists them. */
  roles: RoleDefinition[];
  /** The Workflows the Roles lead: the coordinator's first, then each Role's
   *  in the Roles' order. */
  workflows: WorkflowDefinition[];
  /** One line per file left out, and why. */
  problems: string[];
}

/** Whether `dir` holds at least one Role's folder. */
function holdsRoles(dir: string): boolean {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .some((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, ROLE_FILE)));
  } catch {
    return false;
  }
}

/**
 * The folder holding the Roles: beside the bundle (dist/, where __dirname is
 * for dist/cli.js and dist/extension.js alike), else the repository's own
 * folder, from server/src/roles (tests, runs from source) or from dist/ in a
 * checkout whose build did not copy it (watch mode). Null when none has one.
 */
export function findRoleKitsDir(): string | null {
  const candidates = [
    path.join(__dirname, ROLE_KITS_DIST_DIR),
    path.resolve(__dirname, '..', '..', '..', SOURCE_DIR),
    path.resolve(__dirname, '..', SOURCE_DIR),
  ];
  return candidates.find(holdsRoles) ?? null;
}

/** The Markdown files of `dir` as [id, text], by id; none when it has no such folder. */
function markdownFiles(dir: string, problems: string[], where: string): [string, string][] {
  let names: string[];
  try {
    names = fs.readdirSync(dir).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      problems.push(`${where}: cannot be read (${String(err)})`);
    }
    return [];
  }
  const files: [string, string][] = [];
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const id = name.slice(0, -'.md'.length);
    if (!isWorkflowId(id)) {
      problems.push(
        `${where}/${name}: its name must be lower-case letters, digits and hyphens, starting with a letter`,
      );
      continue;
    }
    try {
      files.push([id, fs.readFileSync(path.join(dir, name), 'utf-8')]);
    } catch (err) {
      problems.push(`${where}/${name}: cannot be read (${String(err)})`);
    }
  }
  return files;
}

/** One Role's folder: the Role with its Contract and Playbooks, and its Workflows. */
function readRoleFolder(
  dir: string,
  id: string,
  problems: string[],
): { role: RoleDefinition; order: number; workflows: KitWorkflow[] } | null {
  let text: string;
  try {
    text = fs.readFileSync(path.join(dir, ROLE_FILE), 'utf-8');
  } catch (err) {
    // A folder with no ROLE.md is not a Role's (a README, a shared folder).
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      problems.push(`${id}/${ROLE_FILE}: cannot be read (${String(err)})`);
    }
    return null;
  }
  const parsed = parseRoleFile(id, text);
  if (typeof parsed === 'string') {
    problems.push(`${id}/${ROLE_FILE}: ${parsed}`);
    return null;
  }
  const { role, order } = parsed;

  try {
    const contract = parseContract(fs.readFileSync(path.join(dir, CONTRACT_FILE), 'utf-8'));
    if (typeof contract === 'string') problems.push(`${id}/${CONTRACT_FILE}: ${contract}`);
    else role.contract = contract.contract;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      problems.push(`${id}/${CONTRACT_FILE}: cannot be read (${String(err)})`);
    }
  }

  const playbooks: KitPlaybook[] = [];
  const playbooksAt = `${id}/${PLAYBOOKS_DIR}`;
  for (const [playbookId, file] of markdownFiles(
    path.join(dir, PLAYBOOKS_DIR),
    problems,
    playbooksAt,
  )) {
    const playbook = parsePlaybookFile(playbookId, file);
    if (typeof playbook === 'string') {
      problems.push(`${playbooksAt}/${playbookId}.md: ${playbook}`);
    } else if (playbooks.length === MAX_ROLE_PLAYBOOKS) {
      problems.push(
        `${playbooksAt}/${playbookId}.md: a role has at most ${MAX_ROLE_PLAYBOOKS} playbooks`,
      );
    } else {
      playbooks.push(playbook);
    }
  }
  if (playbooks.length > 0) {
    role.playbooks = inOrder(
      playbooks,
      (entry) => entry.order,
      (entry) => entry.playbook.id,
    ).map((entry): PlaybookDefinition => entry.playbook);
  }

  const workflows: KitWorkflow[] = [];
  const workflowsAt = `${id}/${WORKFLOWS_DIR}`;
  for (const [workflowId, file] of markdownFiles(
    path.join(dir, WORKFLOWS_DIR),
    problems,
    workflowsAt,
  )) {
    const workflow = parseWorkflowFile(workflowId, id, file);
    if (typeof workflow === 'string') problems.push(`${workflowsAt}/${workflowId}.md: ${workflow}`);
    else workflows.push(workflow);
  }
  return { role, order, workflows };
}

/** By `order`, then by id: the order never depends on how a folder is listed. */
function inOrder<T>(entries: T[], order: (entry: T) => number, id: (entry: T) => string): T[] {
  return [...entries].sort(
    (a, b) => order(a) - order(b) || (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0),
  );
}

/** Everything the Roles' folders under `dir` hold. */
export function readRoleKits(dir: string): RoleKits {
  const problems: string[] = [];
  let names: string[];
  try {
    names = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (err) {
    return { roles: [], workflows: [], problems: [`${dir}: cannot be read (${String(err)})`] };
  }
  const folders: NonNullable<ReturnType<typeof readRoleFolder>>[] = [];
  for (const name of names) {
    if (!isRoleId(name)) {
      problems.push(
        `${name}: a role's folder is named by its id (lower-case letters, digits and hyphens)`,
      );
      continue;
    }
    const folder = readRoleFolder(path.join(dir, name), name, problems);
    if (folder) folders.push(folder);
  }
  const ordered = inOrder(
    folders,
    (folder) => folder.order,
    (folder) => folder.role.id,
  );

  // The coordinator's Workflows are the ones a request usually starts from:
  // they are listed first, then each Role's own.
  const leads = [
    ...ordered.filter((folder) => folder.role.id === DEFAULT_WORKFLOW_LEAD),
    ...ordered.filter((folder) => folder.role.id !== DEFAULT_WORKFLOW_LEAD),
  ];
  const workflows: WorkflowDefinition[] = [];
  const seen = new Set<string>();
  for (const folder of leads) {
    const own = inOrder(
      folder.workflows,
      (entry) => entry.order,
      (entry) => entry.workflow.id,
    );
    for (const { workflow } of own) {
      if (seen.has(workflow.id)) {
        problems.push(
          `${folder.role.id}/${WORKFLOWS_DIR}/${workflow.id}.md: another role already has a workflow "${workflow.id}"`,
        );
        continue;
      }
      seen.add(workflow.id);
      workflows.push(workflow);
    }
  }
  return { roles: ordered.map((folder) => folder.role), workflows, problems };
}

let builtin: RoleKits | null = null;

/** The built-in Roles and the Workflows they lead, read once per process. */
export function builtinRoleKits(): RoleKits {
  if (builtin) return builtin;
  const dir = findRoleKitsDir();
  if (!dir) {
    console.error(`${LOG_PREFIX} the built-in roles were not found beside this build`);
    builtin = { roles: [], workflows: [], problems: ['the built-in roles were not found'] };
    return builtin;
  }
  builtin = readRoleKits(dir);
  for (const problem of builtin.problems) console.warn(`${LOG_PREFIX} ${problem}`);
  return builtin;
}
