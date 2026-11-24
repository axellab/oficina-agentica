/**
 * A Check's output as text, pure: what a command wrote to a pipe, made safe
 * to show in a tool reply and in the office, and its end cut to a size.
 */

// A terminal escape sequence: CSI (colours, cursor moves), OSC (titles,
// links: ended by BEL or ESC \) and the two-character ones.
const ESCAPE_SEQUENCE_RE =
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

// Every control character but tab and line feed.
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

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
