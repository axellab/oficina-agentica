import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';

import {
  launchCommandLine,
  type LaunchShell,
  launchShellOf,
  shellWord,
  type TerminalShell,
} from '../../adapters/vscode/launchCommandLine.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';

const SHELLS: LaunchShell[] = ['posix', 'powershell', 'cmd'];
const SESSION_ID = '0b6e2c1a-5d3f-4c8e-9a7b-1f2e3d4c5b6a';

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
    ['fish', { platform: 'linux', executable: '/usr/bin/fish' }, 'posix'],
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

// The line is typed into a real shell, and a program prints the arguments it
// was given: what the quoting is for. PowerShell and cmd are not run here.
describe.skipIf(process.platform === 'win32')('a POSIX shell hands the program every word', () => {
  const WORDS = [
    'plain',
    '--flag',
    '',
    'two words',
    "it's",
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
    'back\\slash',
    'C:\\Users\\Ana',
    'opus[1m]',
    'ñandú',
    '-n',
  ];
  const PRINT_ARGS = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
  const shells = ['sh', 'bash', 'zsh'].filter(
    (shell) => spawnSync(shell, ['-c', 'exit 0']).status === 0,
  );

  it.each(shells)('%s', (shell) => {
    const line = launchCommandLine([process.execPath, '-e', PRINT_ARGS, '--', ...WORDS], 'posix');
    const run = spawnSync(shell, ['-c', line], { encoding: 'utf8' });

    expect(run.stderr).toBe('');
    expect(JSON.parse(run.stdout)).toEqual(WORDS);
  });
});
