---
name: Technical design
description: Turn a goal into a technical design, with the options weighed, the decision recorded as an ADR where the repository keeps them, and a plan in steps that each leave the system working. Use when asked to design a feature or a change, to choose between approaches, or to write a decision record.
tools: git
order: 20
---

Design one change. Steps 1 to 4 only read and think. Step 5 writes documents (a decision record, a plan), on a branch of its own, and no product code beyond a sketch that proves the design.

## 1. The goal and its constraints

Write down the goal in one sentence, who it is for, and how anyone will know it is met. Then the constraints: the deadline, the budget, what must not change, what it must comply with, the load it must carry. A constraint nobody stated is asked for, not assumed: scope, deadlines, budget and accepted risks are the human's.

## 2. The system as it is

Read the code the design touches, and who calls it, before drawing anything:

```bash
git ls-files | grep -iE '(^|/)(adr|adrs|decisions|design)/'
git grep -n '<the central name>' -- . ':!*.lock'
git log --oneline -20 -- <the paths the design touches>
```

Write down what is there: the components involved, their contracts, the data that flows between them, the decisions already recorded that bind this one, and what the code does that no document says. A design that ignores how the system already works is a rewrite in disguise.

## 3. The options

At least two real ones, and always the smallest that could meet the goal (changing nothing included, when that is honest). For each:

- What changes: components, contracts, data, and what has to be migrated.
- What it costs in complexity, security, operations, performance and money.
- What it makes easy later, and what it makes hard.
- What could go wrong, and how anyone would notice.
- How it could be undone.

When an option rests on something you have not checked (the library does this, the service allows that), check it: read the code or the documentation, or write the smallest sketch that proves it, outside the product's code. An assumption left unchecked is written down as one.

## 4. The decision

Recommend one option and say what tips it: which quality you chose (security, reliability, operability, testability, cost) and which you traded away. Name the requirement that would change the answer.

What only the human can decide is put to them as a choice, with your recommendation, before the plan is written around it.

## 5. Write it down

A decision that would be expensive to reverse gets a record. Where the repository keeps them, follow its numbering and its template:

```bash
git ls-files | grep -iE '(^|/)(adr|adrs|decisions)/' | sort | tail -5
```

Where it has no template, use this one: **Title** (the decision, as a statement), **Status** (proposed, until the human accepts it), **Context** (the forces at play, with the facts of step 2), **Decision**, **Alternatives** (each with why it lost), **Consequences** (what gets easier, what gets harder, what must now be true). Where the repository keeps no records at all, propose where they would go; do not start a folder unasked.

Then the plan:

- The components that change and their contracts, before and after.
- The data: its shape, where it lives, how what exists is migrated, and how the migration is undone.
- The steps to build it in, each small enough to review and each leaving the system working, in order, with the role that takes it and what that role needs to start.
- How it is tested, at which level, and what counts as done.
- The risks, and what watches for each.

On a branch of its own, documents only.

## 6. Hand over

- To the Developer: the plan and its first step.
- To the QA Engineer: the test strategy the design implies, and the acceptance criteria.
- To the Security Engineer: every new entry point and every trust boundary that moves.
- To the Cloud Engineer: what must run where. To the DevSecOps Engineer: what the pipeline must build and check.
- To the human: what was decided, what was traded away, and what is theirs to decide.
