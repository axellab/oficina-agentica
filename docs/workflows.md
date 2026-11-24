# Workflows

A Workflow is how one kind of request is handled: an ordered list of stages, each owned by a [Role](roles.md). You pick the Workflow that fits what you need, write the request in your own words, and a [Crew](roles.md#a-crew-agents-free-to-work-together) takes it from there: its lead hands each stage to an agent of the Role that owns it, and the office shows you every stage as it moves.

Every Workflow is led by one Role. The general ones are led by the Agile Project Manager, who coordinates the whole team; every other Role leads Workflows of its own, for the requests that are its speciality. You can write your own too.

| Workflow                     | Led by                | For                                                                                            |
| ---------------------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| **New feature**              | Agile Project Manager | From a request to a tested, reviewed change ready to merge.                                    |
| **Bug fix**                  | Agile Project Manager | Reproduce a bug, find its cause, fix it and prove it stays fixed.                              |
| **Deep security analysis**   | Agile Project Manager | A threat model and a ranked list of security findings, with evidence.                          |
| **Deep quality analysis**    | Agile Project Manager | How healthy the code, its tests and its pipeline are, with a ranked plan.                      |
| **Sprint planning**          | Agile Project Manager | A goal and a backlog turned into a sprint plan you agreed to, story by story.                  |
| **Architecture review**      | Architect             | How the system is really structured against how it is meant to be, with a ranked plan.         |
| **Technical design**         | Architect             | A goal turned into a reviewed design, its decision recorded, and a plan in steps.              |
| **Safe refactor**            | Developer             | Code restructured in small steps, its behaviour pinned by tests and proven unchanged.          |
| **Dependency upgrade**       | Developer             | Dependencies upgraded one at a time, their changes read, their origin checked.                 |
| **Full regression**          | QA Engineer           | Every suite run, each failure classified, the regressions fixed, and a verdict on the release. |
| **Flaky test hunt**          | QA Engineer           | The tests that fail for no reason found, reproduced, and fixed at their cause.                 |
| **Pipeline troubleshooting** | DevSecOps Engineer    | Why a pipeline that passed now fails, and a fix proven by a green run.                         |
| **Pipeline hardening**       | DevSecOps Engineer    | The pipeline reviewed for mistakes and for abuse, and hardened on a branch.                    |
| **Supply chain audit**       | DevSecOps Engineer    | What the code is built from, what in it is vulnerable, unpinned or leaked.                     |
| **Threat model**             | Security Engineer     | How a system or a change could be attacked, and the control that answers each threat.          |
| **Vulnerability review**     | Security Engineer     | The code scanned and read for vulnerabilities, ranked, fixed where you say, verified.          |
| **Infrastructure review**    | Cloud Engineer        | The infrastructure code checked for mistakes, exposure and weak reliability, ranked.           |
| **Cost review**              | Cloud Engineer        | What the infrastructure costs per month, what makes most of it, and where to save.             |

## Starting a run

1. Click **+** to open the launch drawer.
2. Press the **Workflow** row (under **Crew**; it reads **None** until you pick one) and choose a Workflow. They are listed under the Role that leads them. The **Role** row now names that Role and **Crew** reads **On**: a run is always a Crew led by the Workflow's own Role, so neither is yours to set.
3. Choose the Directory the work happens in.
4. The office shows the Workflow's stages and asks for **your request**. Write what you need as you would to a colleague, then press **Start** (or Ctrl+Enter).

![The launch drawer's Workflow row: the Workflows under the Role that leads each (the list scrolls; its two halves are side by side here), and the drawer once Threat model is picked, with the Role and the Crew set by it](images/workflow-picker.png)

![The request dialog for New feature: its stages numbered by step with the Role that owns each, and the request the run starts from](images/workflow-request.png)

Nothing launches before **Start**. The pick lasts until the drawer closes, like a Role: opened again, the drawer launches plain agents.

## What happens next

- **The lead comes in**, as the Workflow's lead Role (the Agile Project Manager for the general ones, each other Role for its own), with a new Crew. It reads your request and the stages, and asks you in its own terminal for anything the request leaves open that only you can decide.
- **It hands each stage to the Role that owns it**, launching the Roles the Crew does not have yet, without asking you: that is what a Crew is. A stage its own Role owns, it does itself.
- **It waits without spending your plan on looking.** While a colleague works, the lead waits for it with a single call that the office answers when that colleague's turn ends, with what is on its screen. It does not keep checking.
- **The stages run in order.** A stage starts once the ones before it are done or skipped. Stages that share a number in the dialog run at the same time (a security review beside the testing, for example). When later work sends an earlier stage back (QA finds a defect), the lead starts that stage again.
- **You watch it in the office.** Every hand-over is a walk to the other agent's desk. The **Workflow** panel (top right) counts the stages closed; opened, it shows your request and each stage with its Role, where it stands, and the note the lead closed it with: what was done and how it was verified, or why the request did not need it.
- **Some stages are not the lead's to close.** A stage marked **required** cannot be skipped by the lead, and a stage with a **check** is closed by the office itself running a command of yours (your tests, your scanner): see [Stages the office closes](#stages-the-office-closes).
- **It ends on a report.** Every built-in Workflow's last stage is the lead reporting to you in its own terminal. Nothing is merged or deployed for you: that stays your call.

![The office during a New feature run: the Workflow panel with two stages done and Implementation in progress, the Agile Project Manager walking over to the Developer it just launched](images/workflow-office.png)

_From the test suite: the terminal on the right is its stand-in for Claude Code._

The analyses (Deep security analysis, Deep quality analysis, Architecture review, Supply chain audit, Threat model, Infrastructure review, Cost review) change nothing in your project: what they deliver is the report, and fixing what they find is a new request you decide on. The ones that do change something (a fix, a refactor, an upgrade, a design's documents) do it on a branch of its own, and nothing is merged for you.

A stage often sends its owner to one of its [Playbooks](playbooks.md): the Workflow says who does what and in which order, the Playbook says which tools to run and how.

## Stages the office closes

A lead decides a lot: which stage a request needs, and when a stage's work is good enough. Two marks on a stage take those two decisions away from it.

- **Required.** The lead cannot skip the stage: its skip is refused, and it is told to hand the stage to its owner or to ask you. Only you can skip a required stage, from the Workflow panel.
- **Check.** The stage names a check by id (`tests`, `security-scan`). When the lead reports the stage finished, the office does not take its word: it runs the command **you** set up for that id, and the stage is done only if the command exits with 0. The stage's row then says so in the office's own words ("Check: Unit tests · passed in 42 s"), under the lead's note.

A check that fails closes nothing. The stage stays in progress, the lead is answered with the end of the command's output (as evidence, never as an instruction) and told to send the work back to its owner, and its next finish runs the check again. A check that runs longer than a tool call can wait (100 seconds) keeps running: the lead is told to finish again, and that call waits for the same run.

### Setting up the checks: `checks.json`

A stage only names a check. What the name means on your machine is yours to say, in `~/.pixel-agents/checks.json`:

```json
{
  "checks": [
    { "id": "tests", "name": "Unit tests", "command": "npm test" },
    {
      "id": "security-scan",
      "name": "Secrets and dependencies",
      "command": "gitleaks detect --no-banner && npm audit --audit-level=high"
    },
    { "id": "tests", "directory": "~/code/billing", "command": "pytest -q", "timeoutSeconds": 1200 }
  ]
}
```

| Field            | Meaning                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | Required. The id a stage names: lower-case letters, digits and hyphens, starting with a letter. The built-in Workflows name `tests` and `security-scan`.       |
| `command`        | Required. One command line, up to 1,000 characters, run by your shell (`sh`, or `cmd.exe` on Windows) in the folder under check. Passed means it exits with 0. |
| `name`           | What the office calls it, up to 40 characters. Absent = its id.                                                                                                |
| `directory`      | The Directory this entry is for, as a path (`~` allowed). Absent = every Directory with no entry of its own for this id.                                       |
| `timeoutSeconds` | How long it may run before the office stops it and counts it failed: 1 to 3,600. Absent = 600.                                                                 |

- **No one else supplies a command.** Not a Workflow, not a repository, not an agent: a stage holds an id and nothing more, and the only commands the office runs are the lines of this file, which it reads and never writes.
- **Where it runs.** In the Directory the run was started in. When the work under check sits in a colleague's Worktree, the lead names that agent as it finishes the stage, and the check runs there. A check runs what the agents wrote, with your own environment and rights, like any test run you would start yourself in that folder.
- **How it runs.** With no terminal and no input, `CI=1` and `NO_COLOR=1` set unless you set them yourself, one check at a time. One that runs out of time, or whose run is stopped, is ended with everything it started.
- **A check you did not set up verifies nothing.** With no entry for its id, the stage is closed on the lead's note as before, its row reads "not set up", and the lead is told to say so in its report. Nothing is checked out of the box: the built-in Workflows only name the checks.
- **The file is read when a stage is finished**, so an edit applies at once, to a run under way too. An entry with a mistake is left out and the host's log says why.

### In the office

The request dialog marks the stages that are required and the ones a check closes, before you start. In the Workflow panel, such a stage's row can be pressed:

- **Check Output** shows what the office ran, where, how it ended and what it printed (its end, when it printed a lot). Only an office with the tokened URL can ask: the output never rides the broadcast every office gets.
- **Skip Stage**, asked once, closes the stage as skipped, with the note "Skipped by the user, from the office." It ends a check that is running. Tell the lead in its terminal: it reads the change at its next look at the run.

The output is kept in the office's memory, like the run: it is gone when the run is stopped.

![The Workflow panel during a Bug fix run: Verification is required and its check failed, with Check Output and Skip Stage under it; the lead's terminal shows the office's answer, with the output](images/workflow-check-failed.png)

![The same run later: the check passed and the office closed Verification on it, and the Security check, required, was skipped by the user](images/workflow-check-passed.png)

_From the test suite: the terminal on the right is its stand-in for Claude Code._

### The built-in stages that are marked

| Workflow           | Stage           | Required | Check           |
| ------------------ | --------------- | -------- | --------------- |
| New feature        | Testing         | Yes      | `tests`         |
| New feature        | Security review | Yes      | `security-scan` |
| Bug fix            | Verification    | Yes      | `tests`         |
| Bug fix            | Security check  | Yes      | `security-scan` |
| Safe refactor      | Verification    | Yes      | `tests`         |
| Dependency upgrade | Verification    | Yes      | `tests`         |
| Full regression    | Second run      | No       | `tests`         |

The analyses carry no check: their stages end on findings, and a scanner that finds something would keep them open for ever. Make `security-scan` a command that fails only on what must block a change, since it closes the security stage of every fix and feature.

## Stopping a run

**Stop Workflow** in the panel, asked once. The run is over and its Crew is ended: the agents keep running and keep their work, but no longer launch, message or close each other. Ending the run's Crew from the Crew panel, or closing its lead, ends the run too.

A run that reached its last stage stays in the panel, finished, until you stop it, so the notes stay there to read.

## Limits

- A run is a Crew, with a Crew's limits: at most 8 agents at a time, each on your Claude plan, reaching only each other, and only you answer a permission prompt.
- Only you start a run. No agent can start one, and only the run's lead reports its stages.
- The order is the office's, not the lead's good manners: a stage reported out of order is refused, and so are a skip of a required stage and a finish whose check fails.
- A run lives in the office's memory: it does not survive a restart of `pixel-agents`.
- Workflows need the Pixel Office MCP allowed and not read-only, and an office that launches agents itself: the standalone office. Where a run cannot be started, the Workflow row is there, dimmed, and its tooltip says what is missing. The VS Code extension has none.

## The built-in Workflows

Stages with the same number run at the same time.

### New feature

| #   | Stage           | Role                  | What closes it                                                                               |
| --- | --------------- | --------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Requirements    | Agile Project Manager | User stories with acceptance criteria that can be checked, and what is left out.             |
| 2   | Design          | Architect             | A technical plan that covers every story and names its risks.                                |
| 3   | Implementation  | Developer             | The plan built on a branch of its own (a new Worktree), the repository's checks passing.     |
| 4   | Testing         | QA Engineer           | Every acceptance criterion has a test or a recorded check that passes.                       |
| 4   | Security review | Security Engineer     | Each finding fixed, or accepted by you in so many words.                                     |
| 5   | Delivery        | DevSecOps Engineer    | The pipeline passes and the branch is ready for you to merge. Nothing is merged or deployed. |
| 6   | Report          | Agile Project Manager | What was built and where, how each criterion was verified, what is open.                     |

### Bug fix

| #   | Stage          | Role                  | What closes it                                                                        |
| --- | -------------- | --------------------- | ------------------------------------------------------------------------------------- |
| 1   | Reproduce      | QA Engineer           | Anyone can see the bug by following the steps (a failing test where possible).        |
| 2   | Diagnosis      | Developer             | The root cause, with evidence, explains every symptom.                                |
| 3   | Fix            | Developer             | The smallest change that removes the cause, with a regression test, on a branch.      |
| 4   | Verification   | QA Engineer           | The reproduction no longer shows the bug, and nothing nearby broke.                   |
| 4   | Security check | Security Engineer     | Whether the bug could be used against the system, and whether the fix opens anything. |
| 5   | Report         | Agile Project Manager | The bug, its cause, the fix and where it is, how it was verified.                     |

### Deep security analysis

| #   | Stage                     | Role                  | What closes it                                                                     |
| --- | ------------------------- | --------------------- | ---------------------------------------------------------------------------------- |
| 1   | Threat model              | Security Engineer     | What is worth protecting, the entry points, and where to look hardest.             |
| 2   | Code review               | Security Engineer     | Every entry point of the model read; each finding with its evidence.               |
| 2   | Dependencies and pipeline | DevSecOps Engineer    | Dependencies, secrets in the repository, what the pipeline runs and as whom.       |
| 2   | Infrastructure            | Cloud Engineer        | Identities, network exposure, encryption, logging, from what the repository holds. |
| 2   | Architecture              | Architect             | Weaknesses no single file shows: misplaced trust, checks that can be bypassed.     |
| 3   | Triage                    | Security Engineer     | Duplicates dropped, every finding left ranked with a reason.                       |
| 4   | Report                    | Agile Project Manager | The findings by severity, where each is and what would fix it.                     |

A secret found on the way is reported by where it is, never copied into a note or a message.

### Deep quality analysis

| #   | Stage              | Role                  | What closes it                                                      |
| --- | ------------------ | --------------------- | ------------------------------------------------------------------- |
| 1   | Scope              | QA Engineer           | Which parts and which qualities matter, and the starting numbers.   |
| 2   | Tests              | QA Engineer           | What the suites cover and what they do not, flaky and empty tests.  |
| 2   | Code health        | Developer             | The parts hardest to change and why, dead code, lint and type debt. |
| 2   | Architecture       | Architect             | Boundaries that leak, dependencies that point the wrong way.        |
| 2   | Build and pipeline | DevSecOps Engineer    | What the pipeline verifies and lets through, how long it takes.     |
| 3   | Triage             | QA Engineer           | Every finding left has a priority and a reason, grouped into steps. |
| 4   | Report             | Agile Project Manager | The findings by priority and the first steps recommended.           |

### Sprint planning

| #   | Stage            | Role                  | What closes it                                                                                          |
| --- | ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | Goal and backlog | Agile Project Manager | The goal agreed with you, where things stand, and the candidate stories with their acceptance criteria. |
| 2   | Feasibility      | Architect             | Every candidate has a size with its reason, or a question that must be answered first.                  |
| 2   | Readiness        | QA Engineer           | Every acceptance criterion can be checked as written, and what done must include.                       |
| 3   | Plan             | Agile Project Manager | You agreed to the plan in so many words: what is in, what is out, what done means, the risks.           |
| 4   | Report           | Agile Project Manager | The agreed plan written where the team keeps it, and what each Role starts with.                        |

Nothing is written to your tracker before you agree to the plan, and nobody starts building during the planning.

## The Roles' own Workflows

Each is led by the Role it belongs to, which does its own stages with its [Playbooks](playbooks.md) and brings in the other Roles for theirs.

![The request dialog for the Security Engineer's Threat model: its stages by step, three of them at the same time with the Architect, the Cloud Engineer and the DevSecOps Engineer](images/workflow-request-threat-model.png)

### Architect

#### Architecture review

| #   | Stage                 | Role               | What closes it                                                                               |
| --- | --------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| 1   | Map                   | Architect          | The structure the repository says it has, and the parts as they are.                         |
| 2   | Structure             | Architect          | Dependencies that point the wrong way, where change is expensive, what no tool decides.      |
| 2   | Testability           | QA Engineer        | What cannot be tested without starting the whole system, and where a seam is missing.        |
| 2   | Security architecture | Security Engineer  | Weaknesses no single file shows: misplaced trust, a check another path goes round.           |
| 2   | Operability           | DevSecOps Engineer | What must be built and deployed together, and how a failure is traced to a part.             |
| 3   | Recommendations       | Architect          | Every finding left ranked by what it costs against what fixing it costs.                     |
| 4   | Report                | Architect          | The intended and the real structure side by side, the findings by priority, the first steps. |

#### Technical design

| #   | Stage           | Role              | What closes it                                                                                  |
| --- | --------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Context         | Architect         | The goal and how anyone will know it is met, the constraints, the system as it is.              |
| 2   | Options         | Architect         | At least two real options, and the one recommended with what it trades away.                    |
| 3   | Security review | Security Engineer | Each concern with what would answer it: new entry points, trust boundaries that move, the data. |
| 3   | Test strategy   | QA Engineer       | How the design would be tested, and what is hard to test as designed.                           |
| 3   | Operations      | Cloud Engineer    | Where each part runs, what it needs, how it is observed and recovered, roughly what it costs.   |
| 4   | Decision        | Architect         | The decision record and the plan in steps, committed as documents on a branch of its own.       |
| 5   | Report          | Architect         | What was decided and what it trades away, where the documents are, what is yours to decide.     |

Nobody implements the design in this run: building it is a new request.

### Developer

#### Safe refactor

| #   | Stage        | Role        | What closes it                                                                                          |
| --- | ------------ | ----------- | ------------------------------------------------------------------------------------------------------- |
| 1   | Bounds       | Developer   | What is restructured and why, what must not change, the branch, and who depends on the code.            |
| 2   | Target shape | Architect   | The target structure agreed, or the objection with its reason.                                          |
| 2   | Safety net   | QA Engineer | The missing tests written against the code as it is, passing, committed before any restructuring.       |
| 3   | Refactor     | Developer   | One move per commit, the repository's checks green on each.                                             |
| 4   | Verification | QA Engineer | The same tests pass as before, none removed, skipped or loosened, and the public interface is the same. |
| 5   | Report       | Developer   | What was restructured, the commits, the checks before and after, what was found and left alone.         |

A refactor and a change of behaviour never share a commit: a bug found on the way is noted for its own change.

#### Dependency upgrade

| #   | Stage        | Role               | What closes it                                                                                            |
| --- | ------------ | ------------------ | --------------------------------------------------------------------------------------------------------- |
| 1   | Plan         | Developer          | Each chosen upgrade with its two versions and the breaking changes that touch this project.               |
| 2   | Origin check | DevSecOps Engineer | Each new version has a go, or a no with its reason: vulnerabilities, publisher, install scripts, licence. |
| 3   | Upgrade      | Developer          | One upgrade per commit, through the package manager, the repository's checks passing.                     |
| 4   | Verification | QA Engineer        | The suites, and the behaviours no test covers, exercised on the branch's last commit.                     |
| 5   | Report       | Developer          | Each package with its two versions, what changed in the code, what was refused, what is still behind.     |

### QA Engineer

#### Full regression

| #   | Stage                    | Role               | What closes it                                                                                           |
| --- | ------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------- |
| 1   | Baseline                 | QA Engineer        | Every suite with its command, the commit under test, and the last green run to compare with.             |
| 2   | Run                      | QA Engineer        | Every suite has its result, and every failure its class: regression, already broken, flaky, environment. |
| 3   | Fix                      | Developer          | For each regression: the smallest change that removes it, on a branch.                                   |
| 3   | Pipeline and environment | DevSecOps Engineer | For the failures that come from how the suites are run: the cause named, fixed as code or put to you.    |
| 4   | Second run               | QA Engineer        | The regressions are gone, nothing new failed, and no test was skipped or loosened to get there.          |
| 5   | Report                   | QA Engineer        | Each suite's result, each failure with its class, and the verdict with the risk that remains.            |

#### Flaky test hunt

| #   | Stage        | Role               | What closes it                                                                                       |
| --- | ------------ | ------------------ | ---------------------------------------------------------------------------------------------------- |
| 1   | Suspects     | QA Engineer        | Each suspect with how often it failed and where.                                                     |
| 2   | Reproduction | QA Engineer        | Each suspect fails on demand with its cause named, or is named as not reproduced.                    |
| 3   | Test fix     | QA Engineer        | For a cause in the test: the fix at the cause, one test per commit.                                  |
| 3   | Product fix  | Developer          | For a cause in the product: a defect, fixed with a test that forces the failure without the fix.     |
| 3   | Pipeline fix | DevSecOps Engineer | For a cause in how the suite runs: the change to the pipeline, as code. Never a retry of everything. |
| 4   | Proof        | QA Engineer        | Each fixed test repeated at least three times as many runs as it took to fail, with no failure.      |
| 5   | Report       | QA Engineer        | Each flaky test with its cause, what was fixed and where, the runs that prove it.                    |

In both, nobody gets a suite green with a retry, a longer timeout or a skip, and whichever stages at step 3 the causes do not need are skipped, with a note. The fixes of step 3 are written at the same time, so each agent that writes one is launched into a Worktree of its own, and step 4 runs on a branch that brings them together, made for that run alone: the fixes stay on their own branches for you to merge.

### DevSecOps Engineer

#### Pipeline troubleshooting

| #   | Stage           | Role               | What closes it                                                                                          |
| --- | --------------- | ------------------ | ------------------------------------------------------------------------------------------------------- |
| 1   | Evidence        | DevSecOps Engineer | The failed run, its first error, the last green run, what changed, and Pipeline Doctor's report if any. |
| 2   | Diagnosis       | DevSecOps Engineer | One cause explains the failure, with its evidence and what was ruled out.                               |
| 3   | Fix             | Developer          | For a cause in the code: the smallest change that removes it, on a branch.                              |
| 3   | Pipeline change | DevSecOps Engineer | For a cause in the pipeline: the change as code, on a branch.                                           |
| 4   | Verification    | QA Engineer        | The pipeline runs green on the branch, and nothing was skipped or silenced to get there.                |
| 5   | Report          | DevSecOps Engineer | The cause, the evidence, the fix and where it is, what is open.                                         |

Whichever of the two stages at step 3 the cause does not need is skipped, with a note. Nobody makes the pipeline green by skipping a test or turning a check off. How the Evidence stage uses [Pipeline Doctor](playbooks.md#pipeline-troubleshooting-and-pipeline-doctor) is in the Playbook.

#### Pipeline hardening

| #   | Stage           | Role               | What closes it                                                                         |
| --- | --------------- | ------------------ | -------------------------------------------------------------------------------------- |
| 1   | Inventory       | DevSecOps Engineer | Every workflow with its triggers, permissions, secrets and the actions it uses.        |
| 2   | Lint and audit  | DevSecOps Engineer | Each finding of the linter, the audit and the manual review says where it is.          |
| 2   | Security review | Security Engineer  | What a pull request from outside could make the pipeline run, and reach.               |
| 3   | Changes         | DevSecOps Engineer | The fixes on a branch, one finding per commit; what needs your decision is put to you. |
| 4   | Verification    | QA Engineer        | The pipeline runs green on the branch and still runs the same tests as before.         |
| 5   | Report          | DevSecOps Engineer | The findings by severity, what was fixed and where, what waits for your decision.      |

#### Supply chain audit

| #   | Stage        | Role               | What closes it                                                                          |
| --- | ------------ | ------------------ | --------------------------------------------------------------------------------------- |
| 1   | Inventory    | DevSecOps Engineer | What the repository is built from, and its bill of materials.                           |
| 2   | Dependencies | DevSecOps Engineer | Known vulnerabilities, pins, licences: each finding with its package and the fix.       |
| 2   | Secrets      | Security Engineer  | Each match in the files and the history judged, by where it is, never by its value.     |
| 3   | Triage       | Security Engineer  | Every finding left ranked by real risk in this system, with a reason.                   |
| 4   | Report       | DevSecOps Engineer | The findings by severity, the secrets to replace, the tools that ran and those missing. |

### Security Engineer

#### Threat model

| #   | Stage                       | Role               | What closes it                                                                                   |
| --- | --------------------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| 1   | Scope and assets            | Security Engineer  | What is modelled, and what is worth protecting.                                                  |
| 2   | How it is built             | Architect          | The components, data flows, entry points and trust boundaries, each with the file that shows it. |
| 2   | Where it runs               | Cloud Engineer     | What is reachable from the network, the identity each part runs as, where data is stored.        |
| 2   | How it is built and shipped | DevSecOps Engineer | Who can change the pipeline, the secrets it reads, what an outside pull request can make it run. |
| 3   | Threats and controls        | Security Engineer  | Every gap has a severity, a reason and a concrete fix.                                           |
| 4   | Report                      | Security Engineer  | The model written down: the threats that matter most with their controls, the gaps by severity.  |

Nothing is attacked: the model comes from reading how the system is built.

#### Vulnerability review

| #   | Stage          | Role               | What closes it                                                                              |
| --- | -------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| 1   | Scope and scan | Security Engineer  | What ran, what was missing, and the leads each tool gave.                                   |
| 2   | Code reading   | Security Engineer  | Every entry point in scope read for what no scanner sees.                                   |
| 2   | Supply chain   | DevSecOps Engineer | Known vulnerabilities in the dependencies, secrets in the files and the history (redacted). |
| 3   | Triage         | Security Engineer  | Every finding left ranked by real risk, and you are asked which to fix now.                 |
| 4   | Fix            | Developer          | For the findings you chose: one per commit, each with the test that fails without it.       |
| 5   | Verification   | Security Engineer  | Each fix closes the path, not only the one input that showed it.                            |
| 6   | Report         | Security Engineer  | The findings by severity, what was fixed and where, what waits for your decision.           |

Without your answer after the triage nothing is fixed: the report is what the run delivers, and the last two stages before it are skipped with a note.

### Cloud Engineer

#### Infrastructure review

| #   | Stage                | Role               | What closes it                                                                                        |
| --- | -------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| 1   | Inventory            | Cloud Engineer     | The root modules, the environments, the providers and modules with their versions, where state lives. |
| 2   | Checks               | Cloud Engineer     | Format, validation, the linter, the scanners and what no tool decides; a plan only if you said yes.   |
| 2   | Network and identity | Security Engineer  | What is reachable from the internet, and what each identity could do if it were taken over.           |
| 2   | Deployment           | DevSecOps Engineer | Who or what applies the code, with which identity, and where the plan is reviewed.                    |
| 3   | Findings             | Cloud Engineer     | Every finding left has a severity, a reason and the change that would fix it.                         |
| 4   | Report               | Cloud Engineer     | The findings by severity, what the plan showed if one was made, the tools that ran and those missing. |

Nothing is applied, imported or destroyed. A `terraform plan` reads your real cloud account, so the lead asks you once whether you want one and for which environment; without a yes in so many words, the review is from the code alone.

#### Cost review

| #   | Stage     | Role           | What closes it                                                                         |
| --- | --------- | -------------- | -------------------------------------------------------------------------------------- |
| 1   | Inventory | Cloud Engineer | The root modules and environments, and the resources that usually carry the bill.      |
| 2   | Estimate  | Cloud Engineer | The monthly estimate per environment, each number with its source and its assumptions. |
| 2   | Design    | Architect      | What in the design makes it expensive, and what a cheaper design would give up.        |
| 3   | Savings   | Cloud Engineer | Each saving with its money per month, its trade-off and who should decide.             |
| 4   | Report    | Cloud Engineer | The estimate, what makes most of it, the savings in order, every assumption.           |

The lead asks you once for the expected usage, and whether pricing through Infracost is fine with you (see [what it needs and sends](playbooks.md#what-reaches-outside-your-machine)).

## Where the built-in Workflows live

Each is a Markdown file in the folder of the Role that leads it: `roles/<role id>/workflows/<workflow id>.md` in the repository ([`roles/`](../roles)). The front matter names it, the text before the first stage is what the lead is told about the Workflow as a whole, and each stage is a section:

```markdown
---
name: Pipeline troubleshooting
description: Why a pipeline that passed now fails, and a fix proven by a green run.
order: 10
---

The request is a pipeline run that fails. ...

## 1. Evidence (devsecops-engineer)

Run your Pipeline troubleshooting playbook, steps 1 to 4. ... Closed when all of that is in your note.

## 3. Fix (developer)

...

## 3. Pipeline change (devsecops-engineer)

...
```

A stage's heading is `## <step>. <Title> (<role id>)`: stages with the same step number run at the same time, and steps count up from 1 without a gap. The stage's id is its title in lower case with hyphens (`pipeline-change`), or the one the heading gives at its end (`{#pipeline}`). A `model:` line in the front matter names the model the lead runs on. A heading may end in marks, each once and in any order: `{required}` (its lead cannot skip it), `{check=<id>}` (the office closes it by running that check: [Stages the office closes](#stages-the-office-closes)), `{model=<name>}` (the model that stage's owner is launched on: [Choosing the model](#choosing-the-model)) and `{#id}`. The limits are the same as in `workflows.json` below, which is also how you replace one of these or add your own without touching the repository.

A Role added to the repository with `npm run new-role` starts with a Workflow of its own, in its folder ([Adding a Role](roles.md#adding-a-role)). `npm run check-roles` holds every Workflow in `roles/` to the same rules: each stage owned by a Role there is, each saying what closes it, a required stage never saying it may be skipped, and a last stage that is its lead's report.

## Choosing the model

Every agent of a run uses your Claude plan, and the model it runs on decides how much. By default each agent runs on its Role's model when the Role names one ([`roles.json`](roles.md#your-own-roles-rolesjson) or the Role's `ROLE.md`), else on the default of your Claude Code. A Workflow can say more:

- **The lead's model**: `model` on the Workflow. The lead is the agent that stays for the whole run, so its model weighs the most.
- **A stage's model**: `model` on a stage. The office launches the stage's Role on it when the lead brings that Role in for the stage; the lead does not have to ask for it, and its launch tells it which model was used.

An agent keeps the model it was launched with. A Role that owns several stages is launched once, for the first of them still open, and runs on that stage's model until it is closed. No built-in Workflow names a model: nothing changes until you set one.

## Your own Workflows: `workflows.json`

Create `~/.pixel-agents/workflows.json` to add a Workflow or replace a built-in one.

```json
{
  "workflows": [
    {
      "id": "release",
      "name": "Release",
      "description": "Cut a release: notes, version, checks, tag.",
      "lead": "agile-project-manager",
      "brief": "The request names the version. Nothing is published: the run ends with a tagged commit ready for the user to push.",
      "stages": [
        {
          "id": "notes",
          "title": "Release notes",
          "role": "agile-project-manager",
          "brief": "Write the notes from the commits since the last tag. Closed when every user-facing change is in them."
        },
        {
          "id": "checks",
          "title": "Release checks",
          "role": "devsecops-engineer",
          "brief": [
            "Run the full pipeline on the release commit.",
            "Closed when it passes, with the run's link in the note."
          ]
        },
        {
          "id": "smoke",
          "title": "Smoke test",
          "role": "qa-engineer",
          "parallel": true,
          "brief": "Install the build as a user would and walk the main paths. Closed when they all work."
        }
      ]
    }
  ]
}
```

| Field               | Meaning                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | Required. Lower-case letters, digits and hyphens, starting with a letter (up to 40). The id of a built-in Workflow replaces that Workflow; a new id adds one.     |
| `name`              | Required. The name the office shows, up to 40 characters.                                                                                                         |
| `description`       | One line on what it is for, up to 200 characters. Shown in the request dialog and when hovering the Workflow.                                                     |
| `lead`              | The id of the Role that leads its runs. Absent = `agile-project-manager`.                                                                                         |
| `brief`             | What the lead is told about the Workflow as a whole, up to 4,000 characters: one string, or a list of lines.                                                      |
| `stages`            | Required. One to 12 stages, in order.                                                                                                                             |
| `stages[].id`       | Required. Same shape as a Workflow's id, unique within the Workflow. It is what the lead names when it reports the stage.                                         |
| `stages[].title`    | Required. The stage's name in the office, up to 60 characters.                                                                                                    |
| `stages[].role`     | Required. The id of the Role that owns the stage (a built-in one, or one of your own from [`roles.json`](roles.md#your-own-roles-rolesjson)).                     |
| `stages[].brief`    | What the stage's owner does and what closes it, up to 2,000 characters: one string, or a list of lines. The lead is told it; write it so it can check the result. |
| `stages[].parallel` | `true` when the stage may run at the same time as the stage listed before it. Not on the first stage.                                                             |
| `stages[].required` | `true` when the run's lead cannot skip the stage: only you can, from the office. See [Stages the office closes](#stages-the-office-closes).                       |
| `stages[].check`    | The id of the check that closes the stage: the office runs your command for it ([`checks.json`](#setting-up-the-checks-checksjson)) when the lead finishes it.    |
| `model`             | The model the run's lead is launched on, as Claude Code names it (`opus`, `sonnet`, `haiku`, or a full model id). Absent = its Role's, else your default.         |
| `stages[].model`    | The model the stage's owner is launched on. Absent = its Role's, else your default. See [Choosing the model](#choosing-the-model).                                |

The built-in ids are `new-feature`, `bug-fix`, `security-review`, `quality-review`, `sprint-planning`, `architecture-review`, `technical-design`, `safe-refactor`, `dependency-upgrade`, `full-regression`, `flaky-test-hunt`, `pipeline-troubleshooting`, `pipeline-hardening`, `supply-chain-audit`, `threat-model`, `vulnerability-review`, `infrastructure-review` and `cost-review`. An entry with one of them replaces that Workflow **whole** (its stages are a list, not fields to merge), so start from the full Workflow you want. New Workflows are listed after the built-in ones, in the file's order; the drawer shows each under the Role that leads it. Up to 30 entries are read.

A change applies to the next run you start; reload the office to see a new or renamed Workflow in the drawer. A run already under way keeps the stages it started with.

An entry with a mistake (an unknown field, a bad id, no stages, a first stage marked parallel) is left out and the rest still load, and so is a Workflow naming a Role your office does not have. The host's log says what was wrong: the terminal running `pixel-agents`.

Stages are for the lead to plan with, not a script: the lead reads your request first, and skips a stage the request does not need, with a note saying why. The ones you mark `required` are the exception: those it cannot skip.
