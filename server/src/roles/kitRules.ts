/**
 * The house rules of the Roles' folders: what every Role of the team has, on
 * top of each file being well formed (kitFormat.ts says that). Pure: it takes
 * what roleKits.ts read and answers one line per thing that is missing.
 *
 * ONE set of rules, so a Role added tomorrow is built like the ones that ship:
 * the shipped folders are held to it by test (roleKits.test.ts), a Role made
 * from the template is checked against it before a file is written
 * (roleScaffold.ts), and `npm run check-roles` prints it for the folders as
 * they stand.
 *
 * The rules, in the words a line of it uses:
 *
 *   A Role       has a Contract, at least one Playbook, and leads at least one
 *                Workflow.
 *   A Playbook   says when to run it (". Use when " in its description, which
 *                is what the coding agent picks the skill by) and its sections
 *                are its steps, numbered from 1 with none skipped ("## 1. …",
 *                "## 2. …": a step is how a stage or a colleague names a part
 *                of it, so a section with no number is a step nobody can ask
 *                for).
 *   A Workflow   says something to its lead before the first stage, gives
 *                every stage to a Role there is, says in each stage what its
 *                owner does and what closes it, sends a stage's owner only to
 *                Playbooks that Role has (every one a stage names), sends its
 *                lead to one of its own (the coordinator's hand every stage to
 *                someone else, so they are let off), and ends on its lead's
 *                report.
 */

import type { RoleDefinition } from '../../../core/src/roles.js';
import { DEFAULT_WORKFLOW_LEAD, type WorkflowDefinition } from '../../../core/src/workflows.js';
import { CONTRACT_FILE, PLAYBOOKS_DIR, WORKFLOWS_DIR } from './kitFormat.js';

/** What a Playbook's description must hold: when to run it. */
const PLAYBOOK_SAYS_WHEN_RE = /\. Use when /;

/** A section of a Playbook: its heading's text. */
const SECTION_RE = /^## +(.*)$/;

/** A step's heading, after the "## ": its number, then what it is. */
const STEP_RE = /^(\d+)\. +\S/;

/** A code block's fence: three or more backticks or tildes. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** How a stage sends its owner to a Playbook, by the Playbook's name. */
const STAGE_PLAYBOOK_RE = /Run your (.+?) playbook/g;

/** The id of the stage every Workflow ends on. */
const REPORT_STAGE_ID = 'report';

/** The shortest brief that can say what a stage's owner does and what closes it. */
const MIN_STAGE_BRIEF_CHARS = 40;

/** The Roles and Workflows the rules are asked about. */
export interface KitsToCheck {
  roles: readonly RoleDefinition[];
  workflows: readonly WorkflowDefinition[];
}

/**
 * A Playbook's sections, by their headings' text, in the order it has them.
 * Not the lines inside its code blocks: a command's output, or a file a step
 * shows, may hold a line that looks like a heading.
 */
function sectionsOf(instructions: string): string[] {
  const sections: string[] = [];
  /** The fence of the code block the line is in, when it is in one. */
  let fence: string | undefined;
  for (const line of instructions.split(/\r?\n/)) {
    const mark = FENCE_RE.exec(line)?.[1];
    if (fence === undefined) {
      if (mark !== undefined) fence = mark;
      else {
        const heading = SECTION_RE.exec(line)?.[1];
        if (heading !== undefined) sections.push(heading.trim());
      }
    } else if (
      // A block ends on a fence of its own kind, at least as long, alone on its line.
      mark !== undefined &&
      mark[0] === fence[0] &&
      mark.length >= fence.length &&
      line.trim() === mark
    ) {
      fence = undefined;
    }
  }
  return sections;
}

/**
 * What is wrong with a Playbook's steps, if anything: its sections must be
 * "## 1. …", "## 2. …" and on, each the next number. The first one out of
 * place is named, since the ones after it are counted from it.
 */
function stepsProblem(instructions: string): string | undefined {
  const sections = sectionsOf(instructions);
  if (sections.length === 0) return 'its steps must be numbered sections, from "## 1. "';
  const odd = sections.findIndex((heading, at) => STEP_RE.exec(heading)?.[1] !== String(at + 1));
  if (odd < 0) return undefined;
  return `its steps must be numbered sections, from "## 1. " and each the next number: "## ${sections[odd]}" stands where "## ${odd + 1}. " is expected`;
}

