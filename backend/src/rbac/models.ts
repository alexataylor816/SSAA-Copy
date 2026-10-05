import crypto from "node:crypto";
import { db } from "../db.js";
import type { Company, CompanyType, Employee, JoinRequest, JoinRequestStatus, PermissionLevel, UserRole } from "./types.js";

interface CompanyRow {
  id: string;
  name: string;
  company_type: CompanyType;
  address: string | null;
  created_at: string;
  updated_at: string;
}

interface UserRoleRow {
  id: string;
  user_id: string;
  company_id: string;
  permission_level: PermissionLevel;
  is_company_creator: 0 | 1;
  created_at: string;
  updated_at: string;
}

interface JoinRequestRow {
  id: string;
  user_id: string;
  company_id: string;
  status: JoinRequestStatus;
  created_at: string;
  updated_at: string;
}

interface EmployeeRow {
  id: string;
  company_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  linked_user_id: string | null;
  created_at: string;
}

export function ensureRbacTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      company_type TEXT NOT NULL CHECK (company_type IN ('gc', 'sub')),
      address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_roles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      permission_level TEXT NOT NULL CHECK (permission_level IN ('basic', 'level_1', 'partial', 'full', 'account_holder')),
      is_company_creator INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, company_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS company_join_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      linked_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

// --- companies ---

export function createCompanyRow(params: { name: string; companyType: CompanyType; address?: string | null }): Company {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO companies (id, name, company_type, address) VALUES (?, ?, ?, ?)").run(
    id,
    params.name,
    params.companyType,
    params.address ?? null,
  );
  return findCompanyById(id)!;
}

export function findCompanyById(id: string): Company | undefined {
  const row = db.prepare("SELECT * FROM companies WHERE id = ?").get(id) as CompanyRow | undefined;
  return row ? mapCompanyRow(row) : undefined;
}

export function listCompanies(companyType?: CompanyType): Company[] {
  const rows = (
    companyType
      ? db.prepare("SELECT * FROM companies WHERE company_type = ? ORDER BY name").all(companyType)
      : db.prepare("SELECT * FROM companies ORDER BY name").all()
  ) as CompanyRow[];
  return rows.map(mapCompanyRow);
}

function mapCompanyRow(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    companyType: row.company_type,
    address: row.address,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- user_roles ---

export function createUserRole(params: {
  userId: string;
  companyId: string;
  permissionLevel: PermissionLevel;
  isCompanyCreator?: boolean;
}): UserRole {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO user_roles (id, user_id, company_id, permission_level, is_company_creator) VALUES (?, ?, ?, ?, ?)",
  ).run(id, params.userId, params.companyId, params.permissionLevel, params.isCompanyCreator ? 1 : 0);
  return findUserRole(params.userId, params.companyId)!;
}

export function findUserRole(userId: string, companyId: string): UserRole | undefined {
  const row = db.prepare("SELECT * FROM user_roles WHERE user_id = ? AND company_id = ?").get(userId, companyId) as
    | UserRoleRow
    | undefined;
  return row ? mapUserRoleRow(row) : undefined;
}

export function listCompanyRoles(companyId: string): UserRole[] {
  const rows = db.prepare("SELECT * FROM user_roles WHERE company_id = ?").all(companyId) as UserRoleRow[];
  return rows.map(mapUserRoleRow);
}

export function updateUserRolePermission(userId: string, companyId: string, permissionLevel: PermissionLevel) {
  db.prepare(
    "UPDATE user_roles SET permission_level = ?, updated_at = datetime('now') WHERE user_id = ? AND company_id = ?",
  ).run(permissionLevel, userId, companyId);
}

export function deleteUserRole(userId: string, companyId: string) {
  db.prepare("DELETE FROM user_roles WHERE user_id = ? AND company_id = ?").run(userId, companyId);
}

function mapUserRoleRow(row: UserRoleRow): UserRole {
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    permissionLevel: row.permission_level,
    isCompanyCreator: row.is_company_creator === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- company_join_requests ---

export function createJoinRequest(userId: string, companyId: string): JoinRequest {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO company_join_requests (id, user_id, company_id) VALUES (?, ?, ?)").run(
    id,
    userId,
    companyId,
  );
  return findJoinRequestById(id)!;
}

export function findJoinRequestById(id: string): JoinRequest | undefined {
  const row = db.prepare("SELECT * FROM company_join_requests WHERE id = ?").get(id) as JoinRequestRow | undefined;
  return row ? mapJoinRequestRow(row) : undefined;
}

export function findPendingJoinRequest(userId: string, companyId: string): JoinRequest | undefined {
  const row = db
    .prepare("SELECT * FROM company_join_requests WHERE user_id = ? AND company_id = ? AND status = 'pending'")
    .get(userId, companyId) as JoinRequestRow | undefined;
  return row ? mapJoinRequestRow(row) : undefined;
}

export function listPendingJoinRequests(companyId: string): JoinRequest[] {
  const rows = db
    .prepare("SELECT * FROM company_join_requests WHERE company_id = ? AND status = 'pending' ORDER BY created_at")
    .all(companyId) as JoinRequestRow[];
  return rows.map(mapJoinRequestRow);
}

export function setJoinRequestStatus(id: string, status: JoinRequestStatus) {
  db.prepare("UPDATE company_join_requests SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
    status,
    id,
  );
}

function mapJoinRequestRow(row: JoinRequestRow): JoinRequest {
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- employees ---

export function createEmployeeRow(params: {
  companyId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  linkedUserId?: string | null;
}): Employee {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO employees (id, company_id, name, email, phone, linked_user_id) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, params.companyId, params.name, params.email ?? null, params.phone ?? null, params.linkedUserId ?? null);
  const row = db.prepare("SELECT * FROM employees WHERE id = ?").get(id) as EmployeeRow;
  return mapEmployeeRow(row);
}

export function listCompanyEmployees(companyId: string): Employee[] {
  const rows = db.prepare("SELECT * FROM employees WHERE company_id = ? ORDER BY name").all(companyId) as EmployeeRow[];
  return rows.map(mapEmployeeRow);
}

export function findEmployeeByLinkedUser(companyId: string, userId: string): Employee | undefined {
  const row = db
    .prepare("SELECT * FROM employees WHERE company_id = ? AND linked_user_id = ?")
    .get(companyId, userId) as EmployeeRow | undefined;
  return row ? mapEmployeeRow(row) : undefined;
}

export function findEmployeeById(id: string): Employee | undefined {
  const row = db.prepare("SELECT * FROM employees WHERE id = ?").get(id) as EmployeeRow | undefined;
  return row ? mapEmployeeRow(row) : undefined;
}

function mapEmployeeRow(row: EmployeeRow): Employee {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    linkedUserId: row.linked_user_id,
    createdAt: row.created_at,
  };
}
