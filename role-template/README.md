# The Role template

What `npm run new-role` makes a new Role's folder from. It is laid out like a Role's own folder under [`roles/`](../roles), so each Role added to the team starts with the same four files the others have:

| File                    | Becomes                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `ROLE.md`               | `roles/<id>/ROLE.md`: the definition and the Role's standing instructions               |
| `CONTRACT.md`           | `roles/<id>/CONTRACT.md`: its Contract, the five sections                               |
| `playbooks/playbook.md` | `roles/<id>/playbooks/<playbook id>.md`: a first Playbook, which reads and reports      |
| `workflows/workflow.md` | `roles/<id>/workflows/<playbook id>.md`: the Workflow that runs it, led by the new Role |

```bash
npm run new-role -- data-engineer "Data Engineer" --description "Builds and checks the data pipelines."
npm run check-roles
```

How to use the command, and what to do with the files it writes: [docs/roles.md, "Adding a Role"](../docs/roles.md#adding-a-role).

## Placeholders

The command fills these in, in the text and in the front matter:

| Placeholder           | Filled with                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `{{id}}`              | The Role's id, which is its folder's name (`data-engineer`)                               |
| `{{name}}`            | The Role's name (`Data Engineer`)                                                         |
| `{{description}}`     | What the Role does, in one line                                                           |
| `{{color}}`           | The Role's colour, by name                                                                |
| `{{order}}`           | Where the office lists the Role: after the Roles that are there                           |
| `{{playbook}}`        | The name of its first Playbook, and of the Workflow that runs it (`Data Engineer review`) |
| `{{the-reviewer}}`    | The Role a second look is handed to, with its article (`the QA Engineer`)                 |
| `{{reviewer-id}}`     | That Role's id (`qa-engineer`), for a stage's heading                                     |
| `{{the-coordinator}}` | The Role that coordinates the team, with its article (`the Agile Project Manager`)        |

## Changing it

Change these files to what your team expects of every Role, and each Role added from then on starts with it. Three things to keep:

- **Everything after a file's front matter is told to the Role's agents, as written.** A new Role can be launched before anyone edits it, so write what is true of any Role, and leave no note to its author in the text: this page and the command's own output are where those go.
- **A placeholder alone as a front matter value is quoted** (`name: '{{name}}'`): YAML reads bare braces as its own. The command writes the value back plain, or quoted where it needs it (a name with a colon in it).
- **What the template makes must be a Role built like the rest**: each file readable by the office, and the whole within the house rules (a Contract, a Playbook that says when to run it, a Workflow that sends its lead to that Playbook and ends on its report). The command checks before it writes anything, and says which file and which rule when a change here broke one.

`npm run check-roles` counts, for each Role, the lines still exactly as these files wrote them (the ones of 40 characters or more), so its author sees what is left to make the Role's own.
