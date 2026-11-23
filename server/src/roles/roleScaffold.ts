/**
 * A new Role's folder, made from the template (role-template/ in the
 * repository): its ROLE.md, its CONTRACT.md, a first Playbook and the Workflow
 * that runs it, so a Role nobody foresaw is built like the ones that ship from
 * its first commit. `npm run new-role` is its command (scripts/role-kit.ts).
 *
 * Nothing is written unless everything it would write reads back with no
 * problem: each file through the reader the office uses (kitFormat.ts), the
 * whole through the house rules (kitRules.ts). A file is never overwritten.
 *
 * The template's files are Markdown with `{{placeholders}}` (PLACEHOLDERS says
 * which). What they say is true of any Role, so a Role launched before anyone
 * edited it is told nothing wrong; `templateLeftovers` counts the lines still
 * as the template wrote them, for whoever reviews it.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  isRoleId,
  MAX_ROLE_DESCRIPTION_CHARS,
  MAX_ROLE_NAME_CHARS,
  ROLE_COLORS,
  type RoleColor,
  type RoleDefinition,
} from '../../../core/src/roles.js';
import {
  DEFAULT_WORKFLOW_LEAD,
  isWorkflowId,
  MAX_WORKFLOW_NAME_CHARS,
} from '../../../core/src/workflows.js';
import {
  CONTRACT_FILE,
  parseContract,
  parsePlaybookFile,
  parseRoleFile,
  parseWorkflowFile,
  PLAYBOOKS_DIR,
  ROLE_FILE,
  slugOf,
  unquote,
  WORKFLOWS_DIR,
} from './kitFormat.js';
import { roleKitProblems } from './kitRules.js';
import { readRoleKits } from './roleKits.js';

/** The template's own files, within its folder. */
const TEMPLATE_PLAYBOOK_FILE = `${PLAYBOOKS_DIR}/playbook.md`;
const TEMPLATE_WORKFLOW_FILE = `${WORKFLOWS_DIR}/workflow.md`;

/** What a template may ask for, and what each stands for. */
export const PLACEHOLDERS = {
  id: "the Role's id (its folder's name)",
  name: "the Role's name",
  description: 'what the Role does, in one line',
  color: "the Role's colour, by name",
  order: 'where the office lists the Role',
  playbook: "the name of the Role's first Playbook, and of the Workflow that runs it",
  'the-reviewer': 'the Role that takes a second look, with its article ("the QA Engineer")',
  'reviewer-id': "that Role's id",
  'the-coordinator': 'the Role that coordinates the team, with its article',
} as const;

type Placeholder = keyof typeof PLACEHOLDERS;

/** The Role a second look is handed to, where the team has it. */
const REVIEWER_ROLE = 'qa-engineer';

/** How far apart the Roles' `order` values are written. */
const ORDER_STEP = 10;
const MAX_ORDER = 9999;

const PLACEHOLDER_RE = /\{\{([a-z-]+)\}\}/g;

/** What `npm run new-role` was asked for. Only the id is needed. */
export interface NewRoleAsk {
  id: string;
  name?: string;
  description?: string;
  color?: string;
  /** The name of its first Playbook (and of the Workflow that runs it). */
  playbook?: string;
}

/** The command's options, and the field of the ask each gives. */
const ASK_FLAGS: ReadonlyMap<string, keyof NewRoleAsk> = new Map([
  ['--name', 'name'],
  ['--description', 'description'],
  ['--color', 'color'],
  ['--playbook', 'playbook'],
]);

/**
 * What the command's arguments ask for: `<id> ["Name"] [--flag value]…`. A
 * line saying what was not understood when they ask for nothing that can be
 * made (the command prints it over its usage).
 */
export function readNewRoleAsk(args: readonly string[]): NewRoleAsk | string {
  const ask: NewRoleAsk = { id: '' };
  const words: string[] = [];
  for (let at = 0; at < args.length; at++) {
    const arg = args[at];
    if (!arg.startsWith('--')) {
      words.push(arg);
      continue;
    }
    const field = ASK_FLAGS.get(arg);
    if (!field) return `unknown option ${arg}`;
    const value = args[at + 1];
    if (value === undefined || value.startsWith('--')) return `${arg} needs a value`;
    ask[field] = value;
    at++;
  }
  if (words.length === 0) return 'which Role? Give its id, for example data-engineer';
  if (words.length > 2) return 'give the id, then the name in quotes if it has more than one word';
  ask.id = words[0];
  // The name given by its option wins over the one given in passing.
  if (words[1] !== undefined) ask.name ??= words[1];
  return ask;
}

