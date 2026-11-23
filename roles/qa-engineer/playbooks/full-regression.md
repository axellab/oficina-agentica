---
name: Full regression
description: Run every test suite the repository has, the way its pipeline runs them, compare with the last green run of the default branch, and say which failures are regressions, which are flaky and which were already there. Use when asked for a full regression, before a release, or after a large merge or upgrade.
tools: git, gh
order: 10
---

Run the whole test suite of one branch and say what the result means. It builds and runs tests, and changes no file the repository tracks. A full run can take long and load the machine: say how long you expect it to take before you start. Write logs and reports outside the repository (the system's temporary folder).

## 1. What the suite is

Find how this repository tests itself, from the repository, not from habit:

```bash
git ls-files | grep -E '(^|/)(package\.json|Makefile|justfile|Taskfile\.ya?ml|pyproject\.toml|tox\.ini|noxfile\.py|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?)$'
git ls-files .github/workflows
```

The pipeline's workflow files say which commands count: every suite it runs (unit, integration, end to end), in which order, with which environment. Read the contributing guide and the agent instructions for the suites that need a service, a browser or someone's approval to run. Write the list down: suite, command, what it needs.

## 2. The baseline

What you are testing, and what you compare it with:

```bash
git status --short
git rev-parse --short HEAD
gh repo view --json defaultBranchRef --jq .defaultBranchRef.name
gh run list --workflow <workflow file> --branch <default-branch> --status success --limit 1 --json databaseId,headSha,workflowName,createdAt,url
```

The baseline is the last green run of the workflow that runs the suites (step 1 named it), not of any workflow: a run that only published a page or updated a badge is green and has no test to compare with. Where several workflows run suites, take one baseline for each.

Uncommitted changes are part of what you test: say so, or stop and ask. From the last green run, note how many tests each suite ran: a suite that now runs fewer is a finding even when it is green.

```bash
gh run view <run-id> --log | grep -iE '[0-9]+ (tests?|passed|failed|skipped)' | tail -40
```

## 3. Run it all

Install from the lock file, as the pipeline does (`npm ci`, not `npm install`), then run each suite with its own command, one at a time, keeping the whole output:

```bash
<the suite's command> 2>&1 | tee <temporary folder>/<suite>.log
```

Let every suite finish even when an earlier one failed: a regression run that stops at the first failure reports one failure. Do not change a test, a timeout or a configuration to get further. A suite you could not run (a missing service, a browser, an approval you do not have) is reported as not run, with what it needs.

## 4. Read the failures

For each failed test, in this order:

- **Run it again alone**, with the runner's own way of picking one test. Failing every time, it is deterministic. Passing sometimes, it is flaky: say so, and leave the hunt to the Flaky test hunt playbook.
- **Does it fail on the default branch too?** Read the last green run's log, or run that one test on a checkout of the default branch, outside the repository:

  ```bash
  git worktree add --detach <temporary folder>/baseline origin/<default-branch>
  ```

  Remove the checkout when you are done (`git worktree remove <temporary folder>/baseline`). Failing there too, it was already broken: report it apart.

- **What changed?** For a regression, the commits between the baseline and the branch that touch the code under test:

  ```bash
  git log --oneline <baseline-commit>..HEAD -- <path under test>
  ```

- **Is it the environment?** A missing tool, a port in use, a time zone, a permission of this machine. Say what differs from the pipeline's environment.

## 5. What a green run does not say

- **Skipped and disabled tests.** Count them, and list the ones skipped on this branch that ran on the baseline:

  ```bash
  git diff <baseline-commit>..HEAD | grep -E '^\+.*(\.skip\(|\.only\(|\.fixme\(|xit\(|xdescribe\(|@pytest\.mark\.skip|@Disabled|@Ignore|t\.Skip\()'
  ```

- **Tests removed or loosened.** Read the diff of the test files: an assertion deleted, an expected value changed to match the new output, a retry added.
- **Coverage**, where the repository measures it: the number, and the changed code no test reaches.
- **Duration.** A suite that takes much longer than on the baseline.

## 6. Verdict

- The commit tested, the baseline, and each suite: ran or not, passed, failed, skipped, how long.
- Each failure with its class (regression, already broken, flaky, environment), the output that matters, and for a regression the commits that most likely caused it.
- What a green run hid: tests skipped, removed or loosened.
- The verdict: whether this branch meets the bar to release, what was not tested, and the risk that remains.

A regression goes to the Developer with the command that reproduces it. Never call a suite green that you did not see pass.
