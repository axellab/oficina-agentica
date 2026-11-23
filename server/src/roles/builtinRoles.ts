/**
 * The built-in Roles: the parts of a software delivery team an agent can be
 * launched as. Each is a folder of Markdown files (roles/<role id>/ in the
 * repository: its definition, its Contract, its Playbooks and the Workflows it
 * leads), read by roleKits.ts. The host changes or adds to them in roles.json
 * (roleCatalog.ts); what an agent is actually told is composed there too.
 *
 * A Role's ROLE.md is its standing instructions, added to the coding agent's
 * own system prompt behind the team charter: what the Role owns, how it works,
 * and where its work ends and another Role's begins.
 */

import type { RoleDefinition } from '../../../core/src/roles.js';
import { builtinRoleKits } from './roleKits.js';

export const BUILTIN_ROLES: readonly RoleDefinition[] = builtinRoleKits().roles;
