/**
 * Data models.
 *
 * users (Phase 1) below. Directory in Phase 2, scheduling in Phase 3, chat in
 * Phase 4.
 */
import { ensureUsersTable } from "./users.js";

export function ensureSchema() {
  ensureUsersTable();
}

export * from "./users.js";
