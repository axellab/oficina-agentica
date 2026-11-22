import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  launchCommandLine,
  type LaunchShell,
  launchShellOf,
  shellWord,
  type TerminalShell,
} from '../../adapters/vscode/launchCommandLine.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';

const SHELLS: LaunchShell[] = ['posix', 'fish', 'powershell', 'cmd'];
const SESSION_ID = '0b6e2c1a-5d3f-4c8e-9a7b-1f2e3d4c5b6a';
/** The four typographic single quotes PowerShell reads as a quote (U+2018 to
 *  U+201B). The second is the apostrophe a phone or a word processor types. */
const [CURLY_OPEN, CURLY, LOW_QUOTE, REVERSED_QUOTE] = [0x2018, 0x2019, 0x201a, 0x201b].map(
  (code) => String.fromCharCode(code),
);

describe('launchShellOf', () => {
  it.each<[string, TerminalShell, LaunchShell]>([
    ['Windows, nothing known', { platform: 'win32' }, 'powershell'],
    [
      'Windows PowerShell',
      {
        platform: 'win32',
        executable: 'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      },
      'powershell',
    ],
    [
      'PowerShell 7',
      { platform: 'win32', executable: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' },
      'powershell',
    ],
    [
      'the PowerShell profile by name',
      { platform: 'win32', profileName: 'PowerShell' },
      'powershell',
    ],
    [
      'the Windows PowerShell profile by name',
      { platform: 'win32', profileName: 'Windows PowerShell' },
      'powershell',
    ],
    ['cmd', { platform: 'win32', executable: 'C:\\WINDOWS\\System32\\cmd.exe' }, 'cmd'],
    ['cmd in capitals', { platform: 'win32', executable: 'C:\\Windows\\System32\\CMD.EXE' }, 'cmd'],
    [
      'cmd through a settings variable',
      { platform: 'win32', executable: '${env:windir}\\Sysnative\\cmd.exe' },
      'cmd',
    ],
    [
      'the Command Prompt profile by name',
      { platform: 'win32', profileName: 'Command Prompt' },
      'cmd',
    ],
    [
      'Git Bash',
      { platform: 'win32', executable: 'C:\\Program Files\\Git\\bin\\bash.exe' },
      'posix',
    ],
    ['the Git Bash profile by name', { platform: 'win32', profileName: 'Git Bash' }, 'posix'],
    ['WSL', { platform: 'win32', executable: 'C:\\WINDOWS\\System32\\wsl.exe' }, 'posix'],
    [
      'the program over the profile name',
      {
        platform: 'win32',
        executable: 'C:\\Program Files\\Git\\bin\\bash.exe',
        profileName: 'PowerShell',
      },
      'posix',
    ],
    ['Linux, nothing known', { platform: 'linux' }, 'posix'],
    ['bash', { platform: 'linux', executable: '/bin/bash' }, 'posix'],
    ['zsh', { platform: 'darwin', executable: '/bin/zsh' }, 'posix'],
    ['fish', { platform: 'linux', executable: '/usr/bin/fish' }, 'fish'],
    ['fish from Homebrew', { platform: 'darwin', executable: '/opt/homebrew/bin/fish' }, 'fish'],
    ['PowerShell on Linux', { platform: 'linux', executable: '/usr/bin/pwsh' }, 'powershell'],
    [
      'PowerShell on macOS',
      { platform: 'darwin', executable: '/usr/local/bin/pwsh' },
      'powershell',
    ],
  ])('%s', (_name, shell, expected) => {
    expect(launchShellOf(shell)).toBe(expected);
  });
});

describe('shellWord', () => {
  it.each([
    'claude',
    '--session-id',
    '--append-system-prompt-file',
    SESSION_ID,
    'sonnet',
    '/home/ana/.pixel-agents/role-prompts/qa-engineer.md',
  ])('leaves %s as written in every shell', (word) => {
    for (const shell of SHELLS) expect(shellWord(word, shell)).toBe(word);
  });

  it('quotes for a POSIX shell with single quotes', () => {
    expect(shellWord('/home/ana maria/role.md', 'posix')).toBe("'/home/ana maria/role.md'");
    expect(shellWord('/home/$USER/role.md', 'posix')).toBe("'/home/$USER/role.md'");
    expect(shellWord("/home/o'neil/role.md", 'posix')).toBe("'/home/o'\\''neil/role.md'");
    expect(shellWord('C:\\Users\\Ana\\role.md', 'posix')).toBe("'C:\\Users\\Ana\\role.md'");
    expect(shellWord('', 'posix')).toBe("''");
  });

  it('quotes for fish with single quotes, a backslash before each backslash and quote', () => {
    expect(shellWord('/home/ana maria/role.md', 'fish')).toBe("'/home/ana maria/role.md'");
    expect(shellWord('/home/$USER/role.md', 'fish')).toBe("'/home/$USER/role.md'");
    expect(shellWord("/home/o'neil/role.md", 'fish')).toBe("'/home/o\\'neil/role.md'");
    expect(shellWord('C:\\Users\\Ana\\role.md', 'fish')).toBe("'C:\\\\Users\\\\Ana\\\\role.md'");
    // Two backslashes in a row would reach the program as one.
    expect(shellWord('\\\\server\\home', 'fish')).toBe("'\\\\\\\\server\\\\home'");
    expect(shellWord('', 'fish')).toBe("''");
  });

  it('quotes for PowerShell with single quotes, a quote doubled', () => {
    expect(shellWord('C:\\Users\\Ana\\role.md', 'powershell')).toBe("'C:\\Users\\Ana\\role.md'");
    expect(shellWord('C:\\Users\\Ana Maria\\role.md', 'powershell')).toBe(
      "'C:\\Users\\Ana Maria\\role.md'",
    );
    expect(shellWord("C:\\Users\\O'Neil\\role.md", 'powershell')).toBe(
      "'C:\\Users\\O''Neil\\role.md'",
    );
    expect(shellWord('C:\\Users\\$env\\role.md', 'powershell')).toBe("'C:\\Users\\$env\\role.md'");
    expect(shellWord('', 'powershell')).toBe("''");
  });

  it('doubles the typographic quotes PowerShell also ends a string at', () => {
    expect(shellWord(`C:\\Users\\O${CURLY}Neil\\role.md`, 'powershell')).toBe(
      `'C:\\Users\\O${CURLY}${CURLY}Neil\\role.md'`,
    );
    for (const quote of [CURLY_OPEN, CURLY, LOW_QUOTE, REVERSED_QUOTE]) {
      expect(shellWord(`a${quote}b`, 'powershell')).toBe(`'a${quote}${quote}b'`);
    }
    // To the other shells it is a letter like any other.
    expect(shellWord(`/home/o${CURLY}neil/role.md`, 'posix')).toBe(`'/home/o${CURLY}neil/role.md'`);
    expect(shellWord(`/home/o${CURLY}neil/role.md`, 'fish')).toBe(`'/home/o${CURLY}neil/role.md'`);
    expect(shellWord(`C:\\Users\\O${CURLY}Neil`, 'cmd')).toBe(`"C:\\Users\\O${CURLY}Neil"`);
  });

  it('quotes for cmd with double quotes, a quote doubled', () => {
    expect(shellWord('C:\\Users\\Ana\\role.md', 'cmd')).toBe('"C:\\Users\\Ana\\role.md"');
    expect(shellWord('C:\\Users\\Ana Maria\\role.md', 'cmd')).toBe(
      '"C:\\Users\\Ana Maria\\role.md"',
    );
    // An apostrophe means nothing to cmd: single quotes would reach the program.
    expect(shellWord("C:\\Users\\O'Neil\\role.md", 'cmd')).toBe('"C:\\Users\\O\'Neil\\role.md"');
    expect(shellWord('say "hi"', 'cmd')).toBe('"say ""hi"""');
    expect(shellWord('', 'cmd')).toBe('""');
  });

  it('quotes the words a shell would read as something else', () => {
    // PowerShell: two arguments, a splatted variable, the stop-parsing token.
    expect(shellWord('a,b', 'powershell')).toBe("'a,b'");
    expect(shellWord('@args', 'powershell')).toBe("'@args'");
    expect(shellWord('--%', 'powershell')).toBe("'--%'");
    // PowerShell splits a flag at its dot; the other shells do not.
    expect(shellWord('-Dkey.name', 'powershell')).toBe("'-Dkey.name'");
    expect(shellWord('-Dkey.name', 'posix')).toBe('-Dkey.name');
    expect(shellWord('-Dkey.name', 'cmd')).toBe('-Dkey.name');
    // zsh: the path of the command `ls`.
    expect(shellWord('=ls', 'posix')).toBe("'=ls'");
    // A model name with a window suffix: a glob to a POSIX shell.
    expect(shellWord('opus[1m]', 'posix')).toBe("'opus[1m]'");
  });
});

describe('launchCommandLine', () => {
  it('types a launch without a Role as plain words in every shell', () => {
    const launch = claudeProvider.buildLaunchCommand!(SESSION_ID, '/work', {
      bypassPermissions: true,
    });
    for (const shell of SHELLS) {
      expect(launchCommandLine([launch.command, ...launch.args], shell)).toBe(
        `claude --session-id ${SESSION_ID} --dangerously-skip-permissions`,
      );
    }
  });

  it('types a Role launch with its prompt file quoted for the shell', () => {
    const promptFile = "C:\\Users\\Ana O'Neil\\.pixel-agents\\role-prompts\\developer.md";
    const launch = claudeProvider.buildLaunchCommand!(SESSION_ID, 'C:\\work', {
      model: 'opus[1m]',
      appendSystemPromptFile: promptFile,
    });
    const words = [launch.command, ...launch.args];
    const head = `claude --session-id ${SESSION_ID} --model`;

    expect(launchCommandLine(words, 'powershell')).toBe(
      `${head} 'opus[1m]' --append-system-prompt-file ` +
        "'C:\\Users\\Ana O''Neil\\.pixel-agents\\role-prompts\\developer.md'",
    );
    expect(launchCommandLine(words, 'cmd')).toBe(
      `${head} "opus[1m]" --append-system-prompt-file ` +
        '"C:\\Users\\Ana O\'Neil\\.pixel-agents\\role-prompts\\developer.md"',
    );
    expect(launchCommandLine(words, 'posix')).toBe(
      `${head} 'opus[1m]' --append-system-prompt-file ` +
        "'C:\\Users\\Ana O'\\''Neil\\.pixel-agents\\role-prompts\\developer.md'",
    );
    expect(launchCommandLine(words, 'fish')).toBe(
      `${head} 'opus[1m]' --append-system-prompt-file ` +
        "'C:\\\\Users\\\\Ana O\\'Neil\\\\.pixel-agents\\\\role-prompts\\\\developer.md'",
    );
  });

  it('runs a quoted program through the call operator in PowerShell', () => {
    const words = ['C:\\Program Files\\Claude\\claude.exe', '--session-id', SESSION_ID];
    expect(launchCommandLine(words, 'powershell')).toBe(
      `& 'C:\\Program Files\\Claude\\claude.exe' --session-id ${SESSION_ID}`,
    );
    expect(launchCommandLine(words, 'cmd')).toBe(
      `"C:\\Program Files\\Claude\\claude.exe" --session-id ${SESSION_ID}`,
    );
  });
});

// What the quoting is for: the line is typed into each shell this machine has,
// and a program reports the arguments it was given. cmd is never run.
describe('a real shell hands the program every word', () => {
  const WORDS = [
    'plain',
    '--flag',
    '-n',
    '',
    'two words',
    "it's",
    `O${CURLY}Neil`,
    '"quoted"',
    '$HOME',
    '`id`',
    '$(id)',
    'a;b',
    'a&b',
    'a|b',
    '<in>',
    '*',
    '?',
    '~',
    '#comment',
    '=ls',
    'a,b',
    '{a,b}',
    '@args',
    '%self',
    '!history',
    '--%',
    '-Dkey.name',
    'back\\slash',
    'two\\\\backslashes',
    'ends\\',
    'C:\\Users\\Ana',
    'opus[1m]',
    'ñandú',
  ];
  /** Words an older PowerShell loses on the way to a program whatever the
   *  quoting (before 7.3 it drops an empty argument and unwraps a double
   *  quote). A launch holds neither. */
  const LOST_BY_OLD_POWERSHELL = new Set(['', '"quoted"']);

  const REAL_SHELLS: Array<{ program: string; args: string[]; quoting: LaunchShell }> = [
    { program: 'sh', args: ['-c'], quoting: 'posix' },
    { program: 'bash', args: ['-c'], quoting: 'posix' },
    { program: 'zsh', args: ['-c'], quoting: 'posix' },
    { program: 'fish', args: ['-c'], quoting: 'fish' },
    { program: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-Command'], quoting: 'powershell' },
  ];

  /** On Windows a `bash` on the PATH is WSL or MSYS, which rewrite arguments
   *  of their own accord: only PowerShell is run there. */
  function runsHere({ program, quoting }: (typeof REAL_SHELLS)[number]): boolean {
    if (process.platform === 'win32' && quoting !== 'powershell') return false;
    const names = process.platform === 'win32' ? [`${program}.exe`] : [program];
    return (process.env['PATH'] ?? '')
      .split(path.delimiter)
      .some((dir) => names.some((name) => fs.existsSync(path.join(dir, name))));
  }

  let dir: string;
  let printArgs: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-agents-args-'));
    printArgs = path.join(dir, 'print-args.cjs');
    // As hex, so no console encoding stands between the program and the test.
    fs.writeFileSync(
      printArgs,
      "process.stdout.write(Buffer.from(JSON.stringify(process.argv.slice(2))).toString('hex'));\n",
    );
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  for (const shell of REAL_SHELLS) {
    it.skipIf(!runsHere(shell))(
      shell.program,
      () => {
        const words =
          shell.quoting === 'powershell'
            ? WORDS.filter((word) => !LOST_BY_OLD_POWERSHELL.has(word))
            : WORDS;
        const line = launchCommandLine([process.execPath, printArgs, ...words], shell.quoting);
        const run = spawnSync(shell.program, [...shell.args, line], {
          encoding: 'utf8',
          env: { ...process.env, POWERSHELL_TELEMETRY_OPTOUT: '1' },
        });

        const received: unknown = JSON.parse(
          Buffer.from(run.stdout.trim(), 'hex').toString('utf8') || 'null',
        );
        expect(received, `stderr: ${run.stderr}`).toEqual(words);
      },
      30_000,
    );
  }
});
