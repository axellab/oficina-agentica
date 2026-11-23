#!/usr/bin/env node
/**
 * The local trial: one measured run of this checkout's office with the real
 * CLI, driven the way an office drives it (the `/ws` protocol), with nobody at
 * the keyboard.
 *
 *   node scripts/local-trial.mjs sample <folder>
 *       Write a small repository with planted defects to try the Roles on.
 *
 *   node scripts/local-trial.mjs reset-sample <folder>
 *       Put that repository back on `main` after a run whose agents left it
 *       on a branch of theirs (which stays).
 *
 *   node scripts/local-trial.mjs run --dir <folder> --preset <name> [options]
 *       Start the office in <folder>, launch what the preset names, watch it
 *       to its end, close what it launched and write what it measured under
 *       trial-runs/ (a summary in Markdown and JSON, every office message
 *       with its time, the agents' terminal screens and each agent's last
 *       words as its transcript has them).
 *
 * What it never does: answer a permission prompt (a prompt nobody answers ends
 * the run and is reported), stop an office that is already running (it stops
 * before starting its own), print the office's token, or write under
 * `~/.claude`. What it changes outside its own folder is listed in the
 * summary's "Left on this machine".
 */

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'dist', 'cli.js');
const PRINTED_URL = /Pixel Agents server running at (\S+)\s/;

/**
 * Variables the office is not started with. A trial is often started from
 * inside a Claude Code session, which exports its own markers and settings to
 * everything under it; and `ANTHROPIC_*` (an API key, a base URL, a model)
 * sends a CLI to another account than its own login, when the trial measures
 * the plan that login is on. `CLAUDE_CONFIG_DIR` stays: it says where the
 * login is kept. `--keep-env` starts the office with all of them.
 */
const NOT_FOR_THE_OFFICE =
  /^(?:CLAUDE(?!_CONFIG_DIR$)|ANTHROPIC_|USE_(?:STAGING|LOCAL)_OAUTH$|AI_AGENT$|API_TIMEOUT_MS$|DISABLE_MICROCOMPACT$|MCP_(?:CONNECTION_NONBLOCKING|SERVER_CONNECTION_BATCH_SIZE)$|BAGGAGE$|SENTRY-TRACE$|BUN_ENABLE_CRASH_REPORTING$|NO_COLOR$|FORCE_COLOR$|GIT_(?:EDITOR|PAGER|ASKPASS|TERMINAL_PROMPT|SEQUENCE_EDITOR)$)/i;

/** Set for the run: the agents must not update the CLI being measured. */
const SET_FOR_THE_OFFICE = { DISABLE_AUTOUPDATER: '1' };

// ── What a run can be ─────────────────────────────────────────

/** The sample repository's own requests. `--request` / `--prompt` replace the words. */
const PRESETS = {
  'role-check': {
    scenario: 'role',
    roleId: 'qa-engineer',
    prompt:
      'Answer in at most six lines and run no tool. Which Role were you launched as? Which Playbooks do you have as skills, by skill name? Do you see tools whose names start with mcp__pixel-office__?',
  },
  'bug-fix': {
    scenario: 'workflow',
    workflowId: 'bug-fix',
    request:
      'npm test fails in this repository: the discount test expects applyDiscount(100, 10) to be 90 and gets 110. Find the cause, fix it with the smallest change, and prove the suite is green. Do not push anything.',
  },
  'security-review': {
    scenario: 'workflow',
    workflowId: 'security-review',
    request:
      'Review this small shop module for security problems before its first release. Rank what you find, each with its file and line as evidence. Change no code and install nothing.',
  },
  'quality-review': {
    scenario: 'workflow',
    workflowId: 'quality-review',
    request:
      'Say how healthy this small shop module is: its code, its tests and what is missing. Rank what you find, each with its file and line. Change no code and install nothing.',
  },
};

const DEFAULTS = {
  maxMinutes: 20,
  /** Every agent idle this long with the work unfinished: the run is waiting on the user. */
  idleSeconds: 180,
  /** A permission prompt nobody answered for this long ends the run. */
  permissionWaitSeconds: 120,
  /** Idle this long after the last stage closed: the run is over. */
  settleSeconds: 20,
  /** Output tokens across the run's agents after which it is stopped. */
  maxOutputTokens: 150_000,
  launchTimeoutSeconds: 120,
};