/** One file of a new Role, by its path from the Roles' folder (forward slashes). */
export interface NewRoleFile {
  path: string;
  text: string;
}

/** A new Role, checked and ready to write. */
export interface NewRolePlan {
  id: string;
  name: string;
  color: RoleColor;
  playbook: { id: string; name: string };
  files: NewRoleFile[];
}

export type NewRoleResult = { plan: NewRolePlan } | { problems: string[] };

/** "data-engineer" → "Data Engineer". */
function nameOf(id: string): string {
  return id
    .split('-')
    .filter((word) => word.length > 0)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/** One line a person typed: trimmed, or undefined when it holds a line break
 *  or another control character (it would end a front matter line early). */
function oneLine(value: string): string | undefined {
  const text = value.trim();
  return /[\u0000-\u001f\u007f]/.test(text) ? undefined : text;
}

/**
 * A front matter value as YAML takes it: plain where plain is read back as the
 * same text, else quoted the way the repository's formatter would (single
 * quotes, double when the text holds more of those), which kitFormat.ts reads
 * back (`''` in single quotes, `\"` and `\\` in double).
 */
function yamlValue(text: string): string {
  const plain =
    /^[A-Za-z0-9(]/.test(text) &&
    !/: |:$| #/.test(text) &&
    !/^(true|false|yes|no|null|on|off|~)$/i.test(text) &&
    text === text.trim();
  if (plain) return text;
  const singles = text.split("'").length - 1;
  const doubles = text.split('"').length - 1;
  return singles > doubles
    ? `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    : `'${text.replace(/'/g, "''")}'`;
}

/**
 * A template with its placeholders filled in: as they are in the text, and as
 * YAML values in the front matter block it opens with. A placeholder the
 * template asks for that nobody gives is a mistake in the template.
 */
function render(template: string, values: ReadonlyMap<Placeholder, string>): string | string[] {
  const unknown = new Set<string>();
  const fill = (text: string): string =>
    text.replace(PLACEHOLDER_RE, (whole, key: string) => {
      const value = values.get(key as Placeholder);
      if (value === undefined) unknown.add(key);
      return value ?? whole;
    });
  const lines = template.replace(/\r\n?/g, '\n').split('\n');
  const end =
    lines[0]?.trim() === '---' ? lines.findIndex((l, i) => i > 0 && l.trim() === '---') : -1;
  const out = lines.map((line, index) => {
    if (index === 0 || index >= end) return fill(line);
    // A value the template quotes (a placeholder alone reads as YAML's own
    // braces, so the template writes '{{name}}') is filled in without them.
    const field = /^([a-z][a-z-]*):\s+(.*)$/.exec(line);
    if (!field) return fill(line);
    return `${field[1]}: ${yamlValue(fill(unquote(field[2].trim()) ?? field[2]))}`;
  });
  if (unknown.size > 0) return [...unknown].sort();
  return out.join('\n');
}

/** The `order` the next Role takes: after the last one that gives one. */
function nextOrder(rolesDir: string, roles: readonly RoleDefinition[]): number {
  let last = 0;
  for (const role of roles) {
    try {
      const text = fs.readFileSync(path.join(rolesDir, role.id, ROLE_FILE), 'utf-8');
      // Only an `order` the file writes: a Role with none is listed after them all.
      const written = /^order:\s*(\d{1,4})\s*$/m.exec(text.split(/^---\s*$/m)[1] ?? '');
      if (written) last = Math.max(last, Number(written[1]));
    } catch {
      // A Role whose file went missing meanwhile gives no order.
    }
  }
  return Math.min(last + ORDER_STEP, MAX_ORDER);
}

/**
 * The new Role's files, from the template in `templateDir`, for the Roles'
 * folder `rolesDir`. Either a plan that reads back with no problem, or every
 * reason there is none, in words for whoever ran the command.
 */
