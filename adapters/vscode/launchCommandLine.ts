/**
 * A launch command as it is typed into a VS Code terminal.
 *
 * An extension cannot start a terminal's program with an argument list: the
 * command is text sent to whatever shell the terminal runs, so each word is
 * quoted for that shell. Pure (no `vscode`), so Node can test it.
 */

/** The quoting rules a terminal's shell follows. */
export type LaunchShell = 'posix' | 'fish' | 'powershell' | 'cmd';

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
  if (shell === 'fish') return 'fish';
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

/** What PowerShell reads as a single quote: the ASCII one and the four
 *  typographic ones (U+2018 to U+201B), any of which would end the string. */
const POWERSHELL_QUOTES_RE = /['\u2018-\u201B]/g;

/**
 * One word, quoted for the shell so the program receives exactly it.
 *
 * - POSIX shells: single quotes, in which nothing is special; a quote leaves
 *   them (`'\''`).
 * - fish: single quotes too, but a backslash escapes inside them, so a
 *   backslash and a quote are each written after one.
 * - PowerShell: single quotes, each quote character doubled (which keeps the
 *   character it was).
 * - cmd: double quotes, a `"` doubled. Two things it cannot carry, neither of
 *   which a launch holds: `%NAME%` is expanded even inside the quotes, and a
 *   word ending in a backslash escapes the closing quote.
 */
export function shellWord(word: string, shell: LaunchShell): string {
  if (isPlainWord(word, shell)) return word;
  switch (shell) {
    case 'posix':
      return `'${word.replace(/'/g, "'\\''")}'`;
    case 'fish':
      return `'${word.replace(/[\\']/g, '\\$&')}'`;
    case 'powershell':
      return `'${word.replace(POWERSHELL_QUOTES_RE, '$&$&')}'`;
    case 'cmd':
      return `"${word.replace(/"/g, '""')}"`;
  }
}

/** The whole command (the program, then its arguments) as one line for the
 *  shell. */
export function launchCommandLine(words: readonly string[], shell: LaunchShell): string {
  const line = words.map((word) => shellWord(word, shell)).join(' ');
  // PowerShell reads a line that starts with a quoted string as that string,
  // not as a command: the call operator runs it.
  return shell === 'powershell' && line.startsWith("'") ? `& ${line}` : line;
}
