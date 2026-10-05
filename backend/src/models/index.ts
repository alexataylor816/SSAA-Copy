/**
 * Data models.
 *
 * users + password_resets + rbac (companies/user_roles/join_requests) +
 * scheduling (projects/availability, Phase 3 slice) below. Chat in Phase 4.
 */
import { ensurePasswordResetsTable } from "./passwordResets.js";
import { ensureUsersTable } from "./users.js";
import { ensureRbacTables } from "../rbac/models.js";
import { ensureSchedulingTables } from "../scheduling/models.js";
import { ensureProjectTables } from "../query/projectTables.js";

export function ensureSchema() {
  ensureUsersTable();
  ensurePasswordResetsTable();
  ensureRbacTables();
  ensureSchedulingTables();
  ensureProjectTables();
}

export * from "./users.js";
export * from "./passwordResets.js";
