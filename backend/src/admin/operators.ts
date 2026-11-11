/**
 * Operator levels and the audit log (Lovable's Manage SSAA → Operators).
 *
 * - owner          Luke (Lovable's "OMO"): everything, and the only one who adds, changes or removes operators.
 * - main_operator  full access to every operator tool.
 * - view_only      can look at everything (and "view as", read-only) but change nothing.
 *
 * While nobody is owner yet, main operators may manage operators, so a fresh install isn't locked out.
 * Every change an operator makes is written to `operator_audit_log`.
 */
import crypto from "node:crypto";
import type { Request } from "express";
import { database } from "../db.js";
import { ForbiddenError } from "../rbac/errors.js";
import { findUserById, type OperatorLevel, type User } from "../models/users.js";

export const OPERATOR_LEVELS: OperatorLevel[] = ["owner", "main_operator", "view_only"];

export async function ensureOperatorTables(): Promise<void> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS operator_audit_log (
      id TEXT PRIMARY KEY,
      operator_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_operator_audit_created ON operator_audit_log(created_at);
  `);
}

export type Need = "view" | "change" | "operators";

/** The signed-in operator, refused unless their level allows `need`. */
export async function requireOperator(req: Request, need: Need = "view"): Promise<User> {
  const user = await findUserById(req.userId!);
  if (!user?.isAdmin || user.suspendedAt) throw new ForbiddenError("Operator access required.");
  if (need === "view") return user;
  if (user.operatorLevel === "view_only") throw new ForbiddenError("Your operator access is view only.");
  if (need === "operators" && user.operatorLevel !== "owner" && (await ownerExists())) {
    throw new ForbiddenError("Only the owner can manage operators.");
  }
  return user;
}

export async function ownerExists(): Promise<boolean> {
  return !!(await database.get("SELECT id FROM users WHERE is_admin = 1 AND operator_level = 'owner' LIMIT 1"));
}

/** Never throws: the action already happened. */
export async function audit(
  operatorId: string,
  action: string,
  summary: string,
  target?: { type: string; id: string },
): Promise<void> {
  try {
    await database.run(
      "INSERT INTO operator_audit_log (id, operator_id, action, target_type, target_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), operatorId, action, target?.type ?? null, target?.id ?? null, summary.slice(0, 500), new Date().toISOString()],
    );
  } catch (err) {
    console.error(`Couldn't write "${action}" to the operator audit log:`, err);
  }
}

export interface AuditEntry {
  id: string;
  operatorId: string;
  operatorName: string | null;
  operatorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
  createdAt: string;
}

export async function listAudit(filter: { targetId?: string; limit?: number } = {}): Promise<AuditEntry[]> {
  const limit = Math.min(Math.max(Number(filter.limit) || 200, 1), 500);
  const rows = await database.all<{
    id: string;
    operator_id: string;
    full_name: string | null;
    email: string | null;
    action: string;
    target_type: string | null;
    target_id: string | null;
    summary: string;
    created_at: string;
  }>(
    `SELECT a.*, u.full_name, u.email FROM operator_audit_log a LEFT JOIN users u ON u.id = a.operator_id
      ${filter.targetId ? "WHERE a.target_id = ?" : ""}
      ORDER BY a.created_at DESC LIMIT ${limit}`,
    filter.targetId ? [filter.targetId] : [],
  );
  return rows.map((r) => ({
    id: r.id,
    operatorId: r.operator_id,
    operatorName: r.full_name,
    operatorEmail: r.email,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    summary: r.summary,
    createdAt: r.created_at,
  }));
}
