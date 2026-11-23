---
name: Threat model
description: How a system or a change could be attacked, and the control that answers each threat.
order: 10
---

The request is a threat model of a system, a design or a change. The run ends with one document: the assets, the trust boundaries and entry points, the threats ranked by risk, the control that answers each, and the gaps with what would close them.

This is an analysis: nobody changes product code, configuration or infrastructure. What it delivers is the document; closing the gaps it finds is a new request the user decides on.

Nothing is attacked, and no scanner is the point: the model comes from reading how the system is built. Only this team's own system is in scope.

Ask the user once, early, in your own terminal, for what the request leaves open: what is in scope, and what they most fear losing.

## 1. Scope and assets (security-engineer)

Run your Threat model playbook, steps 1 and 2: what is modelled and what is out, and what is worth protecting, with who may read and who may change each asset. Closed when your note gives the next stages the scope and the assets.

## 2. How it is built (architect)

Describe the system as the code has it, for the scope given: the components, the data that flows between them, where state lives, every place data comes in from outside, and each line where trust changes. Closed when the components, flows, entry points and boundaries are in your note, each with the file that shows it.

## 2. Where it runs (cloud-engineer)

From what the repository holds (infrastructure as code, deployment and container files): what is reachable from the network, the identity each part runs as and what it may do, where data is stored and how it is protected. Skip it, with a note, when the repository describes no infrastructure. Closed when each fact names the file it comes from.

## 2. How it is built and shipped (devsecops-engineer) {#delivery}

The path from a commit to a release: who can change the pipeline, which secrets it reads and which identity it deploys as, what a pull request from outside can make it run, and where the dependencies come from. Closed when each fact names the workflow or the file it comes from.

## 3. Threats and controls (security-engineer)

Playbook, steps 3 to 6, on what the three descriptions gave you: for every entry point and boundary, the threats that have a real path here, the control that answers each today (by file and line) or the words "no control", and the gaps ranked. Closed when every gap has a severity, a reason and a concrete fix.

## 4. Report (security-engineer)

Write the model down (playbook, step 7) and report to the user in your own terminal: the scope, the assets, the threats that matter most with their controls, the gaps by severity with what would close each, and what was not modelled. Offer to keep the document in the repository, on a branch of its own, if the user wants it. Accepting a gap instead of closing it is the user's decision.
