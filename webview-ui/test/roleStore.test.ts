/**
 * The office's list of Roles (roleStore): what a `rolesLoaded` message leaves
 * in it, and that nothing else touches it; and what the drawer says of a Role
 * (roleView).
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { beforeEach, test } from 'vitest';

import { handleRolesMessage, listedRoles, resetRoleStoreForTests } from '../src/roles/roleStore.js';
import { roleTitle } from '../src/roles/roleView.js';

beforeEach(() => resetRoleStoreForTests());

const ARCHITECT = {
  id: 'architect',
  name: 'Architect',
  description: 'Shapes the system.',
  color: 'purple',
  source: 'builtin',
};

test('rolesLoaded replaces the list, in the order sent', () => {
  const writer = { ...ARCHITECT, id: 'writer', name: 'Writer', source: 'user' };

  assert.equal(handleRolesMessage({ type: 'rolesLoaded', roles: [ARCHITECT, writer] }), true);
  assert.deepEqual(listedRoles(), [ARCHITECT, writer]);

  handleRolesMessage({ type: 'rolesLoaded', roles: [writer] });
  assert.deepEqual(listedRoles(), [writer]);
});

test('an entry that is not a Role is left out; the rest still list', () => {
  handleRolesMessage({
    type: 'rolesLoaded',
    roles: [{ id: 'Not An Id', name: 'X' }, null, ARCHITECT, { id: 'nameless' }],
  });

  assert.deepEqual(listedRoles(), [ARCHITECT]);
});

test('a Role is listed without anything the office is not told', () => {
  handleRolesMessage({ type: 'rolesLoaded', roles: [{ ...ARCHITECT, prompt: 'secret' }] });

  assert.deepEqual(listedRoles(), [ARCHITECT]);
});

test('a rolesLoaded with no list empties it', () => {
  handleRolesMessage({ type: 'rolesLoaded', roles: [ARCHITECT] });
  handleRolesMessage({ type: 'rolesLoaded' });

  assert.deepEqual(listedRoles(), []);
});

test('any other message is not taken, and changes nothing', () => {
  handleRolesMessage({ type: 'rolesLoaded', roles: [ARCHITECT] });
  const before = listedRoles();

  assert.equal(handleRolesMessage({ type: 'directoriesLoaded', roles: [] }), false);
  assert.equal(listedRoles(), before);
});

test("a Role's Playbooks are listed by name, and only names", () => {
  const engineer = {
    ...ARCHITECT,
    id: 'devsecops-engineer',
    name: 'DevSecOps Engineer',
    playbooks: ['Pipeline troubleshooting', 7, '', 'Supply chain audit'],
  };

  handleRolesMessage({ type: 'rolesLoaded', roles: [engineer, { ...ARCHITECT, playbooks: [] }] });

  assert.deepEqual(listedRoles(), [
    { ...engineer, playbooks: ['Pipeline troubleshooting', 'Supply chain audit'] },
    ARCHITECT,
  ]);
});

test("a Role's tooltip says what it does, then names its Playbooks", () => {
  assert.equal(roleTitle({ description: 'Shapes the system.' }), 'Shapes the system.');
  assert.equal(
    roleTitle({ description: 'Shapes the system.', playbooks: [] }),
    'Shapes the system.',
  );
  assert.equal(
    roleTitle({
      description: 'Builds and secures the pipeline.',
      playbooks: ['Pipeline troubleshooting', 'Supply chain audit'],
    }),
    'Builds and secures the pipeline.\nPlaybooks: Pipeline troubleshooting, Supply chain audit.',
  );
  assert.equal(roleTitle({ description: '', playbooks: ['Daily'] }), 'Playbooks: Daily.');
  assert.equal(roleTitle({ description: '' }), undefined);
});
