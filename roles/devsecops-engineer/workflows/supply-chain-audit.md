---
name: Supply chain audit
description: What the code is built from, what in it is vulnerable, unpinned or leaked, ranked.
order: 30
---

The request is an audit of what the repository is built from. The run ends with a report: the dependencies and how they are pinned, the known vulnerabilities, the secrets found in the files and the history, ranked, each with its evidence and what would fix it.

This is an analysis: nobody changes product code, configuration or infrastructure. What it delivers is the report; fixing what it finds is a new request the user decides on.

A secret found in the code or its history is reported by where it is, never copied into a note or a message.

## 1. Inventory (devsecops-engineer)

Run your Supply chain audit playbook, steps 1 and 5: each ecosystem with its manifest and lock file, and the bill of materials. Closed when your note says what the repository is built from and where the bill of materials was written.

## 2. Dependencies (devsecops-engineer)

Playbook, steps 2, 4 and 6: known vulnerabilities, misconfiguration, licences, and what no scanner decides (pins, install scripts, maintenance, provenance). Closed when each finding says which package and version, whether it ships to production, and the version that fixes it.

## 2. Secrets (security-engineer)

Scan the files and the whole history for secrets, with the values redacted (`gitleaks git --redact .`), and judge each match: a real credential, a test value, or a false positive. A real one that was ever committed is compromised. Closed when each match has its verdict, by file, commit and rule, with nothing of its value in the note.

## 3. Triage (security-engineer)

Merge both lists and rank by real risk in this system: what can be reached, by whom, and what it would cost. Say which vulnerabilities are exploitable here and which are not, with the reason. Closed when every finding left has a severity and a reason.

## 4. Report (devsecops-engineer)

Report to the user in your own terminal: what the repository is built from, the findings by severity with where each is and what would fix it, the secrets to replace (by where they are), the tools that ran and the ones that were missing, and what was not covered.