export function planNewRole(rolesDir: string, templateDir: string, ask: NewRoleAsk): NewRoleResult {
  const id = ask.id;
  if (!isRoleId(id)) {
    return {
      problems: [
        `"${id}" cannot be a Role's id: lower-case letters, digits and hyphens, starting with a letter, 40 characters at most (for example "data-engineer")`,
      ],
    };
  }
  if (!fs.existsSync(rolesDir)) return { problems: [`there is no Roles' folder at ${rolesDir}`] };
  if (fs.existsSync(path.join(rolesDir, id))) {
    return {
      problems: [`${path.join(rolesDir, id)} is already there: a Role is never overwritten`],
    };
  }

  const existing = readRoleKits(rolesDir);
  const problems: string[] = [];

  const name = ask.name === undefined ? nameOf(id) : oneLine(ask.name);
  if (name === undefined || name.length === 0 || name.length > MAX_ROLE_NAME_CHARS) {
    problems.push(`its name must be 1-${MAX_ROLE_NAME_CHARS} characters on one line`);
  }
  const namesake = existing.roles.find(
    (role) => name !== undefined && role.name.toLowerCase() === name.toLowerCase(),
  );
  if (namesake) {
    problems.push(
      `the Role "${namesake.id}" is already called "${namesake.name}": a name tells a Role apart for whoever launches one by it`,
    );
  }

  const description =
    ask.description === undefined
      ? `Does the ${name ?? nameOf(id)}'s part of the team's work.`
      : oneLine(ask.description);
  if (
    description === undefined ||
    description.length === 0 ||
    description.length > MAX_ROLE_DESCRIPTION_CHARS
  ) {
    problems.push(`its description must be 1-${MAX_ROLE_DESCRIPTION_CHARS} characters on one line`);
  }

  const taken = new Set(existing.roles.map((role) => role.color));
  const color: RoleColor | undefined =
    ask.color === undefined
      ? (ROLE_COLORS.find((candidate) => !taken.has(candidate)) ?? 'gray')
      : ROLE_COLORS.find((candidate) => candidate === ask.color);
  if (color === undefined) {
    problems.push(`"${ask.color}" is not a Role's colour: ${ROLE_COLORS.join(', ')}`);
  }

  // The first Playbook and the Workflow that runs it share a name, as the
  // shipped ones do, so the name must fit both.
  const playbook =
    ask.playbook === undefined ? `${name ?? nameOf(id)} review` : oneLine(ask.playbook);
  const playbookId = playbook === undefined ? '' : slugOf(playbook);
  if (
    playbook === undefined ||
    playbook.length === 0 ||
    playbook.length > MAX_WORKFLOW_NAME_CHARS
  ) {
    problems.push(
      `its first Playbook's name must be 1-${MAX_WORKFLOW_NAME_CHARS} characters on one line (give one with --playbook)`,
    );
  } else if (!isWorkflowId(playbookId)) {
    problems.push(
      `"${playbook}" makes no id for a Playbook: start its name with a letter (give one with --playbook)`,
    );
  } else if (existing.workflows.some((workflow) => workflow.id === playbookId)) {
    problems.push(
      `a Workflow "${playbookId}" is already there, and a Workflow's id is its own: name this Role's first Playbook otherwise with --playbook`,
    );
  }
  if (
    problems.length > 0 ||
    name === undefined ||
    description === undefined ||
    color === undefined ||
    playbook === undefined
  ) {
    return { problems };
  }

  const others = existing.roles.filter((role) => role.id !== DEFAULT_WORKFLOW_LEAD);
  const reviewer = others.find((role) => role.id === REVIEWER_ROLE) ?? others[0];
  const coordinator = existing.roles.find((role) => role.id === DEFAULT_WORKFLOW_LEAD);
  const values = new Map<Placeholder, string>([
    ['id', id],
    ['name', name],
    ['description', description],
    ['color', color],
    ['order', String(nextOrder(rolesDir, existing.roles))],
    ['playbook', playbook],
    ['the-reviewer', reviewer ? `the ${reviewer.name}` : 'a colleague'],
    // With no other Role to hand the second look to, the Role takes it itself.
    ['reviewer-id', reviewer?.id ?? id],
    ['the-coordinator', coordinator ? `the ${coordinator.name}` : 'whoever coordinates the team'],
  ]);

  const targets: [template: string, file: string][] = [
    [ROLE_FILE, `${id}/${ROLE_FILE}`],
    [CONTRACT_FILE, `${id}/${CONTRACT_FILE}`],
    [TEMPLATE_PLAYBOOK_FILE, `${id}/${PLAYBOOKS_DIR}/${playbookId}.md`],
    [TEMPLATE_WORKFLOW_FILE, `${id}/${WORKFLOWS_DIR}/${playbookId}.md`],
  ];
  const files: NewRoleFile[] = [];
  for (const [template, file] of targets) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(templateDir, template), 'utf-8');
    } catch (err) {
      problems.push(`the template's ${template} cannot be read (${String(err)})`);
      continue;
    }
    const rendered = render(text, values);
    if (typeof rendered === 'string') files.push({ path: file, text: rendered });
    else {
      problems.push(
        `the template's ${template} asks for {{${rendered.join('}}, {{')}}}, which nothing gives (it takes: ${Object.keys(PLACEHOLDERS).join(', ')})`,
      );
    }
  }
  if (problems.length > 0) return { problems };

  // Read it back as the office would, before a file exists.
  const [roleFile, contractFile, playbookFile, workflowFile] = files;
  const role = parseRoleFile(id, roleFile.text);
  const contract = parseContract(contractFile.text);
  const firstPlaybook = parsePlaybookFile(playbookId, playbookFile.text);
  const workflow = parseWorkflowFile(playbookId, id, workflowFile.text);
  for (const [file, parsed] of [
    [roleFile, role],
    [contractFile, contract],
    [playbookFile, firstPlaybook],
    [workflowFile, workflow],
  ] as const) {
    if (typeof parsed === 'string') problems.push(`${file.path}: ${parsed}`);
  }
  if (
    typeof role === 'string' ||
    typeof contract === 'string' ||
    typeof firstPlaybook === 'string' ||
    typeof workflow === 'string'
  ) {
    return { problems };
  }
  const made: RoleDefinition = {
    ...role.role,
    contract: contract.contract,
    playbooks: [firstPlaybook.playbook],
  };
  const broken = roleKitProblems({
    roles: [...existing.roles, made],
    workflows: [...existing.workflows, workflow.workflow],
  }).filter((problem) => problem.startsWith(`${id}/`));
  if (broken.length > 0) return { problems: broken };

  return { plan: { id, name, color, playbook: { id: playbookId, name: playbook }, files } };
}

