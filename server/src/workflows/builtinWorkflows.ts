/**
 * The built-in Workflows: how the team handles each kind of request. Each is
 * a Markdown file in the folder of the Role that leads it
 * (roles/<role id>/workflows/<id>.md, read by roles/roleKits.ts): the four a
 * request usually starts from are the Agile Project Manager's, and each other
 * Role leads the ones that are its own job. The host replaces or adds to them
 * in workflows.json (workflowCatalog.ts).
 *
 * A Workflow is an ordered list of stages, each owned by a Role. What its file
 * says before the first stage, and each stage's text, are what the run's lead
 * is told through the `workflow` tool (what the stage's owner does, and what
 * closes it): the lead hands each stage to an agent of that Role and reports
 * how it went. Stages that share a step may run at the same time.
 */

import type { WorkflowDefinition } from '../../../core/src/workflows.js';
import { builtinRoleKits } from '../roles/roleKits.js';

export const BUILTIN_WORKFLOWS: readonly WorkflowDefinition[] = builtinRoleKits().workflows;
