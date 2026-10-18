import crypto from "node:crypto";
import { database } from "../db.js";
import type { Company, CompanyType, Employee, JoinRequest, JoinRequestStatus, PermissionLevel, UserRole } from "./types.js";

interface CompanyRow {
  id: string;
  name: string;
  company_type: CompanyType;
  address: string | null;
  trade: string | null;
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
  job_title: string | null;
  employee_number: string | null;
  linked_user_id: string | null;
  created_at: string;
}

export async function ensureRbacTables(): Promise<void> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      company_type TEXT NOT NULL CHECK (company_type IN ('gc', 'sub')),
      address TEXT,
      trade TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await database.exec(`
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

  await database.exec(`
    CREATE TABLE IF NOT EXISTS company_join_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await database.exec(`
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

  // Additive columns for SQLite databases created before these existed.
  // PRAGMA is SQLite-only; MySQL gets them from the MySQL schema file.
  if (database.dialect === "sqlite") {
    const companyCols = new Set(
      (await database.all<{ name: string }>("PRAGMA table_info(companies)")).map((c) => c.name),
    );
    if (!companyCols.has("trade")) {
      await database.exec("ALTER TABLE companies ADD COLUMN trade TEXT");
    }

    const employeeColumns = await database.all<{ name: string }>("PRAGMA table_info(employees)");
    if (!employeeColumns.some((c) => c.name === "employee_number")) {
      await database.exec("ALTER TABLE employees ADD COLUMN employee_number TEXT");
    }
  }
}

/** Sets the HR/payroll ID on the employee record linked to this user; false when they have none. */
export async function setEmployeeNumberForUser(companyId: string, userId: string, value: string | null): Promise<boolean> {
  const result = await database.run(
    "UPDATE employees SET employee_number = ? WHERE company_id = ? AND linked_user_id = ?",
    [value, companyId, userId],
  );
  return result.changes > 0;
}

// --- companies ---

export async function createCompanyRow(params: { name: string; companyType: CompanyType; address?: string | null; trade?: string | null }): Promise<Company> {
  const id = crypto.randomUUID();
  await database.run("INSERT INTO companies (id, name, company_type, address, trade) VALUES (?, ?, ?, ?, ?)", [
    id,
    params.name,
    params.companyType,
    params.address ?? null,
    params.trade ?? null,
  ]);
  return (await findCompanyById(id))!;
}

export async function findCompanyById(id: string): Promise<Company | undefined> {
  const row = await database.get<CompanyRow>("SELECT * FROM companies WHERE id = ?", [id]);
  return row ? mapCompanyRow(row) : undefined;
}

/** What a stranger may learn about a company: enough to recognise it, nothing more (no address). */
export interface CompanySummary {
  id: string;
  name: string;
  companyType: CompanyType;
  trade: string | null;
}

export const COMPANY_SEARCH_MIN_LENGTH = 3;
const COMPANY_SEARCH_LIMIT = 8;

/**
 * Name search for people looking for a company to join or connect with. Only
 * ever a handful of matches for a typed name, so nobody can page through the
 * whole directory.
 */
export async function searchCompanies(
  query: string,
  options: { companyType?: CompanyType; excludeCompanyId?: string | null } = {},
): Promise<CompanySummary[]> {
  // `!` escapes LIKE wildcards the user types. Not a backslash: MySQL and SQLite read that differently.
  const pattern = `%${query.toLowerCase().replace(/[!%_]/g, "!$&")}%`;
  const where = ["LOWER(name) LIKE ? ESCAPE '!'"];
  const params: unknown[] = [pattern];
  if (options.companyType) {
    where.push("company_type = ?");
    params.push(options.companyType);
  }
  if (options.excludeCompanyId) {
    where.push("id <> ?");
    params.push(options.excludeCompanyId);
  }
  const rows = await database.all<CompanyRow>(
    `SELECT * FROM companies WHERE ${where.join(" AND ")} ORDER BY name LIMIT ${COMPANY_SEARCH_LIMIT}`,
    params,
  );
  return rows.map(toCompanySummary);
}

export function toCompanySummary(company: Pick<CompanyRow, "id" | "name" | "company_type" | "trade">): CompanySummary {
  return { id: company.id, name: company.name, companyType: company.company_type, trade: company.trade };
}

/** Every company, in full. Admin screens only; never expose this to ordinary users. */
export async function listCompanies(companyType?: CompanyType): Promise<Company[]> {
  const rows = companyType
    ? await database.all<CompanyRow>("SELECT * FROM companies WHERE company_type = ? ORDER BY name", [companyType])
    : await database.all<CompanyRow>("SELECT * FROM companies ORDER BY name");
  return rows.map(mapCompanyRow);
}

function mapCompanyRow(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    companyType: row.company_type,
    address: row.address,
    trade: row.trade,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- user_roles ---

export async function createUserRole(params: {
  userId: string;
  companyId: string;
  permissionLevel: PermissionLevel;
  isCompanyCreator?: boolean;
}): Promise<UserRole> {
  const id = crypto.randomUUID();
  await database.run(
    "INSERT INTO user_roles (id, user_id, company_id, permission_level, is_company_creator) VALUES (?, ?, ?, ?, ?)",
    [id, params.userId, params.companyId, params.permissionLevel, params.isCompanyCreator ? 1 : 0],
  );
  return (await findUserRole(params.userId, params.companyId))!;
}

export async function findUserRole(userId: string, companyId: string): Promise<UserRole | undefined> {
  const row = await database.get<UserRoleRow>("SELECT * FROM user_roles WHERE user_id = ? AND company_id = ?", [
    userId,
    companyId,
  ]);
  return row ? mapUserRoleRow(row) : undefined;
}

export async function listCompanyRoles(companyId: string): Promise<UserRole[]> {
  const rows = await database.all<UserRoleRow>("SELECT * FROM user_roles WHERE company_id = ?", [companyId]);
  return rows.map(mapUserRoleRow);
}

export async function updateUserRolePermission(userId: string, companyId: string, permissionLevel: PermissionLevel) {
  await database.run(
    "UPDATE user_roles SET permission_level = ?, updated_at = ? WHERE user_id = ? AND company_id = ?",
    [permissionLevel, database.now(), userId, companyId],
  );
}

export async function deleteUserRole(userId: string, companyId: string) {
  await database.run("DELETE FROM user_roles WHERE user_id = ? AND company_id = ?", [userId, companyId]);
}

export async function setRoleCompanyCreator(userId: string, companyId: string, isCreator: boolean) {
  await database.run(
    "UPDATE user_roles SET is_company_creator = ?, updated_at = ? WHERE user_id = ? AND company_id = ?",
    [isCreator ? 1 : 0, database.now(), userId, companyId],
  );
}

/** Detach a user's login from their roster rows without deleting the rows themselves. */
export async function unlinkUserEmployees(userId: string, companyId: string) {
  await database.run("UPDATE employees SET linked_user_id = NULL WHERE linked_user_id = ? AND company_id = ?", [
    userId,
    companyId,
  ]);
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

export async function createJoinRequest(userId: string, companyId: string): Promise<JoinRequest> {
  const id = crypto.randomUUID();
  await database.run("INSERT INTO company_join_requests (id, user_id, company_id) VALUES (?, ?, ?)", [
    id,
    userId,
    companyId,
  ]);
  return (await findJoinRequestById(id))!;
}

export async function findJoinRequestById(id: string): Promise<JoinRequest | undefined> {
  const row = await database.get<JoinRequestRow>("SELECT * FROM company_join_requests WHERE id = ?", [id]);
  return row ? mapJoinRequestRow(row) : undefined;
}

export async function findPendingJoinRequest(userId: string, companyId: string): Promise<JoinRequest | undefined> {
  const row = await database.get<JoinRequestRow>(
    "SELECT * FROM company_join_requests WHERE user_id = ? AND company_id = ? AND status = 'pending'",
    [userId, companyId],
  );
  return row ? mapJoinRequestRow(row) : undefined;
}

export async function listPendingJoinRequests(companyId: string): Promise<JoinRequest[]> {
  const rows = await database.all<JoinRequestRow>(
    "SELECT * FROM company_join_requests WHERE company_id = ? AND status = 'pending' ORDER BY created_at",
    [companyId],
  );
  return rows.map(mapJoinRequestRow);
}

export async function setJoinRequestStatus(id: string, status: JoinRequestStatus) {
  await database.run("UPDATE company_join_requests SET status = ?, updated_at = ? WHERE id = ?", [
    status,
    database.now(),
    id,
  ]);
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

export async function createEmployeeRow(params: {
  companyId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  linkedUserId?: string | null;
}): Promise<Employee> {
  const id = crypto.randomUUID();
  await database.run(
    "INSERT INTO employees (id, company_id, name, email, phone, linked_user_id) VALUES (?, ?, ?, ?, ?, ?)",
    [id, params.companyId, params.name, params.email ?? null, params.phone ?? null, params.linkedUserId ?? null],
  );
  const row = (await database.get<EmployeeRow>("SELECT * FROM employees WHERE id = ?", [id]))!;
  return mapEmployeeRow(row);
}

export async function listCompanyEmployees(companyId: string): Promise<Employee[]> {
  const rows = await database.all<EmployeeRow>("SELECT * FROM employees WHERE company_id = ? ORDER BY name", [companyId]);
  return rows.map(mapEmployeeRow);
}

export async function findEmployeeByLinkedUser(companyId: string, userId: string): Promise<Employee | undefined> {
  const row = await database.get<EmployeeRow>("SELECT * FROM employees WHERE company_id = ? AND linked_user_id = ?", [
    companyId,
    userId,
  ]);
  return row ? mapEmployeeRow(row) : undefined;
}

export async function findEmployeeById(id: string): Promise<Employee | undefined> {
  const row = await database.get<EmployeeRow>("SELECT * FROM employees WHERE id = ?", [id]);
  return row ? mapEmployeeRow(row) : undefined;
}

function mapEmployeeRow(row: EmployeeRow): Employee {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    jobTitle: row.job_title,
    employeeNumber: row.employee_number ?? null,
    linkedUserId: row.linked_user_id,
    createdAt: row.created_at,
  };
}
