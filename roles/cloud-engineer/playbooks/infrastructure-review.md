---
name: Infrastructure review
description: Review infrastructure as code for mistakes, insecure settings and unreliable design, with the formatter, the validator, the linters and a reading of what no tool decides. Use when asked to review Terraform or other infrastructure code, before a change is applied, or to assess how reliably and safely the system runs.
tools: git, terraform, tflint, checkov, trivy
order: 10
---

Review infrastructure code. It reads and reports. Nothing here applies a change, and nothing reaches a cloud account, except step 6, which needs the human's go-ahead in so many words. Never run `terraform apply`, `destroy`, `import`, `taint` or a `state` command that writes. Write any file a tool produces outside the repository (the system's temporary folder).

The commands are Terraform's. Where the project uses OpenTofu, `tofu` takes the same ones. For other tools (CloudFormation, Bicep, Pulumi, Kubernetes manifests), steps 1, 4 and 5 apply as they are.

## 1. Inventory

```bash
git ls-files | grep -E '\.(tf|tfvars|hcl|bicep)$|(^|/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|Chart\.yaml|kustomization\.ya?ml)$'
git ls-files | grep -E '\.tfstate(\.backup)?$|\.tfvars$'
```

Write down each root module (a folder with a backend or a provider block), the environments and how they differ, the providers and the modules with their versions, and where the state lives. A state file in the repository is the first finding: state holds secrets in clear text. So is a `.tfvars` file that holds one: report it by where it is, never copy it.

## 2. Format and validate

```bash
terraform fmt -check -recursive -diff
```

Validation needs the providers. This step downloads the ones the lock file names into `.terraform`, and nothing else: `-backend=false` keeps it from the state, and `-get=false` from the modules. A module's source may be a bucket, a private git host or a private registry, and `init` would fetch it with the human's own credentials (their cloud keys, their SSH key) before anyone agreed to that:

```bash
terraform -chdir=<root module> init -backend=false -get=false -lockfile=readonly -input=false
terraform -chdir=<root module> validate -no-color
```

Where the root module calls modules that are not installed yet (either command says a module is not installed), do not fetch them: report the validation as not run for that root module, with the reason. It is run in step 6, after the human's go-ahead. With no `.terraform.lock.hcl` committed, that is a finding (the providers are not pinned): report it and skip the validation, rather than let `init` choose the versions.

## 3. Lint

```bash
tflint --recursive
```

It runs with the rules built into it, and with the project's `.tflint.hcl` where there is one. Do not run `tflint --init`: it installs plugins, and installing is the human's call. The rules a missing plugin would have run are reported as not run.

## 4. Security and misconfiguration

```bash
checkov -d . --quiet --compact --skip-download
trivy config .
```

`--skip-download` keeps checkov from fetching anything from its vendor's platform; it uploads nothing without an API key, and none is to be set. The two tools overlap: merge their results by resource, and read each one before it becomes a finding. A check that the code skips (`#checkov:skip`, `#trivy:ignore`) is listed with the reason written beside it, or with the words "no reason given".

## 5. What no tool decides

Read the code against this list:

- **Identity.** Every role and policy grants what its user needs and no more: no `*` action on a `*` resource, no long-lived key where a role would do, and a pipeline identity that can deploy only what it deploys.
- **Network.** What is reachable from the internet, and why. Nothing open to `0.0.0.0/0` but what must be public; data stores on private networks.
- **Data.** Encrypted in transit and at rest, and who holds the keys. Backups that exist, are kept long enough and were restored at least once. What deleting the resource would delete (`prevent_destroy`, deletion protection, versioning).
- **State.** A remote backend, encrypted, locked, readable only by who must read it. No secret in a variable's default, or in an output that is not marked sensitive.
- **Reliability.** More than one zone where the requirement says so, health checks, scaling limits, timeouts, and what happens when a dependency is down. The recovery objectives, stated.
- **Observability.** Logs, metrics and alerts that say what is wrong and who should act. Audit logs on, and kept.
- **Repeatability.** Every environment from the same code with different parameters. Provider and module versions pinned; a module from a git source pinned to a commit. Nothing created by hand that the code does not know.
- **Cost.** Resources tagged with their owner and environment; anything oversized or left running that the requirement does not ask for (the Cost review playbook goes further).

## 6. The plan, only with the human's go-ahead

A plan reads the real cloud account with the human's credentials, and may take a lock on the state. Its `init` also fetches the modules step 2 left alone, from wherever their sources point, with the same credentials. Ask first, saying which account and which environment, and that the modules will be downloaded. Then:

```bash
terraform -chdir=<root module> init -lockfile=readonly -input=false
terraform -chdir=<root module> plan -input=false -no-color -out=<temporary folder>/review.tfplan
```

Where step 2 could not validate for want of the modules, run `validate` now. Read what the plan would create, change and destroy, and above all what it would replace: a database that is replaced is a database that is deleted. A plan file holds secrets in clear text: it stays outside the repository, and nothing sensitive from it is copied into a note. Without the go-ahead, say that no plan was made, and review from the code alone.

## 7. Report

- What was reviewed: the modules, the environments, and the versions of the tools.
- The findings, ranked by what they risk (data lost or exposed, an outage, money): the resource with its file and line, what is wrong, the evidence, and the change that fixes it.
- What the plan showed, when one was made.
- What was not checked, and the tools and plugins that were missing.

Nothing is applied: the plan goes to the human, to approve and apply. The network and identity findings go to the Security Engineer, and what the pipeline deploys, with which identity, to the DevSecOps Engineer.
