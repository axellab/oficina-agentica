/**
 * Roles: the named parts in the software lifecycle an agent can be launched as
 * (Architect, Developer, QA Engineer, ...). A Role gives its agent standing
 * instructions and gives the office a name and a colour to mark it with.
 *
 * Pure data and validation, safe on both sides of the wire. The catalog itself
 * (the built-in Roles and the host's own roles.json) is the server's; the wire
 * carries only what the office shows (`Role`, `AgentRole`), never a prompt.
 */

import { isRecord } from './isRecord.js';
import type { AgentRole, Role, RoleColor, RoleSource } from './messages.js';

export type { AgentRole, Role, RoleColor, RoleSource };

/** A Role as the catalog holds it: what the office shows plus what the host
 *  applies at launch. */
export interface RoleDefinition {
  /** Permanent id: what a launch names and what an agent's saved state keeps. */
  id: string;
  name: string;
  description: string;
  color: RoleColor;
  /** The Role's standing instructions, added to the coding agent's own. */
  prompt: string;
  /** The model agents of this Role run on, in the CLI's own names and aliases.
   *  Absent = whatever the CLI would use. */
  model?: string;
}

/** A catalog entry with where it came from. */
export type CatalogRole = RoleDefinition & { source: RoleSource };

/** One entry of the host's roles.json: a whole new Role, or the fields of a
 *  built-in Role (same id) it replaces. */
export type RoleOverride = Pick<RoleDefinition, 'id'> & Partial<Omit<RoleDefinition, 'id'>>;

/** Every colour name a Role can take. Pinned to the contract's `RoleColor` by
 *  the check below. */
export const ROLE_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
  'pink',
  'gray',
] as const satisfies readonly RoleColor[];

// Compile-time: a colour added to the contract must be listed above.
type MissingRoleColor = Exclude<RoleColor, (typeof ROLE_COLORS)[number]>;
const allRoleColorsListed: MissingRoleColor extends never ? true : never = true;
void allRoleColorsListed;

/** The colour of a Role that names none. */
export const DEFAULT_ROLE_COLOR: RoleColor = 'gray';

/** Lower-case letters, digits and hyphens, starting with a letter: an id is
 *  also a file name (the Role's prompt file), so nothing a path could read. */
export const ROLE_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
/** A model name becomes a CLI argument: never a leading `-` (a flag), never a
 *  space or a shell metacharacter. */
const ROLE_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,63}$/;

/** Upper bound on roles.json entries, so a runaway file can't flood the drawer. */
export const MAX_ROLE_OVERRIDES = 50;
export const MAX_ROLE_NAME_CHARS = 40;
export const MAX_ROLE_DESCRIPTION_CHARS = 200;
export const MAX_ROLE_PROMPT_CHARS = 20_000;

export const isRoleId = (value: unknown): value is string =>
  typeof value === 'string' && ROLE_ID_RE.test(value);

const isRoleColor = (value: unknown): value is RoleColor =>
  typeof value === 'string' && (ROLE_COLORS as readonly string[]).includes(value);

/** One line of text: trimmed, non-empty, within `max`, no control characters. */
function lineOf(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (text.length === 0 || text.length > max) return undefined;
  return /[\u0000-\u001f\u007f]/.test(text) ? undefined : text;
}

/** A prompt: one string, or lines to join (JSON has no multi-line strings). */
function promptOf(value: unknown): string | undefined {
  const text =
    Array.isArray(value) && value.every((line) => typeof line === 'string')
      ? value.join('\n')
      : value;
  if (typeof text !== 'string') return undefined;
  const prompt = text.trim();
  return prompt.length > 0 && prompt.length <= MAX_ROLE_PROMPT_CHARS ? prompt : undefined;
}

const OVERRIDE_KEYS = new Set(['id', 'name', 'description', 'color', 'prompt', 'model']);

/** One roles.json entry, checked field by field: the entry, or why not. */
function parseRoleOverride(value: unknown): RoleOverride | string {
  if (!isRecord(value)) return 'not an object';
  if (!isRoleId(value.id)) {
    return 'its "id" must be lower-case letters, digits and hyphens, starting with a letter';
  }
  const unknown = Object.keys(value).find((key) => !OVERRIDE_KEYS.has(key));
  if (unknown !== undefined) return `unknown field "${unknown}"`;

  const entry: RoleOverride = { id: value.id };
  if (value.name !== undefined) {
    const name = lineOf(value.name, MAX_ROLE_NAME_CHARS);
    if (name === undefined) return `"name" must be 1-${MAX_ROLE_NAME_CHARS} characters on one line`;
    entry.name = name;
  }
  if (value.description !== undefined) {
    const description = lineOf(value.description, MAX_ROLE_DESCRIPTION_CHARS);
    if (description === undefined) {
      return `"description" must be 1-${MAX_ROLE_DESCRIPTION_CHARS} characters on one line`;
    }
    entry.description = description;
  }
  if (value.color !== undefined) {
    if (!isRoleColor(value.color)) return `"color" must be one of: ${ROLE_COLORS.join(', ')}`;
    entry.color = value.color;
  }
  if (value.prompt !== undefined) {
    const prompt = promptOf(value.prompt);
    if (prompt === undefined) {
      return `"prompt" must be text (or a list of lines) of 1-${MAX_ROLE_PROMPT_CHARS} characters`;
    }
    entry.prompt = prompt;
  }
  if (value.model !== undefined) {
    if (typeof value.model !== 'string' || !ROLE_MODEL_RE.test(value.model)) {
      return '"model" must be a model name or alias (letters, digits, . _ : - [ ])';
    }
    entry.model = value.model;
  }
  return entry;
}

