import crypto from "node:crypto";
import { db } from "../db.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "./errors.js";
import { findCompanyById } from "./models.js";
import { deleteProjectAndChildren } from "../scheduling/models.js";
import { findUserById } from "../models/users.js";
import { isAccountHolder } from "./permissions.js";
import { findUserRole } from "./models.js";

/**
 * Company deletion requests (the ManageCompanyModal danger zone, request
 * side only). Approval lives behind the admin UI (Phase 5c) — until then
 * requests pile up as `pending`, which is honest: nothing here deletes.
 *
 * Kept in its own module rather than models.ts/service.ts so the other
 * agent's in-flight edits there are never in the way.
 */

export interface CompanyDeletionRequest {
  id: string;
  companyId: string;
  requestedBy: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  updatedAt: string;
}

interface CompanyDeletionRequestRow {
  id: string;
  company_id: string;
  requested_by: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
}

export function ensureCompanyDeletionTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_deletion_requests (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      requested_by TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function mapRow(row: CompanyDeletionRequestRow): CompanyDeletionRequest {
  return {
    id: row.id,
    companyId: row.company_id,
    requestedBy: row.requested_by,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Holder (or admin) files a deletion request; one pending request at a time. */
export function requestCompanyDeletion(
  companyId: string,
  actorUserId: string,
  reason?: string,
): CompanyDeletionRequest {
  const company = findCompanyById(companyId);
  if (!company) throw new NotFoundError("Company not found.");
  const actorUser = findUserById(actorUserId);
  if (!actorUser) throw new NotFoundError("User not found.");

  const role = findUserRole(actorUserId, companyId);
  const holder =
    actorUser.isAdmin ||
    (role !== undefined &&
      isAccountHolder({ permissionLevel: role.permissionLevel, isCompanyCreator: role.isCompanyCreator }));
  if (!holder) {
    throw new ForbiddenError("Only the account holder or an admin can request company deletion.");
  }

  const existing = db
    .prepare("SELECT * FROM company_deletion_requests WHERE company_id = ? AND status = 'pending'")
    .get(companyId) as CompanyDeletionRequestRow | undefined;
  if (existing) {
    throw new ConflictError("A deletion request is already pending for this company.");
  }

  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (trimmed.length > 500) {
    throw new BadRequestError("Reason must be 500 characters or fewer.");
  }

  const id = crypto.randomUUID();
  db.prepare("INSERT INTO company_deletion_requests (id, company_id, requested_by, reason) VALUES (?, ?, ?, ?)").run(
    id,
    companyId,
    actorUserId,
    trimmed || null,
  );
  return findCompanyDeletionRequest(id)!;
}

export function findCompanyDeletionRequest(id: string): CompanyDeletionRequest | undefined {
  const row = db.prepare("SELECT * FROM company_deletion_requests WHERE id = ?").get(id) as
    | CompanyDeletionRequestRow
    | undefined;
  return row ? mapRow(row) : undefined;
}

/** Pending request for a company, if any — so the UI can show state instead of a dead button. */
export function findPendingCompanyDeletion(companyId: string): CompanyDeletionRequest | undefined {
  const row = db
    .prepare("SELECT * FROM company_deletion_requests WHERE company_id = ? AND status = 'pending'")
    .get(companyId) as CompanyDeletionRequestRow | undefined;
  return row ? mapRow(row) : undefined;
}

/** Same, but only visible to members of that company (or admins). */
export function getPendingCompanyDeletion(companyId: string, requesterUserId: string): CompanyDeletionRequest | null {
  const requester = findUserById(requesterUserId);
  if (!requester) throw new NotFoundError("User not found.");
  if (!requester.isAdmin) {
    const role = findUserRole(requesterUserId, companyId);
    if (!role) {
      throw new ForbiddenError("You are not a member of this company.");
    }
  }
  return findPendingCompanyDeletion(companyId) ?? null;
}

/** Every pending request, for the admin queue. */
export function listPendingCompanyDeletions(): (CompanyDeletionRequest & { companyName: string | null })[] {  const rows = db
    .prepare(
      `SELECT d.*, c.name AS company_name FROM company_deletion_requests d
       LEFT JOIN companies c ON c.id = d.company_id
       WHERE d.status = 'pending' ORDER BY d.created_at`,
    )
    .all() as (CompanyDeletionRequestRow & { company_name: string | null })[];
  return rows.map((r) => ({ ...mapRow(r), companyName: r.company_name }));
}

/** Admin resolution from the queue: approve executes the full deletion, reject just closes the request. */
export function resolveCompanyDeletion(requestId: string, approve: boolean): void {
  const row = db.prepare("SELECT * FROM company_deletion_requests WHERE id = ?").get(requestId) as
    | CompanyDeletionRequestRow
    | undefined;
  if (!row) throw new NotFoundError("Deletion request not found.");
  if (row.status !== "pending") {
    throw new ConflictError("This request has already been handled.");
  }
  if (!approve) {
    db.prepare("UPDATE company_deletion_requests SET status = 'rejected', updated_at = datetime('now') WHERE id = ?").run(
      requestId,
    );
    return;
  }
  executeCompanyDeletion(row.company_id);
}

/**
 * Execute an approved deletion: every owned project goes through the same
 * child-clearing path as project deletion, then roster, roles, requests,
 * contractor links, member logins are detached, and the company row goes.
 * Members keep their logins; they just belong nowhere afterwards.
 */
export function executeCompanyDeletion(companyId: string): void {
  const company = findCompanyById(companyId);
  if (!company) throw new NotFoundError("Company not found.");

  const projectIds = (
    db.prepare("SELECT id FROM projects WHERE company_id = ?").all(companyId) as { id: string }[]
  ).map((r) => r.id);

  db.transaction(() => {
    for (const pid of projectIds) deleteProjectAndChildren(pid);
    db.prepare("DELETE FROM contractor_connection_projects WHERE main_company_id = ? OR sub_company_id = ?").run(
      companyId,
      companyId,
    );
    db.prepare(
      "DELETE FROM contractor_connections WHERE company_a_id = ? OR company_b_id = ?",
    ).run(companyId, companyId);
    db.prepare("DELETE FROM employees WHERE company_id = ?").run(companyId);
    db.prepare("DELETE FROM user_roles WHERE company_id = ?").run(companyId);
    db.prepare("DELETE FROM user_project_assignments WHERE company_id = ?").run(companyId);
    db.prepare("DELETE FROM employee_project_assignments WHERE company_id = ?").run(companyId);
    db.prepare("DELETE FROM company_join_requests WHERE company_id = ?").run(companyId);
    db.prepare("DELETE FROM project_connections WHERE project_id NOT IN (SELECT id FROM projects)").run();
    db.prepare("UPDATE users SET company_id = NULL WHERE company_id = ?").run(companyId);
    db.prepare("UPDATE company_deletion_requests SET status = 'approved', updated_at = datetime('now') WHERE company_id = ? AND status = 'pending'").run(
      companyId,
    );
    db.prepare("DELETE FROM companies WHERE id = ?").run(companyId);
  })();
}
