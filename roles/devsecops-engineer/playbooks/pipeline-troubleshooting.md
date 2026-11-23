---
name: Pipeline troubleshooting
description: Find why a GitHub Actions run fails, above all one that used to pass, from the run's own evidence and from Pipeline Doctor's report where the repository has it. Use when a workflow run or a pull request check is red.
tools: gh, git, Pipeline Doctor
order: 10
---

Diagnose one failed run of a GitHub Actions pipeline. Steps 1 to 5 only read and compare. Step 6 spends pipeline minutes and step 7 proposes a change: each says what it needs first.

## 1. Pin down the run

You are given a run's link, a run number or a pull request. With none of them, take the newest failure:

```bash
gh run list --status failure --limit 10 --json databaseId,workflowName,headBranch,headSha,event,createdAt,url
```

Then the run itself: its jobs, and in each failed job the first step whose conclusion is `failure`.

```bash
gh run view <run-id> --json databaseId,workflowName,headBranch,headSha,event,attempt,conclusion,url,jobs
```

Write down the workflow, the branch, the commit, the event and the failing job and step.

## 2. Read the failure, not the whole log

```bash
gh run view <run-id> --log-failed
```

Look for the first error, not the last one: what follows it is usually its consequence. Keep the lines that matter, with a few before them. If the log shows what looks like a credential, do not copy it: note the step that printed it and tell the Security Engineer.

## 3. Find the last green run

The same workflow, on the default branch:

```bash
gh repo view --json defaultBranchRef --jq .defaultBranchRef.name
gh run list --workflow "<workflow file or name>" --branch <default-branch> --status success --limit 1 --json databaseId,headSha,createdAt,url
```

And what changed in the code between the two commits:

```bash
gh api "repos/{owner}/{repo}/compare/<green-sha>...<failed-sha>" --jq '.files[].filename'
```

Tell three cases apart:

- **Same commit, different result.** The code did not change. The cause is the environment (a dependency, the runner image, a tool, a service outside) or a flaky test.
- **Different commits, and the failing step exercises a changed file.** The change is the first suspect.
- **Different commits, and the failing step has nothing to do with them.** Look at the environment first, and say that the code changed too.

## 4. Read Pipeline Doctor's report, where the repository has it

Pipeline Doctor (`github.com/maikadevops-labs/pipeline-doctor`) runs inside the pipeline. One action stores a fingerprint of the environment of every run; another, when a job fails, compares that fingerprint with the last green run's. Is it wired here?

```bash
grep -rn "pipeline-doctor" .github/workflows
```

**It is wired.** Its report is in the failed run. The workflow file names the job that uses its `diagnostico` action (often `doctor`); find that job's id in the output of step 1 and read its log:

```bash
gh run view <run-id> --job <doctor-job-id> --log
```

The report is the block titled `Informe de Pipeline Doctor`, written in Spanish. On a pull request it is also a comment:

```bash
gh pr view <number> --json comments --jq '.comments[].body | select(contains("<!-- pipeline-doctor -->"))'
```

Read it section by section:

- **Qué cambió en el entorno** is a table computed by comparing the two fingerprints: dependencies, tool versions, the runner image, and the hashes of lock files and workflows. It is a fact, not an opinion.
- **Descartado** is what the comparison ruled out. Stop looking there.
- **Diagnóstico** and **Tratamiento** are a proposal. Where the last line of the report says a model wrote the text (`Texto redactado con IA`), check it against the table before you repeat it.
- **No comparison.** The report says so in its Historial section: the job stored no fingerprint (the `huella` step is missing or lacks `if: always()`), or the default branch has no green run stored yet. With no report at all, the `doctor` job did not run: it runs only when a job fails, and never on a pull request from a fork. Say which it is and go on from the logs.

Do not read more into it than it measures: it fingerprints Python packages and the versions of common tools. For another stack it sees tool versions and file hashes only. It compares with the last green run of the default branch, not of your branch.

**It is not wired.** Diagnose from steps 2 and 3, and put the proposal of step 8 in your report.

## 5. Name the cause

One of these, with the evidence for it and what you ruled out:

| Cause                      | What shows it                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Code change                | The failing step exercises a file changed since the last green run, and the error names it.                                            |
| Environment drift          | The same commit passed before, or Pipeline Doctor's table shows a dependency, a tool or an image that changed, and the error names it. |
| Flaky test                 | The same commit both passed and failed, or the failing test differs between attempts.                                                  |
| Runner or outside service  | Network, registry, rate limit, disk or timeout errors that are not in the project's own code.                                          |
| Credentials or permissions | A 401 or 403, `Resource not accessible by integration`, a secret that is empty, a token that expired.                                  |
| Pipeline definition        | The workflow file changed, or an action it uses by tag moved to a new commit.                                                          |

A guess is not a diagnosis. When the evidence does not settle it, say so, and say which run or log would.

## 6. Check a flake before you call it one

Only when step 5 points to a flaky test or to the runner, and only once the lead of the workflow or the human agrees, because it spends pipeline minutes:

```bash
gh run rerun <run-id> --failed
```

A re-run that passes proves the failure is not deterministic. It fixes nothing: the flaky test goes to the QA Engineer with both runs linked.

## 7. Treatment

Propose the smallest change that removes the cause, and name who makes it:

- **Code change:** the Developer, with the failing step and the error.
- **Environment drift:** pin the version that was green (the exact one, from the table or from the lock file) on a branch, and open the follow-up to adapt to the new one. The pin is yours when it lives in the pipeline or in a lock file; a change to the product's code is the Developer's.
- **Pipeline definition:** yours, as code on a branch of its own, never on the default branch.
- **Credentials or permissions:** say which identity lacks what. Do not widen a permission to make the run pass, and do not print a secret to check it.

Never make the run green by skipping the failing test, adding `continue-on-error` or removing the step.

## 8. When Pipeline Doctor is not wired: propose it

Do not install it yourself. Put this in the report, for the human to decide:

- **What it adds:** the table of what changed since the last green run, which the logs alone cannot give.
- **What it needs:** an AWS account with a private S3 bucket, GitHub's OIDC provider and one IAM role (its repository ships the Terraform, in `infra/terraform`), three repository variables, and two additions to the workflow: its `huella` step at the end of each job, with `if: always()`, and a `doctor` job that runs when one fails.
- **Pin both actions to a commit**, not to the `v0` tag, which can move: `maikadevops-labs/pipeline-doctor/huella@0819c91d51b19e786c8aa4e4d0093f8cda849eda` and `maikadevops-labs/pipeline-doctor/diagnostico@0819c91d51b19e786c8aa4e4d0093f8cda849eda`. That is the commit `v0` named when this playbook was written. Check what it names now with `git ls-remote https://github.com/maikadevops-labs/pipeline-doctor refs/tags/v0`, and read what changed before you move the pin.
- **Leave `bedrock-model-id` empty.** The comparison needs no model, and you write the diagnosis from it.
- **The cloud resources** are the Cloud Engineer's to plan and the human's to apply.

## 9. Report

- The run, the failing job and step, and the first error, quoted.
- The last green run and what changed since: the code, and the environment when Pipeline Doctor reported.
- The cause, the evidence for it and what was ruled out.
- The treatment, who makes it, and what the next run must show to prove it.
- What you could not verify.
