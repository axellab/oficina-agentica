import { defineTool, ok } from '../tool.js';

export const listRoles = defineTool({
  name: 'list_roles',
  title: 'List roles',
  description:
    'List the Roles an agent can be launched as in this office: the parts of the delivery team ' +
    '(Architect, Developer, QA Engineer, …, plus any the user defined). For each: its `id` (what ' +
    "launch_agent's `role` takes), name, what it does, whether it is built in or the user's own, " +
    '`agents`: the ids of the agents in the office launched as it (list_agents says what each is ' +
    'doing; an empty `agents` means nobody holds that Role right now), and `playbooks`: the jobs ' +
    'its agents run the same way every time, each with what it is for. Ask an agent of the Role ' +
    'for one by its name.',
  input: {},
  changes: false,
  uses: ['roles'],
  run: (_args, { office }) => {
    const roles = office.roles.listRoles().map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      source: role.source,
      agents: role.agents,
      playbooks: role.playbooks,
    }));
    return ok({ roles });
  },
});
