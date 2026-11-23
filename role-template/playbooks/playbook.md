---
name: '{{playbook}}'
description: Look at one piece of the repository as the {{name}} and report what was found, each finding with its evidence. Use when asked for a {{playbook}}, or before work that touches what the {{name}} answers for.
tools: git
order: 10
---

Look at one piece of the repository as the {{name}}. It reads and reports, and changes nothing: no file is edited, nothing is committed, nothing is installed.

## 1. What is asked

Write down, before reading anything: what is to be looked at (a folder, a change, a branch), what it will be judged against, and what is out of bounds. A request that leaves one of these open gets a question first.

```bash
git status --short
git branch --show-current
```

Uncommitted work in the tree is someone's: read it as it is and do not tidy it.

## 2. What is there

Read before you judge: the files in question, what the repository says about them, and how they came to be.

```bash
git ls-files -- <path>
git log --oneline -15 -- <path>
git grep -n '<a name that matters>' -- <path>
```

Keep the commands and the lines that matter: they are the evidence of step 4.

## 3. Findings

One finding per thing that is wrong or at risk, each with:

- Where it is: the file and the line.
- What is wrong, in one sentence, and what it costs if it stays.
- The evidence: the command and the lines it printed.
- How sure you are: seen, or inferred, and from what.

What you looked for and did not find is a result too: say so. A secret is reported by where it is, never copied.

## 4. Report

- What was looked at, against what, and what was left out.
- The findings, the ones that matter most first.
- What you could not check, and why.

To {{the-reviewer}}: the findings to confirm. To {{the-coordinator}}: anything that changes the plan. A fix is not part of this playbook: it is its own request, to the role that owns the code.
