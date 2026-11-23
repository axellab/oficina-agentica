/**
 * A command as Windows can start it in a terminal.
 *
 * A PTY spawn there is CreateProcess, which starts an .exe and nothing else.
 * A CLI that npm installed is not one: `claude` on PATH is `claude.cmd`, a few
 * lines of batch that end on the package's own .exe, or on `node …\cli.js`.
 * Spawned by its bare name the launch found no `claude.exe`, and the agent
 * left the office the moment it joined, with nothing said.
 *
 * Running the .cmd means cmd.exe, which reads the whole line again by rules of
 * its own: an `&`, a `|`, a `%NAME%` or a quote inside an argument becomes
 * syntax, and a first message is whatever a user or an agent wrote. So the
 * launcher is never run. It is read, and what it would have started is started
 * instead, its arguments still a list no shell reads. A batch file that is not
 * such a launcher is refused, saying why.
 *
 * Pure but for the two file reads it is handed, and written against
 * `path.win32`, so it is tested on any machine.
 */

import * as fs from 'fs';
import * as path from 'path';

const win = path.win32;

/** What Windows starts by itself. */
const PROGRAM_EXTENSIONS: ReadonlySet<string> = new Set(['.exe', '.com']);
/** What only cmd.exe runs. */
const BATCH_EXTENSIONS: ReadonlySet<string> = new Set(['.cmd', '.bat']);

/** PATHEXT's own default, cut to what can be launched here. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/**
 * A launcher's last word: `"%dp0%\<file>" %*` (npm's cmd-shim, Yarn's) or
 * `"%~dp0\<file>" %*` (pnpm's, older npm's), with the program it hands the
 * file to just before it, when it names one.
 */
const LAUNCHER_LINE = /(?:(\S+)[ \t]+)?"%(?:dp0%|~dp0)\\([^"%\r\n]+)"[ \t]+%\*/g;
/** `SET "_prog=…"`: what npm's launcher means by `"%_prog%"`. */
const PROG_ASSIGNMENT = /^\s*@?SET\s+"_prog=([^"\r\n]*)"/gim;
/** Node, as a launcher names it. */
const NODE_PROGRAM = /^"?(?:%(?:dp0%|~dp0)\\)?node(?:\.exe)?"?$/i;
const PROG_VARIABLE = '"%_prog%"';

/** The file system as this module reads it: swapped by tests. */
export interface WindowsFiles {
  isFile(file: string): boolean;
  /** A file's text, or null when it cannot be read. */
  read(file: string): string | null;
}

export interface WindowsLaunch {
  command: string;
  args: string[];
}

const diskFiles: WindowsFiles = {
  isFile: (file) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      // An app execution alias (a Store app's .exe) cannot be followed, yet
      // it is there and Windows starts it.
      try {
        const stat = fs.lstatSync(file);
        return stat.isFile() || stat.isSymbolicLink();
      } catch {
        return false;
      }
    }
  },
  read: (file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  },
};

/** An environment variable by its name, whatever case it is kept in (Windows' `Path`). */
function envValue(env: Record<string, string | undefined>, name: string): string | undefined {
  const exact = env[name];
  if (exact !== undefined) return exact;
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === name) return value;
  }
  return undefined;
}

/** The extensions a bare name is tried with, in PATHEXT's order: only the ones that can be launched here. */
function launchExtensions(env: Record<string, string | undefined>): string[] {
  const launchable = (pathExt: string): string[] =>
    pathExt
      .split(';')
      .map((ext) => ext.trim().toLowerCase())
      .filter((ext) => PROGRAM_EXTENSIONS.has(ext) || BATCH_EXTENSIONS.has(ext));
  const mine = launchable(envValue(env, 'PATHEXT') ?? '');
  return mine.length > 0 ? mine : launchable(DEFAULT_PATHEXT);
}

/**
 * The file a command names, as a shell would find it: in each PATH folder in
 * turn, under each extension in turn. A name that already says what it is
 * (`node.exe`, `tool.cmd`) is looked for as given, whatever PATHEXT lists:
 * PATHEXT only completes a bare name. A command with a folder in it is looked
 * for there alone (relative to `cwd`). Never the current folder by itself:
 * what happens to stand in the folder an agent is launched into is not the CLI.
 */
