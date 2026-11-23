---
name: Architecture review
description: How the system is really structured against how it is meant to be, with a ranked plan.
order: 10
---

The request is a review of the system's architecture. The run ends with a report: the intended structure beside the real one, the findings ranked by what they cost against what fixing them costs, and the decisions worth recording.

This is an analysis: nobody changes product code, configuration or infrastructure. What it delivers is the report; fixing what it finds is a new request the user decides on.

A finding says where it is (the files, the dependency, the pattern in the history), what is wrong, the evidence (the command and the lines that matter), what it costs, and what would fix it.

## 1. Map (architect)

Run your Architecture review playbook, steps 1 and 2: the structure the repository says it has, and the parts as they are, with their entry points and what each reaches. Closed when both are in your note, and it says where the next stages should look hardest.

## 2. Structure (architect)

Playbook, steps 3 to 5: the dependencies that point the wrong way, where change is expensive (the files that change most, and the ones that change together), and what no tool decides (boundaries, contracts, state, failure). Closed when each finding has its evidence.

## 2. Testability (qa-engineer)

Assess what the structure does to testing: the parts that cannot be tested without starting the whole system, the behaviour only an end-to-end test can reach, and where a seam is missing. Closed when each finding has its evidence.

## 2. Security architecture (security-engineer)

Assess the design for weaknesses no single file shows: trust placed in the wrong component, a check that another path goes round, missing isolation between tenants or privileges, a failure that leaves the system open. Closed when each finding has its evidence.

## 2. Operability (devsecops-engineer)

Assess what the structure does to building, shipping and running the system: what must be built and deployed together, what cannot be released on its own, and how a failure is noticed and traced to a part. Closed when each finding has its evidence.

## 3. Recommendations (architect)

Bring the findings together: drop duplicates and what does not hold up when checked again, rank the rest by what they cost against what fixing them costs, and slice the fixes into steps that each leave the system working. For a fix that is expensive to reverse, write the decision to record, with its alternatives. Closed when every finding left has a priority and a reason for it.

## 4. Report (architect)

Report to the user in your own terminal (playbook, step 6): the intended and the real structure side by side, the findings by priority with where each one is and what would fix it, what fits and should be kept, what was not reviewed, and the first steps you recommend. Offer to write it to a file in the repository if the user wants to keep it.
