---
name: Flaky test hunt
description: The tests that fail for no reason found, reproduced, and fixed at their cause.
order: 20
---

The request is a suite that cannot be trusted: tests that pass and fail while the code stays the same. The run ends with each flaky test reproduced, its cause named, the fix at the cause on a branch of its own, repeated runs that prove it, and a report.

A retry, a longer timeout or a skip hides a flaky test; it does not fix one. Nobody adds them. Taking a test out of the suite is the user's decision.

Re-running jobs on the pipeline spends the user's minutes: ask the user once, in your own terminal, before the first one.

The fixes of step 3 are written at the same time, and agents launched into one folder share its checkout: two of them changing branches there would undo each other's work. Launch every agent that writes a fix into a new Worktree of its own (launch_agent with `worktree`), each from the commit the hunt started on. Only one writer, you at most, works in the folder you run in.

## 1. Suspects (qa-engineer)

Run your Flaky test hunt playbook, step 1: the runs that needed a second attempt, the failures on the default branch that no change explains, and the retries and skips the code already has. Closed when each suspect is in your note with how often it failed and where.

## 2. Reproduction (qa-engineer)

Playbook, steps 2 to 4: each suspect run alone many times, then under the pipeline's conditions (order, parallelism, load, time zone), until it fails on demand; its cause named; and whose fix it is. Closed when each suspect has its cause with the evidence, or is named as not reproduced with what was tried.

## 3. Test fix (qa-engineer)

For a cause in the test (a wait that guesses, shared state, the clock, an unordered comparison): the fix at the cause (playbook, step 5), on a branch of its own, one test per commit. Skip it, with a note, when no cause was in a test. Closed when the commits are on the branch.

## 3. Product fix (developer)

For a cause in the product (a race, a leak, an error swallowed): it is a defect. The smallest change that removes it, on a branch of its own, with a test that forces the failure every time without it. Skip it, with a note, when no cause was in the product. Closed when the commits are on the branch and the repository's checks pass.

## 3. Pipeline fix (devsecops-engineer)

For a cause in how the suite runs (too few resources, a service not ready, a cache, tests sharing a machine): the change to the pipeline, as code on a branch of its own. Never a retry of everything. Skip it, with a note, when no cause was in the pipeline. Closed when the commits are on the branch.

## 4. Proof (qa-engineer)

Bring the fixes together first: a branch for the proof alone, from the commit the hunt started on, with each fix's branch merged into it (a conflict goes back to whoever wrote the fix). The fixes stay on their own branches; this one is not the result. On it, each fixed test repeated under the condition that made it fail, for at least three times as many runs as it took to see it fail, with no failure; then the whole suite once. Closed when the number of runs and their result are in your note for each test.

## 5. Report (qa-engineer)

Report to the user in your own terminal: each flaky test with how often it failed, its cause and the evidence, what was fixed and where (branch, pull request), the runs that prove it, what was not reproduced, and what is still open. A test that only passed on a re-run is not fixed. Nothing is merged: that is the user's call.
