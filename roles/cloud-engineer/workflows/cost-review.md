---
name: Cost review
description: What the infrastructure costs per month, what makes most of it, and where to save.
order: 20
---

The request is a look at what the infrastructure costs. The run ends with a report: the monthly estimate per environment, what makes most of it, what a pending change would add, and the savings ranked by money, each with what it would cost in reliability or effort.

This is an analysis: nobody changes product code, configuration or infrastructure. What it delivers is the report; acting on a saving is a new request the user decides on.

Every number comes with how it was obtained and what it assumes. A price nobody read from the tool or from the provider's price list is not in the report.

Ask the user once, early, in your own terminal, for what only they know: the expected usage (requests, data stored and transferred), and whether pricing through Infracost is fine with them (it needs their API key, and sends what the code declares to its vendor's pricing service).

## 1. Inventory (cloud-engineer)

Run your Cost review playbook, step 1: the root modules and environments, and the resources that usually carry the bill. Closed when the inventory is in your note.

## 2. Estimate (cloud-engineer)

Playbook, steps 2 to 4: the monthly estimate per environment, what could not be priced and the usage assumed for it, and what the pending change adds or removes when the request names one. Without the tool, the estimate by hand from the provider's price list. Closed when each number has its source and its assumptions.

## 2. Design (architect)

Say what in the design makes it expensive: parts that talk across zones or regions more than they need to, capacity sized for a requirement nobody stated, a service kept running for an occasional job, data kept in the costliest place. Closed when each point says which requirement it rests on, and what a cheaper design would give up.

## 3. Savings (cloud-engineer)

Playbook, step 5, with what the Architect found: each possible saving with its money per month, what it would cost in reliability, performance or effort, and who should decide. Ranked by money. Closed when each saving has its number, its trade-off and its owner.

## 4. Report (cloud-engineer)

Report to the user in your own terminal (playbook, step 6): the estimate per environment and what it leaves out, the resources that make most of it, what the change adds, the savings in order with their trade-offs, and every assumption. Nothing is changed: a saving that changes the infrastructure is code, a plan and the user's approval.
