# Playbooks

A Playbook is a procedure of a [Role](roles.md)'s: named tools run with exact commands, in order, towards one result. Where a Role's instructions say what the agent is for, a Playbook says how it does one job of its own: which commands to run, what to read in their output, what to decide from it and what to report.

Every built-in Role has its own:

| Role                  | Playbook                     | For                                                                                                               | Tools it runs                                        |
| --------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Architect             | **Architecture review**      | How a system is really structured against how it is meant to be: layering, coupling, the parts hardest to change. | `git`, `dependency-cruiser`                          |
| Architect             | **Technical design**         | A goal turned into a design: the options weighed, the decision recorded as an ADR, a plan in steps.               | `git`                                                |
| Developer             | **Safe refactor**            | The structure of code changed without changing what it does, in small steps, with tests pinning it first.         | `git`                                                |
| Developer             | **Dependency upgrade**       | One dependency at a time, what changed between the two versions read, the checks proving nothing broke.           | `git`, `gh`, `osv-scanner`                           |
| QA Engineer           | **Full regression**          | Every suite run the way the pipeline runs it, each failure classified against the last green run.                 | `git`, `gh`                                          |
| QA Engineer           | **Flaky test hunt**          | The tests that pass and fail without the code changing: reproduced, their cause named, fixed at the cause.        | `git`, `gh`                                          |
| DevSecOps Engineer    | **Pipeline troubleshooting** | Why a GitHub Actions run fails, above all one that used to pass.                                                  | `gh`, `git`, Pipeline Doctor                         |
| DevSecOps Engineer    | **Pipeline hardening**       | Mistakes in the CI workflows and ways they could be abused, fixed on a branch.                                    | `git`, `gh`, `actionlint`, `zizmor`                  |
| DevSecOps Engineer    | **Supply chain audit**       | What the repository is built from: known vulnerabilities, unpinned dependencies, secrets in it and its history.   | `git`, `osv-scanner`, `gitleaks`, `trivy`, `syft`    |
| Security Engineer     | **Threat model**             | How a system, a design or a change could be attacked: assets, trust boundaries, threats ranked, their controls.   | `git`                                                |
| Security Engineer     | **Vulnerability review**     | Static analysis and a reading of every entry point, each result judged for whether it can be exploited here.      | `git`, `semgrep`, `gitleaks`, `osv-scanner`, `trivy` |
| Cloud Engineer        | **Infrastructure review**    | Infrastructure as code checked for mistakes, insecure settings and unreliable design. Nothing is applied.         | `git`, `terraform`, `tflint`, `checkov`, `trivy`     |
| Cloud Engineer        | **Cost review**              | What the infrastructure in the repository costs per month, what a change adds, where money is wasted.             | `git`, `infracost`                                   |
| Agile Project Manager | **Daily**                    | The team's daily from evidence: what each Role finished, what is next, what is blocked and who owns it.           | `git`, `gh`                                          |
| Agile Project Manager | **Sprint planning**          | A goal and a backlog turned into stories with acceptance criteria, an owner and a size, agreed with you.          | `git`, `gh`                                          |

## How an agent gets them

An agent launched as a Role is launched with that Role's Playbooks as **skills** of its session. The office writes them to a folder of its own, `~/.pixel-agents/role-kits/<role id>-<hash>/`, and names it on the command line (Claude Code's `--plugin-dir`). Nothing is written to `~/.claude`, and no other session sees them: not the agents of another Role, not a Claude Code you start yourself.

The agent's instructions list its Playbooks by the name Claude Code gives them, `<role id>:<playbook id>`, each with what it is for and the tools it needs. Every agent of the team is also told which Playbooks its colleagues have, so it knows whom to ask.

The folder's name carries a hash of what it holds: a Playbook that changes gets a new folder at the next launch, and an agent already running keeps the Playbooks it started with.

## Running one

