/**
 * The Workflow catalog of this host: the built-in Workflows with the host's
 * workflows.json laid over them (an entry there replaces the built-in Workflow
 * of the same id whole, or adds one).
 *
 * workflows.json is the user's file: read, never written. Like roles.json it
 * is re-read whenever it changed on disk (path + mtime + size), and the
 * catalog is rebuilt whenever the Role catalog was (a Workflow naming a Role
 * this host does not have is left out, and logged), so an edit applies to the
 * next start and the next office that connects, with no watcher to run.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { Workflow } from '../../../core/src/messages.js';
import type { CatalogRole } from '../../../core/src/roles.js';
import {
  type CatalogWorkflow,
  mergeWorkflowCatalog,
  parseWorkflows,
} from '../../../core/src/workflows.js';
import { PIXEL_AGENTS_DIR, WORKFLOWS_FILE_NAME } from '../constants.js';
import { roleCatalog } from '../roles/roleCatalog.js';
import { BUILTIN_WORKFLOWS } from './builtinWorkflows.js';

const LOG_PREFIX = '[Pixel Agents] Workflows:';

function workflowsFilePath(): string {
  return path.join(os.homedir(), PIXEL_AGENTS_DIR, WORKFLOWS_FILE_NAME);
}

/** What the file was last read as: its path and, when it exists, its mtime
 *  and size. A different $HOME (tests) is a different key. */
function fileKey(file: string): string {
  try {
    const stat = fs.statSync(file);
    return `${file}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return file;
  }
}

/** The host's own entries. Everything wrong with the file is logged once per
 *  read (it is the user's hand-edited file) and left out. */
function readOwn(file: string): ReturnType<typeof parseWorkflows>['workflows'] {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`${LOG_PREFIX} cannot read ${WORKFLOWS_FILE_NAME}:`, err);
    }
    return [];
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} ${WORKFLOWS_FILE_NAME} is not valid JSON and was ignored (${String(err)})`,
    );
    return [];
  }
  const parsed = parseWorkflows(raw);
  for (const problem of parsed.problems) {
    console.warn(`${LOG_PREFIX} ${WORKFLOWS_FILE_NAME}: ${problem}`);
  }
  return parsed.workflows;
}

let cached: {
  key: string;
  /** The Role catalog it was checked against (rebuilt when roles.json changes). */
  roles: readonly CatalogRole[];
  workflows: readonly CatalogWorkflow[];
} | null = null;

/** Every Workflow a run can be started from on this host, in the order the
 *  office lists them. */
export function workflowCatalog(): readonly CatalogWorkflow[] {
  const file = workflowsFilePath();
  const key = fileKey(file);
  const roles = roleCatalog();
  if (cached?.key !== key || cached.roles !== roles) {
    const merged = mergeWorkflowCatalog(
      BUILTIN_WORKFLOWS,
      readOwn(file),
      new Set(roles.map((role) => role.id)),
    );
    for (const problem of merged.problems) console.warn(`${LOG_PREFIX} ${problem}`);
    cached = { key, roles, workflows: merged.workflows };
  }
  return cached.workflows;
}

/** The name of the Role `roleId`, as the office and the agents read it. */
export function roleNameOf(roleId: string): string {
  return roleCatalog().find((role) => role.id === roleId)?.name ?? roleId;
}

/** A catalog Workflow as the office lists it: no brief, Roles by name. */
export function workflowListing(workflow: CatalogWorkflow): Workflow {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    source: workflow.source,
    leadRoleName: roleNameOf(workflow.lead),
    stages: workflow.stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      roleName: roleNameOf(stage.role),
      ...(stage.parallel ? { parallel: true } : {}),
    })),
  };
}
