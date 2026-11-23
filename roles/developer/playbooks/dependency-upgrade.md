---
name: Dependency upgrade
description: Upgrade one dependency at a time, having read what changed between the two versions, through the package manager so the lock file moves with it, and with the checks proving nothing broke. Use when asked to upgrade or update a dependency, to move off a vulnerable version, or to catch up on outdated packages.
tools: git, gh, osv-scanner
order: 20
---

Upgrade dependencies the careful way. Steps 1 to 3 only read. Step 4 changes the manifest and the lock file, on a branch of its own. A new version is code from outside that will run with the project's rights: read before you install.

## 1. What is behind, and what is vulnerable

Ask the project's own package manager, in each ecosystem it has:

```bash
npm outdated
npm audit
```

(For the others: `pip list --outdated`, `go list -u -m all`, `cargo update --dry-run`, `bundle outdated`, `mvn versions:display-dependency-updates`.) Then the known vulnerabilities, from the lock files:

```bash
osv-scanner scan source -r .
```

(An osv-scanner older than version 2 takes `osv-scanner -r .`.) Write the candidates down: the package, the version installed, the version wanted, whether the jump is a patch, a minor or a major, whether the project depends on it directly, and whether it ships to production.

## 2. Choose one

One dependency per change, or one family that must move together (a framework and its plugins). In this order: a vulnerable version that ships, then what blocks other upgrades, then the rest. A major version is a task of its own, with its own plan: say so instead of folding it into a batch.

A package that is new to the project is not an upgrade: adding a dependency needs its reason, and the DevSecOps Engineer's look at where it comes from.

## 3. Read what changed

Before installing anything:

- **The changelog and the release notes** between the two versions, every one in between: breaking changes, deprecations, new requirements (a runtime version, a peer dependency).

  ```bash
  gh release list --repo <owner>/<repository> --limit 30
  gh release view <tag> --repo <owner>/<repository>
  ```

- **Where the project uses it**, against what changed:

  ```bash
  git grep -n '<package>' -- . ':!*.lock'
  ```

- **What the new version brings with it.** New dependencies of its own, a new maintainer, a script that runs at install time, a licence that changed, a version published hours ago. For npm:

  ```bash
  npm view <package>@<version> dependencies scripts license maintainers time.modified
  ```

  Anything odd here goes to the DevSecOps Engineer before the upgrade, not after.

## 4. Upgrade

On a branch of its own, through the package manager, so the manifest and the lock file change together:

```bash
git switch -c <upgrade-branch>
npm install <package>@<version>
git diff --stat
```

Read the lock file's diff: which other packages moved with it, and whether any moved that should not have. A lock file regenerated from scratch is not an upgrade: if most of it changed, undo it and find out why. Never edit a lock file by hand.

Then make the code build against the new version, changing only what the upgrade forces. A deprecation you could also clean up is noted for its own change.

## 5. Prove it

Run the repository's own checks (type check, lint, tests, build) and keep their output. Then, beyond them:

- Exercise what the dependency does in this project where no test does: start the application, run the command, open the page.
- Scan again: the vulnerability the upgrade was for is gone, and no new one came in.

  ```bash
  osv-scanner scan source -r .
  ```

- A test that fails after the upgrade is information. Fix the code, or stop and report that the upgrade does not fit yet. Never loosen the test.

One upgrade per commit, with the two versions and the reason in the message.

## 6. Hand over

- The package, from which version to which, and why now.
- What changed between them that touches this project, and what you changed for it.
- The other packages the lock file moved.
- The checks and their real output, and what you exercised by hand.
- What is still behind, and the majors that need a plan of their own.

To the QA Engineer: the areas this dependency touches. To the DevSecOps Engineer: anything about where the new version comes from that you could not settle.
