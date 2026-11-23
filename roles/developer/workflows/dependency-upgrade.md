---
name: Dependency upgrade
description: Dependencies upgraded one at a time, their changes read, their origin checked, the suite proving it.
order: 20
---

The request is to upgrade a dependency, or to catch up on the ones that are behind. The run ends with each upgrade on a branch of its own, one per commit, the changes between the versions read, the new version's origin checked, the suites proving nothing broke, and a report.

A new version is code from outside that will run with the project's rights: it is read about before it is installed. A major version is a piece of work of its own. Nobody loosens a test to make an upgrade fit.

Ask the user once, early, in your own terminal, for what the request leaves open: which dependencies, and whether major versions are wanted.

## 1. Plan (developer)

Run your Dependency upgrade playbook, steps 1 to 3: what is behind and what is vulnerable, the upgrades chosen and in which order, and what changed between the versions that touches this project. Closed when each chosen upgrade is in your note with its two versions and its breaking changes.

## 2. Origin check (devsecops-engineer)

For each new version, before it is installed: its known vulnerabilities, who publishes it and whether that changed, the scripts it runs at install time, the dependencies it brings, its licence, and how the project pins it. Closed when each upgrade has a go, or a no with its reason.

## 3. Upgrade (developer)

Playbook, steps 4 and 5, for the upgrades that got a go: through the package manager, one per commit, the lock file's diff read, the code changed only where the upgrade forces it, and the repository's checks passing. Closed when the commits are on the branch and the checks pass on the last one.

## 4. Verification (qa-engineer)

Test what the upgraded dependencies touch: the suites the repository has, and the behaviours that depend on them and no test covers, exercised by hand. A defect goes back to the Developer (start the upgrade stage again) with the steps to reproduce it. Closed when the results are in your note for the branch's last commit.

## 5. Report (developer)

Report to the user in your own terminal (playbook, step 6): each package with its two versions and why, what changed in the code for it, the other packages the lock file moved, the checks with their real output, what was refused and why, and what is still behind. Nothing is merged: that is the user's call.
