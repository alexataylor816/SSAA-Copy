import crypto from "node:crypto";
import { db } from "../db.js";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  companyId: string | null;
  isAdmin: boolean;
  createdAt: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  company_id: string | null;
  is_admin: 0 | 1;
  created_at: string;
}

export function ensureUsersTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      company_id TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Additive column migrations for databases created before these existed.
  const columns = new Set(
    (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!columns.has("company_id")) {
    db.exec("ALTER TABLE users ADD COLUMN company_id TEXT");
  }
  if (!columns.has("is_admin")) {
    db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
  }
}

export function findUserByEmail(email: string): User | undefined {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) as
    | UserRow
    | undefined;
  return row ? mapRow(row) : undefined;
}

export function findUserById(id: string): User | undefined {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? mapRow(row) : undefined;
}

export function createUser(params: { email: string; passwordHash: string; fullName: string }): User {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)").run(
    id,
    params.email.toLowerCase(),
    params.passwordHash,
    params.fullName,
  );
  return findUserById(id)!;
}

export function updateUserPassword(userId: string, passwordHash: string) {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
}

export function setUserCompany(userId: string, companyId: string | null) {
  db.prepare("UPDATE users SET company_id = ? WHERE id = ?").run(companyId, userId);
}

export function setUserIsAdmin(userId: string, isAdmin: boolean) {
  db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(isAdmin ? 1 : 0, userId);
}

function mapRow(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    fullName: row.full_name,
    companyId: row.company_id,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
  };
}
