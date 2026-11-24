---
name: Safe refactor
description: Code restructured in small steps, its behaviour pinned by tests and proven unchanged.
order: 10
---

The request is to restructure code without changing what it does. The run ends with the refactor on a branch of its own, in commits that are one move each, the tests that pin the behaviour added before the first of them, proof that nothing changed, and a report.

A refactor and a change of behaviour never share a commit. A bug found on the way is noted for its own change, not fixed here. No test has what it expects changed to make a step pass.

Ask the user once, early, in your own terminal, for what the request leaves open: what must not change, and how far the refactor may go.

## 1. Bounds (developer)

Run your Safe refactor playbook, steps 1 and 2: what is restructured and why, what must not change, the branch it happens on, and everyone who depends on the code. Closed when the bounds, the branch and the dependents are in your note.

## 2. Target shape (architect)

Review where the refactor is heading before it starts: whether the target structure fits the system's layering and its recorded decisions, what would be simpler, and which boundary or contract must not move. Closed when the target is agreed in your note, or the objection is there with its reason.

## 2. Safety net (qa-engineer)

Say whether the tests would notice a change of behaviour in the code to be restructured: which behaviours are pinned and which are not. Write the missing tests against the code as it is, through its public interface, on the refactor's branch, before any restructuring. Closed when the new tests pass on the untouched code and are committed on their own.

## 3. Refactor (developer)

Playbook, steps 3 and 4: the baseline of the repository's checks, then one move per commit, each leaving the checks green, towards the target the Architect agreed to. Closed when the commits are on the branch and the checks pass on the last one.

## 4. Verification (qa-engineer) {required} {check=tests}

Prove nothing changed: the same tests exist and pass as before, none was removed, skipped or loosened (read the diff of the test files), the public interface is the same, and as many tests ran as in the baseline the Refactor stage took, which already counts the safety net's. Closed when the comparison is in your note.

## 5. Report (developer)

Report to the user in your own terminal (playbook, step 6): what was restructured and why, the commits, the tests added first, the checks before and after with their real output, and what was found and left alone. Nothing is merged: that is the user's call.