// ── Small helpers ─────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      opts._.push(arg);
      continue;
    }
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) opts[arg.slice(2)] = true;
    else {
      opts[arg.slice(2)] = next;
      i++;
    }
  }
  return { command, opts };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function sha256(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function git(cwd, ...args) {
  const out = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return out.status === 0 ? out.stdout.trim() : null;
}

/** Where a folder's repository stands, as `<branch> <commit>`; null outside one. */
function gitState(dir) {
  const commit = git(dir, 'rev-parse', '--short', 'HEAD');
  if (commit === null) return null;
  return `${git(dir, 'rev-parse', '--abbrev-ref', 'HEAD') ?? '?'} ${commit}`;
}

function seconds(ms) {
  return ms === undefined || ms === null ? '' : `${(ms / 1000).toFixed(1)} s`;
}

function fail(message, code = 1) {
  console.error(`[trial] ${message}`);
  process.exit(code);
}

// ── The sample repository ─────────────────────────────────────

/** A shop module small enough to read in a minute, with defects planted in it
 *  (listed in `PLANTED`, never in the files: finding them is the agents' work). */
const SAMPLE_FILES = {
  'package.json': `${JSON.stringify(
    {
      name: 'trial-shop',
      version: '0.1.0',
      private: true,
      description: 'A small shop module: prices, a cart, users and a sales report.',
      scripts: { test: 'node --test' },
    },
    null,
    2,
  )}\n`,
  'README.md': [
    '# trial-shop',
    '',
    'A small shop module: prices and discounts, a cart, user lookup and a sales report.',
    '',
    '- `src/pricing.js`: discounts and the cart total',
    '- `src/users.js`: user lookup in the database',
    '- `src/report.js`: the sales report',
    '- `src/config.js`: settings',
    '',
    "Tests: `npm test` (Node's own runner, nothing to install).",
    '',
  ].join('\n'),
  'src/pricing.js': [
    "'use strict';",
    '',
    '/** The price after a discount of `percent` (0 to 100). */',
    'function applyDiscount(price, percent) {',
    '  if (percent < 0 || percent > 100) {',
    "    throw new RangeError('percent must be between 0 and 100');",
    '  }',
    '  return price + (price * percent) / 100;',
    '}',
    '',
    '/** The total of a cart: a list of { price, quantity }. */',
    'function cartTotal(items) {',
    '  let total = 0;',
    '  for (let i = 0; i <= items.length; i++) {',
    '    total += items[i].price * items[i].quantity;',
    '  }',
    '  return total;',
    '}',
    '',
    '/** A price as text: 12.5 is "$12.50". */',
    'function formatPrice(value) {',
    "  return '$' + (Math.round(value * 100) / 100).toFixed(2);",
    '}',
    '',
    'module.exports = { applyDiscount, cartTotal, formatPrice };',
    '',
  ].join('\n'),
  'src/users.js': [
    "'use strict';",
    '',
    '/** The user called `name`, or undefined. `db.query(sql)` returns the rows. */',
    'async function findUserByName(db, name) {',
    '  const rows = await db.query("SELECT id, name, email FROM users WHERE name = \'" + name + "\'");',
    '  return rows[0];',
    '}',
    '',
    'module.exports = { findUserByName };',
    '',
  ].join('\n'),
  'src/report.js': [
    "'use strict';",
    '',
    "const { exec } = require('node:child_process');",
    '',
    "/** How many sales a day's file holds: one line each. `file` comes from the request. */",
    'function countSales(file, done) {',
    "  exec('wc -l ' + file, (err, stdout) => {",
    '    if (err) return done(err);',
    '    done(null, Number.parseInt(stdout, 10));',
    '  });',
    '}',
    '',
    '/** A price as text: 12.5 is "$12.50". */',
    'function formatPrice(value) {',
    "  return '$' + (Math.round(value * 100) / 100).toFixed(2);",
    '}',
    '',
    'function reportLine(day, total) {',
    "  return day + ': ' + formatPrice(total);",
    '}',
    '',
    'module.exports = { countSales, reportLine };',
    '',
  ].join('\n'),
  'src/config.js': [
    "'use strict';",
    '',
    'module.exports = {',
    "  dbHost: 'localhost',",
    "  dbUser: 'shop',",
    "  dbPassword: 'hunter2-trial-not-a-secret',",
    '  reportDir: process.env.REPORT_DIR,',
    '};',
    '',
  ].join('\n'),
  'test/pricing.test.js': [
    "'use strict';",
    '',
    "const assert = require('node:assert/strict');",
    "const { test } = require('node:test');",
    '',
    "const { applyDiscount, formatPrice } = require('../src/pricing');",
    '',
    "test('a 10% discount on 100 is 90', () => {",
    '  assert.equal(applyDiscount(100, 10), 90);',
    '});',
    '',
    "test('no discount leaves the price', () => {",
    '  assert.equal(applyDiscount(80, 0), 80);',
    '});',
    '',
    "test('a discount outside 0 to 100 is refused', () => {",
    '  assert.throws(() => applyDiscount(100, 101), RangeError);',
    '});',
    '',
    "test('a price is shown with two decimals', () => {",
    "  assert.equal(formatPrice(12.5), '$12.50');",
    '});',
    '',
  ].join('\n'),
};

/** What was planted, for whoever scores a run's findings. */
const PLANTED = [
  'src/pricing.js applyDiscount adds the discount instead of taking it off (a test fails on it)',
  'src/pricing.js cartTotal reads one item past the end (throws on every cart) and has no test',
  'src/users.js findUserByName builds its SQL by joining text (SQL injection)',
  'src/report.js countSales passes a request value to a shell (command injection)',
  'src/config.js holds a database password in the code',
  'src/report.js formatPrice is a copy of the one in src/pricing.js',
  'src/users.js and src/report.js have no tests',
];

/** Who the sample's first commit is by: how a folder is known to be a sample. */
const SAMPLE_AUTHOR = 'trial@example.invalid';

function writeSample(dir) {
  if (!dir) fail('sample: name the folder to write it in');
  const target = path.resolve(dir);
  fs.mkdirSync(target, { recursive: true });
  const there = fs.readdirSync(target);
  if (there.length > 0)
    fail(`sample: ${target} is not empty (${there.length} entries); nothing written`, 3);
  for (const [name, text] of Object.entries(SAMPLE_FILES)) {
    const file = path.join(target, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  // A repository with one commit, so a change shows as a diff. The author is
  // given on the command line: no git setting is read or written.
  let committed = false;
  if (git(target, 'init', '--quiet', '--initial-branch=main') !== null) {
    git(target, 'add', '-A');
    committed =
      git(
        target,
        '-c',
        'user.name=Agent Office trial',
        '-c',
        `user.email=${SAMPLE_AUTHOR}`,
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'Sample shop module for the Agent Office trial',
      ) !== null;
  }
  console.log(`[trial] sample written to ${target} (${Object.keys(SAMPLE_FILES).length} files)`);
  console.log(`[trial] git repository with a first commit: ${committed ? 'yes' : 'no'}`);
  console.log('[trial] planted:');
  for (const line of PLANTED) console.log(`  - ${line}`);
}

/**
 * Puts a sample back on `main`, where every run starts: an agent that fixed
 * something leaves the folder on its own branch. Only a folder this script
 * wrote, only with nothing uncommitted in it, and nothing is deleted: the
 * agents' branches stay.
 */
function resetSample(dir) {
  if (!dir) fail('reset-sample: name the sample folder');
  const target = path.resolve(dir);
  if (git(target, 'log', '--max-parents=0', '--format=%ae', 'main') !== SAMPLE_AUTHOR)
    fail(`reset-sample: ${target} is not a sample this script wrote; nothing done`, 3);
  const uncommitted = git(target, 'status', '--porcelain');
  if (uncommitted !== '')
    fail(`reset-sample: ${target} has uncommitted changes; nothing done\n${uncommitted ?? ''}`, 3);
  const was = gitState(target);
  if (git(target, 'checkout', '--quiet', 'main') === null)
    fail(`reset-sample: could not check out main in ${target}`, 3);
  console.log(`[trial] ${target}: ${was} -> ${gitState(target)}`);
  const others = (git(target, 'branch', '--format=%(refname:short)') ?? '')
    .split('\n')
    .filter((name) => name && name !== 'main');
  if (others.length > 0) console.log(`[trial] branches left as they were: ${others.join(', ')}`);
}

// ── Reading the agents' transcripts ───────────────────────────

/**
 * What one transcript says its session used. A message is written once per
 * content block with the same usage, so messages are counted by id.
 */
function transcriptUsage(file) {
  const out = {
    file,
    models: {},
    messages: 0,
    toolUses: 0,
    userPrompts: 0,
    first: null,
    last: null,
    cwd: null,
    lastWords: null,
  };
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  const byMessage = new Map();
  // What each message said, in the order the messages were written.
  const said = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof record.timestamp === 'string') {
      out.first ??= record.timestamp;
      out.last = record.timestamp;
    }
    if (typeof record.cwd === 'string') out.cwd ??= record.cwd;
    const message = record.message;
    if (record.type === 'user' && message && typeof message.content === 'string') out.userPrompts++;
    if (record.type !== 'assistant' || !message) continue;
    const id = message.id ?? record.uuid;
    if (Array.isArray(message.content)) {
      out.toolUses += message.content.filter((block) => block?.type === 'tool_use').length;
      // A sidechain record is a sub-agent's turn, not this session's own words.
      if (record.isSidechain !== true) {
        for (const block of message.content) {
          if (block?.type !== 'text' || typeof block.text !== 'string' || !block.text.trim())
            continue;
          said.set(id, [...(said.get(id) ?? []), block.text]);
        }
      }
    }
    const usage = message.usage;
    if (!usage) continue;
    const seen = byMessage.get(id) ?? {
      model: message.model ?? 'unknown',
      input: 0,
      create: 0,
      read: 0,
      output: 0,
    };
    seen.input = Math.max(seen.input, usage.input_tokens ?? 0);
    seen.create = Math.max(seen.create, usage.cache_creation_input_tokens ?? 0);
    seen.read = Math.max(seen.read, usage.cache_read_input_tokens ?? 0);
    seen.output = Math.max(seen.output, usage.output_tokens ?? 0);
    byMessage.set(id, seen);
  }
  for (const seen of byMessage.values()) {
    // All zero is a synthetic record (an API error, an interrupt): no message.
    if (seen.input + seen.create + seen.read + seen.output === 0) continue;
    const model = (out.models[seen.model] ??= {
      messages: 0,
      input: 0,
      cacheCreation: 0,
      cacheRead: 0,
      output: 0,
    });
    model.messages++;
    model.input += seen.input;
    model.cacheCreation += seen.create;
    model.cacheRead += seen.read;
    model.output += seen.output;
    out.messages++;
  }
  out.lastWords = [...said.values()].pop()?.join('\n\n') ?? null;
  return out;
}

function addUsage(into, models) {
  for (const [model, usage] of Object.entries(models)) {
    const sum = (into[model] ??= {
      messages: 0,
      input: 0,
      cacheCreation: 0,
      cacheRead: 0,
      output: 0,
    });
    for (const key of Object.keys(sum)) sum[key] += usage[key];
  }
  return into;
}

function totalOf(models) {
  const total = { messages: 0, input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
  for (const usage of Object.values(models))
    for (const key of Object.keys(total)) total[key] += usage[key];
  return total;
}

/** A session's usage: its transcript plus its sub-agents' (`<session>/subagents/`). */
function sessionUsage(jsonlFile) {
  const main = transcriptUsage(jsonlFile);
  const models = addUsage({}, main.models);
  let subagents = 0;
  const side = path.join(jsonlFile.replace(/\.jsonl$/, ''), 'subagents');
  try {
    for (const name of fs.readdirSync(side)) {
      if (!name.endsWith('.jsonl')) continue;
      addUsage(models, transcriptUsage(path.join(side, name)).models);
      subagents++;
    }
  } catch {
    // No sub-agents.
  }
  return { ...main, models, subagents };
}

// ── A terminal, read as text ──────────────────────────────────

/** Mirrors one agent's terminal off its `/terminal/:id` socket (read only, unless `type` is called). */
class TerminalMirror {
  constructor(WebSocket, url, origin) {
    const { Terminal } = require('@xterm/headless');
    this.Terminal = Terminal;
    this.term = null;
    this.pending = Promise.resolve();
    this.lastOutputAt = Date.now();
    this.exited = null;
    this.socket = new WebSocket(url, { origin });
    this.socket.on('message', (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (frame.type === 'replay') {
        this.term = new this.Terminal({
          cols: frame.cols || 120,
          rows: frame.rows || 40,
          scrollback: 5000,
          allowProposedApi: true,
        });
        this.write(frame.data ?? '');
      } else if (frame.type === 'output') {
        this.lastOutputAt = Date.now();
        this.write(frame.data ?? '');
      } else if (frame.type === 'exit') {
        this.exited = { exitCode: frame.exitCode, signal: frame.signal };
      }
    });
    this.socket.on('error', () => {});
  }

  write(data) {
    if (!this.term) return;
    this.pending = this.pending.then(
      () => new Promise((resolve) => this.term.write(data, resolve)),
    );
  }

  /** The screen as text; with `scrollback`, everything the terminal still holds. */
  async text({ scrollback = false } = {}) {
    await this.pending;
    if (!this.term) return '';
    const buffer = this.term.buffer.active;
    const lines = [];
    for (let y = scrollback ? 0 : buffer.baseY; y < buffer.length; y++) {
      lines.push(buffer.getLine(y)?.translateToString(true) ?? '');
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    return lines.join('\n');
  }

  quietFor() {
    return Date.now() - this.lastOutputAt;
  }

  /** Type text as one paste, then Enter as its own write once the paste landed. */
  async type(text) {
    this.socket.send(
      JSON.stringify({
        type: 'input',
        data: `\u001b[200~${text.replace(/\r?\n/g, ' ')}\u001b[201~`,
      }),
    );
    await sleep(900);
    this.socket.send(JSON.stringify({ type: 'input', data: '\r' }));
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // Already closed.
    }
  }
}

// ── The run ───────────────────────────────────────────────────

async function run(opts) {
  const preset = PRESETS[opts.preset];
  if (!preset) fail(`run: --preset must be one of ${Object.keys(PRESETS).join(', ')}`);
  if (!opts.dir) fail('run: --dir <folder> is the folder the agents work in');
  const dir = path.resolve(String(opts.dir));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(`run: ${dir} is not a folder`);
  if (!fs.existsSync(CLI))
    fail(`run: ${CLI} is missing. Build first: node esbuild.js && npm run build:webview`);

  const scenario = {
    ...preset,
    ...(typeof opts.role === 'string' ? { roleId: opts.role } : {}),
    ...(typeof opts.workflow === 'string' ? { workflowId: opts.workflow } : {}),
    ...(typeof opts.request === 'string' ? { request: opts.request } : {}),
    ...(typeof opts.prompt === 'string' ? { prompt: opts.prompt } : {}),
  };
  const limit = (name, fallback) => (opts[name] !== undefined ? Number(opts[name]) : fallback);
  const limits = {
    maxMs: limit('max-minutes', DEFAULTS.maxMinutes) * 60_000,
    idleMs: limit('idle-seconds', DEFAULTS.idleSeconds) * 1000,
    permissionMs: limit('permission-wait-seconds', DEFAULTS.permissionWaitSeconds) * 1000,
    settleMs: limit('settle-seconds', DEFAULTS.settleSeconds) * 1000,
    maxOutputTokens: limit('max-output-tokens', DEFAULTS.maxOutputTokens),
    launchMs: limit('launch-timeout-seconds', DEFAULTS.launchTimeoutSeconds) * 1000,
  };
  const grantMcp = opts['grant-mcp'] === true;
  const keepMcpConsent = opts['keep-mcp-consent'] === true;

  // `--home` (the harness's own tests): another home for the office and its agents.
  const home = typeof opts.home === 'string' ? path.resolve(opts.home) : os.homedir();
  const officeDir = path.join(home, '.pixel-agents');
  const configFile = path.join(officeDir, 'config.json');
  const stateFile = path.join(officeDir, 'standalone-state.json');
  const claudeSettings = path.join(home, '.claude', 'settings.json');
  const hookScript = path.join(officeDir, 'hooks', 'claude-hook.js');

  // ── An office already running stops everything: it is never ours to stop ──
  const running = [];
  const legacy = readJson(path.join(officeDir, 'server.json'));
  if (legacy && isAlive(legacy.pid)) running.push({ pid: legacy.pid, port: legacy.port });
  try {
    for (const name of fs.readdirSync(path.join(officeDir, 'servers'))) {
      const entry = readJson(path.join(officeDir, 'servers', name));
      if (entry && isAlive(entry.pid) && !running.some((r) => r.pid === entry.pid)) {
        running.push({ pid: entry.pid, port: entry.port });
      }
    }
  } catch {
    // No registry yet.
  }
  if (running.length > 0) {
    fail(
      `an office is already running on this machine (${running
        .map((r) => `pid ${r.pid}, port ${r.port}`)
        .join('; ')}). The trial starts its own and never stops another: close that one first.`,
      3,
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.resolve(
    typeof opts.out === 'string'
      ? opts.out
      : path.join(REPO_ROOT, 'trial-runs', `${stamp}-${opts.preset}`),
  );
  fs.mkdirSync(path.join(outDir, 'screens'), { recursive: true });

  const before = {
    config: readJson(configFile) ?? {},
    claudeSettingsHash: sha256(claudeSettings),
    hookScriptHash: sha256(hookScript),
    freeMemMb: Math.round(os.freemem() / 1048576),
    git: gitState(dir),
  };
  const mcpConsentBefore = before.config.officeMcpConsent ?? 'unanswered';

  const startedAt = Date.now();
  const t = () => Date.now() - startedAt;
  let token = '';
  const mask = (text) => {
    let out = String(text);
    if (token) out = out.split(token).join('<token>');
    return out.replace(/token=[^\s&"']+/g, 'token=<masked>');
  };
  const say = (line) => console.log(`[trial ${seconds(t()).padStart(8)}] ${mask(line)}`);

  // ── Start the office ──
  const port = opts.port !== undefined ? Number(opts.port) : await freePort();
  // Names only are kept for the report, never a value.
  const env = {};
  const envRemoved = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (opts['keep-env'] !== true && NOT_FOR_THE_OFFICE.test(name)) envRemoved.push(name);
    else env[name] = value;
  }
  const envSet = opts['keep-env'] === true ? {} : SET_FOR_THE_OFFICE;
  Object.assign(env, envSet);
  if (typeof opts.home === 'string') {
    env.HOME = home;
    env.USERPROFILE = home;
  }
  if (typeof opts['path-prepend'] === 'string') {
    env.PATH = `${path.resolve(opts['path-prepend'])}${path.delimiter}${env.PATH ?? ''}`;
    env.PIXEL_AGENTS_NODE_BIN = process.execPath;
  }
  const cliArgs = [CLI, '--port', String(port), '--host', '127.0.0.1'];
  if (opts['no-trust'] !== true) cliArgs.push('--trust-directories');
  const server = spawn(process.execPath, cliArgs, {
    cwd: dir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOut = '';
  let serverExit = null;
  server.stdout.on('data', (chunk) => (serverOut += chunk.toString()));
  server.stderr.on('data', (chunk) => (serverOut += chunk.toString()));
  server.on('exit', (code, signal) => (serverExit = { code, signal, at: t() }));

  let printedUrl = null;
  while (!printedUrl && !serverExit && t() < 90_000) {
    printedUrl = PRINTED_URL.exec(serverOut)?.[1] ?? null;
    if (!printedUrl) await sleep(100);
  }
  if (!printedUrl) {
    fs.writeFileSync(path.join(outDir, 'server.log'), mask(serverOut));
    if (!serverExit) server.kill();
    fail(`the office never printed its address (see ${path.join(outDir, 'server.log')})`);
  }
  const serverStartMs = t();
  token = new URL(printedUrl).searchParams.get('token') ?? '';
  const origin = `http://127.0.0.1:${port}`;
  say(`office up in ${seconds(serverStartMs)} on port ${port} (pid ${server.pid})`);

  // ── Connect as an office does ──
  const WebSocket = require('ws');
  const messagesFile = fs.createWriteStream(path.join(outDir, 'messages.jsonl'));
  const record = (direction, msg) => {
    let text = JSON.stringify(msg);
    if (text.length > 6000) {
      const kept = { type: msg.type, bytes: text.length };
      if (msg.type === 'workflowsLoaded')
        Object.assign(kept, { available: msg.available, runs: msg.runs });
      text = JSON.stringify(kept);
    }
    messagesFile.write(`${JSON.stringify({ t: t(), d: direction })}\t${mask(text)}\n`);
  };

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`, {
    origin,
  });
  const send = (msg) => {
    record('out', msg);
    ws.send(JSON.stringify(msg));
  };

  // What the office says, kept as it arrives.
  const office = {
    access: null,
    terminal: null,
    mcp: null,
    roles: [],
    workflows: null,
    crewsAvailable: null,
    hooksAsked: [],
    mcpAsked: false,
    preexisting: new Set(),
    snapshotAt: null,
  };
  const agents = new Map();
  const mirrors = new Map();
  const stageEvents = [];
  const crewEvents = [];
  const crewMembers = new Map();
  const notes = [];
  let scenarioAt = null;
  let rejected = null;
  let runInfo = null;
  let runGoneAt = null;
  let lastActivityAt = 0;
  const touch = () => (lastActivityAt = t());

  const agentOf = (id) => {
    let agent = agents.get(id);
    if (!agent) {
      agent = {
        id,
        ours: false,
        role: null,
        directoryName: null,
        nickname: null,
        external: false,
        createdAt: null,
        closedAt: null,
        status: null,
        statusAt: null,
        firstActiveAt: null,
        activeMs: 0,
        waitingMs: 0,
        turns: 0,
        awaitingInput: false,
        toolCalls: 0,
        tools: {},
        permissionWaits: [],
        permissionSince: null,
        context: null,
        session: null,
        launch: null,
      };
      agents.set(id, agent);
    }
    return agent;
  };
  const ours = () => [...agents.values()].filter((a) => a.ours);
  const oursOpen = () => ours().filter((a) => a.closedAt === null);

  const setStatus = (agent, status, awaitingInput) => {
    const now = t();
    if (agent.status === 'active') agent.activeMs += now - agent.statusAt;
    if (agent.status === 'waiting') agent.waitingMs += now - agent.statusAt;
    if (agent.status === 'active' && status === 'waiting') agent.turns++;
    if (status === 'active') agent.firstActiveAt ??= now;
    agent.status = status;
    agent.statusAt = now;
    agent.awaitingInput = status === 'waiting' && awaitingInput === true;
  };

  const saveScreen = async (agent, label) => {
    const mirror = mirrors.get(agent.id);
    if (!mirror) return null;
    const name = `agent-${agent.id}-${label}.txt`;
    try {
      fs.writeFileSync(
        path.join(outDir, 'screens', name),
        mask(await mirror.text({ scrollback: label === 'final' })),
      );
      return `screens/${name}`;
    } catch {
      return null;
    }
  };

  // The office's own browser page, for pictures of the run (best effort).
  const shots = {
    wanted: opts.screenshots === true,
    taken: [],
    error: null,
    browser: null,
    page: null,
    lastAt: 0,
  };
  const shoot = async (label, { force = false } = {}) => {
    if (!shots.page || shots.taken.length >= 14) return;
    if (!force && t() - shots.lastAt < 20_000) return;
    shots.lastAt = t();
    const name = `${String(shots.taken.length + 1).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
    try {
      // The Workflow panel opened, so a picture shows the stages and where each stands.
      const show = shots.page.getByRole('button', { name: 'Show the workflow' });
      if ((await show.count()) > 0)
        await show
          .first()
          .click({ timeout: 2000 })
          .catch(() => {});
      await shots.page.screenshot({ path: path.join(outDir, 'shots', name) });
      shots.taken.push({ at: t(), file: `shots/${name}` });
    } catch (err) {
      shots.error ??= String(err.message ?? err).split('\n')[0];
    }
  };

  const onRun = (runs) => {
    const listed = Array.isArray(runs) ? runs : [];
    if (!runInfo) {
      const found = listed.find((r) => r.workflowId === scenario.workflowId);
      if (!found || scenarioAt === null) return;
      runInfo = {
        crewId: found.crewId,
        name: found.name,
        leadAgentId: null,
        finishedAt: null,
        stages: new Map(),
      };
      say(`workflow run listed: ${found.name}`);
    }
    const current = listed.find((r) => r.crewId === runInfo.crewId);
    if (!current) {
      runGoneAt ??= t();
      return;
    }
    if (current.leadAgentId !== undefined) runInfo.leadAgentId = current.leadAgentId;
    for (const stage of current.stages) {
      const known = runInfo.stages.get(stage.id) ?? {
        id: stage.id,
        title: stage.title,
        roleName: stage.roleName,
        parallel: stage.parallel === true,
        state: 'pending',
        startedAt: null,
        closedAt: null,
        note: null,
        starts: 0,
      };
      if (known.state !== stage.state) {
        stageEvents.push({
          at: t(),
          stage: stage.id,
          title: stage.title,
          from: known.state,
          to: stage.state,
          note: stage.note ?? null,
        });
        say(`stage "${stage.title}" (${stage.roleName}): ${known.state} -> ${stage.state}`);
        if (stage.state === 'active') {
          known.startedAt ??= t();
          known.starts++;
          known.closedAt = null;
        }
        if (stage.state === 'done' || stage.state === 'skipped') known.closedAt = t();
        known.state = stage.state;
        touch();
        void shoot(`stage-${stage.id}-${stage.state}`);
      }
      if (stage.note) known.note = stage.note;
      runInfo.stages.set(stage.id, known);
    }
    if (current.finished && runInfo.finishedAt === null) {
      runInfo.finishedAt = t();
      say('workflow run finished: every stage is closed');
    }
  };

  const onMessage = (msg) => {
    record('in', msg);
    switch (msg.type) {
      case 'officeAccess':
        office.access = { readOnly: msg.readOnly === true };
        break;
      case 'terminalAvailability':
        office.terminal = { available: msg.available === true, reason: msg.reason ?? null };
        break;
      case 'officeMcpStatus':
        office.mcp = { consent: msg.consent, readOnly: msg.readOnly === true };
        break;
      case 'officeMcpConsentRequest':
        office.mcpAsked = true;
        break;
      case 'hooksConsentRequest':
        office.hooksAsked.push(msg.providerId);
        break;
      case 'rolesLoaded':
        office.roles = (msg.roles ?? []).map((role) => ({
          id: role.id,
          name: role.name,
          playbooks: role.playbooks ?? [],
        }));
        break;
      case 'crewsLoaded':
        office.crewsAvailable = {
          available: msg.available === true,
          reason: msg.unavailableReason ?? null,
        };
        for (const crew of msg.crews ?? []) {
          for (const member of crew.members ?? []) {
            if (!crewMembers.has(member.agentId)) {
              crewMembers.set(member.agentId, { ...member, crewId: crew.id, at: t() });
            }
          }
          for (const event of crew.events ?? []) {
            const key = `${event.at}:${event.kind}:${event.fromId}:${(event.toIds ?? []).join(',')}`;
            if (crewEvents.some((seen) => seen.key === key)) continue;
            crewEvents.push({
              key,
              at: event.at - startedAt,
              kind: event.kind,
              from: event.from,
              to: event.to,
              gist: event.gist ?? null,
            });
            say(`crew: ${event.from} ${event.kind} ${(event.to ?? []).join(', ')}`);
            touch();
          }
        }
        break;
      case 'workflowsLoaded':
        office.workflows = {
          available: msg.available === true,
          reason: msg.unavailableReason ?? null,
          ids: (msg.workflows ?? []).map((w) => w.id),
        };
        onRun(msg.runs);
        break;
      case 'workflowRejected':
        rejected = msg.reason ?? 'rejected';
        break;
      case 'existingAgents':
        if (office.snapshotAt === null) {
          for (const id of msg.agents ?? []) {
            office.preexisting.add(id);
            const agent = agentOf(id);
            agent.role = msg.roles?.[String(id)]?.name ?? null;
            agent.directoryName = msg.directoryNames?.[String(id)] ?? null;
            agent.external = msg.externalAgents?.[String(id)] === true;
          }
          office.snapshotAt = t();
        }
        break;
      case 'agentCreated': {
        const agent = agentOf(msg.id);
        agent.createdAt ??= t();
        agent.role = msg.role?.name ?? null;
        agent.roleId = msg.role?.id ?? null;
        agent.directoryName = msg.directoryName ?? null;
        agent.nickname = msg.nickname ?? null;
        agent.external = msg.isExternal === true;
        agent.ours = scenarioAt !== null && !agent.external && !office.preexisting.has(msg.id);
        say(
          `agent ${msg.id} joined${agent.role ? ` as ${agent.role}` : ''}${agent.ours ? '' : " (not this run's)"}`,
        );
        if (agent.ours) {
          touch();
          attachTerminal(agent.id);
          setTimeout(() => void shoot(`agent-${agent.id}-joined`), 4000);
        }
        break;
      }
      case 'agentClosed': {
        const agent = agentOf(msg.id);
        if (agent.status) setStatus(agent, null);
        agent.closedAt ??= t();
        if (agent.ours) say(`agent ${msg.id} left`);
        break;
      }
      case 'agentStatus': {
        const agent = agentOf(msg.id);
        if (agent.status !== msg.status) setStatus(agent, msg.status, msg.awaitingInput);
        else agent.awaitingInput = msg.status === 'waiting' && msg.awaitingInput === true;
        if (agent.ours) touch();
        break;
      }
      case 'agentToolStart': {
        const agent = agentOf(msg.id);
        const name = msg.toolName ?? String(msg.status ?? 'tool').split(/[ :]/)[0];
        agent.toolCalls++;
        agent.tools[name] = (agent.tools[name] ?? 0) + 1;
        if (agent.ours) touch();
        break;
      }
      case 'agentToolDone':
      case 'subagentToolStart':
      case 'subagentToolDone':
        if (agents.get(msg.id)?.ours) touch();
        break;
      case 'agentToolPermission': {
        const agent = agentOf(msg.id);
        if (agent.permissionSince === null) {
          agent.permissionSince = t();
          const wait = { at: t(), ms: null, screen: null };
          agent.permissionWaits.push(wait);
          if (agent.ours) {
            say(`agent ${msg.id} is waiting on a permission prompt (nobody answers it here)`);
            setTimeout(() => {
              void saveScreen(agent, `permission-${agent.permissionWaits.length}`).then(
                (file) => (wait.screen = file),
              );
              void shoot(`permission-agent-${agent.id}`, { force: true });
            }, 1500);
          }
        }
        break;
      }
      case 'agentToolPermissionClear': {
        const agent = agentOf(msg.id);
        if (agent.permissionSince !== null) {
          const wait = agent.permissionWaits[agent.permissionWaits.length - 1];
          if (wait) wait.ms = t() - agent.permissionSince;
          agent.permissionSince = null;
          if (agent.ours) touch();
        }
        break;
      }
      case 'agentContextUsage':
        agentOf(msg.id).context = { tokens: msg.contextTokens, max: msg.maxContextTokens };
        break;
      case 'agentCloseQuestion':
        // A Worktree of ours with uncommitted files: kept as it is, for a person to look at.
        notes.push(`Agent ${msg.id} left a Worktree with uncommitted files: kept.`);
        send({ type: 'closeAgent', id: msg.id, worktreeChoice: 'keep' });
        break;
      default:
        break;
    }
  };

  function attachTerminal(id, attempt = 0) {
    const mirror = new TerminalMirror(
      WebSocket,
      `ws://127.0.0.1:${port}/terminal/${id}?token=${encodeURIComponent(token)}`,
      origin,
    );
    mirrors.set(id, mirror);
    mirror.socket.on('close', () => {
      if (!mirror.term && attempt < 5 && agents.get(id)?.closedAt === null) {
        setTimeout(() => attachTerminal(id, attempt + 1), 700);
      }
    });
  }

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  }).catch((err) => {
    server.kill();
    fail(`could not connect to the office: ${err.message}`);
  });
  ws.on('message', (raw) => {
    try {
      onMessage(JSON.parse(raw.toString()));
    } catch (err) {
      notes.push(`A message could not be read: ${err.message}`);
    }
  });
  send({ type: 'webviewReady' });

  // The connect snapshot, then a moment for the asks that follow it.
  for (let waited = 0; office.snapshotAt === null && waited < 20_000; waited += 100)
    await sleep(100);
  await sleep(1500);
  say(
    `connected: ${office.access?.readOnly ? 'READ ONLY' : 'privileged'}, terminal ${
      office.terminal
        ? office.terminal.available
          ? 'on'
          : `off (${office.terminal.reason})`
        : 'unknown'
    }, Pixel Office MCP ${office.mcp?.consent ?? 'not offered'}, ${office.roles.length} Roles, ${
      office.workflows?.ids.length ?? 0
    } Workflows`,
  );

  // ── Samples of the machine while it runs ──
  const samples = [];
  const cpuTimes = () => {
    let idle = 0;
    let total = 0;
    for (const cpu of os.cpus()) {
      for (const value of Object.values(cpu.times)) total += value;
      idle += cpu.times.idle;
    }
    return { idle, total };
  };
  let lastCpu = cpuTimes();
  const sampler = setInterval(() => {
    const now = cpuTimes();
    const total = now.total - lastCpu.total;
    const busy = total > 0 ? 1 - (now.idle - lastCpu.idle) / total : 0;
    lastCpu = now;
    samples.push({
      at: t(),
      cpu: Math.round(busy * 100),
      freeMemMb: Math.round(os.freemem() / 1048576),
      agents: oursOpen().length,
    });
  }, 5000);

  // ── Which transcript is whose (the office's saved state says) ──
  const refreshSessions = () => {
    for (const saved of readJson(stateFile)?.agents ?? []) {
      const agent = agents.get(saved.id);
      if (agent?.ours && saved.jsonlFile)
        agent.session = { id: saved.sessionId, jsonlFile: saved.jsonlFile };
    }
  };
  const usageNow = () => {
    refreshSessions();
    const models = {};
    for (const agent of ours())
      if (agent.session) addUsage(models, sessionUsage(agent.session.jsonlFile).models);
    return totalOf(models);
  };

  /** The command lines the office started its agents with (they hold no secret). */
  const processes = new Map();
  const readProcesses = () => {
    let lines = [];
    try {
      if (process.platform === 'win32') {
        const out = spawnSync(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*role-prompts*' -or $_.CommandLine -like '*--mcp-config*' -or $_.CommandLine -like '*--session-id*' } | ForEach-Object { $_.CommandLine }",
          ],
          { encoding: 'utf8', timeout: 20_000, windowsHide: true },
        );
        lines = (out.stdout ?? '').split(/\r?\n/);
      } else {
        const out = spawnSync('ps', ['-eo', 'args='], { encoding: 'utf8', timeout: 10_000 });
        lines = (out.stdout ?? '').split('\n');
      }
    } catch {
      return;
    }
    for (const line of lines) {
      const command = line.trim();
      if (!command || command.includes('local-trial.mjs') || command.includes('Get-CimInstance'))
        continue;
      if (!/--session-id|--mcp-config|role-prompts/.test(command)) continue;
      const session = /--session-id[= ]"?([0-9a-f-]{36})/.exec(command)?.[1];
      if (session && !processes.has(session)) processes.set(session, command);
    }
  };

  // ── Grant the Pixel Office MCP for the run, when asked to ──
  let mcpGrantedHere = false;
  let outcome = null;
  const end = (result, detail = '') => {
    outcome ??= { result, detail, at: t() };
  };

  const needsMcp = scenario.scenario === 'workflow';
  if (office.access?.readOnly) end('refused', 'The office took this connection as read-only.');
  else if (!office.terminal?.available) {
    end('refused', `The office cannot launch agents: ${office.terminal?.reason ?? 'no terminal'}`);
  } else if (office.mcp && office.mcp.consent !== 'granted' && (needsMcp || grantMcp)) {
    if (!grantMcp) {
      end(
        'refused',
        'A Workflow needs the Pixel Office MCP allowed. Run again with --grant-mcp once its owner agreed.',
      );
    } else {
      send({ type: 'officeMcpConsentResponse', choice: 'allow' });
      for (let waited = 0; office.mcp.consent !== 'granted' && waited < 10_000; waited += 100)
        await sleep(100);
      mcpGrantedHere = office.mcp.consent === 'granted';
      say(`Pixel Office MCP allowed for this run: ${mcpGrantedHere ? 'yes' : 'NO'}`);
      await sleep(500);
    }
  } else if (needsMcp && !office.mcp) {
    end('refused', 'This office does not offer the Pixel Office MCP.');
  }

  if (shots.wanted && !outcome) {
    try {
      fs.mkdirSync(path.join(outDir, 'shots'), { recursive: true });
      const { chromium } = require('playwright');
      const channel =
        typeof opts['browser-channel'] === 'string'
          ? opts['browser-channel']
          : process.platform === 'win32'
            ? 'msedge'
            : undefined;
      // `--browser-path`: a browser that is already on the machine. Nothing is downloaded.
      const executablePath =
        typeof opts['browser-path'] === 'string' ? opts['browser-path'] : undefined;
      shots.browser = await chromium.launch({
        headless: true,
        ...(executablePath ? { executablePath } : channel ? { channel } : {}),
      });
      const context = await shots.browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      });
      shots.page = await context.newPage();
      await shots.page.goto(printedUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await shots.page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30_000 });
      await sleep(1500);
      await shoot('office-before', { force: true });
    } catch (err) {
      shots.error = String(err.message ?? err).split('\n')[0];
      say(`no pictures: ${shots.error}`);
    }
  }

  // ── Launch ──
  if (!outcome) {
    scenarioAt = t();
    touch();
    if (scenario.scenario === 'workflow') {
      if (office.workflows && !office.workflows.available) {
        end('refused', `No Workflow can start: ${office.workflows.reason ?? 'unavailable'}`);
      } else if (office.workflows && !office.workflows.ids.includes(scenario.workflowId)) {
        end('refused', `This office has no Workflow "${scenario.workflowId}".`);
      } else {
        say(`starting the Workflow "${scenario.workflowId}"`);
        send({
          type: 'startWorkflow',
          workflowId: scenario.workflowId,
          directoryPath: dir,
          request: scenario.request,
        });
      }
    } else {
      say(`launching one agent as "${scenario.roleId}"`);
      send({ type: 'launchAgent', directoryPath: dir, roleId: scenario.roleId });
    }
  }

  // ── A Role alone: wait for its prompt, ask once ──
  let asked = null;
  const askTheRole = async () => {
    const agent = ours()[0];
    const mirror = agent && mirrors.get(agent.id);
    if (!mirror?.term) return;
    const since = t() - agent.createdAt;
    // Its screen settled: the CLI drew its prompt (or stopped on a question of its own).
    if (since < 8000 || mirror.quietFor() < 4000) return;
    asked = { at: t(), readyMs: since };
    await saveScreen(agent, 'ready');
    say(`agent ${agent.id} settled after ${seconds(since)}: asking it`);
    await mirror.type(scenario.prompt);
    touch();
  };

  // ── Watch it to its end ──
  let lastBudgetAt = 0;
  let lastProcessesAt = 0;
  let knownAgents = 0;
  while (!outcome) {
    await sleep(1000);
    const now = t();
    if (serverExit) end('server-exited', `The office ended by itself (code ${serverExit.code}).`);
    else if (ws.readyState !== 1) end('disconnected', 'The connection to the office closed.');
    else if (rejected) end('rejected', rejected);
    else if (now > limits.maxMs)
      end('timeout', `Still going after ${Math.round(limits.maxMs / 60000)} minutes.`);
    if (outcome) break;

    const mine = ours();
    const open = oursOpen();
    if (mine.length !== knownAgents || now - lastProcessesAt > 60_000) {
      if (mine.length !== knownAgents) await sleep(2500);
      knownAgents = mine.length;
      lastProcessesAt = now;
      refreshSessions();
      readProcesses();
    }

    const stuck = open.find(
      (a) => a.permissionSince !== null && now - a.permissionSince > limits.permissionMs,
    );
    if (stuck) {
      end(
        'blocked-permission',
        `Agent ${stuck.id} (${stuck.role ?? 'no Role'}) waited ${seconds(now - stuck.permissionSince)} on a permission prompt.`,
      );
      break;
    }

    if (now - lastBudgetAt > 30_000) {
      lastBudgetAt = now;
      const used = usageNow();
      if (used.output > limits.maxOutputTokens) {
        end(
          'budget',
          `The agents wrote ${used.output} output tokens, over the ${limits.maxOutputTokens} this run allows.`,
        );
        break;
      }
    }

    const idleFor = now - lastActivityAt;
    const allIdle = open.every((a) => a.status !== 'active' && a.permissionSince === null);

    if (mine.length === 0) {
      if (now - scenarioAt > limits.launchMs) end('launch-failed', 'No agent joined the office.');
      continue;
    }
    if (open.length === 0) {
      end('agents-left', 'Every agent of the run left the office.');
      continue;
    }

    if (scenario.scenario === 'role') {
      const agent = mine[0];
      if (!asked) {
        await askTheRole();
        if (!asked && now - agent.createdAt > limits.launchMs)
          end('no-prompt', 'Its terminal never settled on a prompt.');
        continue;
      }
      refreshSessions();
      const answered = agent.session ? sessionUsage(agent.session.jsonlFile).messages > 0 : false;
      const quiet = mirrors.get(agent.id)?.quietFor() ?? 0;
      if ((agent.turns > 0 || answered) && allIdle && quiet > 8000)
        end('completed', 'It answered.');
      else if (now - asked.at > limits.idleMs && quiet > 30_000) {
        end('stalled', 'It was asked and nothing came back: see its screen.');
      }
      continue;
    }

    // A Workflow.
    if (!runInfo) {
      if (now - scenarioAt > limits.launchMs) end('launch-failed', 'The run was never listed.');
      continue;
    }
    if (runGoneAt !== null && runInfo.finishedAt === null) {
      end(
        'run-ended',
        'The run left the list before its stages were closed (its lead left, or it was stopped).',
      );
    } else if (runInfo.finishedAt !== null && allIdle && idleFor > limits.settleMs) {
      end('completed', 'Every stage is closed and the Crew is idle.');
    } else if (allIdle && idleFor > limits.idleMs) {
      const open2 = [...runInfo.stages.values()].filter(
        (s) => s.state === 'pending' || s.state === 'active',
      );
      end(
        'stalled',
        `Every agent idle for ${seconds(idleFor)} with ${open2.length} stage(s) open (${open2.map((s) => s.title).join(', ')}): it waits on the user, or a hand-over was lost.`,
      );
    }
  }
  say(`run over: ${outcome.result}${outcome.detail ? ` (${outcome.detail})` : ''}`);

  // ── Wind down: keep the evidence, close what the run launched ──
  clearInterval(sampler);
  await shoot('office-at-the-end', { force: true });
  refreshSessions();
  readProcesses();
  for (const agent of ours()) agent.finalScreen = await saveScreen(agent, 'final');
  for (const agent of agents.values())
    if (agent.status) setStatus(agent, agent.status, agent.awaitingInput);

  if (ws.readyState === 1) {
    if (runInfo && runGoneAt === null && runInfo.finishedAt === null) {
      send({ type: 'stopWorkflow', crewId: runInfo.crewId });
      await sleep(500);
    }
    for (const agent of oursOpen()) send({ type: 'closeAgent', id: agent.id });
    for (let waited = 0; oursOpen().length > 0 && waited < 30_000; waited += 200) await sleep(200);
  }
  const notClosed = oursOpen().map((a) => a.id);
  if (notClosed.length > 0)
    notes.push(`Not confirmed closed before the office stopped: agents ${notClosed.join(', ')}.`);

  if (shots.browser) await shots.browser.close().catch(() => {});
  for (const mirror of mirrors.values()) mirror.close();
  ws.close();
  if (!serverExit) {
    server.kill();
    for (let waited = 0; !serverExit && waited < 10_000; waited += 100) await sleep(100);
  }
  await new Promise((resolve) => messagesFile.end(resolve));
  fs.writeFileSync(path.join(outDir, 'server.log'), mask(serverOut));

  // A killed office cannot tidy up after itself (Windows has no gentler way to
  // stop a child), so its entries stay in the list of running offices. The
  // ones naming the process this run started are taken back, and no other.
  const registryRemoved = [];
  if (serverExit) {
    const mine = (file) => readJson(file)?.pid === server.pid;
    const candidates = [path.join(officeDir, 'server.json')];
    try {
      for (const name of fs.readdirSync(path.join(officeDir, 'servers'))) {
        if (name.endsWith('.json')) candidates.push(path.join(officeDir, 'servers', name));
      }
    } catch {
      // No registry folder.
    }
    for (const file of candidates) {
      if (!mine(file)) continue;
      try {
        fs.unlinkSync(file);
        registryRemoved.push(path.relative(officeDir, file));
      } catch {
        notes.push(`A stale entry of this run's office is left: ${file}`);
      }
    }
  }

  // The same for the folder of its agents' MCP files (`mcp/<pid>-<rand>/`),
  // whose tokens died with it: the files it names itself, then the folder,
  // only when nothing else is in it.
  if (serverExit) {
    const mcpDir = path.join(officeDir, 'mcp');
    let folders = [];
    try {
      folders = fs.readdirSync(mcpDir).filter((name) => name.startsWith(`${server.pid}-`));
    } catch {
      // No MCP folder.
    }
    for (const name of folders) {
      const folder = path.join(mcpDir, name);
      try {
        for (const file of fs.readdirSync(folder)) {
          if (/^agent-\d+\.json$/.test(file)) fs.unlinkSync(path.join(folder, file));
        }
        fs.rmdirSync(folder);
        registryRemoved.push(path.relative(officeDir, folder));
      } catch {
        notes.push(`A folder of this run's office is left: ${folder}`);
      }
    }
  }

  // The consent goes back to what it was: it was allowed for the run alone.
  let mcpConsentAfter = (readJson(configFile) ?? {}).officeMcpConsent ?? 'unanswered';
  if (mcpGrantedHere && !keepMcpConsent) {
    const config = readJson(configFile);
    if (config) {
      if (before.config.officeMcpConsent === undefined) delete config.officeMcpConsent;
      else config.officeMcpConsent = before.config.officeMcpConsent;
      const tmp = `${configFile}.trial-tmp`;
      fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
      fs.renameSync(tmp, configFile);
      mcpConsentAfter = config.officeMcpConsent ?? 'unanswered';
    }
  }

  // ── What it used ──
  const totals = {};
  let leadReport = null;
  for (const agent of ours()) {
    if (!agent.session) continue;
    const usage = sessionUsage(agent.session.jsonlFile);
    agent.usage = {
      models: usage.models,
      total: totalOf(usage.models),
      toolUses: usage.toolUses,
      subagents: usage.subagents,
    };
    addUsage(totals, usage.models);
    if (usage.lastWords) {
      // A screen read back with its scrollback is hard to read; the transcript
      // has the same words as they were written.
      const name = `agent-${agent.id}.md`;
      try {
        fs.mkdirSync(path.join(outDir, 'reports'), { recursive: true });
        fs.writeFileSync(path.join(outDir, 'reports', name), `${mask(usage.lastWords)}\n`);
        agent.lastWords = `reports/${name}`;
      } catch {
        notes.push(`Agent ${agent.id}'s last words could not be written.`);
      }
      if (agent.id === runInfo?.leadAgentId) leadReport = mask(usage.lastWords);
    }
    const command = processes.get(agent.session.id);
    if (command) {
      agent.launch = {
        permissionMode: /--permission-mode[= ]"?([\w-]+)/.exec(command)?.[1] ?? null,
        skipsPermissions: command.includes('--dangerously-skip-permissions'),
        model: /--model[= ]"?([\w.[\]-]+)/.exec(command)?.[1] ?? null,
        roleInstructions: command.includes('--append-system-prompt-file'),
        playbooks: command.includes('--plugin-dir'),
        officeMcp: command.includes('--mcp-config'),
        preapprovedTools: command.includes('--allowedTools'),
      };
    }
  }

  const cpu = samples.map((s) => s.cpu);
  const summary = {
    harness: 1,
    preset: opts.preset,
    scenario,
    startedAt: new Date(startedAt).toISOString(),
    wallMs: t(),
    outcome,
    limits,
    host: {
      platform: `${os.platform()} ${os.release()}`,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      threads: os.cpus().length,
      totalMemMb: Math.round(os.totalmem() / 1048576),
      freeMemMbBefore: before.freeMemMb,
      freeMemMbLowest: samples.length
        ? Math.min(...samples.map((s) => s.freeMemMb))
        : before.freeMemMb,
      cpuAvg: cpu.length ? Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length) : null,
      cpuMax: cpu.length ? Math.max(...cpu) : null,
      node: process.version,
    },
    office: {
      commit: git(REPO_ROOT, 'rev-parse', '--short', 'HEAD'),
      serverStartMs,
      privileged: office.access ? !office.access.readOnly : null,
      terminal: office.terminal,
      roles: office.roles.length,
      workflows: office.workflows?.ids.length ?? 0,
      hooksAsked: office.hooksAsked,
      mcpConsent: {
        before: mcpConsentBefore,
        during: office.mcp?.consent ?? null,
        after: mcpConsentAfter,
      },
      preexistingAgents: office.preexisting.size,
    },
    run: runInfo
      ? {
          name: runInfo.name,
          leadAgentId: runInfo.leadAgentId,
          firstStageAt: Math.min(
            ...[...runInfo.stages.values()].map((s) => s.startedAt ?? Infinity),
          ),
          finishedAt: runInfo.finishedAt,
          stages: [...runInfo.stages.values()],
        }
      : null,
    asked,
    agents: ours().map((agent) => ({
      id: agent.id,
      role: agent.role,
      launchedBy: crewMembers.get(agent.id)?.launchedBy ?? null,
      joinedAt: agent.createdAt,
      joinedAfterMs: agent.createdAt - scenarioAt,
      firstActiveAt: agent.firstActiveAt,
      leftAt: agent.closedAt,
      activeMs: agent.activeMs,
      waitingMs: agent.waitingMs,
      turns: agent.turns,
      toolCalls: agent.toolCalls,
      tools: agent.tools,
      permissionWaits: agent.permissionWaits,
      context: agent.context,
      launch: agent.launch,
      usage: agent.usage ?? null,
      finalScreen: agent.finalScreen ?? null,
      lastWords: agent.lastWords ?? null,
    })),
    leadReport,
    crewEvents: crewEvents.map(({ key: _key, ...event }) => event),
    stageEvents,
    usage: { models: totals, total: totalOf(totals) },
    samples,
    pictures: { taken: shots.taken, error: shots.error },
    environment: {
      keptFromTheOffice: envRemoved.sort(),
      setForTheRun: Object.keys(envSet),
    },
    leftOnThisMachine: {
      registryEntriesRemoved: registryRemoved,
      claudeSettingsTouched: before.claudeSettingsHash !== sha256(claudeSettings),
      hookScriptReplaced: before.hookScriptHash !== sha256(hookScript),
      mcpConsent: `${mcpConsentBefore} -> ${mcpConsentAfter}`,
      agentsNotConfirmedClosed: notClosed,
      trustedFolder: opts['no-trust'] === true ? null : dir,
      folderGit: { before: before.git, after: gitState(dir) },
    },
    notes,
    planted: PLANTED,
  };
  if (summary.run && !Number.isFinite(summary.run.firstStageAt)) summary.run.firstStageAt = null;
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(outDir, 'processes.txt'), [...processes.values()].join('\n\n'));
  const report = summaryMarkdown(summary);
  fs.writeFileSync(path.join(outDir, 'summary.md'), report);
  console.log(`\n${report}`);
  console.log(`[trial] written to ${outDir}`);
  process.exit(outcome.result === 'completed' ? 0 : 2);
}