/** What a roles.json holds: the entries that passed, and one line per problem
 *  (for the host's log: a hand-edited file should say what is wrong with it). */
export interface ParsedRoleOverrides {
  overrides: RoleOverride[];
  problems: string[];
}

/**
 * The entries of a roles.json (`{ "roles": [ ... ] }`). Lenient per entry: one
 * bad entry is left out and reported, the rest still load. An id listed twice
 * keeps its first entry.
 */
export function parseRoleOverrides(value: unknown): ParsedRoleOverrides {
  if (!isRecord(value) || !Array.isArray(value.roles)) {
    return { overrides: [], problems: ['expected an object with a "roles" list'] };
  }
  const overrides: RoleOverride[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  const entries: unknown[] = value.roles;
  if (entries.length > MAX_ROLE_OVERRIDES) {
    problems.push(`only the first ${MAX_ROLE_OVERRIDES} roles are read`);
  }
  entries.slice(0, MAX_ROLE_OVERRIDES).forEach((raw, index) => {
    const entry = parseRoleOverride(raw);
    if (typeof entry === 'string') {
      problems.push(`roles[${index}]: ${entry}`);
    } else if (seen.has(entry.id)) {
      problems.push(`roles[${index}]: "${entry.id}" is listed twice; the first one is used`);
    } else {
      seen.add(entry.id);
      overrides.push(entry);
    }
  });
  return { overrides, problems };
}

/** The catalog: the built-in Roles in their order, each with its roles.json
 *  entry laid over it, then the Roles roles.json adds, in its order. */
export interface MergedRoleCatalog {
  roles: CatalogRole[];
  problems: string[];
}

export function mergeRoleCatalog(
  builtin: readonly RoleDefinition[],
  overrides: readonly RoleOverride[],
): MergedRoleCatalog {
  const byId = new Map(overrides.map((entry) => [entry.id, entry]));
  const problems: string[] = [];
  const roles: CatalogRole[] = builtin.map((role) => {
    const override = byId.get(role.id);
    byId.delete(role.id);
    return override ? { ...role, ...override, source: 'user' } : { ...role, source: 'builtin' };
  });
  // What is left names no built-in Role: each is a Role of its own, and must
  // say at least what it is called and what it is told.
  for (const entry of byId.values()) {
    if (entry.name === undefined || entry.prompt === undefined) {
      problems.push(`"${entry.id}": a new role needs a "name" and a "prompt"`);
      continue;
    }
    roles.push({
      id: entry.id,
      name: entry.name,
      description: entry.description ?? '',
      color: entry.color ?? DEFAULT_ROLE_COLOR,
      prompt: entry.prompt,
      model: entry.model,
      source: 'user',
    });
  }
  return { roles, problems };
}

/** A catalog Role as the office lists it (no prompt, no model). */
export function roleListing(role: CatalogRole): Role {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    color: role.color,
    source: role.source,
  };
}

/** What an agent launched as `role` carries for its life. */
export function agentRoleOf(role: RoleDefinition): AgentRole {
  return { id: role.id, name: role.name, color: role.color };
}

/**
 * A catalog Role as the office is told it (`rolesLoaded`), or undefined when
 * it is not one. Built on parseAgentRole, so both readings agree on what a
 * Role's id, name and colour may be.
 */
export function parseRoleListing(value: unknown): Role | undefined {
  const role = parseAgentRole(value);
  if (!role || !isRecord(value)) return undefined;
  return {
    ...role,
    description: typeof value.description === 'string' ? value.description : '',
    source: value.source === 'user' ? 'user' : 'builtin',
  };
}

/**
 * An agent's Role as read back from saved state or off the wire, or undefined
 * when it is absent or not one. The ONE reader: the server's restore and the
 * office's message handling both go through it.
 */
export function parseAgentRole(value: unknown): AgentRole | undefined {
  if (!isRecord(value) || !isRoleId(value.id)) return undefined;
  const name = lineOf(value.name, MAX_ROLE_NAME_CHARS);
  if (name === undefined) return undefined;
  return { id: value.id, name, color: isRoleColor(value.color) ? value.color : DEFAULT_ROLE_COLOR };
}
