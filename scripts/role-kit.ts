/**
 * The Roles' folders from the command line:
 *
 *   npm run new-role -- <id> ["Name"] [--description "…"] [--color <name>] [--playbook "Name"]
 *       Make roles/<id>/ from role-template/: its ROLE.md, its CONTRACT.md, a first
 *       Playbook and the Workflow that runs it. Nothing is written unless all of
 *       it reads back with no problem, and nothing is overwritten.
 *
 *   npm run check-roles
 *       Read roles/ as the office does and print what is wrong with a file, what
 *       a Role is missing by the house rules, and which files still hold the
 *       template's own lines. Exits 1 when there is a problem.
 *
 * The rules themselves are the server's (server/src/roles/: kitFormat.ts,
 * kitRules.ts, roleScaffold.ts), where they are tested; this only talks.
 */

import * as path from 'path';

import { roleKitProblems } from '../server/src/roles/kitRules.js';
import { readRoleKits } from '../server/src/roles/roleKits.js';
import {
  planNewRole,
  readNewRoleAsk,
  templateLeftovers,
  writeNewRole,
} from '../server/src/roles/roleScaffold.js';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROLES_DIR = path.join(REPO_ROOT, 'roles');
const TEMPLATE_DIR = path.join(REPO_ROOT, 'role-template');

const USAGE = [
  'Usage:',
  '  npm run new-role -- <id> ["Name"] [--description "…"] [--color <name>] [--playbook "Name"]',
  '  npm run check-roles',
  '',
  'Example:',
  '  npm run new-role -- data-engineer "Data Engineer" --description "Builds and checks the data pipelines."',
].join('\n');

/** A path as it is typed from the repository's root. */
const shown = (file: string): string => path.relative(REPO_ROOT, file).split(path.sep).join('/');

function newRole(args: string[]): number {
  const ask = readNewRoleAsk(args);
  if (typeof ask === 'string') {
    console.error(`${ask}\n\n${USAGE}`);
    return 1;
  }
  const result = planNewRole(ROLES_DIR, TEMPLATE_DIR, ask);
  if ('problems' in result) {
    console.error(`No Role was made:\n${result.problems.map((line) => `  - ${line}`).join('\n')}`);
    return 1;
  }
  const { plan } = result;
  const written = writeNewRole(ROLES_DIR, plan);
  const folder = `roles/${plan.id}`;
  console.log(
    [
      `Made the ${plan.name} (${plan.color}) in ${folder}/:`,
      ...written.map((file) => `  ${shown(file)}`),
      '',
      'It is a Role already: the office lists it after the next build (npm run build),',
      'the others are told of it, and its Workflow is in the launch drawer.',
      "What it says is the template's, true of any Role. Make it this one's:",
      `  1. ${folder}/ROLE.md       what it does, how it works, where its work ends`,
      `  2. ${folder}/CONTRACT.md   what it accepts, delivers and never does, whom it hands to`,
      `  3. ${folder}/playbooks/    the tools it really runs, with the exact commands`,
      `  4. ${folder}/workflows/    the stages of the request it leads, and who owns each`,
      ...(ask.description === undefined
        ? [
            '',
            "No --description was given, so ROLE.md's is a stand-in: write the one line the",
            'other Roles read of this one.',
          ]
        : []),
      '',
      'Then: npm run check-roles',
      'How each file is written: docs/roles.md, "Adding a Role".',
    ].join('\n'),
  );
  return 0;
}

function checkRoles(): number {
  const kits = readRoleKits(ROLES_DIR);
  const problems = [...kits.problems, ...roleKitProblems(kits)];
  const playbooks = kits.roles.reduce((count, role) => count + (role.playbooks?.length ?? 0), 0);
  console.log(
    `${kits.roles.length} Roles, ${playbooks} Playbooks and ${kits.workflows.length} Workflows in roles/.`,
  );
  if (problems.length === 0) console.log('No problem found.');
  else console.error(`\nTo fix:\n${problems.map((line) => `  - roles/${line}`).join('\n')}`);

  const leftovers = kits.roles.flatMap((role) =>
    templateLeftovers(ROLES_DIR, TEMPLATE_DIR, role.id),
  );
  if (leftovers.length > 0) {
    console.log(
      [
        '',
        'Still as the template wrote them (not a problem: check each is true of the Role):',
        ...leftovers.map(
          ({ file, lines }) => `  - roles/${file}: ${lines} ${lines === 1 ? 'line' : 'lines'}`,
        ),
      ].join('\n'),
    );
  }
  return problems.length === 0 ? 0 : 1;
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'new') process.exitCode = newRole(rest);
else if (command === 'check') process.exitCode = checkRoles();
else {
  console.error(USAGE);
  process.exitCode = 1;
}
