/**
 * The Checks of this host (CONTEXT.md "Check"): the commands the office itself
 * runs to close a stage of a Workflow run, from the user's own
 * `~/.pixel-agents/checks.json`.
 *
 * checks.json is the user's file: read, never written, and the ONLY place a
 * command the office runs comes from. No repository, no Workflow and no agent
 * supplies one: a stage only names a Check by id. Like workflows.json it is
 * re-read whenever it changed on disk (path + mtime + size), so an edit
 * applies to the next stage that is finished, with no watcher to run.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { type CheckDefinition, checkFor, parseChecks } from '../../../core/src/checks.js';
import { CHECKS_FILE_NAME, PIXEL_AGENTS_DIR } from '../constants.js';
import { normalizeDirectoryPath } from '../directories.js';

const LOG_PREFIX = '[Pixel Agents] Checks:';

function checksFilePath(): string {
  return path.join(os.homedir(), PIXEL_AGENTS_DIR, CHECKS_FILE_NAME);
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

/** The file's entries. Everything wrong with it is logged once per read (it
 *  is the user's hand-edited file) and left out. */
function readChecks(file: string): CheckDefinition[] {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`${LOG_PREFIX} cannot read ${CHECKS_FILE_NAME}:`, err);
    }
    return [];
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} ${CHECKS_FILE_NAME} is not valid JSON and was ignored (${String(err)})`,
    );
    return [];
  }
  const parsed = parseChecks(raw);
  for (const problem of parsed.problems) {
    console.warn(`${LOG_PREFIX} ${CHECKS_FILE_NAME}: ${problem}`);
  }
  return parsed.checks;
}

let cached: { key: string; checks: readonly CheckDefinition[] } | null = null;

/** Every Check the user's file states, as written. */
export function checkCatalog(): readonly CheckDefinition[] {
  const file = checksFilePath();
  const key = fileKey(file);
  if (cached?.key !== key) cached = { key, checks: readChecks(file) };
  return cached.checks;
}

/**
 * The Check `id` for a run started in `directoryPath`, as the file says now:
 * the entry written for that Directory, else the one written for every
 * Directory, else none (the stage is then closed on its lead's note).
 */
export function checkForDirectory(id: string, directoryPath: string): CheckDefinition | undefined {
  return checkFor(
    checkCatalog(),
    id,
    normalizeDirectoryPath(directoryPath),
    normalizeDirectoryPath,
  );
}
