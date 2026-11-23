/**
 * The office's Crews: what a `crewsLoaded` message leaves in the store
 * (crewStore), who wears the Crew's mark, and what the Crew panel prints
 * (crewView): the agents under the one that launched them, a line per event.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { beforeEach, test } from 'vitest';

import type { Crew, CrewEvent } from '../../core/src/messages.js';
import {
  activeCrewOf,
  crewsLoaded,
  handleCrewsMessage,
  resetCrewStoreForTests,
} from '../src/crews/crewStore.js';
import { crewAgentCount, crewEventLine, crewMemberTitle, crewRows } from '../src/crews/crewView.js';

beforeEach(() => resetCrewStoreForTests());

const MANAGER = { agentId: 1, label: 'Byte', roleName: 'Agile Project Manager' };
const DEVELOPER = { agentId: 2, label: 'Pixel', roleName: 'Developer', launchedBy: 1 };
const QA = { agentId: 3, label: 'Glitch', roleName: 'QA Engineer', launchedBy: 2 };
const SECURITY = { agentId: 4, label: 'Cipher', launchedBy: 1 };

function crewOf(members: Crew['members'], more: Partial<Crew> = {}): Crew {
  return { id: 'crew-1', ended: false, members, events: [], ...more };
}

function loaded(crews: Crew[], more: Record<string, unknown> = {}) {
  return { type: 'crewsLoaded', available: true, maxAgents: 8, crews, ...more };
}

// ── The store ───────────────────────────────────────────────────

test('nothing is known of Crews until the server lists them', () => {
  assert.equal(crewsLoaded(), null);
  assert.equal(activeCrewOf(crewsLoaded(), 1), undefined);
});

test('crewsLoaded replaces the list', () => {
  assert.equal(handleCrewsMessage(loaded([crewOf([MANAGER, DEVELOPER])])), true);
  assert.deepEqual(crewsLoaded()?.crews[0].members, [MANAGER, DEVELOPER]);
  assert.equal(crewsLoaded()?.maxAgents, 8);

  handleCrewsMessage(loaded([]));
  assert.deepEqual(crewsLoaded()?.crews, []);
});

test('why no Crew can be started is kept for the drawer to say', () => {
  handleCrewsMessage(loaded([], { available: false, unavailableReason: 'Turn the MCP on.' }));

  assert.equal(crewsLoaded()?.available, false);
  assert.equal(crewsLoaded()?.unavailableReason, 'Turn the MCP on.');
});

test('a member or an event that is not one is left out; the rest still list', () => {
  handleCrewsMessage(
    loaded([
      {
        id: 'crew-1',
        ended: false,
        members: [MANAGER, { agentId: 'two', label: 'x' }, null, DEVELOPER],
        events: [
          { at: 1, kind: 'danced', fromId: 1, from: 'Byte', toIds: [2], to: ['Pixel'] },
          { at: 2, kind: 'launched', fromId: 1, from: 'Byte', toIds: [2], to: ['Pixel'] },
        ],
      } as unknown as Crew,
    ]),
  );

  const crew = crewsLoaded()?.crews[0];
  assert.deepEqual(crew?.members, [MANAGER, DEVELOPER]);
  assert.deepEqual(
    crew?.events.map((event) => event.kind),
    ['launched'],
  );
});

test('any other message is not taken, and changes nothing', () => {
  handleCrewsMessage(loaded([crewOf([MANAGER])]));
  const before = crewsLoaded();

  assert.equal(handleCrewsMessage({ type: 'rolesLoaded', crews: [] }), false);
  assert.equal(crewsLoaded(), before);
});

test("an agent wears its Crew's mark until the user ends the Crew", () => {
  handleCrewsMessage(loaded([crewOf([MANAGER, DEVELOPER])]));
  assert.equal(activeCrewOf(crewsLoaded(), 2)?.id, 'crew-1');
  assert.equal(activeCrewOf(crewsLoaded(), 9), undefined);

  handleCrewsMessage(loaded([crewOf([MANAGER, DEVELOPER], { ended: true })]));
  assert.equal(activeCrewOf(crewsLoaded(), 2), undefined);
});

// ── The panel's rows ────────────────────────────────────────────

test('each agent is listed under the one that launched it', () => {
  // Launch order: the manager, the developer, security, then the developer's QA.
  const rows = crewRows(crewOf([MANAGER, DEVELOPER, SECURITY, QA]));

  assert.deepEqual(
    rows.map((row) => [row.member.label, row.depth]),
    [
      ['Byte', 0],
      ['Pixel', 1],
      ['Glitch', 2],
      ['Cipher', 1],
    ],
  );
});

test('an agent whose launcher left stands at the top', () => {
  const rows = crewRows(crewOf([DEVELOPER, QA]));

  assert.deepEqual(
    rows.map((row) => [row.member.label, row.depth]),
    [
      ['Pixel', 0],
      ['Glitch', 1],
    ],
  );
});

test('launchers named in a circle still list every agent once', () => {
  const rows = crewRows(
    crewOf([
      { agentId: 1, label: 'A', launchedBy: 2 },
      { agentId: 2, label: 'B', launchedBy: 1 },
      { agentId: 3, label: 'C', launchedBy: 3 },
    ]),
  );

  assert.deepEqual(rows.map((row) => row.member.label).sort(), ['A', 'B', 'C']);
});

test("a member's tooltip says its Role and who launched it", () => {
  const crew = crewOf([MANAGER, DEVELOPER, { agentId: 5, label: 'Orphan', launchedBy: 9 }]);

  assert.equal(
    crewMemberTitle(crew, crew.members[0]),
    'Agent 1 · Agile Project Manager · started the Crew',
  );
  assert.equal(crewMemberTitle(crew, crew.members[1]), 'Agent 2 · Developer · launched by Byte');
  assert.equal(crewMemberTitle(crew, crew.members[2]), 'Agent 5 · launched by agent 9');
});

test('an event reads as who did what to whom', () => {
  const event = (kind: CrewEvent['kind'], to: string[]): CrewEvent => ({
    at: 1,
    kind,
    fromId: 1,
    from: 'Byte (Agile Project Manager)',
    toIds: to.map((_, index) => index + 2),
    to,
  });

  assert.equal(
    crewEventLine(event('launched', ['Pixel (Developer)'])),
    'Byte (Agile Project Manager) launched Pixel (Developer)',
  );
  assert.equal(
    crewEventLine(event('messaged', ['Pixel (Developer)', 'Glitch (QA Engineer)'])),
    'Byte (Agile Project Manager) to Pixel (Developer), Glitch (QA Engineer)',
  );
  assert.equal(
    crewEventLine(event('closed', ['Pixel (Developer)'])),
    'Byte (Agile Project Manager) closed Pixel (Developer)',
  );
});

test('in its Crew an event names the agents still there by their label alone', () => {
  const crew = crewOf([MANAGER, DEVELOPER]);
  const closed: CrewEvent = {
    at: 1,
    kind: 'closed',
    fromId: 1,
    from: 'Byte (Agile Project Manager)',
    toIds: [3],
    to: ['Glitch (QA Engineer)'],
  };
  const messaged: CrewEvent = {
    ...closed,
    kind: 'messaged',
    toIds: [2, 7],
    to: ['Pixel (Developer)'],
  };

  // The manager is listed above with its Role; the QA engineer it closed is gone.
  assert.equal(crewEventLine(closed, crew), 'Byte closed Glitch (QA Engineer)');
  // A name the server did not give is the agent's number.
  assert.equal(crewEventLine(messaged, crew), 'Byte to Pixel, agent 7');
});

test('the header counts the agents of every Crew', () => {
  assert.equal(crewAgentCount([]), 0);
  assert.equal(
    crewAgentCount([crewOf([MANAGER, DEVELOPER]), crewOf([SECURITY], { id: 'crew-2' })]),
    3,
  );
});
