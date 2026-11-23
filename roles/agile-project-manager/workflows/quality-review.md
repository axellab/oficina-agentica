---
name: Deep quality analysis
description: How healthy the code, its tests and its pipeline are, with a ranked plan.
order: 40
---

The request is a deep look at the quality of the system: how well it is tested, how easy it is to change, and how reliably it is built. The run ends with a report: the findings, ranked by the risk they carry and what fixing them costs.

This is an analysis: nobody changes product code, configuration or infrastructure. What it delivers is the report; fixing what it finds is a new request the user decides on.

A finding says where it is (file and line, resource, pipeline step), what is wrong, the evidence (the code, the command and its output), what it costs or risks, and what would fix it.

Measure before judging: run the suites, the linters and the coverage the repository already has, and report the numbers with the commands that produced them.

## 1. Scope (qa-engineer)

Set the scope from the request: which parts of the system, which qualities matter most here (correctness, maintainability, performance, operability), and what "good" would look like. Run what the repository already runs (tests, coverage, lint, type checks) and record the starting numbers. Closed when the next stages know where to look and against what.

## 2. Tests (qa-engineer)

Assess the tests: what the suites cover and what they do not (by behaviour, not only by lines), tests that pass without checking anything, flaky and slow ones, and the risky paths with no test at all. Closed when each finding has its evidence.

## 2. Code health (developer)

Assess the code: the hardest parts to change and why (size, complexity, duplication), dead code, errors swallowed or handled inconsistently, lint and type debt, and comments or documents that no longer match what the code does. Closed when each finding has its evidence.

## 2. Architecture (architect)

Run your Architecture review playbook: boundaries that leak, dependencies that point the wrong way, modules that change together and should be one (or the reverse), and decisions the code has outgrown. Closed when each finding has its evidence.

## 2. Build and pipeline (devsecops-engineer) {#pipeline}

Assess how the code is built and checked: what the pipeline verifies and what it lets through, how long it takes and where, whether a build can be repeated, and what a developer has to know by heart to work on it. Closed when each finding has its evidence.

## 3. Triage (qa-engineer)

Bring the findings together: drop duplicates and what does not hold up when checked again, rank the rest by the risk it carries and the cost of fixing it, and group them into steps that can be taken one at a time. Closed when every finding left has a priority and a reason for it.

## 4. Report (agile-project-manager)

Report to the user in your own terminal: the scope and the starting numbers, the findings by priority with where each one is and what would fix it, what was not looked at, and the first steps you recommend. Offer to write it to a file in the repository if the user wants to keep it.
