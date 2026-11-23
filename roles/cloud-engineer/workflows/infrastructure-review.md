---
name: Infrastructure review
description: The infrastructure code checked for mistakes, exposure and weak reliability, ranked.
order: 10
---

The request is a review of the infrastructure as code. The run ends with a report: what is declared, and the findings ranked by what they risk (data lost or exposed, an outage, money), each with its evidence and the change that would fix it.

This is an analysis: nobody changes product code, configuration or infrastructure. What it delivers is the report; fixing what it finds is a new request the user decides on.

Nothing is applied, imported or destroyed, and nothing reaches a cloud account, with one exception: a plan, which reads the real account with the user's credentials. Ask the user once, early, in your own terminal, whether they want one and for which environment. Without a yes in so many words, review from the code alone.

A secret found in the code, a variables file or a state file is reported by where it is, never copied into a note or a message.

## 1. Inventory (cloud-engineer)

Run your Infrastructure review playbook, step 1: the root modules, the environments and how they differ, the providers and modules with their versions, and where the state lives. Closed when the inventory is in your note.

## 2. Checks (cloud-engineer)

Playbook, steps 2 to 5: format and validation, the linter, the security scanners, and what no tool decides (identity, network, data, state, reliability, observability, repeatability). And step 6, the plan, only if the user said yes. Closed when each finding names its resource, file and line, with its evidence.

## 2. Network and identity (security-engineer)

Review the design as an attacker would: what is reachable from the internet and what that reaches next, what each identity could do if it were taken over, where a secret is stored or passed, and what is logged. Closed when each finding has its evidence, or the note says none was found and what was read.

## 2. Deployment (devsecops-engineer)

Review how this code reaches the cloud: who or what applies it, with which identity and how much that identity may do, where the plan is reviewed before it is applied, how the state is protected, and whether a change could be applied from a pull request nobody approved. Closed when each finding has its evidence.

## 3. Findings (cloud-engineer)

Bring the three lists together: merge what the tools and the reviews found for the same resource, drop what does not hold up when read again, and rank the rest by what it risks and how likely that is. Closed when every finding left has a severity, a reason and the change that would fix it.

## 4. Report (cloud-engineer)

Report to the user in your own terminal (playbook, step 7): what was reviewed, the findings by severity with where each is and what would fix it, what the plan showed if one was made, the tools that ran and the ones that were missing, and what was not checked. Nothing is applied: any change goes through code, a plan and the user's approval.
