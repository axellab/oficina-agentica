---
name: Architecture review
description: Review how a system is really structured against how it is meant to be, from its documents, its dependency graph and its history, with layering, coupling and the parts that are hardest to change. Use when asked for an architecture review, before a large change, or when changes keep touching too many places.
tools: git, dependency-cruiser
order: 10
---

Review the structure of one system. It reads, measures and reports, and changes nothing. Write any file a tool produces outside the repository (the system's temporary folder).

dependency-cruiser is run as the project has it installed, never downloaded: `npx --no-install depcruise --version` says whether it has. It reads JavaScript and TypeScript. For another language, or without it, read the imports with `git grep` as step 3 shows.

## 1. The intended structure

Read what the repository says about itself before you read the code: the README, the architecture and design documents, the decision records, the agent instructions, the glossary.

```bash
git ls-files | grep -iE '(^|/)(README|ARCHITECTURE|CONTEXT|CLAUDE|AGENTS|CONTRIBUTING)[^/]*\.md$|(^|/)(adr|adrs|decisions|design)/'
```

Write the intended structure down in a few lines: the parts, what each is for, which may depend on which, and the rules stated as rules. Where nothing is written, that is the first finding, and the intended structure is what the folder names promise.

## 2. The real structure

The parts as they are: the top-level folders and packages, their size, and what each exposes.

```bash
git ls-files | cut -d/ -f1-2 | sort | uniq -c | sort -rn | head -40
```

Then the entry points (what starts the system, what the outside calls), and the data stores and outside services each part reaches.

## 3. Dependencies that point the wrong way

Where the project has dependency-cruiser set up (a `.dependency-cruiser.js`, `.cjs` or `.json` at its root), its rules are the intended structure in a form that can be run:

```bash
npx --no-install depcruise --output-type err-long <source folders>
```

Each violation is a finding. Without a configuration it has no rules to hold, but it still measures how much depends on each folder and how much each depends on:

```bash
npx --no-install depcruise --no-config --output-type metrics <source folders>
```

A rule of step 1 that the tool does not hold is checked by reading the imports. For "this part depends on nothing in that one":

```bash
git grep -nE "(from|require\(|import) ['\"][^'\"]*<that part>/" -- <this part>
```

(Write the pattern for this language's imports.) A dependency that crosses a boundary through a side door counts too: a shared global, a file both sides read, a type imported only to be cast.

## 4. Where change is expensive

The history says where the structure hurts. The files changed most often:

```bash
git log --since="12 months ago" --name-only --format= | sort | uniq -c | sort -rn | head -30
```

Cross them with their size: a large file that changes all the time is where the next defect will be. Then what changes together. For a file from that list, the files that share its commits:

```bash
git log --since="12 months ago" --format=%h -- <file> | while read c; do git show --name-only --format= "$c"; done | sort | uniq -c | sort -rn | head -15
```

Files in different parts that always change together are one part split in two, or a contract nobody wrote down.

## 5. What no tool decides

Read the code of the parts that came up, against this list:

- **Boundaries.** Each part can be explained without the others, and its interface is smaller than its inside.
- **Contracts.** What crosses a boundary (a message, a file format, an API) is defined in one place, versioned where it is stored or sent, and validated where it comes in.
- **State.** One owner per piece of state; nobody else writes it.
- **Failure.** What happens when a part is slow, absent or wrong: timeouts, retries that are safe to repeat, a failure that leaves neither the system open nor the data half-written.
- **Names.** The code speaks the domain's language, one word per thing.
- **Testability.** A part can be tested without starting the whole system.
- **Decisions the code outgrew.** A record that no longer matches the code, or a constraint whose reason is gone.

## 6. Report

A finding says where it is (the files, the dependency, the pattern in the history), what is wrong, the evidence (the command and the lines that matter), what it costs (which changes it makes slow or risky), and what would fix it, with its size.

- The intended structure and the real one, side by side, in a few lines.
- The findings, ranked by what they cost against what fixing them costs.
- For a fix that is expensive to reverse: the decision to record, with its alternatives.
- What fits and should be kept. A review that lists only faults invites a rewrite.
- What was not reviewed.

Nothing is changed here: the fixes are steps for the Developer, sliced so that each leaves the system working.
