/**
 * Path globs, pure: how a Workflow's stage says which files it is for, and a
 * Change trigger which branches it watches (CONTEXT.md "Change trigger").
 *
 * A small, fixed dialect, so one line means the same in a Role's folder, in
 * workflows.json and in triggers.json:
 *
 *   `*`   any run of characters inside one path segment
 *   `**`  any run of characters, segments included
 *   `?`   one character that is not a `/`
 *   a pattern with no `/` matches a file's name at any depth (`*.md`)
 *   a pattern ending in `/` matches everything under that folder (`docs/`)
 *   a leading `/` anchors a pattern with no other `/` at the root (`/README.md`)
 *   a leading `!` leaves out what the rest matches
 *
 * Paths are a repository's own, `/`-separated, compared as written. A branch
 * is matched by its whole name (`nameSelector`): `main` is `main` and never
 * `feature/main`, so the two lines about depth and folders are for paths only.
 */

/** Upper bounds, so a hand-edited file can't hold a pattern nobody could read. */
export const MAX_PATH_GLOB_CHARS = 200;
export const MAX_PATH_GLOBS = 30;

/**
 * Whether `value` is a pattern of this dialect: no blank space or control
 * character, no brace and no comma (a stage's heading lists patterns between
 * braces, separated by commas), and something to match after a `!`.
 */
export function isPathGlob(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_PATH_GLOB_CHARS) return false;
  if (/[\s\u0000-\u001f\u007f{},]/.test(value)) return false;
  const body = value.startsWith('!') ? value.slice(1) : value;
  return body.length > 0 && body !== '/' && !body.startsWith('!');
}

/** A list of patterns as a file states it: one pattern, or 1 to MAX_PATH_GLOBS
 *  of them, none twice. */
export function parsePathGlobs(value: unknown): string[] | undefined {
  const list: unknown[] = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  if (list.length === 0 || list.length > MAX_PATH_GLOBS) return undefined;
  const globs: string[] = [];
  for (const entry of list) {
    if (!isPathGlob(entry) || globs.includes(entry)) return undefined;
    globs.push(entry);
  }
  return globs;
}

const REGEX_SPECIAL = /[.+^$()|[\]\\]/g;

/** One pattern (its `!` already taken off) as a regular expression: of a
 *  path, or (`whole`) of a name matched from end to end. */
function globRegex(glob: string, whole: boolean): RegExp {
  let body = glob;
  if (!whole) {
    const anchored = body.startsWith('/');
    if (anchored) body = body.slice(1);
    // A name alone is looked for at any depth; a folder holds everything under it.
    if (!anchored && !body.slice(0, -1).includes('/')) body = `**/${body}`;
    if (body.endsWith('/')) body = `${body}**`;
  }

  let source = '';
  for (let at = 0; at < body.length; at++) {
    const char = body[at];
    if (char === '*') {
      if (body[at + 1] === '*') {
        at++;
        // `**/` also matches no folder at all: `**/a` is `a` at the root too.
        if (body[at + 1] === '/') {
          at++;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(REGEX_SPECIAL, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/** Patterns read once: the ones that take a path in, the ones that leave it out. */
export interface PathSelector {
  include: RegExp[];
  exclude: RegExp[];
}

function selector(globs: readonly string[], whole: boolean): PathSelector {
  const include: RegExp[] = [];
  const exclude: RegExp[] = [];
  for (const glob of globs) {
    if (glob.startsWith('!')) exclude.push(globRegex(glob.slice(1), whole));
    else include.push(globRegex(glob, whole));
  }
  return { include, exclude };
}

/** Patterns over a repository's paths. */
export function pathSelector(globs: readonly string[]): PathSelector {
  return selector(globs, false);
}

/** Patterns over whole names (a branch's): `release/*`, `!wip/**`. */
export function nameSelector(globs: readonly string[]): PathSelector {
  return selector(globs, true);
}

/**
 * Whether the patterns select `path`: some pattern takes it in (any path is
 * taken in when every pattern is a `!` one) and none leaves it out.
 */
export function pathSelected(path: string, selector: PathSelector): boolean {
  const included =
    selector.include.length === 0 || selector.include.some((regex) => regex.test(path));
  return included && !selector.exclude.some((regex) => regex.test(path));
}

/** Whether any of `paths` is selected by `globs`: what "a change touches what
 *  this stage is for" means. */
export function touchesPaths(paths: readonly string[], globs: readonly string[]): boolean {
  const selector = pathSelector(globs);
  return paths.some((path) => pathSelected(path, selector));
}
