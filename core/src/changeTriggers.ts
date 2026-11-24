/**
 * Change triggers, pure (CONTEXT.md "Change trigger"): the Directories whose
 * new commits start a Workflow run, as the user's own triggers.json states
 * them.
 *
 * Data and validation only. Watching a Directory, working out what changed
 * and starting the run are the server's (server/src/workflows/changeTriggers.ts).
 * Like checks.json, the file is the user's: no repository and no agent says
 * what is watched or which Workflow a change starts.
 */

import { isRecord } from './isRecord.js';
import { MAX_PATH_GLOBS, parsePathGlobs } from './pathGlobs.js';
import { isWorkflowId } from './workflows.js';

/** One Change trigger, as the file states it. */
export interface ChangeTriggerDefinition {
  /** The Directory watched, as the user wrote it (a path, `~` allowed). */
  directory: string;
  /** The id of the Workflow a change starts a run of. */
  workflow: string;
  /** The branches whose commits count, as patterns over the branch's whole
   *  name (`main`, `release/*`, `!wip/**`); absent = whichever is checked out. */
  branches?: string[];
  /** How long the newest commit must stand before a run starts: commits that
   *  come one after another are reviewed as one change. */
  settleSeconds: number;
  /** The most runs it starts in any hour; a change past that waits. */
  maxRunsPerHour: number;
  /** false = written down and switched off. */
  enabled: boolean;
}

/** The Workflow a trigger that names none starts: the built-in review of a change. */
export const DEFAULT_CHANGE_WORKFLOW = 'change-review';

/** Bounds, so a hand-edited file can't watch without end or spend without limit. */
export const MAX_CHANGE_TRIGGERS = 20;
export const MAX_TRIGGER_DIRECTORY_CHARS = 1024;
export const TRIGGER_DEFAULT_SETTLE_SECONDS = 20;
export const TRIGGER_MIN_SETTLE_SECONDS = 5;
export const TRIGGER_MAX_SETTLE_SECONDS = 3600;
export const TRIGGER_DEFAULT_RUNS_PER_HOUR = 4;
export const TRIGGER_MAX_RUNS_PER_HOUR = 30;

const TRIGGER_KEYS = new Set([
  'directory',
  'workflow',
  'branches',
  'settleSeconds',
  'maxRunsPerHour',
  'enabled',
]);

/** A whole number from `min` to `max`, or nothing. */
function wholeWithin(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;
}

/** One triggers.json entry, checked field by field: the trigger, or why not. */
function parseTrigger(value: unknown): ChangeTriggerDefinition | string {
  if (!isRecord(value)) return 'not an object';
  const unknown = Object.keys(value).find((key) => !TRIGGER_KEYS.has(key));
  if (unknown !== undefined) return `unknown field "${unknown}"`;
  const directory = typeof value.directory === 'string' ? value.directory.trim() : '';
  if (
    directory.length === 0 ||
    directory.length > MAX_TRIGGER_DIRECTORY_CHARS ||
    /[\u0000-\u001f\u007f]/.test(directory)
  ) {
    return `"directory" must be the path of the Directory to watch, 1-${MAX_TRIGGER_DIRECTORY_CHARS} characters on one line`;
  }
  const trigger: ChangeTriggerDefinition = {
    directory,
    workflow: DEFAULT_CHANGE_WORKFLOW,
    settleSeconds: TRIGGER_DEFAULT_SETTLE_SECONDS,
    maxRunsPerHour: TRIGGER_DEFAULT_RUNS_PER_HOUR,
    enabled: true,
  };
  if (value.workflow !== undefined) {
    if (!isWorkflowId(value.workflow)) return '"workflow" must be the id of a Workflow';
    trigger.workflow = value.workflow;
  }
  if (value.branches !== undefined) {
    const branches = parsePathGlobs(value.branches);
    if (branches === undefined) {
      return `"branches" must be a branch pattern or a list of 1-${MAX_PATH_GLOBS} of them, none twice (like "main", "release/*" or "!wip/**")`;
    }
    trigger.branches = branches;
  }
  if (value.settleSeconds !== undefined) {
    const seconds = wholeWithin(
      value.settleSeconds,
      TRIGGER_MIN_SETTLE_SECONDS,
      TRIGGER_MAX_SETTLE_SECONDS,
    );
    if (seconds === undefined) {
      return `"settleSeconds" must be a whole number from ${TRIGGER_MIN_SETTLE_SECONDS} to ${TRIGGER_MAX_SETTLE_SECONDS}`;
    }
    trigger.settleSeconds = seconds;
  }
  if (value.maxRunsPerHour !== undefined) {
    const runs = wholeWithin(value.maxRunsPerHour, 1, TRIGGER_MAX_RUNS_PER_HOUR);
    if (runs === undefined) {
      return `"maxRunsPerHour" must be a whole number from 1 to ${TRIGGER_MAX_RUNS_PER_HOUR}`;
    }
    trigger.maxRunsPerHour = runs;
  }
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== 'boolean') return '"enabled" must be true or false';
    trigger.enabled = value.enabled;
  }
  return trigger;
}

/** What a triggers.json holds: the entries that passed, and one line per
 *  problem (for the host's log: a hand-edited file should say what is wrong). */
export interface ParsedChangeTriggers {
  triggers: ChangeTriggerDefinition[];
  problems: string[];
}

/**
 * The entries of a triggers.json (`{ "triggers": [ ... ] }`). Lenient per
 * entry: one bad entry is left out and reported, the rest still load. A
 * Directory is watched once: of two entries for one (`sameDirectory`: the
 * server's way of comparing paths), the first is kept.
 */
export function parseChangeTriggers(
  value: unknown,
  sameDirectory: (a: string, b: string) => boolean = (a, b) => a === b,
): ParsedChangeTriggers {
  if (!isRecord(value) || !Array.isArray(value.triggers)) {
    return { triggers: [], problems: ['expected an object with a "triggers" list'] };
  }
  const triggers: ChangeTriggerDefinition[] = [];
  const problems: string[] = [];
  const entries: unknown[] = value.triggers;
  if (entries.length > MAX_CHANGE_TRIGGERS) {
    problems.push(`only the first ${MAX_CHANGE_TRIGGERS} triggers are read`);
  }
  entries.slice(0, MAX_CHANGE_TRIGGERS).forEach((raw, index) => {
    const entry = parseTrigger(raw);
    if (typeof entry === 'string') {
      problems.push(`triggers[${index}]: ${entry}`);
    } else if (triggers.some((kept) => sameDirectory(kept.directory, entry.directory))) {
      problems.push(
        `triggers[${index}]: "${entry.directory}" is listed twice; the first one is used`,
      );
    } else {
      triggers.push(entry);
    }
  });
  return { triggers, problems };
}
