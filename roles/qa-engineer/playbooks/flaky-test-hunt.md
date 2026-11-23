---
name: Flaky test hunt
description: Find the tests that pass and fail without the code changing, reproduce each one, name its cause and fix it at the cause. Use when a check went green on a re-run, when a test fails only sometimes, or when asked to stabilize the suite.
tools: git, gh
order: 20
---

Hunt flaky tests: the ones whose result changes while the code does not. Steps 1 to 4 only read and run tests. Step 5 changes test code, on a branch of its own. Repeating tests loads the machine: say what you are about to run. Write logs outside the repository (the system's temporary folder).

## 1. Suspects, from the pipeline's own history

A run that needed more than one attempt to go green is the best lead there is:

```bash
gh run list --limit 200 --json databaseId,attempt,conclusion,workflowName,headBranch,headSha,createdAt,url --jq '.[] | select(.attempt > 1)'
```

For each, the attempt that failed and what failed in it:

```bash
gh run view <run-id> --attempt 1 --log-failed
```

Then the failures on the default branch, where no change explains them:

```bash
gh run list --branch <default-branch> --status failure --limit 30 --json databaseId,workflowName,headSha,createdAt,url
```

And what the code already admits to:

```bash
git grep -nE '(retries|retry|flaky|\.skip\(|\.fixme\(|@flaky|@Retry|rerunFailingTestsCount)' -- . ':!*.lock' | head -100
```

Write the suspects down: the test's name and file, how often it failed out of how many runs, on which system and in which job.

## 2. Reproduce

One suspect at a time. Run it alone, many times, with the runner's own way of repeating where it has one (Playwright's `--repeat-each`, Go's `-count`, a repeat plugin the project already has), or with a loop:

```bash
for i in $(seq 1 30); do <the command that runs that one test> > <temporary folder>/flaky-$i.log 2>&1 || echo "run $i failed"; done
```

When it passes every time alone, change one condition at a time, towards what the pipeline has:

- **Order.** With the tests that run before it in the pipeline, then in a shuffled order where the runner can shuffle.
- **Parallelism.** With the number of workers the pipeline uses, then with one.
- **A slower machine.** While the machine is busy with another run.
- **Time and place.** Another time zone and locale (`TZ=Pacific/Auckland`, `LANG=tr_TR.UTF-8`), a date near midnight or the end of a month.
- **The system.** When it fails on one system only, say so. A run there is the pipeline's, and re-running jobs spends the human's minutes: ask first.

Keep the log of a failing run: it is the evidence. A test you could not make fail in any way is reported as not reproduced, with what you tried.

## 3. Name the cause

Read the failing log beside a passing one, and the test beside the code under test. It is almost always one of these:

- **A wait that guesses.** A fixed sleep, a timeout too tight for a slow machine, an assertion made before the thing it waits for happened.
- **Shared state.** Tests that depend on their order: a global, a file, a database row, a port, a cache left by another test.
- **Time.** The real clock, a time zone, a date that rolls over.
- **Randomness.** Random data, or an unordered collection compared as if it were ordered.
- **Concurrency in the product.** A real race the test only sometimes loses. This one is a defect, not a flaky test.
- **Something outside.** A network call, a service, a download.
- **Resources.** A leak that fails the tenth test, not the first.

The cause is named when you can make the test fail on purpose, every time, by forcing it: a delay injected, the order fixed, the clock set.

## 4. Whose fix it is

- In the test (a wait, shared state, an unordered comparison): yours, step 5.
- In the product (a race, a leak, an error swallowed): a defect for the Developer, with the way to force it.
- In the pipeline (too few resources, a service it does not wait for, a cache): the DevSecOps Engineer's.

## 5. Fix at the cause

On a branch of its own, one test per commit: wait for the condition instead of a duration, give each test its own state and clean it up, control the clock and the random seed, replace the outside call with a stand-in.

A retry, a longer timeout or a skip hides a flaky test; it does not fix one. Do not add them. Taking a test out of the suite for a while is the human's decision: put it to them with what the test protects.

Then prove it: the loop of step 2, under the condition that made it fail, for at least three times as many runs as it took to see it fail, with no failure.

## 6. Report

- Each suspect: how often it failed and where, whether you reproduced it and how, its cause with the evidence.
- What was fixed, on which branch, and the runs that prove it.
- What went to the Developer or the DevSecOps Engineer.
- What was not reproduced, and what is still open. A test that only passed on a re-run is not fixed.
