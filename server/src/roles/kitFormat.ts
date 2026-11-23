/**
 * A Role's folder, as text: what each of its Markdown files must look like and
 * what it is read as. Pure (no file access: roleKits.ts reads the folder).
 *
 *   roles/<role id>/
 *     ROLE.md              front matter (name, description, color, order?, model?)
 *                          + the Role's standing instructions
 *     CONTRACT.md          the Role's Contract: the five sections of CONTRACT_SECTIONS, in order
 *     playbooks/<id>.md    front matter (name, description, tools?, order?) + the steps
 *     workflows/<id>.md    front matter (name, description, order?) + what the lead is told
 *                          + one section per stage: `## <step>. <Title> (<role id>)`
 *
 * Every reader answers the thing read, or one line saying what is wrong with
 * the file (for the host's log), and never throws: a file a person edits by
 * hand should say what to fix. Each is held to the same limits as the entry of
 * roles.json or workflows.json it stands for, by going through that parser.
 */

import {
  MAX_PLAYBOOK_CHARS,
  MAX_PLAYBOOK_DESCRIPTION_CHARS,
  MAX_PLAYBOOK_NAME_CHARS,
  MAX_PLAYBOOK_TOOLS,
  MAX_ROLE_CONTRACT_CHARS,
  parseRoleOverrides,
  type PlaybookDefinition,
  type RoleDefinition,
} from '../../../core/src/roles.js';
import { parseWorkflows, type WorkflowDefinition } from '../../../core/src/workflows.js';

/** The names a Role's folder gives its files and folders. */
export const ROLE_FILE = 'ROLE.md';
export const CONTRACT_FILE = 'CONTRACT.md';
export const PLAYBOOKS_DIR = 'playbooks';
export const WORKFLOWS_DIR = 'workflows';

/** The sections a Contract holds, in this order, each a `### ` heading. */
export const CONTRACT_SECTIONS = [
  'Accepts',
  'Delivers',
  'Done when',
  'Never',
  'Hands over',
] as const;

/** Where a file with no `order` goes: after the ones that give one. */
const DEFAULT_ORDER = 1000;
/** The last `order` a file may give. */
export const MAX_ORDER = 9999;

/** A tool as a Playbook names it: the word its command goes by, or the name
 *  of the service (letters, digits, spaces and . _ + -). */
const TOOL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,39}$/;

/** A file's front matter and what follows it. */
interface KitDocument {
  fields: Map<string, string>;
  body: string;
}

