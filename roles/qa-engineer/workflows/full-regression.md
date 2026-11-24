---
name: Full regression
description: Every suite run, each failure classified, the regressions fixed, and a verdict on the release.
order: 10
---

The request is a full regression of a branch or a release candidate. The run ends with every suite run the way the pipeline runs it, each failure classified, the regressions fixed on a branch of its own, and a verdict: whether it meets the bar to release, and the risk that remains.

A failing test is information. Nobody makes a suite green by skipping a test, loosening an assertion, adding a retry or raising a timeout.

Ask the user once, early, in your own terminal, for what the request leaves open: which branch or commit, and which suites may not be run here (the ones that open windows, need an approval or cost money).

The two stages of step 3 write at the same time, and agents launched into one folder share its checkout: two of them changing branches there would undo each other's work. Launch each agent that writes into a new Worktree of its own (launch_agent with `worktree`), from the commit under test.

## 1. Baseline (qa-engineer)

Run your Full regression playbook, steps 1 and 2: every suite the repository has with its command and what it needs, the commit under test, and the last green run of the default branch to compare with. Closed when the list of suites and the baseline are in your note.

## 2. Run (qa-engineer)

Playbook, steps 3 to 5: every suite run to its end, each failure run again alone and classified (regression, already broken, flaky, environment), and what a green run hides (tests skipped, removed or loosened). Closed when every suite has its result or the reason it was not run, and every failure its class and its evidence.

## 3. Fix (developer)

For each regression: the smallest change that removes it, on a branch of its own, with the test that showed it passing for the right reason. A test is changed only when the test was wrong, and the commit says why. Skip it, with a note, when nothing regressed. Closed when the commits are on the branch and the repository's checks pass locally.

## 3. Pipeline and environment (devsecops-engineer) {#pipeline}

For the failures that come from how the suites are run: a service the pipeline does not start, a cache, a version that drifted, a runner too small. As code on a branch of its own, never by turning a check off. Skip it, with a note, when no failure was the environment's. Closed when the cause of each is named, and fixed or put to the user.

## 4. Second run (qa-engineer) {check=tests}

Bring the changes together first: a branch for this run alone, from the commit under test, with each fix's branch merged into it (a conflict goes back to whoever wrote the fix). Run again what failed, then the whole suite once on it: the regressions are gone, nothing new failed, and no test was skipped, removed or loosened to get there (read the diff of the test files). Skip it, with a note, when nothing was changed. Closed when the result of the second run is in your note.

## 5. Report (qa-engineer)

Report to the user in your own terminal (playbook, step 6): the commit tested and the baseline, each suite's result, each failure with its class, what was fixed and where, what is flaky or was already broken, what was not tested, and the verdict with the risk that remains. Nothing is merged or released: that is the user's call.
