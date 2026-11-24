/**
 * A Check's output as text, pure: what a command wrote to a pipe, made safe
 * to show in a tool reply and in the office, and its end cut to a size.
 */

// A terminal escape sequence: CSI (colours, cursor moves), OSC (titles,
// links: ended by BEL or the string terminator) and the two-character ones.
// Each opens with ESC and a second character, or with the one C1 control
// character that stands for the pair (U+009B for CSI, U+009D for OSC, U+009C
// for the terminator): a terminal reading UTF-8 obeys both forms.
const ESCAPE_SEQUENCE_RE =
  /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]|(?:\u001b\]|\u009d)[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c)|\u001b[@-Z\\-_]/g;

// Every control character but tab and line feed: the C0 ones, DEL and the C1
// ones (U+0080 to U+009F).
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/**
 * Output as plain lines: escape sequences gone, a carriage return taken as
 * the end of a line (a progress bar redrawn in place becomes its frames, one
 * per line) and no other control character left. What is shown is text: no
 * byte of a command's output can move a cursor or retitle a window.
 */
export function cleanCheckOutput(raw: string): string {
  return raw
    .replace(ESCAPE_SEQUENCE_RE, '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_RE, '')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * The end of `text`, at most `max` characters, starting on a whole line where
 * one starts within reach: a test run says what failed last.
 */
export function outputTail(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const end = text.slice(text.length - max);
  const firstBreak = end.indexOf('\n');
  // Drop the cut line, unless that would drop most of what is kept.
  const whole = firstBreak >= 0 && firstBreak < max / 2 ? end.slice(firstBreak + 1) : end;
  return { text: whole, truncated: true };
}
