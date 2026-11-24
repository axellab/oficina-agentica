/**
 * The Change triggers of this host (CONTEXT.md "Change trigger"): the
 * Directories whose new commits start a Workflow run, from the user's own
 * `~/.pixel-agents/triggers.json`.
 *
 * triggers.json is the user's file: read, never written. No repository and no
 * agent says what is watched, or which Workflow a change starts. Like
 * checks.json it is re-read whenever it changed on disk (path + mtime +
 * size), so an edit applies at the watch's next look, with no watcher to run.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  type ChangeTriggerDefinition,
  parseChangeTriggers,
} from '../../../core/src/changeTriggers.js';
import { PIXEL_AGENTS_DIR, TRIGGERS_FILE_NAME } from '../constants.js';
import { normalizeDirectoryPath } from '../directories.js';

const LOG_PREFIX = '[Pixel Agents] Change triggers:';

function triggersFilePath(): string {
  return path.join(os.homedir(), PIXEL_AGENTS_DIR, TRIGGERS_FILE_NAME);
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
function readTriggers(file: string): ChangeTriggerDefinition[] {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`${LOG_PREFIX} cannot read ${TRIGGERS_FILE_NAME}:`, err);
    }
    return [];
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} ${TRIGGERS_FILE_NAME} is not valid JSON and was ignored (${String(err)})`,
    );
    return [];
  }
  const parsed = parseChangeTriggers(
    raw,
    (a, b) => normalizeDirectoryPath(a) === normalizeDirectoryPath(b),
  );
  for (const problem of parsed.problems) {
    console.warn(`${LOG_PREFIX} ${TRIGGERS_FILE_NAME}: ${problem}`);
  }
  return parsed.triggers;
}

let cached: { key: string; triggers: readonly ChangeTriggerDefinition[] } | null = null;

/** Every Change trigger the user's file states, as written. */
export function changeTriggerCatalog(): readonly ChangeTriggerDefinition[] {
  const file = triggersFilePath();
  const key = fileKey(file);
  if (cached?.key !== key) cached = { key, triggers: readTriggers(file) };
  return cached.triggers;
}
