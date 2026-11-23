---
name: Technical design
description: A goal turned into a reviewed design, its decision recorded, and a plan in steps.
order: 20
---

The request is a design for a feature or a change, before anything is built. The run ends with the design on a branch of its own, as documents: the options weighed, the decision recorded, and a plan in steps that each leave the system working, reviewed by the roles it touches.

Nobody implements the design here: building it is a new request the user decides on. A sketch that proves an assumption stays out of the product's code.

Scope, deadlines, budget and accepted risks are the user's. Ask the user once, early, in your own terminal, for the constraints the request leaves open, and put to them, before the plan is written, any choice that is theirs.

## 1. Context (architect)

Run your Technical design playbook, steps 1 and 2: the goal and how anyone will know it is met, the constraints, and the system as it is where the design touches it. Closed when the goal, the constraints and the current state are in your note.

## 2. Options (architect)

Playbook, steps 3 and 4: at least two real options with what each changes, costs and risks, the assumptions checked, and the one you recommend with what it trades away. Closed when the options and the recommendation are in your note, ready to be reviewed.

## 3. Security review (security-engineer)

Review the recommended option: every new entry point, every trust boundary that moves, the data it stores or sends, and the control each threat needs. Closed when each concern is in your note with what would answer it, or the note says none was found and what was read.

## 3. Test strategy (qa-engineer)

Say how the design would be tested: the acceptance criteria that can be checked, the level each behaviour is proved at, what is hard to test as designed, and the seam that would make it testable. Closed when the strategy is in your note.

## 3. Operations (cloud-engineer)

Say what the design needs to run: where each part runs, what it needs from the infrastructure, how it is observed and recovered, and roughly what it costs. Skip it, with a note, when the design changes nothing about where or how the system runs. Closed when what it needs is in your note.

## 4. Decision (architect)

Playbook, step 5: take the reviews in, and write the design down on a branch of its own, documents only. The decision record where the repository keeps them, and the plan: the components and contracts that change, the data and its migration, the steps in order with the role that takes each, how it is tested, and the risks. Closed when the documents are committed on the branch.

## 5. Report (architect)

Report to the user in your own terminal (playbook, step 6): the goal, the options in a line each, what was decided and what it trades away, what the reviews changed, where the documents are (branch, pull request), the first step of the plan, and what is theirs to decide. Nothing is merged: that is the user's call.
