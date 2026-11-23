---
name: '{{playbook}}'
description: One piece of the repository looked at by the {{name}}, with the findings confirmed and reported.
order: 10
---

The request names what the {{name}} is to look at. The run ends with the findings, each with its evidence, a second look at them by another role, and a report.

This is an analysis: nobody changes product code, and nothing is installed. A fix that a finding calls for is its own request. A secret is reported by where it is, never copied.

Ask the user once, early, in your own terminal, for what the request leaves open: what to look at, and what to judge it against.

## 1. Scope ({{id}})

Run your {{playbook}} playbook, steps 1 and 2: what is asked, what it is judged against, what is out of bounds, and what is there. Closed when the scope and what was read are in your note.

## 2. Findings ({{id}})

Playbook, step 3: one finding per thing that is wrong or at risk, each with where it is, what it costs and the evidence. Closed when the findings are in your note, or the note says none was found and what was looked for.

## 3. Second look ({{reviewer-id}})

Check the findings against their evidence: each one can be seen again from the command and the lines it cites, and none says more than was seen. Closed when each finding is confirmed, or sent back with the reason, in your note.

## 4. Report ({{id}})

Report to the user in your own terminal (playbook, step 4): what was looked at, the findings that stood, what could not be checked, and what each finding needs next and from which role. Nothing is changed: that is the user's call.
