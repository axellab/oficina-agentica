---
name: Deep security analysis
description: A threat model and a ranked list of security findings, with evidence.
order: 30
---

The request is a deep look at how the system could be attacked. The run ends with a report: the threat model and the findings, ranked, each with its evidence and what would fix it.

This is an analysis: nobody changes product code, configuration or infrastructure. What it delivers is the report; fixing what it finds is a new request the user decides on.

A finding says where it is (file and line, resource, pipeline step), what is wrong, the evidence (the code, the command and its output), what it costs or risks, and what would fix it.

A secret found in the code or its history is reported by where it is, never copied into a note or a message.

## 1. Threat model (security-engineer)

Run your Threat model playbook on the scope the request sets: what is worth protecting, who could want it, the trust boundaries and entry points, and the paths an attacker would try first. Closed when the model says where the next stages should look hardest.

## 2. Code review (security-engineer)

Run your Vulnerability review playbook along the threat model: how every input is validated, authentication and authorization on every path, session and secret handling, cryptography, injection, unsafe deserialization, error messages that say too much. Closed when every entry point of the model was read and each finding has its evidence.

## 2. Dependencies and pipeline (devsecops-engineer) {#supply-chain}

Run your Supply chain audit playbook, and review how the code is built: dependencies with known vulnerabilities or no maintainer, pinned versions and lock files, secrets in the repository and its history, what the pipeline runs with which permissions, and how a release is made and signed. Closed when each finding has its evidence.

## 2. Infrastructure (cloud-engineer)

Run your Infrastructure review playbook on what the repository holds (infrastructure as code, deployment and container files), from the code alone, with no plan: identities and their permissions, what is reachable from the network, encryption in transit and at rest, logging and backups. Skip it, with a note, when the repository describes no infrastructure. Closed when each finding has its evidence.

## 2. Architecture (architect)

Review the design for weaknesses no single file shows: trust placed in the wrong component, checks that can be bypassed by another path, missing isolation between tenants or privileges, a failure that leaves the system open. Closed when each finding has its evidence.

## 3. Triage (security-engineer)

Bring the findings together: drop duplicates and what does not hold up when checked again, rank the rest by how likely it is to be used and what it would cost (critical, high, medium, low), and order the fixes. Closed when every finding left has a severity and a reason for it.

## 4. Report (agile-project-manager)

Report to the user in your own terminal: the scope, the threat model in short, the findings by severity with where each one is and what would fix it, what was not looked at, and the fixes you recommend starting with. Offer to write it to a file in the repository if the user wants to keep it.
