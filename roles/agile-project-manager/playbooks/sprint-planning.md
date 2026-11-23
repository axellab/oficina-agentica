---
name: Sprint planning
description: Plan a sprint with the human, from the goal and the backlog to stories with acceptance criteria, an owner and a size, what fits, what is left out and what done means. Use when asked to plan a sprint or an iteration, to order the backlog, or to turn a goal into stories.
tools: git, gh
order: 20
---

Plan one sprint. Steps 1 to 5 read and propose. Step 6 writes to the tracker, and only what the human agreed to. Scope, priorities and deadlines are the human's: you bring the trade-offs and a recommendation.

## 1. The goal

One sentence the human agrees with: what will be true at the end of the sprint that is not true now. And the frame: how long the sprint is, when it ends, and what is fixed (a date, a release, a promise to someone). Without a goal, ask for it: a sprint that is a list of tickets has no way to say no.

## 2. Where things stand

```bash
gh issue list --state open --limit 100 --json number,title,labels,assignees,milestone,updatedAt,url
gh pr list --state open --json number,title,isDraft,author,headRefName,reviewDecision,updatedAt,url
gh api "repos/{owner}/{repo}/milestones" --jq '.[] | {number, title, due_on, open_issues, closed_issues}'
git log --since="<start of the last sprint>" --merges --format='%h %ad %s' --date=short
```

Write down: what is already in progress (finishing it comes before starting anything), what the last sprint planned against what it shipped (that ratio is the only honest measure of what fits), and what was carried over and why.

## 3. Candidates

From the backlog and the goal, the stories that would move the goal. Each one is written so that it can be checked:

- **As** who, **I want** what, **so that** why.
- **Acceptance criteria**: what someone could observe to say it is done. A story with none is not ready: write them, or ask the role that knows.
- **The role that takes it**, and the roles it needs afterwards (a review, a test, a deploy).
- **What it depends on.**

Split a story that cannot be finished within the sprint, along what a user could already use, not along the layers of the code.

## 4. Size and risk

Ask the roles that will do the work; do not size for them. With the office's tools, send each one its stories (`send_message`) and read the answers: the Architect for what is technically uncertain and what must be built first, the Developer for the effort, the QA Engineer for whether the criteria can be tested, the Security, DevSecOps and Cloud Engineers for the stories that touch what is theirs. Without the tools, ask through the human.

A relative size is enough (small, medium, large). What nobody can size has a question in it: the story becomes the smallest piece of work that answers the question.

## 5. The plan

Order by value and risk, the riskiest of the valuable first, and cut where the capacity ends: what the team finished last sprint, less what is carried over. Then put it to the human, as a proposal:

- **The goal.**
- **In**: the stories in order, each with its owner, its size and its criteria.
- **Out**: what was considered and is explicitly left for later, so that nobody assumes it.
- **What done means** for this sprint: reviewed, tested, the pipeline green, documented, merged, deployed, as far as the team goes.
- **Risks to the date or the goal**, each with its options.
- **Decisions that are theirs**, with your recommendation.

Leave room: a plan filled to the last hour has already slipped. Change it until the human agrees to it, in so many words.

## 6. Write it down

Only now, and only where the human agreed the plan lives. In the tracker:

```bash
gh api "repos/{owner}/{repo}/milestones" -f title="<sprint name>" -f due_on="<end date>T23:59:59Z" -f description="<the goal>"
gh issue create --title "<story>" --body-file <temporary folder>/story.md --milestone "<sprint name>"
gh issue edit <number> --milestone "<sprint name>"
```

One issue per story, with its criteria, its owner role and its size in the body. An issue that already exists is edited, not duplicated. Close, relabel or reassign nothing that is not in the agreed plan.

Then hand each first story to the role that takes it, with a clear ask and where the plan is, and tell the human the plan as agreed, in a form they can read in a minute.