function findCommand(
  command: string,
  cwd: string,
  env: Record<string, string | undefined>,
  files: WindowsFiles,
): string | null {
  const own = win.extname(command).toLowerCase();
  const names =
    PROGRAM_EXTENSIONS.has(own) || BATCH_EXTENSIONS.has(own)
      ? [command]
      : launchExtensions(env).map((ext) => command + ext);
  const folders = /[\\/]/.test(command)
    ? [cwd]
    : (envValue(env, 'PATH') ?? '')
        .split(win.delimiter)
        .map((dir) => dir.trim().replace(/^"(.*)"$/, '$1'))
        .filter(Boolean);
  for (const folder of folders) {
    for (const name of names) {
      const file = win.resolve(folder, name);
      if (files.isFile(file)) return file;
    }
  }
  return null;
}

function refusal(file: string, why: string): Error {
  return new Error(
    `${file} cannot be started in a terminal: ${why} ` +
      'Windows runs a batch file through cmd.exe, which would read its arguments as commands, ' +
      'so only an .exe, or the launcher npm, pnpm or Yarn writes for a CLI, is started.',
  );
}

/** Whether every program a launcher's line may hand its script to is Node. */
function runsNode(program: string, text: string): boolean {
  if (program !== PROG_VARIABLE) return NODE_PROGRAM.test(program);
  const assigned = [...text.matchAll(PROG_ASSIGNMENT)].map((match) => match[1]);
  return assigned.length > 0 && assigned.every((value) => NODE_PROGRAM.test(value));
}

/** What a package manager's launcher starts, with the arguments it would pass on. */
function launcherTarget(
  launcher: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  files: WindowsFiles,
): WindowsLaunch {
  const text = files.read(launcher);
  if (text === null) throw refusal(launcher, 'it could not be read.');
  const lines = [...text.matchAll(LAUNCHER_LINE)];
  const targets = new Set(lines.map((line) => line[2].toLowerCase()));
  if (targets.size !== 1) {
    throw refusal(launcher, 'it is not a launcher a package manager wrote.');
  }
  const folder = win.dirname(launcher);
  const target = win.resolve(folder, lines[0][2]);
  if (!files.isFile(target)) throw refusal(launcher, `the file it runs is missing (${target}).`);

  const isProgram = PROGRAM_EXTENSIONS.has(win.extname(target).toLowerCase());
  const programs = lines.map((line) => line[1]);
  if (programs.every((program) => program === undefined)) {
    // The launcher runs the file itself: the package's own program, nothing added.
    if (!isProgram) throw refusal(launcher, 'what it runs by itself is not a program.');
    return { command: target, args };
  }
  if (isProgram) throw refusal(launcher, 'it runs a program through another one.');
  // A script is whatever the launcher hands to an interpreter (npm's `bin`
  // files often have no extension): it is Node's when that interpreter is Node.
  if (!programs.every((program) => program !== undefined && runsNode(program, text))) {
    throw refusal(launcher, 'it does not hand its script straight to Node.');
  }
  // The launcher's own choice: the node.exe beside it, else the one on PATH.
  const beside = win.join(folder, 'node.exe');
  const node = files.isFile(beside) ? beside : findCommand('node.exe', cwd, env, files);
  if (!node) throw refusal(launcher, 'it runs a Node script and no node.exe is on PATH.');
  return { command: node, args: [target, ...args] };
}

/**
 * The program and arguments a PTY must be given on Windows to start `command`
 * with `args`: the .exe a bare name stands for, or what a package manager's
 * launcher would have started. A command nothing on PATH answers to is left as
 * it is, for Windows to look for in its own folders (`cmd.exe` when PATH is
 * bare). Throws, with the reason, on a batch file that cannot be started
 * without a shell.
 */
export function windowsLaunch(
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string | undefined> },
  files: WindowsFiles = diskFiles,
): WindowsLaunch {
  const found = findCommand(command, options.cwd, options.env, files);
  if (!found) return { command, args };
  if (BATCH_EXTENSIONS.has(win.extname(found).toLowerCase())) {
    return launcherTarget(found, args, options.cwd, options.env, files);
  }
  return { command: found, args };
}
