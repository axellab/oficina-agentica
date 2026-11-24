/**
 * Running a Check (CONTEXT.md "Check"): the one place the office runs a
 * command to close a stage of a Workflow run.
 *
 * The command is the user's own line from checks.json, run by the host's
 * shell in the folder under check, with no terminal and no input. Passed
 * means it exited with 0; anything else is a failure: another exit code, its
 * time running out, a folder that is not there. Standard output and error
 * are kept together, their end only (CHECK_OUTPUT_KEPT_CHARS).
 *
 * Nothing of a Check outlives its result: whatever the command started and
 * left running is ended before the result is given, however the command
 * ended (POSIX; on Windows only a Check the office ends takes its tree with
 * it, see `treeAlive`).
 *
 * Nothing an agent says reaches the command line: a stage names its Check by
 * id, and the folder is one the office already knows (the run's Directory, or
 * a Worktree one of its Crew's agents is in).
 */

import { type ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';

import { CHECK_KILL_GRACE_MS, CHECK_OUTPUT_KEPT_CHARS } from '../constants.js';
import { cleanCheckOutput, outputTail } from './checkOutput.js';

export interface CheckRunRequest {
  command: string;
  /** The folder it runs in. */
  cwd: string;
  timeoutSeconds: number;
  /** The environment it runs with (the office's own, see `checkEnv`). */
  env: Readonly<Record<string, string>>;
}

/** How a Check's run ended. */
export type CheckEnd =
  /** The command ran to its end: `exitCode` says how. */
  | 'exited'
  /** Its time ran out and the office ended it. */
  | 'timedOut'
  /** The office ended it: its run stopped, its stage was skipped. */
  | 'cancelled'
  /** It never ran: no such folder, or the shell could not be started. */
  | 'notStarted';

export interface CheckResult {
  passed: boolean;
  ended: CheckEnd;
  /** Only when it `exited`. */
  exitCode?: number;
  /** How long it ran, in whole seconds. */
  seconds: number;
  /** Its output, cleaned (checkOutput.ts): the end of it when `truncated`. */
  output: string;
  truncated: boolean;
}

export interface RunningCheck {
  result: Promise<CheckResult>;
  /** Its output so far, cleaned. */
  output(): { text: string; truncated: boolean };
  /** End it now. Its result then says `cancelled`. */
  cancel(): void;
}

/**
 * The environment a Check runs with: the office's, told that no person is
 * watching (`CI`, as a pipeline sets it: test runners then run once, with no
 * watch mode and no prompt) and that the output is not a terminal's. What the
 * user set themselves stands.
 */
export function checkEnv(env: Readonly<Record<string, string>>): Record<string, string> {
  const colour = env.NO_COLOR === undefined && env.FORCE_COLOR === undefined;
  return {
    ...env,
    ...(env.CI === undefined ? { CI: '1' } : {}),
    ...(colour ? { NO_COLOR: '1' } : {}),
  };
}

/** End a Check's shell and everything it started. */
function endProcessTree(child: ChildProcess, force: boolean): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    // taskkill takes the whole tree; Windows has no gentler signal to try first.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    }).on('error', () => {
      child.kill();
    });
    return;
  }
  try {
    // The shell leads a process group of its own (`detached`): the group goes.
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    // Already gone.
  }
}

/**
 * Whether anything a Check started is still there (POSIX: its process group
 * has a member left). Windows is never asked: taskkill took the whole tree by
 * force the first time, and once a shell is gone Windows keeps no group to
 * find what it started by, so what a command that ran to its end left behind
 * stays there.
 */
function treeAlive(child: ChildProcess): boolean {
  if (child.pid === undefined || process.platform === 'win32') return false;
  try {
    process.kill(-child.pid, 0);
  } catch (err) {
    // EPERM: there, and not ours to signal. Anything else: gone.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
  return process.platform === 'linux' ? groupRuns(child.pid) : true;
}

/**
 * Whether a process group has a member that still runs (Linux). A process
 * that ended stays in its group until its parent collects it, and where
 * nothing collects the ones whose parent left first (a container whose first
 * process never does) that is for ever: such a member is not there. True
 * where /proc cannot say.
 */
function groupRuns(group: number): boolean {
  let entries: string[];
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return true;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let stat: string;
    try {
      stat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8');
    } catch {
      continue; // Gone between the listing and the read.
    }
    // "<pid> (<name>) <state> <parent> <group> …": a name may hold anything,
    // so the fields are read from its last ")". Z and X: ended.
    const [state, , memberOf] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (Number(memberOf) === group && state !== 'Z' && state !== 'X') return true;
  }
  return false;
}

/** How long after the shell exits its pipes are still read, and what it
 *  started may still leave by itself: something it left running in the
 *  background may hold them open for ever. */
const PIPE_DRAIN_MS = 1000;

/** How often what a Check left running is looked for again, once it was
 *  asked to end. */
const TREE_GONE_POLL_MS = 100;

/** Added to the output of a Check whose command ran to its end and left
 *  something running, so nobody wonders where that went. */
export const CHECK_LEFTOVERS_NOTE = 'The office ended what this command left running.';

