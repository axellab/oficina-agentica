---
name: Pipeline hardening
description: Review a GitHub Actions pipeline for mistakes and for ways it could be abused, and fix what it finds on a branch. Use when asked to review, secure or harden the CI workflows, or before a repository starts taking outside contributions.
tools: git, gh, actionlint, zizmor
order: 20
---

Review the workflows under `.github/workflows` and harden them. Steps 1 to 4 only read. Step 5 changes files, on a branch of its own, and nothing is pushed to a shared pipeline before the human agrees.

## 1. Inventory

```bash
git ls-files .github/workflows
grep -rhoE "uses:[[:space:]]*[^[:space:]#]+" .github/workflows | sort | uniq -c
```

For each workflow, write down its triggers, its `permissions`, its jobs, the secrets it reads and every action it uses with the ref it is pinned to.

## 2. Lint

```bash
actionlint
```

Run at the repository's root, it checks every workflow: syntax, expressions, the inputs of actions, and the shell scripts in `run:` steps when `shellcheck` is installed. Every error is a finding.

## 3. Audit

```bash
zizmor .
```

It reports what an attacker would look for: actions pinned by tag, permissions wider than needed, text from an event interpolated into a script, dangerous triggers, credentials left on disk. Keep its output: each finding names the file and the line.

## 4. What no tool decides

Read each workflow against this list, whatever the tools said:

- **Permissions.** A `permissions:` block at the top that grants only `contents: read`, and a write scope only on the job that needs it.
- **Pins.** An action that is not GitHub's own or the repository's is pinned to a full commit, with its tag in a comment. The commit a tag names:

  ```bash
  gh api "repos/<owner>/<action-repo>/commits/<tag>" --jq .sha
  ```

- **Untrusted code with secrets.** A workflow on `pull_request_target` or `workflow_run` never checks out and runs the pull request's code.
- **Injection.** Nothing a contributor writes (a title, a branch name, a comment) is interpolated into a `run:` script with `${{ }}`. It goes through `env:` and is read as a variable.
- **Secrets.** Each one reaches only the step that needs it, is never echoed, and `actions/checkout` runs with `persist-credentials: false` in a job that does not push.
- **Honest installs.** Dependencies come from the lock file (`npm ci`, not `npm install`), and caches are keyed on it.
- **Limits.** Every job has `timeout-minutes`, and a deploy has a `concurrency` group.
- **What blocks a merge.** Which checks are required on the default branch. Reading it needs admin rights; when the call is refused, say so and ask the human:

  ```bash
  gh api "repos/{owner}/{repo}/branches/<default-branch>/protection" --jq '.required_status_checks.contexts'
  ```

## 5. Changes

On a branch of its own, one finding per commit, with what it fixes in the message. After the changes, run steps 2 and 3 again: they must come back clean, or each remaining finding must have its reason written down.

Removing a noisy check is a change like any other: say which one and why. Do not turn a control off to make the pipeline pass.

A pipeline is shared by everyone who pushes: show the human the diff and get their agreement before the branch is pushed. Then open a pull request and link the green run on it.

## 6. Report

- What was reviewed: the workflows, and the versions of the tools.
- The findings, ranked: where each is, what an attacker or a mistake could do with it, and what fixes it.
- What was changed and where (branch, pull request, the green run), and what was left for the human to decide.
- What you could not check, and why.
