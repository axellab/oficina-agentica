---
name: Pipeline hardening
description: The pipeline reviewed for mistakes and for abuse, and hardened on a branch.
order: 20
---

The request is to review and harden the delivery pipeline. The run ends with the findings ranked, the fixes on a branch of their own with a green run, and a report the user can decide to merge from.

A pipeline is shared by everyone who pushes. Every change is code on a branch; nothing is pushed to the default branch, and no control is turned off to make a run pass.

## 1. Inventory (devsecops-engineer)

Run your Pipeline hardening playbook, step 1: every workflow with its triggers, its permissions, the secrets it reads and each action it uses with its pin. Closed when the inventory is in your note.

## 2. Lint and audit (devsecops-engineer)

Playbook, steps 2 to 4: the linter, the audit, and the list no tool decides. Closed when each finding says where it is and what could be done with it.

## 2. Security review (security-engineer)

Review the same workflows as an attacker would: what a pull request from outside can make the pipeline run, which secrets that code could reach, and what a compromised action or dependency would be allowed to do. Closed when each finding has its evidence, or the note says none was found and what was read.

## 3. Changes (devsecops-engineer)

Fix the findings (playbook, step 5), most severe first, one finding per commit, on a branch of its own. A finding that needs a decision of the user's (a required check, a secret to replace, an action to drop) is put to them, not decided. Closed when the commits are on the branch and the linter and the audit were run again.

## 4. Verification (qa-engineer)

The pipeline still does its job: it runs green on the branch, the same tests ran as before (compare the jobs and the test counts with a run on the default branch), and nothing that used to block a merge stopped blocking. Closed when the green run is linked in the note.

## 5. Report (devsecops-engineer)

Report to the user in your own terminal: what was reviewed, the findings by severity, what was fixed and where (branch, pull request, the green run), and what waits for their decision. Nothing is merged: that is the user's call.
