/**
 * Data models.
 *
 * users + password_resets + rbac (companies/user_roles/join_requests) +
 * scheduling (projects/availability, Phase 3 slice) below. Chat in Phase 4.
 */
import fs from "node:fs";
import path from "node:path";
import { BASE_DIR } from "../config.js";
import { database } from "../db.js";
import { ensurePasswordResetsTable } from "./passwordResets.js";
import { ensureUsersTable } from "./users.js";
import { ensureRbacTables } from "../rbac/models.js";
import { ensureSchedulingTables } from "../scheduling/models.js";
import { ensureProjectTables } from "../query/projectTables.js";
import { ensureMessagingTables } from "../messaging/service.js";
import { ensureNotificationTables } from "../notifications/service.js";
import { ensureCompanyDeletionTables } from "../rbac/companyDeletion.js";
import { ensureContractorTables } from "../contractors/models.js";
import { ensureTemplateTables, seedNotificationTemplates } from "../notifications/templates.js";

export async function ensureSchema(): Promise<void> {
  if (database.dialect === "mysql") {
    // MySQL's tables (and the columns SQLite adds with ALTER TABLE) all live
    // in one idempotent file; only the default rows still need inserting.
    await database.execScript(fs.readFileSync(path.join(BASE_DIR, "db", "mysql", "schema.sql"), "utf8"));
    await seedNotificationTemplates();
    return;
  }
  await ensureUsersTable();
  await ensurePasswordResetsTable();
  await ensureRbacTables();
  await ensureCompanyDeletionTables();
  await ensureContractorTables();
  await ensureTemplateTables();
  await ensureSchedulingTables();
  await ensureProjectTables();
  await ensureMessagingTables();
  await ensureNotificationTables();
}

export * from "./users.js";
export * from "./passwordResets.js";
