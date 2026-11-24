/**
 * Checks, pure (CONTEXT.md "Check"): the commands the office itself runs to
 * close a stage of a Workflow run, as the user's own checks.json states them.
 *
 * A stage names its Check by id (`tests`, `security-scan`); the file says what
 * that means on this host, for every Directory or for one. Data and
 * validation only: which entry a Directory gets and the running are the
 * server's (server/src/workflows/checkCatalog.ts, checkRunner.ts). No agent
 * and no repository ever supplies a command.
 */

import { isRecord } from './isRecord.js';
import { isRoleId } from './roles.js';

/** One Check, as the file states it. */
export interface CheckDefinition {
  /** What a stage names (`check`): the same shape as a Workflow's id. */
  id: string;
  /** What the office and the agents call it (absent in the file = its id). */
  name: string;
  /** The command line, run by the host's shell in the folder under check.
   *  Passed = it exits with 0. */
  command: string;
  /** The Directory it is for, as the user wrote it (a path, `~` allowed);
   *  absent = every Directory that has no entry of its own for this id. */
  directory?: string;
  /** How long it may run before the office ends it and counts it failed. */
  timeoutSeconds: number;
}

/** A Check's id: lower-case letters, digits and hyphens, starting with a letter. */
export const isCheckId = isRoleId;

/** Upper bounds, so a runaway file can't flood a lead's context or run for ever. */
export const MAX_CHECKS = 100;
export const MAX_CHECK_NAME_CHARS = 40;
export const MAX_CHECK_COMMAND_CHARS = 1000;
export const MAX_CHECK_DIRECTORY_CHARS = 1024;
export const CHECK_DEFAULT_TIMEOUT_SECONDS = 600;
export const CHECK_MAX_TIMEOUT_SECONDS = 3600;

const CHECK_KEYS = new Set(['id', 'name', 'command', 'directory', 'timeoutSeconds']);

/** One line of text: trimmed, non-empty, within `max`, no control characters. */
function lineOf(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (text.length === 0 || text.length > max) return undefined;
  return /[\u0000-\u001f\u007f]/.test(text) ? undefined : text;
}

/** One checks.json entry, checked field by field: the Check, or why not. */
function parseCheck(value: unknown): CheckDefinition | string {
  if (!isRecord(value)) return 'not an object';
  if (!isCheckId(value.id)) {
    return 'its "id" must be lower-case letters, digits and hyphens, starting with a letter';
  }
  const unknown = Object.keys(value).find((key) => !CHECK_KEYS.has(key));
  if (unknown !== undefined) return `unknown field "${unknown}"`;
  const command = lineOf(value.command, MAX_CHECK_COMMAND_CHARS);
  if (command === undefined) {
    return `"command" must be a command line of 1-${MAX_CHECK_COMMAND_CHARS} characters on one line`;
  }
  const check: CheckDefinition = {
    id: value.id,
    name: value.id,
    command,
    timeoutSeconds: CHECK_DEFAULT_TIMEOUT_SECONDS,
  };
  if (value.name !== undefined) {
    const name = lineOf(value.name, MAX_CHECK_NAME_CHARS);
    if (name === undefined) {
      return `"name" must be 1-${MAX_CHECK_NAME_CHARS} characters on one line`;
    }
    check.name = name;
  }
  if (value.directory !== undefined) {
    const directory = lineOf(value.directory, MAX_CHECK_DIRECTORY_CHARS);
    if (directory === undefined) {
      return `"directory" must be the path of a Directory (1-${MAX_CHECK_DIRECTORY_CHARS} characters)`;
    }
    check.directory = directory;
  }
  if (value.timeoutSeconds !== undefined) {
    const seconds = value.timeoutSeconds;
    if (
      typeof seconds !== 'number' ||
      !Number.isInteger(seconds) ||
      seconds < 1 ||
      seconds > CHECK_MAX_TIMEOUT_SECONDS
    ) {
      return `"timeoutSeconds" must be a whole number from 1 to ${CHECK_MAX_TIMEOUT_SECONDS}`;
    }
    check.timeoutSeconds = seconds;
  }
  return check;
}

/** What a checks.json holds: the entries that passed, and one line per
 *  problem (for the host's log: a hand-edited file should say what is wrong). */
export interface ParsedChecks {
  checks: CheckDefinition[];
  problems: string[];
}

/**
 * The entries of a checks.json (`{ "checks": [ ... ] }`). Lenient per entry,
 * like workflows.json: one bad entry is left out and reported, the rest still
 * load. An id listed twice for the same Directory (as written) keeps its first
 * entry.
 */
export function parseChecks(value: unknown): ParsedChecks {
  if (!isRecord(value) || !Array.isArray(value.checks)) {
    return { checks: [], problems: ['expected an object with a "checks" list'] };
  }
  const checks: CheckDefinition[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  const entries: unknown[] = value.checks;
  if (entries.length > MAX_CHECKS) problems.push(`only the first ${MAX_CHECKS} checks are read`);
  entries.slice(0, MAX_CHECKS).forEach((raw, index) => {
    const entry = parseCheck(raw);
    if (typeof entry === 'string') {
      problems.push(`checks[${index}]: ${entry}`);
      return;
    }
    const key = `${entry.id}\n${entry.directory ?? ''}`;
    if (seen.has(key)) {
      problems.push(
        `checks[${index}]: "${entry.id}" is listed twice${entry.directory ? ` for ${entry.directory}` : ''}; the first one is used`,
      );
      return;
    }
    seen.add(key);
    checks.push(entry);
  });
  return { checks, problems };
}

/**
 * The Check `id` of a run in the Directory `directoryKey`: the entry written
 * for that Directory, else the one written for every Directory. `keyOf` turns
 * a path as written into the host's comparison key (the server's
 * `normalizeDirectoryPath`: what a path means is the host's to say).
 */
export function checkFor(
  checks: readonly CheckDefinition[],
  id: string,
  directoryKey: string,
  keyOf: (directory: string) => string,
): CheckDefinition | undefined {
  const named = checks.filter((check) => check.id === id);
  return (
    named.find(
      (check) => check.directory !== undefined && keyOf(check.directory) === directoryKey,
    ) ?? named.find((check) => check.directory === undefined)
  );
}
