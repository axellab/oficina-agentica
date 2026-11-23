---
name: Threat model
description: Model how a system, a design or a change could be attacked, with its assets, trust boundaries, entry points, threats ranked by risk, and the control that answers each. Use when asked for a threat model, before a design is built, or when a change adds an entry point or moves a trust boundary.
tools: git
order: 10
---

Model the threats to one system, design or change. It reads, and writes one document; it attacks nothing and runs no scanner. Only this team's own system is in scope.

## 1. Scope

Write down what is being modelled (the whole system, one service, one change), what it is for, who uses it, and what is explicitly out. For a change, read it first:

```bash
git diff --stat <base>...<branch>
```

A threat model the repository already keeps is the starting point, not a thing to rewrite:

```bash
git ls-files | grep -iE '(threat[-_ ]?model|security)[^/]*\.md$'
```

## 2. What is worth protecting

List the assets: the data (personal, credentials, money, what a customer would sue over), the capabilities (running code, moving money, changing who may do what), and availability where an outage costs. For each one, who may read it and who may change it.

## 3. How it is built: entry points and trust boundaries

Draw the system from the code, not from memory: the processes, the data stores, the outside services, and the data that flows between them. Then mark:

- **Entry points.** Every place data comes in from outside the process: routes, message handlers, files read, command lines, environment, webhooks, what another service answers.

  ```bash
  git grep -nIE '(app|router|server)\.(get|post|put|patch|delete|all|use)\(|@(Get|Post|Put|Patch|Delete|RequestMapping)|@app\.route|process\.argv|process\.env|os\.environ' -- . ':!*.lock' | head -200
  ```

  The pattern is a start for common frameworks, not a list of what exists: read the entry files the project really has.

- **Trust boundaries.** Each line where data or control passes between parties that trust each other differently: the internet and the server, one tenant and another, a user and an administrator, the application and its database, the pipeline and production.
- **Identities.** Who each component runs as, and what that identity may do.

## 4. Threats

For each entry point and each boundary crossing, ask the six questions (STRIDE), and write down only the ones with a real path here:

- **Spoofing.** Can someone pass for another user, service or device?
- **Tampering.** Can data be changed in transit, at rest or in a request?
- **Repudiation.** Could someone do it and nobody be able to show they did?
- **Information disclosure.** Can data reach someone who may not read it, through a response, an error, a log or a side door?
- **Denial of service.** Can one caller make it unusable for the rest?
- **Elevation of privilege.** Can someone do what only a more trusted party may?

A threat is written as a path: who, from where, through which entry point, to which asset. "Injection is possible" is not a threat; "an unauthenticated caller of `POST /import` controls the file name passed to the shell" is.

## 5. Controls and gaps

For each threat, the control that answers it today (where it is in the code or the configuration, by file and line) or the words "no control". Read the control: one that is named in a document and missing from the code is a gap.

## 6. Rank

Rank each gap by how likely the path is to be used (who can reach it, what skill it takes) and what it would cost (which asset, how much of it): critical, high, medium, low, each with its reason. A gap with no path to an asset goes at the bottom, whatever it is called.

## 7. Write it down

One document: scope, assets, the system as text (components, flows, boundaries), the threats with their controls, the gaps ranked with a concrete fix for each, and what was not modelled. Where the repository keeps such documents, propose it there, on a branch of its own; otherwise it goes in your hand-over. Nothing else in the repository changes.

Hand the fixes to the Developer, the check that would catch each class to the DevSecOps Engineer, and the infrastructure changes to the Cloud Engineer. Accepting a gap instead of closing it is the human's decision.
