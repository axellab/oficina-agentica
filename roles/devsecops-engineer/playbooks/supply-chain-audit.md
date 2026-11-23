---
name: Supply chain audit
description: Audit what a repository is built from, with known vulnerabilities, unpinned or unmaintained dependencies, secrets in the repository and its history, and licences. Use when asked to audit dependencies, the supply chain or the repository for secrets.
tools: git, osv-scanner, gitleaks, trivy, syft
order: 30
---

An audit: it reads, scans and reports, and changes nothing in the repository. Write any file a tool produces outside the repository (the system's temporary folder), never inside it.

## 1. What it is built from

```bash
git ls-files | grep -E '(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|requirements[^/]*\.txt|poetry\.lock|uv\.lock|Pipfile\.lock|go\.sum|Cargo\.lock|Gemfile\.lock|pom\.xml|build\.gradle(\.kts)?|Dockerfile[^/]*)$'
```

Write down each ecosystem and where its manifest and lock file are. A manifest with no lock file beside it is the first finding: its builds are not repeatable.

## 2. Known vulnerabilities

```bash
osv-scanner scan source -r .
```

(An osv-scanner older than version 2 takes `osv-scanner -r .`.) Then the ecosystem's own audit where it has one, which knows the dependency tree better: `npm audit --omit=dev` and `npm audit`, `pip-audit`, `govulncheck ./...`, `cargo audit`.

For each vulnerability: the package, the version installed, the version that fixes it, and whether it ships to production or is used only to build and test. Whether it can really be exploited in this system is the Security Engineer's judgement: hand it the list.

## 3. Secrets, in the files and in the history

```bash
gitleaks git --redact .
```

(A gitleaks older than 8.19 takes `gitleaks detect --redact`.) `--redact` is not optional: the report must say where a secret is, never what it is. For each finding give the file, the commit and the rule that matched, and nothing of the value.

A secret that was ever committed is compromised, even if a later commit removed it. Replacing it is the human's to do, with whoever owns the system it opens. Rewriting history is not yours to do.

## 4. Misconfiguration, containers and licences

```bash
trivy fs --scanners vuln,secret,misconfig,license .
```

Read the misconfiguration findings on Dockerfiles and infrastructure files, and the licences that the project's own licence does not allow. In each Dockerfile, check the base image: pinned by digest, or by a tag that moves?

## 5. A bill of materials

```bash
syft dir:. -o cyclonedx-json=<temporary folder>/sbom.cdx.json
```

Say where you wrote it. It is the list the next audit compares against, and what a customer or an auditor may ask for.

## 6. What no scanner decides

- **Pins.** Dependencies installed from a URL or a git branch, version ranges with no lock file, images and actions pinned by a tag that moves.
- **Install scripts.** Packages that run code at install time, and whether the pipeline installs with them enabled.
- **Maintenance.** A dependency with no release in years, or with one maintainer, on a path that matters.
- **Provenance.** Whether releases are built by the pipeline alone, from a tagged commit, and signed.

## 7. Report

Rank by what can be reached and what it would cost, not by the score a scanner printed:

- Each finding: where it is, what is wrong, the evidence (the command and the lines that matter), and what fixes it, down to the version to move to.
- What ships to production and what does not.
- The tools that ran, with their versions, and the ones that were missing.
- What was not covered.
