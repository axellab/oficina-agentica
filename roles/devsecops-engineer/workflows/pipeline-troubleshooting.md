---
name: Pipeline troubleshooting
description: Why a pipeline that passed now fails, and a fix proven by a green run.
order: 10
---

The request is a pipeline run that fails. The run ends with the cause found, the smallest change that removes it on a branch of its own, a green run that proves it, and a report.

The cause comes from evidence: the failing step, the last green run, and what changed between them. Nobody makes the pipeline green by skipping a test, adding `continue-on-error`, widening a permission or turning a check off.

Ask the user once, early, in your own terminal, for what the request leaves open: which run, when it names none and several failed.

When both stages of step 3 have work, they write at the same time, and agents launched into one folder share its checkout: launch the Developer into a new Worktree (launch_agent with `worktree`), from the commit that failed, and bring both changes onto one branch before the Verification.

## 1. Evidence (devsecops-engineer)

Run your Pipeline troubleshooting playbook, steps 1 to 4: the failed run with its failing job and step, the first error, the last green run of the same workflow, what changed in the code between the two, and Pipeline Doctor's report where the repository has it wired. Closed when all of that is in your note, with the run's link.

## 2. Diagnosis (devsecops-engineer)

Name the cause (playbook, step 5): a code change, environment drift, a flaky test, the runner or an outside service, credentials or permissions, or the pipeline's own definition, with the evidence for it and what was ruled out. A re-run of the failed jobs to check a flake (playbook, step 6) spends the user's pipeline minutes: it is yours to decide here, once, when the diagnosis needs it. Closed when one cause explains the failure, or when your note says plainly what evidence is missing and you asked the user for it.

## 3. Fix (developer)

For a cause in the product's code, its tests or its dependencies: the smallest change that removes it, on a branch of its own, with the checks the repository runs passing locally. Skip it, with a note, when the cause is in the pipeline itself. Closed when the commits are on the branch.

## 3. Pipeline change (devsecops-engineer)

For a cause in the pipeline: a pinned version, a workflow file, an action that moved, a cache, a timeout. As code on a branch of its own, never on the default branch. A missing secret or permission is not yours to grant: say which identity lacks what, and ask the user. Skip it, with a note, when the cause is not in the pipeline. Closed when the commits are on the branch.

## 4. Verification (qa-engineer)

Prove it on the branch: the pipeline runs green, the step that failed now passes for the right reason, and nothing was skipped, silenced or removed to get there (read the diff of the workflow files and of the tests). A flaky test that only passed on a re-run is not fixed: report it as open. Closed when the green run is linked in the note.

## 5. Report (devsecops-engineer)

Report to the user in your own terminal: the run that failed and its first error, the cause and the evidence for it, what was ruled out, the fix and where it is (branch, pull request, the green run), and what is left open. When the repository has no Pipeline Doctor, add what it would have told you and what wiring it needs (playbook, step 8). Nothing is merged: that is the user's call.