export function startCheck(request: CheckRunRequest): RunningCheck {
  const started = Date.now();
  let kept = '';
  let dropped = false;
  const keep = (chunk: string): void => {
    kept += chunk;
    // Trimmed in strides, not on every chunk.
    if (kept.length > 2 * CHECK_OUTPUT_KEPT_CHARS) {
      kept = kept.slice(kept.length - CHECK_OUTPUT_KEPT_CHARS);
      dropped = true;
    }
  };
  const output = (): { text: string; truncated: boolean } => {
    const tail = outputTail(cleanCheckOutput(kept), CHECK_OUTPUT_KEPT_CHARS);
    return { text: tail.text, truncated: tail.truncated || dropped };
  };
  const seconds = (): number => Math.round((Date.now() - started) / 1000);
  const notStarted = (why: string): RunningCheck => ({
    result: Promise.resolve({
      passed: false,
      ended: 'notStarted',
      seconds: 0,
      output: why,
      truncated: false,
    }),
    output: () => ({ text: why, truncated: false }),
    cancel: () => {},
  });

  let isFolder = false;
  try {
    isFolder = fs.statSync(request.cwd).isDirectory();
  } catch {
    // Not there.
  }
  if (!isFolder) return notStarted(`The folder ${request.cwd} is not there.`);

  let child: ChildProcess;
  try {
    child = spawn(request.command, {
      cwd: request.cwd,
      env: { ...request.env },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // POSIX: a process group of its own, so the whole tree can be ended.
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
  } catch (err) {
    return notStarted(`The command could not be started: ${String(err)}`);
  }

  let ended: CheckEnd = 'exited';
  let settled = false;
  /** The shell is gone: how the Check ended is said, whatever comes after. */
  let shellGone = false;
  /** Set from the office asking the tree to end until it ends it by force. */
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  /** The tree was ended by force: nothing more is waited for. */
  let forced = false;
  /** The result, when it waits for the tree to be ended by force. */
  let afterKill: (() => void) | undefined;
  /** Ask everything the Check started to end, and end by force what is
   *  still there once it had its time. */
  const endTree = (): void => {
    endProcessTree(child, false);
    killTimer = setTimeout(() => {
      killTimer = undefined;
      forced = true;
      endProcessTree(child, true);
      afterKill?.();
    }, CHECK_KILL_GRACE_MS);
  };
  const end = (why: 'timedOut' | 'cancelled'): void => {
    // A command that already ran to its end keeps the way it ended: what it
    // left running is ended on the way to its result (`settle`).
    if (ended !== 'exited' || settled || shellGone) return;
    ended = why;
    endTree();
  };

  const result = new Promise<CheckResult>((resolve) => {
    let exitCode: number | null = null;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    /** The time the pipes are read for after the shell left is over. */
    let drained = false;
    let goneTimer: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => end('timedOut'), request.timeoutSeconds * 1000);
    const settle = (startError?: unknown): void => {
      if (settled) return;
      // The shell is gone and something it started is not: the result waits
      // until that is gone too, so nothing of a Check outlives its result, or
      // runs beside the Check that comes next.
      if (startError === undefined && !forced && treeAlive(child)) {
        // Looked for from here on: what holds no pipe of the Check's leaves
        // without a sign.
        goneTimer ??= setInterval(() => settle(), TREE_GONE_POLL_MS);
        if (killTimer === undefined) {
          // Nobody asked it to end: the command ran to its end. What is
          // still there may be on its way out (a test runner's workers), so
          // it has the time the pipes are read for.
          if (!drained) return;
          // Still there: left in the background. It is ended as a pipeline
          // ends what a step leaves behind, and the command's exit code
          // still says how the Check went.
          keep(`\n${CHECK_LEFTOVERS_NOTE}\n`);
          endTree();
        }
        // Asked to end: it has until the office ends it by force.
        afterKill = () => settle();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      clearTimeout(drainTimer);
      clearInterval(goneTimer);
      if (startError !== undefined) {
        resolve({
          passed: false,
          ended: 'notStarted',
          seconds: seconds(),
          output: `The command could not be started: ${String(startError)}`,
          truncated: false,
        });
        return;
      }
      const { text, truncated } = output();
      // Nothing more is read: a process that left the group (a daemon in a
      // session of its own) may hold the pipes for as long as it lives, and
      // the office keeps no file open for a Check that is over.
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({
        passed: ended === 'exited' && exitCode === 0,
        ended,
        ...(ended === 'exited' && exitCode !== null ? { exitCode } : {}),
        seconds: seconds(),
        output: text,
        truncated,
      });
    };
    for (const stream of [child.stdout, child.stderr]) {
      stream?.setEncoding('utf8');
      stream?.on('data', keep);
    }
    child.on('error', (err) => settle(err));
    child.on('exit', (code, signal) => {
      shellGone = true;
      exitCode = code;
      // Ended by a signal that was not ours: it did not run to its end.
      if (code === null && ended === 'exited' && signal) keep(`\nEnded by ${signal}.\n`);
      drainTimer = setTimeout(() => {
        drained = true;
        settle();
      }, PIPE_DRAIN_MS);
    });
    child.on('close', () => settle());
  });

  return { result, output, cancel: () => end('cancelled') };
}
