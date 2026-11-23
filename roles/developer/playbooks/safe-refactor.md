---
name: Safe refactor
description: Change the structure of code without changing what it does, in small steps that each keep the checks green, with tests pinning the behaviour before the first edit. Use when asked to refactor, rename, extract, move or simplify code, or to pay down a piece of technical debt.
tools: git
order: 10
---

Restructure code while its behaviour stays the same. It changes files, on a branch of its own; steps 1 and 2 only read. A refactor and a change of behaviour never share a commit.

## 1. Bounds

Write down, before touching anything: what is being restructured, why (what will be easier afterwards), and what must not change: the public interface, the output, the errors, the performance someone depends on. If a behaviour has to change, that is another task: say so and stop.

```bash
git status --short
git switch -c <refactor-branch>
```

Start from a clean tree: someone else's uncommitted work is not yours to carry along.

## 2. Who depends on it

Every caller, every import, every place the name appears, the ones a compiler does not see included (configuration, documentation, strings, other languages, generated code):

```bash
git grep -n '<name>' -- . ':!*.lock'
git log --oneline -15 -- <path>
```

The history says who changes it and how often. A file someone else is changing right now is a merge conflict you are about to cause: ask before you start.

## 3. A safety net, before the first edit

Run the repository's own checks (type check, lint, tests, build) and keep the output: this is the baseline. They must be green before you begin. A check that already fails is reported, not fixed in passing.

Then find out whether the tests would notice if you broke it. Break the code on purpose in one place (return early, flip a condition), run its tests, and undo it:

```bash
git diff --stat
git restore <path>
```

No test failed: the behaviour is not pinned. Write the tests that pin it first, against the code as it is, through its public interface, and commit them on their own before any restructuring. They describe what the code does today, what looks wrong included: a bug found here is noted for its own change, not fixed inside the refactor.

## 4. Small steps

One kind of move per commit: a rename, an extraction, a move, an inlining, a signature change with its callers. After each one, run the checks that cover it; the full set every few steps and at the end.

```bash
git add <the files of this move>
git commit -m "refactor: <one move, in the repository's own commit style>"
```

- Let the tools do the mechanical part where the project has them (the language server's rename, a codemod it already uses).
- A step that turns the checks red is undone, not patched: go back to the last green commit and take a smaller step.
- No test changes in a restructuring commit, other than the mechanical edit a rename forces. A test that has to change what it expects is telling you the behaviour changed.
- Nothing rides along: no formatting of files you did not touch, no dependency, no second refactor you noticed on the way. Note them for their own change.

## 5. Prove nothing changed

```bash
git diff --stat <base>...HEAD
git diff <base>...HEAD -- <test paths>
```

- The same tests exist and pass as before, plus the ones step 3 added. None was removed, skipped or loosened.
- The public interface is the same: exports, routes, command lines, file formats, messages.
- The repository's own checks pass on the last commit: compare with the baseline of step 3, down to the number of tests that ran.
- What depended on it at run time and no check covers (a script, a configuration, a document) was read again.

## 6. Hand over

- What was restructured and why, and what is easier now.
- The commits, one move each, and the tests that were added first.
- The checks and their real output, before and after.
- What you found and left alone: bugs, further refactors, code nothing calls.

To the QA Engineer: what was restructured, and which behaviours to look at hardest. A boundary or a contract that had to move is the Architect's to decide: stop and ask.
