/**
 * A command as Windows can start it in a terminal: the .exe a bare name stands
 * for, or what a package manager's .cmd launcher would have started, never the
 * launcher itself (cmd.exe would read the arguments as commands).
 */

import { describe, expect, it } from 'vitest';

import type { WindowsFiles } from '../src/terminal/windowsCommand.js';
import { windowsLaunch } from '../src/terminal/windowsCommand.js';

const NODE_DIR = 'C:\\Program Files\\nodejs';
const TOOLS_DIR = 'C:\\tools';
const CWD = 'C:\\work\\repo';

/** npm's launcher for a package whose `bin` is its own program (Claude Code 2.x: `bin/claude.exe`). */
const NPM_PROGRAM_LAUNCHER = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*',
  '',
].join('\r\n');

/** npm's launcher for a package whose `bin` is a Node script. */
const npmScriptLauncher = (program = 'node'): string =>
  [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    '',
    `IF EXIST "%dp0%\\${program}.exe" (`,
    `  SET "_prog=%dp0%\\${program}.exe"`,
    ') ELSE (',
    `  SET "_prog=${program}"`,
    '  SET PATHEXT=%PATHEXT:;.JS;=;%',
    ')',
    '',
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\some-cli\\cli.js" %*',
    '',
  ].join('\r\n');

/** pnpm's launcher (and older npm's): `%~dp0`, the program named on the line itself. */
const PNPM_SCRIPT_LAUNCHER = [
  '@SETLOCAL',
  '@IF NOT DEFINED NODE_PATH (',
  '  @SET "NODE_PATH=C:\\Users\\me\\AppData\\Local\\pnpm\\global\\5\\.pnpm\\node_modules"',
  ') ELSE (',
  '  @SET "NODE_PATH=C:\\Users\\me\\AppData\\Local\\pnpm\\global\\5\\.pnpm\\node_modules;%NODE_PATH%"',
  ')',
  '@IF EXIST "%~dp0\\node.exe" (',
  '  "%~dp0\\node.exe"  "%~dp0\\global\\5\\node_modules\\some-cli\\cli.js" %*',
  ') ELSE (',
  '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
  '  node  "%~dp0\\global\\5\\node_modules\\some-cli\\cli.js" %*',
  ')',
  '',
].join('\r\n');

/** A disk holding these files (path → text), names compared as Windows does. */
function disk(entries: Record<string, string>): WindowsFiles {
  const byName = new Map(Object.entries(entries).map(([file, text]) => [file.toLowerCase(), text]));
  return {
    isFile: (file) => byName.has(file.toLowerCase()),
    read: (file) => byName.get(file.toLowerCase()) ?? null,
  };
}

const env = (dirs: string[], extra: Record<string, string> = {}): Record<string, string> => ({
  PATH: dirs.join(';'),
  PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.CPL',
  ...extra,
});

const ARGS = ['--session-id', 'abc', '--', 'fix "it" & del %TEMP% | more\nnow'];

