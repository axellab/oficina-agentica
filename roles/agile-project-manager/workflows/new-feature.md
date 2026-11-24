---
name: New feature
description: From a request to a tested, reviewed change ready to merge.
order: 10
---

The request is a new capability. The run ends with the change on a branch of its own (never on the default branch), tested and reviewed, and a report the user can decide to merge from.

Keep the change as small as the request allows. What the request leaves open and only the user can decide (scope, a deadline, a risk to accept), ask the user once, early, in your own terminal.

## 1. Requirements (agile-project-manager)

Turn the request into user stories with acceptance criteria that can be checked, and say what is explicitly left out. Closed when the stories are written where the team keeps them (or in your note) and nothing in them contradicts the request.

## 2. Design (architect)

Run your Technical design playbook for the feature: read the code it touches and write the technical plan, with the components and contracts that change, the data that flows, the decisions taken with the alternatives rejected, and the steps to build it in. Closed when the plan covers every story and names its risks.

## 3. Implementation (developer)

Build the plan on a branch of its own, in small commits, with the unit tests each step needs. Launch the Developer into a new Worktree (launch_agent with `worktree`) so the change stays apart from the main checkout. Closed when the code builds, the checks the repository runs (types, lint, tests) pass, and the commits are on the branch.

## 4. Testing (qa-engineer) {required} {check=tests}

Test the change against the acceptance criteria: the cases a user would hit, the edges and the failures, and the suites the repository already has. A defect goes back to the Developer (start the implementation stage again) with the steps to reproduce it. Closed when every criterion has a test or a recorded check that passes on the branch's last commit.

## 4. Security review (security-engineer) {required} {check=security-scan}

Review the change for what it exposes: new inputs and how they are validated, authentication and authorization on every new path, secrets, dependencies added. Closed when each finding is fixed, or accepted by the user in so many words.

## 5. Delivery (devsecops-engineer)

Make the change ready to ship: the pipeline passes on the branch, what the change needs to run (configuration, migrations, flags) is written down, and a pull request is opened when the repository uses them. Nothing is merged or deployed: that is the user's call. Closed when the branch is ready for the user to merge.

## 6. Report (agile-project-manager)

Report to the user in your own terminal: what was asked, what was built and where (branch, pull request), how each acceptance criterion was verified, what is left out or open, and what you recommend next.