function playbookProblems(role: RoleDefinition): string[] {
  const problems: string[] = [];
  for (const playbook of role.playbooks ?? []) {
    const at = `${role.id}/${PLAYBOOKS_DIR}/${playbook.id}.md`;
    if (!PLAYBOOK_SAYS_WHEN_RE.test(playbook.description)) {
      problems.push(
        `${at}: its description must say when to run it (a sentence that starts "Use when ")`,
      );
    }
    const steps = stepsProblem(playbook.instructions);
    if (steps !== undefined) problems.push(`${at}: ${steps}`);
  }
  return problems;
}

/** The Playbooks a stage's brief sends its owner to, by name, each once. */
function playbooksNamed(brief: string): string[] {
  return [...new Set([...brief.matchAll(STAGE_PLAYBOOK_RE)].map((match) => match[1]))];
}

function workflowProblems(
  workflow: WorkflowDefinition,
  roles: ReadonlyMap<string, RoleDefinition>,
): string[] {
  const at = `${workflow.lead}/${WORKFLOWS_DIR}/${workflow.id}.md`;
  const problems: string[] = [];
  if (workflow.brief.trim() === '') {
    problems.push(`${at}: it must tell its lead what the run is for, before the first stage`);
  }
  for (const stage of workflow.stages) {
    const owner = roles.get(stage.role);
    if (!owner) {
      problems.push(`${at}: stage "${stage.title}" is owned by "${stage.role}", which is no Role`);
      continue;
    }
    if (stage.brief.trim().length <= MIN_STAGE_BRIEF_CHARS) {
      problems.push(
        `${at}: stage "${stage.title}" must say what its owner does and what closes it`,
      );
    }
    // Every one the brief names: a stage may send its owner to several.
    for (const named of playbooksNamed(stage.brief)) {
      if (!(owner.playbooks ?? []).some((p) => p.name === named)) {
        problems.push(
          `${at}: stage "${stage.title}" sends the ${owner.name} to a "${named}" playbook it does not have`,
        );
      }
    }
  }
  const sendsItsLead = workflow.stages.some(
    (stage) => stage.role === workflow.lead && playbooksNamed(stage.brief).length > 0,
  );
  if (workflow.lead !== DEFAULT_WORKFLOW_LEAD && roles.has(workflow.lead) && !sendsItsLead) {
    problems.push(
      `${at}: one of its lead's own stages must send it to one of its Playbooks ("Run your <Name> playbook")`,
    );
  }
  const last = workflow.stages.at(-1);
  if (
    !last ||
    last.id !== REPORT_STAGE_ID ||
    last.role !== workflow.lead ||
    last.parallel === true
  ) {
    problems.push(
      `${at}: it must end on its lead's report, a last stage "## <step>. Report (${workflow.lead})" of its own step`,
    );
  }
  return problems;
}

/**
 * What the Roles and their Workflows are missing by the house rules, one line
 * each, named by the file to open (as roleKits.ts names its own problems).
 * Empty when every Role is built like the rest.
 */
export function roleKitProblems(kits: KitsToCheck): string[] {
  const roles = new Map(kits.roles.map((role) => [role.id, role]));
  const problems: string[] = [];
  for (const role of kits.roles) {
    if (role.contract === undefined) {
      problems.push(`${role.id}/${CONTRACT_FILE}: missing, and every Role has a Contract`);
    }
    if ((role.playbooks ?? []).length === 0) {
      problems.push(`${role.id}/${PLAYBOOKS_DIR}: every Role has at least one Playbook`);
    }
    problems.push(...playbookProblems(role));
    if (!kits.workflows.some((workflow) => workflow.lead === role.id)) {
      problems.push(`${role.id}/${WORKFLOWS_DIR}: every Role leads at least one Workflow`);
    }
  }
  for (const workflow of kits.workflows) problems.push(...workflowProblems(workflow, roles));
  return problems;
}