describe('windowsLaunch', () => {
  it('starts the program a bare name stands for, by its full path', () => {
    const files = disk({ [`${TOOLS_DIR}\\claude.exe`]: '' });
    expect(
      windowsLaunch('claude', ARGS, { cwd: CWD, env: env([NODE_DIR, TOOLS_DIR]) }, files),
    ).toEqual({ command: `${TOOLS_DIR}\\claude.exe`, args: ARGS });
  });

  it("starts the program npm's launcher runs, not the launcher", () => {
    const program = `${NODE_DIR}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
    const files = disk({
      // What npm leaves beside node.exe: a sh script, the .cmd and a .ps1.
      [`${NODE_DIR}\\claude`]: '#!/bin/sh\n',
      [`${NODE_DIR}\\claude.cmd`]: NPM_PROGRAM_LAUNCHER,
      [`${NODE_DIR}\\claude.ps1`]: '',
      [`${NODE_DIR}\\node.exe`]: '',
      [program]: '',
    });
    const launch = windowsLaunch('claude', ARGS, { cwd: CWD, env: env([NODE_DIR]) }, files);
    expect(launch).toEqual({ command: program, args: ARGS });
    // The very list: nothing quoted, escaped or joined on the way.
    expect(launch.args).toBe(ARGS);
  });

  it("starts Node on the script npm's launcher runs, with the node.exe beside it", () => {
    const files = disk({
      [`${NODE_DIR}\\tool.cmd`]: npmScriptLauncher(),
      [`${NODE_DIR}\\node.exe`]: '',
      [`${NODE_DIR}\\node_modules\\some-cli\\cli.js`]: '',
    });
    expect(windowsLaunch('tool', ARGS, { cwd: CWD, env: env([NODE_DIR]) }, files)).toEqual({
      command: `${NODE_DIR}\\node.exe`,
      args: [`${NODE_DIR}\\node_modules\\some-cli\\cli.js`, ...ARGS],
    });
  });

  it('takes the node.exe on PATH when none stands beside the launcher', () => {
    const files = disk({
      [`${TOOLS_DIR}\\tool.cmd`]: npmScriptLauncher(),
      [`${TOOLS_DIR}\\node_modules\\some-cli\\cli.js`]: '',
      [`${NODE_DIR}\\node.exe`]: '',
    });
    expect(
      windowsLaunch('tool', ['x'], { cwd: CWD, env: env([TOOLS_DIR, NODE_DIR]) }, files),
    ).toEqual({
      command: `${NODE_DIR}\\node.exe`,
      args: [`${TOOLS_DIR}\\node_modules\\some-cli\\cli.js`, 'x'],
    });
  });

  it('starts Node on a script with no extension (an npm `bin` often has none)', () => {
    const launcher = npmScriptLauncher().replace(
      'node_modules\\some-cli\\cli.js',
      'node_modules\\some-cli\\bin\\tool',
    );
    const files = disk({
      [`${NODE_DIR}\\tool.cmd`]: launcher,
      [`${NODE_DIR}\\node.exe`]: '',
      [`${NODE_DIR}\\node_modules\\some-cli\\bin\\tool`]: '',
    });
    expect(windowsLaunch('tool', ['x'], { cwd: CWD, env: env([NODE_DIR]) }, files)).toEqual({
      command: `${NODE_DIR}\\node.exe`,
      args: [`${NODE_DIR}\\node_modules\\some-cli\\bin\\tool`, 'x'],
    });
  });

  it("reads pnpm's launcher too", () => {
    const files = disk({
      [`${TOOLS_DIR}\\tool.cmd`]: PNPM_SCRIPT_LAUNCHER,
      [`${TOOLS_DIR}\\node.exe`]: '',
      [`${TOOLS_DIR}\\global\\5\\node_modules\\some-cli\\cli.js`]: '',
    });
    expect(windowsLaunch('tool', ['x'], { cwd: CWD, env: env([TOOLS_DIR]) }, files)).toEqual({
      command: `${TOOLS_DIR}\\node.exe`,
      args: [`${TOOLS_DIR}\\global\\5\\node_modules\\some-cli\\cli.js`, 'x'],
    });
  });

  it('looks in PATH order, then in PATHEXT order', () => {
    const files = disk({
      [`${NODE_DIR}\\tool.cmd`]: NPM_PROGRAM_LAUNCHER,
      [`${TOOLS_DIR}\\tool.exe`]: '',
      [`${TOOLS_DIR}\\tool.cmd`]: 'never read',
    });
    // A program later on PATH loses to a launcher earlier on it...
    expect(() =>
      windowsLaunch('tool', [], { cwd: CWD, env: env([NODE_DIR, TOOLS_DIR]) }, files),
    ).toThrow(/claude\.exe/);
    // ...and in one folder the program wins, as PATHEXT lists it first.
    expect(windowsLaunch('tool', [], { cwd: CWD, env: env([TOOLS_DIR, NODE_DIR]) }, files)).toEqual(
      { command: `${TOOLS_DIR}\\tool.exe`, args: [] },
    );
  });

  it('reads PATH and PATHEXT under any case, and a quoted PATH folder', () => {
    const files = disk({ [`${NODE_DIR}\\tool.exe`]: '' });
    const launch = windowsLaunch(
      'tool',
      [],
      { cwd: CWD, env: { Path: `"${NODE_DIR}";;C:\\nowhere`, PathExt: '.EXE' } },
      files,
    );
    expect(launch.command).toBe(`${NODE_DIR}\\tool.exe`);
  });

  it('takes a name that says what it is as given, whatever PATHEXT lists', () => {
    // PATHEXT only completes a bare name: `node.exe` is not looked for as `node.exe.cmd`.
    const cmdOnly = env([TOOLS_DIR, NODE_DIR], { PATHEXT: '.CMD' });
    const files = disk({
      [`${TOOLS_DIR}\\tool.cmd`]: npmScriptLauncher(),
      [`${TOOLS_DIR}\\node_modules\\some-cli\\cli.js`]: '',
      [`${NODE_DIR}\\node.exe`]: '',
    });
    expect(windowsLaunch('tool', ['x'], { cwd: CWD, env: cmdOnly }, files)).toEqual({
      command: `${NODE_DIR}\\node.exe`,
      args: [`${TOOLS_DIR}\\node_modules\\some-cli\\cli.js`, 'x'],
    });
    expect(windowsLaunch('node.exe', [], { cwd: CWD, env: cmdOnly }, files).command).toBe(
      `${NODE_DIR}\\node.exe`,
    );
  });

  it('never picks a file from the folder the terminal opens in', () => {
    const files = disk({ [`${CWD}\\claude.exe`]: '', [`${CWD}\\claude.cmd`]: 'del /q *' });
    expect(windowsLaunch('claude', ARGS, { cwd: CWD, env: env([NODE_DIR]) }, files)).toEqual({
      command: 'claude',
      args: ARGS,
    });
  });

  it('looks for a command with a folder in it there alone', () => {
    const files = disk({
      [`${CWD}\\bin\\tool.exe`]: '',
      [`${NODE_DIR}\\tool.exe`]: '',
      'C:\\Windows\\System32\\cmd.exe': '',
    });
    const options = { cwd: CWD, env: env([NODE_DIR]) };
    expect(windowsLaunch('bin\\tool', [], options, files).command).toBe(`${CWD}\\bin\\tool.exe`);
    expect(windowsLaunch('C:\\Windows\\System32\\cmd.exe', [], options, files).command).toBe(
      'C:\\Windows\\System32\\cmd.exe',
    );
    expect(windowsLaunch('other\\tool', [], options, files).command).toBe('other\\tool');
  });

  it('leaves a command nothing on PATH answers to as it is', () => {
    expect(windowsLaunch('cmd.exe', [], { cwd: CWD, env: {} }, disk({}))).toEqual({
      command: 'cmd.exe',
      args: [],
    });
    // A script Windows would hand to a script host is not something to launch.
    const files = disk({ [`${NODE_DIR}\\claude.js`]: '', [`${NODE_DIR}\\claude`]: '' });
    expect(windowsLaunch('claude', [], { cwd: CWD, env: env([NODE_DIR]) }, files).command).toBe(
      'claude',
    );
  });

  describe('refuses a batch file it cannot start without a shell', () => {
    const options = { cwd: CWD, env: env([TOOLS_DIR]) };
    const refused = (text: string, others: Record<string, string> = {}): string => {
      const files = disk({ [`${TOOLS_DIR}\\tool.cmd`]: text, ...others });
      try {
        windowsLaunch('tool', ARGS, options, files);
      } catch (err) {
        return String(err);
      }
      return 'started';
    };

    it('a batch file nobody generated', () => {
      const why = refused('@echo off\r\nnode "%~dp0\\cli.js" --flag %1 %2\r\n');
      expect(why).toContain(`${TOOLS_DIR}\\tool.cmd cannot be started in a terminal`);
      expect(why).toContain('not a launcher a package manager wrote');
      expect(why).toContain('cmd.exe');
    });

    it('a launcher naming two different files', () => {
      expect(
        refused('"%~dp0\\node.exe" "%~dp0\\a.js" %*\r\nnode "%~dp0\\b.js" %*\r\n', {
          [`${TOOLS_DIR}\\a.js`]: '',
          [`${TOOLS_DIR}\\b.js`]: '',
        }),
      ).toContain('not a launcher a package manager wrote');
    });

    it('a launcher whose file is gone', () => {
      expect(refused(NPM_PROGRAM_LAUNCHER)).toContain('the file it runs is missing');
    });

    it('a launcher handing its script to something other than Node', () => {
      const script = { [`${TOOLS_DIR}\\node_modules\\some-cli\\cli.js`]: '' };
      expect(refused(npmScriptLauncher('sh'), script)).toContain(
        'does not hand its script straight to Node',
      );
      expect(refused('sh "%~dp0\\run.sh" %*\r\n', { [`${TOOLS_DIR}\\run.sh`]: '' })).toContain(
        'does not hand its script straight to Node',
      );
      // Arguments of the launcher's own between Node and the script are not carried over.
      expect(
        refused('node --no-warnings "%~dp0\\cli.js" %*\r\n', { [`${TOOLS_DIR}\\cli.js`]: '' }),
      ).toContain('does not hand its script straight to Node');
    });

    it('a launcher running by itself something that is not a program', () => {
      expect(refused('"%~dp0\\other.cmd" %*\r\n', { [`${TOOLS_DIR}\\other.cmd`]: '' })).toContain(
        'what it runs by itself is not a program',
      );
    });

    it('a launcher running a program through another one', () => {
      expect(
        refused('wrapper "%~dp0\\inner.exe" %*\r\n', { [`${TOOLS_DIR}\\inner.exe`]: '' }),
      ).toContain('runs a program through another one');
    });

    it('a Node script with no node.exe to run it', () => {
      expect(
        refused(npmScriptLauncher(), { [`${TOOLS_DIR}\\node_modules\\some-cli\\cli.js`]: '' }),
      ).toContain('no node.exe is on PATH');
    });
  });
});
