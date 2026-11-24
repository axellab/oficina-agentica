/**
 * What changed in a Directory, read through git (the Worktrees' `git`, the
 * one place the server runs it): where its checkout stands, and what the
 * commits since one it already saw touch.
 *
 * Reads only: nothing here writes to the repository, fetches, or installs a
 * hook. A commit is named by its full hash, checked to be one before it is
 * handed to git, and the paths come back as data: they are matched against
 * the stages' patterns and counted, and never put into anything an agent is
 * told.
 */

import { git, isRepo } from '../worktreeGit.js';

/** A commit's full name (SHA-1 or SHA-256). */
const COMMIT_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** Where a checkout stands. */
export interface CheckoutHead {
  commit: string;
  /** The branch checked out; absent on a detached HEAD. */
  branch?: string;
}

/**
 * Where the checkout of `directory` stands, or nothing: not a repository's
 * root, no commit yet, or git could not say.
 */
export async function headOf(directory: string): Promise<CheckoutHead | undefined> {
  if (!isRepo(directory)) return undefined;
  // Two lines: the commit, then the branch's name ("HEAD" when detached).
  const result = await git(directory, ['rev-parse', 'HEAD', '--abbrev-ref', 'HEAD']);
  if (!result.ok) return undefined;
  const [commit, branch] = result.stdout.split('\n').map((line) => line.trim());
  if (!COMMIT_RE.test(commit ?? '')) return undefined;
  return { commit, ...(branch && branch !== 'HEAD' ? { branch } : {}) };
}

/** The commits of a checkout that a commit seen before does not have. */
export interface ChangeSince {
  /** Where the two part: `since` itself when history only moved forward, an
   *  older commit after a rebase or a reset. */
  base: string;
  head: string;
  /** How many commits `head` has that `base` does not. */
  commits: number;
  /** The paths that differ between the two, as the repository names them. */
  files: string[];
}

/**
 * What `head` holds that `since` did not, in `directory`; nothing when git
 * cannot say (a commit that is gone, two histories with nothing in common).
 * No commits and no files when `head` is `since` or behind it.
 */
export async function changeSince(
  directory: string,
  since: string,
  head: string,
): Promise<ChangeSince | undefined> {
  if (!COMMIT_RE.test(since) || !COMMIT_RE.test(head)) return undefined;
  const merged = await git(directory, ['merge-base', since, head]);
  const base = merged.stdout.trim();
  if (!merged.ok || !COMMIT_RE.test(base)) return undefined;
  if (base === head) return { base, head, commits: 0, files: [] };
  const counted = await git(directory, ['rev-list', '--count', `${base}..${head}`]);
  const commits = Number(counted.stdout.trim());
  if (!counted.ok || !Number.isInteger(commits)) return undefined;
  // Names only, between two commits: no file of the checkout is read, and no
  // diff driver or text conversion a repository configures is run.
  const diff = await git(directory, [
    'diff',
    '--name-only',
    '-z',
    '--no-renames',
    '--no-ext-diff',
    '--no-textconv',
    base,
    head,
    '--',
  ]);
  if (!diff.ok) return undefined;
  return { base, head, commits, files: diff.stdout.split('\0').filter(Boolean) };
}