/** One line, as every reader takes it: no BOM, Unix line ends. */
function normalize(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

/**
 * A front matter value: plain text, or a quoted string (double quotes with
 * `\"` and `\\`, single quotes with `''`), as YAML writes one that holds a
 * colon. Undefined when a quote is never closed.
 */
export function unquote(raw: string): string | undefined {
  const quote = raw[0];
  if (quote !== '"' && quote !== "'") return raw;
  if (raw.length < 2 || raw[raw.length - 1] !== quote) return undefined;
  const inner = raw.slice(1, -1);
  return quote === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner.replace(/''/g, "'");
}

/**
 * The front matter block a file opens with (`---`, `key: value` lines, `---`)
 * and the text after it. Only the keys of `allowed`, each once, each on one
 * line: a typo in a key is refused rather than ignored.
 */
function readFrontMatter(text: string, allowed: readonly string[]): KitDocument | string {
  const lines = normalize(text).split('\n');
  if (lines[0].trim() !== '---') return 'it must open with a front matter block (a line of ---)';
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return 'its front matter block is never closed (a line of ---)';
  const fields = new Map<string, string>();
  for (let index = 1; index < end; index++) {
    const line = lines[index];
    if (line.trim() === '') continue;
    const match = /^([a-z][a-z-]*):(?:\s+(.*))?$/.exec(line);
    if (!match) return `line ${index + 1} of its front matter is not "key: value"`;
    const key = match[1];
    if (!allowed.includes(key)) {
      return `unknown front matter field "${key}" (it takes: ${allowed.join(', ')})`;
    }
    if (fields.has(key)) return `front matter field "${key}" is given twice`;
    const value = unquote((match[2] ?? '').trim());
    if (value === undefined) return `front matter field "${key}" opens a quote it never closes`;
    fields.set(key, value);
  }
  return {
    fields,
    body: lines
      .slice(end + 1)
      .join('\n')
      .trim(),
  };
}

/** An `order` field: where the file goes among its kind. */
function orderOf(fields: Map<string, string>): number | string {
  const raw = fields.get('order');
  if (raw === undefined) return DEFAULT_ORDER;
  if (!/^\d{1,4}$/.test(raw)) return `"order" must be a whole number from 0 to ${MAX_ORDER}`;
  return Number(raw);
}

/** A Role read from its ROLE.md, and where it goes in the catalog. */
export interface KitRole {
  role: RoleDefinition;
  order: number;
}

/**
 * ROLE.md: the Role `id` (its folder's name). The front matter is what the
 * office shows (name, description, colour) and how it is launched (model); the
 * text is the Role's standing instructions.
 */
export function parseRoleFile(id: string, text: string): KitRole | string {
  const doc = readFrontMatter(text, ['name', 'description', 'color', 'order', 'model']);
  if (typeof doc === 'string') return doc;
  const order = orderOf(doc.fields);
  if (typeof order === 'string') return order;
  if (doc.body.length === 0) return 'it holds no instructions after the front matter';
  const entry: Record<string, unknown> = { id, prompt: doc.body };
  for (const key of ['name', 'description', 'color', 'model']) {
    const value = doc.fields.get(key);
    if (value !== undefined) entry[key] = value;
  }
  const parsed = parseRoleOverrides({ roles: [entry] });
  const [role] = parsed.overrides;
  if (!role) return parsed.problems[0]?.replace(/^roles\[0\]: /, '') ?? 'not a role';
  // A built-in Role says everything about itself: nothing is left to a default.
  const { name, description, color, prompt } = role;
  if (
    name === undefined ||
    description === undefined ||
    color === undefined ||
    prompt === undefined
  ) {
    return 'its front matter must give a "name", a "description" and a "color"';
  }
  const definition: RoleDefinition = { id, name, description, color, prompt };
  if (role.model !== undefined) definition.model = role.model;
  return { role: definition, order };
}

/**
 * CONTRACT.md: the Role's Contract, as its agents are told it. No front
 * matter; the five sections of CONTRACT_SECTIONS as `### ` headings, in that
 * order and none empty, so every Role answers the same questions.
 */
export function parseContract(text: string): { contract: string } | string {
  const contract = normalize(text).trim();
  if (contract.length === 0) return 'it is empty';
  if (contract.length > MAX_ROLE_CONTRACT_CHARS) {
    return `it is longer than ${MAX_ROLE_CONTRACT_CHARS} characters`;
  }
  const lines = contract.split('\n');
  const headings = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.startsWith('### '));
  const wanted = CONTRACT_SECTIONS.map((section) => `### ${section}`);
  const found = headings.map(({ line }) => line.trim());
  if (found.length !== wanted.length || found.some((heading, at) => heading !== wanted[at])) {
    return `its sections must be exactly, in this order: ${wanted.join(', ')}`;
  }
  for (const [at, { index }] of headings.entries()) {
    const next = headings[at + 1]?.index ?? lines.length;
    const section = lines
      .slice(index + 1, next)
      .join('')
      .trim();
    if (section === '') return `its "${CONTRACT_SECTIONS[at]}" section is empty`;
  }
  return { contract };
}

/** One line of text: trimmed, non-empty, within `max`, no control characters. */
function lineOf(value: string | undefined, max: number): string | undefined {
  const text = value?.trim() ?? '';
  if (text.length === 0 || text.length > max) return undefined;
  return /[\u0000-\u001f\u007f]/.test(text) ? undefined : text;
}

/** A Playbook read from its file, and where it goes among its Role's. */
export interface KitPlaybook {
  playbook: PlaybookDefinition;
  order: number;
}

/**
 * playbooks/<id>.md: the Playbook `id` (its file's name). The description is
 * what the coding agent picks the skill by, so it says when to run it; `tools`
 * names what the steps run, separated by commas.
 */
