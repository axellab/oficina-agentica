/**
 * A launch command as it is typed into a VS Code terminal.
 *
 * An extension cannot start a terminal's program with an argument list: the
 * command is text sent to whatever shell the terminal runs, so each word is
 * quoted for that shell. Pure (no `vscode`), so Node can test it.
 */

/** The quoting rules a terminal's shell follows. */
export type LaunchShell = 'posix' | 'powershell' | 'cmd';

/** What the host knows about the shell a new terminal opens. */
export interface TerminalShell {
  /** The extension host's `process.platform`. */
  platform: NodeJS.Platform;
  /** The shell's program, as a path or a bare name; absent = not known. */
  executable?: string;
  /** The terminal profile's name ("PowerShell", "Command Prompt", "Git Bash"),
   *  read when no program is known. */
  profileName?: string;
}

/** Which quoting rules the terminal's shell follows. */
export function launchShellOf({ platform, executable, profileName }: TerminalShell): LaunchShell {
  // The program without its folders (either separator: a Windows path is also
  // read on other hosts) and without `.exe`, else the profile's name.
  const shell = (executable || profileName || '')
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\.exe$/, '');

  if (shell === 'pwsh' || shell === 'powershell') return 'powershell';
  // Windows opens PowerShell when nothing says otherwise.
  if (platform === 'win32' && (!shell || shell.includes('powershell'))) return 'powershell';
  if (shell === 'cmd' || shell.includes('command prompt')) return 'cmd';
  return 'posix';
}

/** Words every shell reads as they are written. Left out on purpose, though
 *  most shells read them plainly: `,` (PowerShell splits the word into two
 *  arguments), `@` (PowerShell splats a word that starts with it), `=` (zsh
 *  expands a word that starts with it into a command's path) and `%`
 *  (PowerShell stops parsing at `--%`). */
const PLAIN_WORD_RE = /^[\w+:./-]+$/;

/** A flag PowerShell passes on whole. One with a `.` is split at it
 *  (`-Dkey.name` arrives as `-Dkey` and `.name`), so anything more than
 *  letters, digits, `_` and `-` is quoted. */
const POWERSHELL_PLAIN_FLAG_RE = /^-[\w-]*$/;

function isPlainWord(word: string, shell: LaunchShell): boolean {
  if (!PLAIN_WORD_RE.test(word)) return false;
  return shell !== 'powershell' || !word.startsWith('-') || POWERSHELL_PLAIN_FLAG_RE.test(word);
}

/**
 * One word, quoted for the shell so the program receives exactly it.
 *
 * - posix and PowerShell: single quotes, in which nothing is special but the
 *   quote itself (`'\''` and `''`). fish follows the posix rule for everything
 *   but a backslash, which a home folder on the systems it runs on never has.
 * - cmd: double quotes, a `"` doubled. cmd still expands `%NAME%` inside them
 *   and has no escape for it at a prompt.
 */
export function shellWord(word: string, shell: LaunchShell): string {
  if (isPlainWord(word, shell)) return word;
  if (shell === 'powershell') return `'${word.replace(/'/g, "''")}'`;
  if (shell === 'posix') return `'${word.replace(/'/g, "'\\''")}'`;
  return `"${word.replace(/"/g, '""')}"`;
}

/** The whole command (the program, then its arguments) as one line for the
 *  shell. */
export function launchCommandLine(words: readonly string[], shell: LaunchShell): string {
  const line = words.map((word) => shellWord(word, shell)).join(' ');
  // PowerShell reads a line that starts with a quoted string as that string,
  // not as a command: the call operator runs it.
  return shell === 'powershell' && line.startsWith("'") ? `& ${line}` : line;
}
