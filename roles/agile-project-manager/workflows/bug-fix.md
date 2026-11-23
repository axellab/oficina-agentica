---
name: Bug fix
description: Reproduce a bug, find its cause, fix it and prove it stays fixed.
order: 20
---

The request is something that works wrongly. The run ends with the cause found, the smallest fix for it on a branch of its own with a test that fails without it, and a report.

Fix the cause, not the symptom, and nothing else: an improvement noticed on the way goes in the report, not in the change.

## 1. Reproduce (qa-engineer)

Reproduce the bug: the shortest steps that show it, what was expected and what happens, the version and environment, and a failing automated test where one can be written. Closed when anyone can see the bug by following the steps. If it cannot be reproduced, say what was tried and ask the user for what is missing.

## 2. Diagnosis (developer)

Find the root cause, with evidence: the line, the condition, the commit that brought it in. A guess is not a diagnosis. Closed when the cause explains every symptom of the reproduction.

## 3. Fix (developer)

Make the smallest change that removes the cause, on a branch of its own, with a regression test that fails before it and passes after. Closed when the checks the repository runs pass and the commits are on the branch.

## 4. Verification (qa-engineer)

Follow the reproduction again on the fixed branch, run the regression test and the suites around the change, and look for what the fix could have broken nearby. A failure goes back to the Developer (start the fix stage again). Closed when the reproduction no longer shows the bug on the branch's last commit.

## 4. Security check (security-engineer)

Say whether the bug could be used against the system (and since when), and whether the fix opens anything. Skip it, with a note saying why, when the bug is nowhere near a trust boundary. Closed when the answer is written, with the evidence.

## 5. Report (agile-project-manager)

Report to the user in your own terminal: the bug, its cause, the fix and where it is (branch, pull request), how it was verified, whether it had a security side, and anything else the team noticed and did not touch.