export function parsePlaybookFile(id: string, text: string): KitPlaybook | string {
  const doc = readFrontMatter(text, ['name', 'description', 'tools', 'order']);
  if (typeof doc === 'string') return doc;
  const order = orderOf(doc.fields);
  if (typeof order === 'string') return order;
  const name = lineOf(doc.fields.get('name'), MAX_PLAYBOOK_NAME_CHARS);
  if (name === undefined) {
    return `"name" must be 1-${MAX_PLAYBOOK_NAME_CHARS} characters on one line`;
  }
  const description = lineOf(doc.fields.get('description'), MAX_PLAYBOOK_DESCRIPTION_CHARS);
  if (description === undefined) {
    return `"description" must be 1-${MAX_PLAYBOOK_DESCRIPTION_CHARS} characters on one line`;
  }
  const tools = (doc.fields.get('tools') ?? '')
    .split(',')
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
  if (tools.length > MAX_PLAYBOOK_TOOLS) return `"tools" names more than ${MAX_PLAYBOOK_TOOLS}`;
  const odd = tools.find((tool) => !TOOL_NAME_RE.test(tool));
  if (odd !== undefined) {
    return `"tools" must be names separated by commas (letters, digits, spaces and . _ + -), not "${odd}"`;
  }
  if (new Set(tools.map((tool) => tool.toLowerCase())).size !== tools.length) {
    return '"tools" names a tool twice';
  }
  if (doc.body.length === 0) return 'it holds no steps after the front matter';
  if (doc.body.length > MAX_PLAYBOOK_CHARS) {
    return `its steps are longer than ${MAX_PLAYBOOK_CHARS} characters`;
  }
  return { playbook: { id, name, description, tools, instructions: doc.body }, order };
}

/** A stage's heading: its step, its title, the Role that owns it and, when the
 *  title's own words would not make its id, the id (`{#id}`). */
const STAGE_HEADING_RE = /^## (\d{1,2})\. (.+?) \(([a-z][a-z0-9-]*)\)(?: \{#([a-z][a-z0-9-]*)\})?$/;

/** An id from a title: its words in lower case, joined by hyphens (a stage's
 *  id from its heading, a Playbook's from the name a new Role gives it). */
export function slugOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A Workflow read from its file, and where it goes among its lead's. */
export interface KitWorkflow {
  workflow: WorkflowDefinition;
  order: number;
}

/**
 * workflows/<id>.md: the Workflow `id` (its file's name), led by `lead` (the
 * Role whose folder holds it). What comes before the first stage is what the
 * lead is told of the Workflow as a whole; each stage is a section
 *
 *   ## <step>. <Title> (<role id>)
 *
 * whose text is the stage's brief. Steps count from 1 and never skip; stages
 * that share a step run at the same time (the later ones are `parallel`).
 */
export function parseWorkflowFile(id: string, lead: string, text: string): KitWorkflow | string {
  const doc = readFrontMatter(text, ['name', 'description', 'order']);
  if (typeof doc === 'string') return doc;
  const order = orderOf(doc.fields);
  if (typeof order === 'string') return order;

  const lines = doc.body.split('\n');
  const stages: Record<string, unknown>[] = [];
  const brief: string[] = [];
  let current: { stage: Record<string, unknown>; text: string[] } | null = null;
  let step = 0;
  const close = (): void => {
    if (!current) return;
    const stageBrief = current.text.join('\n').trim();
    if (stageBrief.length > 0) current.stage.brief = stageBrief;
    stages.push(current.stage);
  };
  for (const line of lines) {
    if (!line.startsWith('## ')) {
      (current ? current.text : brief).push(line);
      continue;
    }
    const match = STAGE_HEADING_RE.exec(line.trimEnd());
    if (!match) {
      return `"${line.trim()}" is not a stage heading: write "## <step>. <Title> (<role id>)"`;
    }
    const [, stepText, title, role, givenId] = match;
    const asked = Number(stepText);
    if (asked < 1 || (asked !== step && asked !== step + 1)) {
      return `stage "${title}" is step ${asked}, after step ${step}: steps count from 1 and never skip`;
    }
    close();
    const stage: Record<string, unknown> = { id: givenId ?? slugOf(title), title, role };
    if (asked === step) stage.parallel = true;
    step = asked;
    current = { stage, text: [] };
  }
  close();

  const entry: Record<string, unknown> = { id, lead, stages };
  for (const key of ['name', 'description']) {
    const value = doc.fields.get(key);
    if (value !== undefined) entry[key] = value;
  }
  const leadBrief = brief.join('\n').trim();
  if (leadBrief.length > 0) entry.brief = leadBrief;
  const parsed = parseWorkflows({ workflows: [entry] });
  const [workflow] = parsed.workflows;
  if (!workflow) return parsed.problems[0]?.replace(/^workflows\[0\]: /, '') ?? 'not a workflow';
  if (workflow.description === '') return 'its front matter must give a "description"';
  return { workflow, order };
}