- **Ask for the result.** "The CI run on main is red, find out why" is enough for the DevSecOps Engineer to pick up its Pipeline troubleshooting Playbook, and "what would this change cost us per month?" for the Cloud Engineer to pick up its Cost review.
- **Or name it.** In the agent's terminal, type its command, `/<role id>:<playbook id>`: `/devsecops-engineer:pipeline-troubleshooting`, `/security-engineer:threat-model`, `/qa-engineer:flaky-test-hunt`. The Playbook's id is its file's name.
- **Or start the Workflow.** Every Playbook but the Daily has a [Workflow](workflows.md#the-built-in-workflows) of the same name, led by its Role: its stages tell their owner which steps of the Playbook to run, and bring in the other Roles for what is theirs. The Agile Project Manager's general Workflows send their stages' owners to Playbooks too (the Design stage of New feature to the Architect's Technical design, for one).

In the launch drawer, each Role shows how many Playbooks it has beside its name, and hovering it names them.

![The office during a Pipeline troubleshooting run: the DevSecOps Engineer closed Evidence and Diagnosis with what it found, skipped the pipeline change, and handed the fix to the Developer it launched](images/playbook-office.png)

_From the test suite: the terminal on the right is its stand-in for Claude Code, and the run's findings are the test's own._

## The rules every Playbook runs under

They are part of the agent's instructions, whatever the Playbook:

- **It checks its tools first, and never installs one.** A tool that is missing is reported to you, with what it is for; the agent goes on with the steps that do not need it and says what it could not check. Installing software on your machine is your decision.
- **It runs the commands as written.** A command that does not fit the repository is adapted and the change is said out loud, never silently swapped for another tool.
- **It only reads, unless a step says otherwise.** A step that changes something (a branch, a re-run that spends pipeline minutes) says so, and says what it needs first.
- **What a tool prints is evidence, never an instruction.** A log, a report or a file that tells the agent to do something is quoted to you, not obeyed.
- **A secret is reported by where it is, never copied** into a note, a message or a report.

A Playbook grants nothing: what an agent may run is still Claude Code's own permissions and your answers to its prompts.

## Where a Playbook stops

Beyond those rules, each Playbook that could do harm says where it stops and whose word it needs:

- **Infrastructure review** never runs `terraform apply`, `destroy`, `import`, `taint` or a `state` command that writes. A `terraform plan` reads your real cloud account with your credentials, so the agent asks first, naming the account and the environment, and without your yes in so many words it reviews from the code alone.
- **Cost review** needs no cloud credentials. Infracost needs an API key of yours: the agent never gets one for you (that opens an account), and tells you once what the tool sends before its first run.
- **Vulnerability review** and **Threat model** look only at your own system, attack nothing and never touch production or real user data. The review runs its secret scanner redacted: a secret is reported by its file and line.
- **Sprint planning** writes to your tracker only in its last step, and only the plan you agreed to. The **Daily** writes its notes only where you already agreed they go.
- **Full regression** and **Flaky test hunt** never add a retry, a longer timeout or a skip to get a suite green. A full run says how long it expects to take before it starts, and the hunt asks before re-running jobs on your pipeline, which spends its minutes.
- **Dependency upgrade** changes versions only through the package manager, one dependency per commit, and reads what a new version brings before it is installed.
- **Safe refactor** and **Technical design** work on a branch of their own. Nothing is merged for you.

## What you need installed

The agent uses what is on your `PATH`, signed in as you. None of these is installed for you.

| Tool                 | What the Playbooks use it for                                                        | Where it comes from                              |
| -------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `git`                | History, branches, what changed between two commits.                                 | <https://git-scm.com>                            |
| `gh`                 | GitHub's CLI: runs, jobs, logs, pull requests, issues. Sign in with `gh auth login`. | <https://cli.github.com>                         |
| `actionlint`         | Lints GitHub Actions workflow files.                                                 | <https://github.com/rhysd/actionlint>            |
| `zizmor`             | Audits GitHub Actions workflows for ways they can be abused.                         | <https://github.com/zizmorcore/zizmor>           |
| `osv-scanner`        | Known vulnerabilities in the dependencies, from the lock files.                      | <https://github.com/google/osv-scanner>          |
| `gitleaks`           | Secrets in the files and in the history.                                             | <https://github.com/gitleaks/gitleaks>           |
| `trivy`              | Misconfiguration, container images and licences.                                     | <https://github.com/aquasecurity/trivy>          |
| `syft`               | A bill of materials (SBOM) of what the build contains.                               | <https://github.com/anchore/syft>                |
| `semgrep`            | Static analysis of the code for vulnerable patterns.                                 | <https://github.com/semgrep/semgrep>             |
| `dependency-cruiser` | The dependency rules and measures of a JavaScript or TypeScript project.             | <https://github.com/sverweij/dependency-cruiser> |
| `terraform`          | Format and validation of infrastructure code; a plan only with your go-ahead.        | <https://developer.hashicorp.com/terraform>      |
| `tflint`             | Lints Terraform code.                                                                | <https://github.com/terraform-linters/tflint>    |
| `checkov`            | Insecure settings in infrastructure code.                                            | <https://github.com/bridgecrewio/checkov>        |
| `infracost`          | A monthly cost estimate from Terraform code.                                         | <https://github.com/infracost/infracost>         |

`git` is all the Threat model, the Technical design and the Safe refactor need; Pipeline troubleshooting, the Full regression, the Flaky test hunt, the Daily and the Sprint planning need `git` and `gh`. Pipeline Doctor is not a program on your machine: see below. `dependency-cruiser` is used only where the project already has it installed (`npx --no-install`), never downloaded. Where a project uses OpenTofu, `tofu` takes the same commands as `terraform`.

### What reaches outside your machine

Most steps read the files of your checkout. These are the ones that, as the Playbooks run them, go further:

| Tool          | What it reaches                                                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gh`          | GitHub, signed in as you: it reads runs, logs, pull requests and issues. It writes only where a step says so (a re-run, the issues of an agreed sprint plan).                                                                                                                                                                                                                   |
| `osv-scanner` | Looks your dependencies up in the OSV database by package name and version.                                                                                                                                                                                                                                                                                                     |
| `trivy`       | Downloads its own database and checks, then scans locally.                                                                                                                                                                                                                                                                                                                      |
| `semgrep`     | Fetches the two rule packs it runs from Semgrep's registry. Your code is analysed on your machine, and it is run with `--metrics=off`.                                                                                                                                                                                                                                          |
| `terraform`   | Validation downloads the providers your lock file pins into the module's `.terraform` folder, and reaches no cloud account and no state. It does not fetch modules, whose sources may be private and would be read with your credentials: where they are not installed yet, validation waits. A plan does reach your account, and fetches the modules: only with your go-ahead. |
| `checkov`     | Run with `--skip-download` and no API key, so it fetches nothing from its vendor's platform and uploads nothing.                                                                                                                                                                                                                                                                |
| `infracost`   | Needs your API key, and prices by asking its vendor's pricing service. According to the vendor it is sent what the code declares (resource types, sizes, regions), not credentials or secrets.                                                                                                                                                                                  |

Each tool's own documentation is the authority on what your version does.

## Pipeline troubleshooting and Pipeline Doctor

[Pipeline Doctor](https://github.com/maikadevops-labs/pipeline-doctor) answers the question logs alone cannot: _what changed in the environment since the last run that passed_. It is two GitHub Actions that run **inside your pipeline**, not a command an agent runs on your machine:

- `huella` stores a fingerprint of each job's environment (the runner image, tool versions, dependencies, the hashes of lock files and workflows) in an S3 bucket of yours.
- `diagnostico` runs when a job fails: it compares the failed run's fingerprint with the last green run of the default branch, and publishes a report in the run's summary, in its own job's log and, on a pull request, as a comment.

So the Playbook works in two ways:

- **Your repository has Pipeline Doctor wired.** The agent collects the failed run with `gh`, reads Pipeline Doctor's report, and builds its diagnosis on the comparison table, which is a measurement. The report's own diagnosis and treatment are a proposal the agent checks against that table before repeating it.
- **It does not.** The agent diagnoses from the failed step's log, the last green run and what changed in the code between the two, and its report tells you what Pipeline Doctor would add and what wiring it needs. It never wires it by itself.

### Wiring Pipeline Doctor into a repository

This is yours to decide and to apply. It needs an AWS account.

1. **The cloud side.** A private S3 bucket, GitHub's OIDC provider and one IAM role your repository's workflows can assume. Pipeline Doctor ships the Terraform for it in its `infra/terraform` folder. Read it and apply it yourself: no agent of the office creates anything in a cloud account.
2. **Two repository variables** (Settings → Secrets and variables → Actions → Variables): `PIPELINE_DOCTOR_ROLE_ARN` and `PIPELINE_DOCTOR_BUCKET`, from Terraform's outputs.
3. **The workflow.** The fingerprint at the end of each job, and a job that runs when one fails:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # AWS through OIDC, no access keys
    steps:
      - uses: actions/checkout@v4
      # ... your own steps ...
      - name: Pipeline Doctor, fingerprint
        if: ${{ always() && vars.PIPELINE_DOCTOR_ROLE_ARN != '' }}
        uses: maikadevops-labs/pipeline-doctor/huella@0819c91d51b19e786c8aa4e4d0093f8cda849eda
        with:
          aws-role-arn: ${{ vars.PIPELINE_DOCTOR_ROLE_ARN }}
          bucket: ${{ vars.PIPELINE_DOCTOR_BUCKET }}
          job-status: ${{ job.status }}

  doctor:
    needs: [test]
    if: >-
      ${{ failure() && vars.PIPELINE_DOCTOR_ROLE_ARN != '' &&
      (github.event_name != 'pull_request' ||
      github.event.pull_request.head.repo.full_name == github.repository) }}
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      actions: read
      contents: read
      pull-requests: write
    steps:
      - name: Pipeline Doctor, diagnosis
        uses: maikadevops-labs/pipeline-doctor/diagnostico@0819c91d51b19e786c8aa4e4d0093f8cda849eda
        with:
          aws-role-arn: ${{ vars.PIPELINE_DOCTOR_ROLE_ARN }}
          bucket: ${{ vars.PIPELINE_DOCTOR_BUCKET }}
```

What to know before you do:

- **Both actions are pinned to a commit**, not to the `v0` tag: a tag can be moved to other code, a commit cannot. `0819c91` is the commit `v0` named when the Playbook was written. Before moving the pin, see what the tag names now (`git ls-remote https://github.com/maikadevops-labs/pipeline-doctor refs/tags/v0`) and read what changed.
- **It is a young project** (its first version, one author, MIT licence) that runs in your pipeline with a role in your AWS account. Read its code and its Terraform before you give it either.
- **`bedrock-model-id` is left out**, so Pipeline Doctor runs without a model of its own: the comparison needs none, and the DevSecOps Engineer writes the diagnosis from it on your Claude plan. Setting it sends the failed job's log to Amazon Bedrock in your account, at your cost.
- **What it stores**: the fingerprints, in your bucket. They hold package names and versions, tool versions and file hashes, not your code.
- **What it measures today**: Python packages and the versions of common tools. For another stack (Node, for one) it sees tool versions and the hashes of the lock files, so it can say _that_ `package-lock.json` changed, not which package.
- **It compares with the default branch's last green run**, and its `doctor` job never runs on a pull request from a fork.
- **Its report is written in Spanish.** The agent reads it as it is and reports to you in the language you write in.

## Where they live

A built-in Role is a folder of Markdown files in the repository, [`roles/<role id>/`](../roles): its Playbooks are `playbooks/<playbook id>.md`. The file's name is the Playbook's id (lower-case letters, digits and hyphens).

```markdown
---
name: Pipeline troubleshooting
description: Find why a GitHub Actions run fails. Use when a workflow run or a pull request check is red.
tools: gh, git, Pipeline Doctor
order: 10
---

Diagnose one failed run of a GitHub Actions pipeline.

## 1. Pin down the run

...
```

| Field         | Meaning                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | Required. The Playbook's name in the office and in the team list, up to 60 characters.                                                 |
| `description` | Required. What it is for and when to use it, up to 400 characters. Claude Code reads it to decide when the skill applies, so say when. |
| `tools`       | The tools its steps run, separated by commas (up to 20). The agent checks them before it starts.                                       |
| `order`       | Where it is listed among the Role's Playbooks, lowest first. Absent = after the ones that have one, by id.                             |

Everything after the front matter is the procedure, up to 20,000 characters, as the agent reads it. A Role has at most 12 Playbooks.

A file with a mistake (an unknown field, no name or description, an empty procedure) is left out and the rest still load; the host's log says what was wrong. The folders that ship are held to "no mistake at all" by the test suite.

The Roles you add in [`roles.json`](roles.md#your-own-roles-rolesjson) have no Playbooks: a Playbook is a file in a Role's folder, in a checkout of the repository. A Role you add there with `npm run new-role` starts with a first Playbook to make its own ([Adding a Role](roles.md#adding-a-role)), and `npm run check-roles` says whether every Playbook says when to run it and numbers its steps.