function summaryMarkdown(s) {
  const lines = [];
  const n = (value) => (value ?? 0).toLocaleString('en-US');
  lines.push(`# Trial run: ${s.preset}`, '');
  lines.push(`- Result: **${s.outcome.result}**${s.outcome.detail ? `. ${s.outcome.detail}` : ''}`);
  lines.push(
    `- Wall time: ${seconds(s.wallMs)} (office up in ${seconds(s.office.serverStartMs)}), commit ${s.office.commit}`,
  );
  lines.push(
    `- Machine: ${s.host.cpu}, ${s.host.threads} threads, ${n(s.host.totalMemMb)} MB; free memory ${n(s.host.freeMemMbBefore)} MB before, lowest ${n(s.host.freeMemMbLowest)} MB; CPU average ${s.host.cpuAvg ?? '?'}%, peak ${s.host.cpuMax ?? '?'}%`,
  );
  lines.push(
    `- Tokens: ${n(s.usage.total.output)} output, ${n(s.usage.total.input)} input, ${n(s.usage.total.cacheCreation)} cache written, ${n(s.usage.total.cacheRead)} cache read, in ${n(s.usage.total.messages)} model messages`,
  );
  for (const [model, usage] of Object.entries(s.usage.models)) {
    lines.push(
      `  - ${model}: ${n(usage.output)} output, ${n(usage.input + usage.cacheCreation)} new input, ${n(usage.cacheRead)} cache read, ${n(usage.messages)} messages`,
    );
  }
  if (s.asked)
    lines.push(`- The agent's prompt was ready ${seconds(s.asked.readyMs)} after it joined`);
  if (s.environment.keptFromTheOffice.length > 0) {
    const account = s.environment.keptFromTheOffice.filter((name) => /^ANTHROPIC_/i.test(name));
    lines.push(
      `- Environment: ${s.environment.keptFromTheOffice.length} variable(s) of the launching session kept from the office (names in summary.json)${
        account.length > 0
          ? `; among them ${account.join(', ')}, so the agents ran on the CLI's own login`
          : ''
      }`,
    );
  }
  lines.push('');

  if (s.run) {
    lines.push(
      `## Stages of "${s.run.name}"`,
      '',
      '| Stage | Role | State | Started | Took | Note |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const stage of s.run.stages) {
      const took =
        stage.startedAt !== null && stage.closedAt !== null
          ? seconds(stage.closedAt - stage.startedAt)
          : '';
      lines.push(
        `| ${stage.title}${stage.parallel ? ' (parallel)' : ''} | ${stage.roleName} | ${stage.state}${stage.starts > 1 ? ` (started ${stage.starts} times)` : ''} | ${seconds(stage.startedAt)} | ${took} | ${(stage.note ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ')} |`,
      );
    }
    lines.push('');
  }

  lines.push(
    '## Agents',
    '',
    '| Agent | Role | Joined | First active | Active | Idle | Turns | Tool calls | Permission waits | Output tokens | Cache read | Context |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const agent of s.agents) {
    const context = agent.context
      ? `${Math.round((agent.context.tokens / agent.context.max) * 100)}% of ${n(agent.context.max)}`
      : '';
    lines.push(
      `| ${agent.id} | ${agent.role ?? ''} | ${seconds(agent.joinedAt)} | ${seconds(agent.firstActiveAt)} | ${seconds(agent.activeMs)} | ${seconds(agent.waitingMs)} | ${agent.turns} | ${agent.toolCalls} | ${agent.permissionWaits.length} | ${n(agent.usage?.total.output)} | ${n(agent.usage?.total.cacheRead)} | ${context} |`,
    );
  }
  lines.push('');
  for (const agent of s.agents) {
    const tools = Object.entries(agent.tools)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name} ${count}`)
      .join(', ');
    const launch = agent.launch
      ? `permission mode ${agent.launch.permissionMode ?? 'default'}${agent.launch.skipsPermissions ? ' (skips permissions)' : ''}, model ${agent.launch.model ?? 'default'}, Role instructions ${agent.launch.roleInstructions ? 'yes' : 'NO'}, Playbooks ${agent.launch.playbooks ? 'yes' : 'no'}, Pixel Office MCP ${agent.launch.officeMcp ? 'yes' : 'no'}`
      : 'command line not seen';
    lines.push(
      `- Agent ${agent.id} (${agent.role ?? 'no Role'}): ${launch}. Tools: ${tools || 'none'}.`,
    );
    for (const wait of agent.permissionWaits) {
      lines.push(
        `  - Permission prompt at ${seconds(wait.at)}, ${wait.ms === null ? 'never answered' : `answered after ${seconds(wait.ms)}`}${wait.screen ? ` (${wait.screen})` : ''}`,
      );
    }
  }
  lines.push('');

  if (s.crewEvents.length > 0) {
    lines.push('## Between the agents', '');
    for (const event of s.crewEvents) {
      lines.push(
        `- ${seconds(event.at)}: ${event.from} ${event.kind} ${event.to.join(', ')}${event.gist ? `: ${event.gist.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`,
      );
    }
    lines.push('');
  }

  if (s.leadReport) {
    lines.push("## The lead's report", '');
    for (const line of s.leadReport.split(/\r?\n/)) lines.push(line ? `> ${line}` : '>');
    lines.push('');
  }
  const lastWords = s.agents.filter((agent) => agent.lastWords);
  if (lastWords.length > 0) {
    lines.push(
      `Each agent's last words: ${lastWords.map((agent) => agent.lastWords).join(', ')}`,
      '',
    );
  }

  lines.push('## Left on this machine', '');
  lines.push(
    `- Claude's own settings file changed: ${s.leftOnThisMachine.claudeSettingsTouched ? 'YES' : 'no'}`,
  );
  lines.push(
    `- The office's hook script replaced: ${s.leftOnThisMachine.hookScriptReplaced ? 'yes' : 'no'}`,
  );
  lines.push(`- Pixel Office MCP consent: ${s.leftOnThisMachine.mcpConsent}`);
  if (s.leftOnThisMachine.trustedFolder)
    lines.push(`- Claude Code was told to trust: ${s.leftOnThisMachine.trustedFolder}`);
  const folderGit = s.leftOnThisMachine.folderGit;
  if (folderGit.before !== folderGit.after) {
    lines.push(
      `- The folder's repository: ${folderGit.before ?? 'none'} -> ${folderGit.after ?? 'none'}`,
    );
  }
  if (s.leftOnThisMachine.registryEntriesRemoved.length > 0) {
    lines.push(
      `- Left by the stopped office and removed: ${s.leftOnThisMachine.registryEntriesRemoved.join(', ')}`,
    );
  }
  if (s.leftOnThisMachine.agentsNotConfirmedClosed.length > 0) {
    lines.push(
      `- Agents not confirmed closed: ${s.leftOnThisMachine.agentsNotConfirmedClosed.join(', ')}`,
    );
  }
  for (const note of s.notes) lines.push(`- ${note}`);
  if (s.pictures.taken.length > 0)
    lines.push(`- Pictures: ${s.pictures.taken.length} under shots/`);
  if (s.pictures.error) lines.push(`- Pictures failed: ${s.pictures.error}`);
  lines.push('');
  return lines.join('\n');
}

// ── Entry ─────────────────────────────────────────────────────

const { command, opts } = parseArgs(process.argv.slice(2));
if (command === 'sample') writeSample(opts._[0]);
else if (command === 'reset-sample') resetSample(opts._[0]);
else if (command === 'run') {
  run(opts).catch((err) => {
    console.error(`[trial] ${err.stack ?? err}`);
    process.exit(1);
  });
} else {
  console.log(
    [
      'Usage:',
      '  node scripts/local-trial.mjs sample <folder>',
      '  node scripts/local-trial.mjs reset-sample <folder>',
      `  node scripts/local-trial.mjs run --dir <folder> --preset <${Object.keys(PRESETS).join('|')}>`,
      '      [--grant-mcp] [--keep-mcp-consent] [--screenshots] [--browser-channel msedge|chrome] [--browser-path <exe>]',
      '      [--max-minutes n] [--idle-seconds n] [--permission-wait-seconds n] [--max-output-tokens n]',
      '      [--request "..."] [--prompt "..."] [--role <id>] [--workflow <id>] [--out <folder>] [--no-trust] [--keep-env]',
    ].join('\n'),
  );
  process.exit(command ? 1 : 0);
}