/**
 * Write a plan's files under `rolesDir`, answering the paths written. A file
 * that is already there stops it (and is left as it is): the plan was made for
 * a folder that did not exist.
 */
export function writeNewRole(rolesDir: string, plan: NewRolePlan): string[] {
  const written: string[] = [];
  for (const file of plan.files) {
    const target = path.join(rolesDir, ...file.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.text, { encoding: 'utf-8', flag: 'wx' });
    written.push(target);
  }
  return written;
}

/** A file of a Role and how many of its lines the template still wrote. */
export interface TemplateLeftover {
  /** From the Roles' folder, with forward slashes. */
  file: string;
  lines: number;
}

/** The shortest line worth telling: shorter ones (a heading, a command) are
 *  the same in any Role. */
const MIN_TELLING_LINE_CHARS = 40;

/** A template's text after its front matter, as the lines that would be
 *  recognized in a Role's file whatever its placeholders were filled with. */
function tellingLines(template: string): RegExp[] {
  const lines = template.replace(/\r\n?/g, '\n').split('\n');
  const end =
    lines[0]?.trim() === '---' ? lines.findIndex((l, i) => i > 0 && l.trim() === '---') : -1;
  return lines
    .slice(end + 1)
    .map((line) => line.trim())
    .filter((line) => line.length >= MIN_TELLING_LINE_CHARS && !line.startsWith('#'))
    .map(
      (line) =>
        new RegExp(
          `^${line
            .split(PLACEHOLDER_RE)
            // split() keeps the captured names at the odd places.
            .map((part, at) => (at % 2 === 1 ? '.+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
            .join('')}$`,
        ),
    );
}

function markdownIn(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .sort();
  } catch {
    return [];
  }
}

/**
 * The files of the Role `roleId` that still hold lines as the template wrote
 * them, and how many. Not a problem (every such line is true of any Role):
 * a list of what nobody has made the Role's own yet.
 */
export function templateLeftovers(
  rolesDir: string,
  templateDir: string,
  roleId: string,
): TemplateLeftover[] {
  const pairs: [template: string, files: string[]][] = [
    [ROLE_FILE, [ROLE_FILE]],
    [CONTRACT_FILE, [CONTRACT_FILE]],
    [
      TEMPLATE_PLAYBOOK_FILE,
      markdownIn(path.join(rolesDir, roleId, PLAYBOOKS_DIR)).map((n) => `${PLAYBOOKS_DIR}/${n}`),
    ],
    [
      TEMPLATE_WORKFLOW_FILE,
      markdownIn(path.join(rolesDir, roleId, WORKFLOWS_DIR)).map((n) => `${WORKFLOWS_DIR}/${n}`),
    ],
  ];
  const leftovers: TemplateLeftover[] = [];
  for (const [template, files] of pairs) {
    let telling: RegExp[];
    try {
      telling = tellingLines(fs.readFileSync(path.join(templateDir, template), 'utf-8'));
    } catch {
      continue;
    }
    for (const file of files) {
      let text: string;
      try {
        text = fs.readFileSync(path.join(rolesDir, roleId, ...file.split('/')), 'utf-8');
      } catch {
        continue;
      }
      const lines = text
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => telling.some((pattern) => pattern.test(line))).length;
      if (lines > 0) leftovers.push({ file: `${roleId}/${file}`, lines });
    }
  }
  return leftovers;
}
