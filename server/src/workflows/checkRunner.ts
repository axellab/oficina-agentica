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

/** How long after the shell exits its pipes are still read: something it
 *  left running in the background may hold them open for ever. */
const PIPE_DRAIN_MS = 1000;

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
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const end = (why: 'timedOut' | 'cancelled'): void => {
    if (ended !== 'exited' || settled) return;
    ended = why;
    endProcessTree(child, false);
    killTimer = setTimeout(() => endProcessTree(child, true), CHECK_KILL_GRACE_MS);
  };

  const result = new Promise<CheckResult>((resolve) => {
    let exitCode: number | null = null;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => end('timedOut'), request.timeoutSeconds * 1000);
    const settle = (startError?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      clearTimeout(drainTimer);
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
      exitCode = code;
      // Ended by a signal that was not ours: it did not run to its end.
      if (code === null && ended === 'exited' && signal) keep(`\nEnded by ${signal}.\n`);
      drainTimer = setTimeout(() => settle(), PIPE_DRAIN_MS);
    });
    child.on('close', () => settle());
  });

  return { result, output, cancel: () => end('cancelled') };
}
