---
name: Cost review
description: Estimate what the infrastructure in the repository costs per month, what a change adds or removes, and where money is wasted, from the infrastructure code and with Infracost where the human has it set up. Use when asked what something will cost, to review cloud spend, or before a change that adds resources.
tools: git, infracost
order: 20
---

Estimate and review cost from the infrastructure code. It reads and reports, changes nothing, and needs no cloud credentials. Write any file a tool produces outside the repository (the system's temporary folder).

Two things about Infracost before its first run. It needs an API key of the human's: when it answers that none is set, stop there and say so, because getting one opens an account, and that is theirs to do. And it prices by asking its vendor's pricing service, which according to the vendor is sent what the code declares (resource types, sizes, regions) and no credentials or secrets: tell the human so once, and skip the tool if they would rather not.

## 1. What is declared

```bash
git ls-files | grep -E '\.(tf|tfvars)$' | xargs -n1 dirname | sort -u
git grep -cE '^(resource|module) "' -- '*.tf'
```

Write down each root module and environment, and the resources that usually carry the bill: compute, databases, storage, load balancers, gateways, data transfer, and the managed services billed by use.

## 2. What it costs today

```bash
infracost breakdown --path <root module> --format table
```

Read the table for what it could not price: resources billed by use (requests, data stored or transferred, function runs) show no price without usage figures. Ask the human for the expected usage, or state your assumption beside each number. A price you did not get from the tool or from the provider's own price list is not in the report.

## 3. What a change adds

For a branch, compare with the default branch, from a checkout of it outside the repository:

```bash
git worktree add --detach <temporary folder>/cost-base origin/<default-branch>
infracost breakdown --path <temporary folder>/cost-base/<root module> --format json --out-file <temporary folder>/cost-base.json
infracost diff --path <root module> --compare-to <temporary folder>/cost-base.json
git worktree remove <temporary folder>/cost-base
```

The difference per month, resource by resource, and which line of the change causes each.

## 4. Without Infracost

The estimate is still owed. List the resources with their size, count and region from the code, price the few that carry the bill from the provider's public price list (say which page, and the date), and mark the rest as not priced. An estimate with its assumptions written down is useful; a number with none is not.

## 5. Where money is wasted

Read the code against this list. Each is a question for whoever owns the requirement, not a verdict:

- **Sized for a guess.** Instance and database classes larger than the stated load asks for; storage provisioned at its maximum.
- **Always on.** Development and test environments that run nights and weekends; capacity that never scales down.
- **Paid twice.** Several zones, replicas or a standby where the requirement does not ask for them. And the reverse: missing where an outage would cost more than they do.
- **Traffic.** NAT gateways, data crossing zones or regions, transfer out to the internet, large downloads with no content network in front.
- **Kept for ever.** Logs, snapshots, backups and object versions with no expiry; storage with no lifecycle rule.
- **Left behind.** Disks, addresses and load balancers that outlive what they served.
- **The wrong way to buy.** On-demand prices for a steady load a commitment would cover; a managed service where a simpler one would do, or the reverse.
- **Nobody to ask.** Resources without owner and environment tags; no budget, and no alert on spend.

## 6. Report

- The monthly estimate per environment, with what it covers and what it leaves out.
- The handful of resources that make most of it.
- For a change: what it adds or removes per month, and why.
- The savings, ranked by money per month, each with what it would cost in reliability or effort, and who should decide.
- Every assumption, and how the numbers were obtained (the tool and its version, or the price list and its date).

Nothing is changed here. A saving that changes the infrastructure is a change like any other: code, reviewed, planned, and applied by the human.
