/**
 * The Role catalog of this host: the built-in Roles with the host's roles.json
 * laid over them, and the one step that turns a picked Role into a launch.
 *
 * roles.json is the user's file: read, never written. It is re-read whenever
 * it changed on disk (path + mtime + size), so an edit applies to the next
 * launch and the next office that connects, with no watcher to run.
 *
 * A Role reaches the coding agent as a FILE (role-prompts/<id>.md), named on
 * the command line: the instructions are long, and both surfaces must launch
 * the same command -- VS Code types it into the user's shell, where a
 * multi-line argument would need quoting per shell.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { RolesLoaded } from '../../../core/src/messages.js';
import {
  type AgentRole,
  agentRoleOf,
  type CatalogRole,
  isRoleId,
  mergeRoleCatalog,
  parseRoleOverrides,
  roleListing,
} from '../../../core/src/roles.js';
import {
  CREW_PROMPT_FILE_STEM,
  PIXEL_AGENTS_DIR,
  ROLE_PROMPTS_DIR_NAME,
  ROLES_FILE_NAME,
} from '../constants.js';
import { BUILTIN_ROLES } from './builtinRoles.js';
import { composeCrewPrompt, composeRolePrompt, type CrewTerms } from './rolePrompt.js';

const LOG_PREFIX = '[Pixel Agents] Roles:';

function rolesFilePath(): string {
  return path.join(os.homedir(), PIXEL_AGENTS_DIR, ROLES_FILE_NAME);
}

function rolePromptsDir(): string {
  return path.join(os.homedir(), PIXEL_AGENTS_DIR, ROLE_PROMPTS_DIR_NAME);
}

/** What the catalog was last built from: the file's path and, when it exists,
 *  its mtime and size. A different $HOME (tests) is a different key. */
function rolesFileKey(file: string): string {
  try {
    const stat = fs.statSync(file);
    return `${file}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return file;
  }
}

let cached: { key: string; roles: readonly CatalogRole[] } | null = null;

/** The built-in Roles alone: what a host with no (usable) roles.json has. */
function builtinCatalog(): CatalogRole[] {
  return mergeRoleCatalog(BUILTIN_ROLES, []).roles;
}

/** The catalog as roles.json makes it. Everything wrong with the file is
 *  logged once per read (it is the user's hand-edited file) and left out. */
function readCatalog(file: string): CatalogRole[] {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`${LOG_PREFIX} cannot read ${ROLES_FILE_NAME}:`, err);
    }
    return builtinCatalog();
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} ${ROLES_FILE_NAME} is not valid JSON and was ignored (${String(err)})`,
    );
    return builtinCatalog();
  }
  const parsed = parseRoleOverrides(raw);
  const merged = mergeRoleCatalog(BUILTIN_ROLES, parsed.overrides);
  for (const problem of [...parsed.problems, ...merged.problems]) {
    console.warn(`${LOG_PREFIX} ${ROLES_FILE_NAME}: ${problem}`);
  }
  return merged.roles;
}

/** Every Role an agent can be launched as on this host, in the order the
 *  office lists them. */
export function roleCatalog(): readonly CatalogRole[] {
  const file = rolesFilePath();
  const key = rolesFileKey(file);
  if (cached?.key !== key) cached = { key, roles: readCatalog(file) };
  return cached.roles;
}

/** The catalog as the office is told it: no prompt, no model. Part of the
 *  `webviewReady` handshake on both surfaces. */
export function rolesLoadedMessage(): RolesLoaded {
  return { type: 'rolesLoaded', roles: roleCatalog().map(roleListing) };
}

/**
 * Write a launch's instructions where the coding agent reads them
 * (`<stem>.md`), and return the path. Rewritten only when the text changed;
 * atomically (tmp + rename), since an agent launching at that moment reads it.
 * Owner-only: a host's own Roles may say things about its systems.
 */
function writePrompt(stem: string, prompt: string): string {
  const dir = rolePromptsDir();
  const file = path.join(dir, `${stem}.md`);
  const text = `${prompt}\n`;
  try {
    if (fs.readFileSync(file, 'utf-8') === text) return file;
  } catch {
    // Not written yet (or unreadable): write it.
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  return file;
}

/**
 * The file holding the instructions of `role`: `<id>.md`, or, for an agent of
 * a Crew, `<id>.crew.md` (a file of its own, so a Crew's launch and a plain
 * one of the same Role never rewrite each other's; a Role id holds no dot).
 */
function writeRolePrompt(
  role: CatalogRole,
  catalog: readonly CatalogRole[],
  crew?: CrewTerms,
): string {
  return writePrompt(crew ? `${role.id}.crew` : role.id, composeRolePrompt(role, catalog, crew));
}

/** What launching an agent as a Role adds to the launch. */
export interface RoleLaunch {
  /** What the agent carries for its life, and the office shows. */
  role: AgentRole;
  /** The file holding the Role's instructions (`buildLaunchCommand`'s
   *  `appendSystemPromptFile`). */
  appendSystemPromptFile: string;
  /** The model the Role runs on, when it names one. */
  model?: string;
}

/**
 * A launch as the Role `roleId` names, or undefined for a launch with no Role:
 * none was asked for, the id names no Role of this host (a client's stale
 * list, a Role since deleted from roles.json that a resumed conversation
 * remembers), or its instructions could not be written. The last two are
 * logged; the agent still launches, plainly without a Role, which the office
 * shows -- refusing the launch would show nothing at all. With `crew`, the
 * instructions are the ones of that Role in a Crew.
 */
export function prepareRoleLaunch(roleId: unknown, crew?: CrewTerms): RoleLaunch | undefined {
  if (roleId === undefined || roleId === null) return undefined;
  if (!isRoleId(roleId)) {
    console.warn(`${LOG_PREFIX} launch named an invalid role id; launching without a role`);
    return undefined;
  }
  const catalog = roleCatalog();
  const role = catalog.find((candidate) => candidate.id === roleId);
  if (!role) {
    console.warn(`${LOG_PREFIX} no role "${roleId}" on this host; launching without a role`);
    return undefined;
  }
  try {
    const launch: RoleLaunch = {
      role: agentRoleOf(role),
      appendSystemPromptFile: writeRolePrompt(role, catalog, crew),
    };
    if (role.model !== undefined) launch.model = role.model;
    return launch;
  } catch (err) {
    console.error(
      `${LOG_PREFIX} cannot write the instructions of "${roleId}"; launching without a role:`,
      err,
    );
    return undefined;
  }
}

/**
 * The instructions of a Crew's agent launched with no Role (the charter and
 * the Crew's terms), written where the coding agent reads them: the path, or
 * undefined when they could not be written (logged; the agent still launches
 * and the server still holds it to the Crew's limits, it is only not told them).
 */
export function prepareCrewPrompt(crew: CrewTerms): string | undefined {
  try {
    return writePrompt(CREW_PROMPT_FILE_STEM, composeCrewPrompt(roleCatalog(), crew));
  } catch (err) {
    console.error(`${LOG_PREFIX} cannot write a Crew's instructions:`, err);
    return undefined;
  }
}
