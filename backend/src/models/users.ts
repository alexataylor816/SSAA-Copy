import crypto from "node:crypto";
import { db } from "../db.js";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  phone: string | null;
  language: string;
  profilePictureUrl: string | null;
  companyId: string | null;
  isAdmin: boolean;
  googleSub: string | null;
  createdAt: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  phone: string | null;
  language: string | null;
  profile_picture_url: string | null;
  company_id: string | null;
  is_admin: 0 | 1;
  google_sub: string | null;
  created_at: string;
}

export function ensureUsersTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      language TEXT NOT NULL DEFAULT 'en',
      profile_picture_url TEXT,
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
  if (!columns.has("google_sub")) {
    db.exec("ALTER TABLE users ADD COLUMN google_sub TEXT");
    // NULLs stay distinct in SQLite, so Googlers get deduplication while
    // password-only rows are untouched.
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub ON users(google_sub)");
  }
  if (!columns.has("phone")) {
    db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
  }
  if (!columns.has("language")) {
    db.exec("ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en'");
  }
  if (!columns.has("profile_picture_url")) {
    db.exec("ALTER TABLE users ADD COLUMN profile_picture_url TEXT");
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

export function findUserByGoogleSub(sub: string): User | undefined {
  const row = db.prepare("SELECT * FROM users WHERE google_sub = ?").get(sub) as
    | UserRow
    | undefined;
  return row ? mapRow(row) : undefined;
}

/** Links a Google subject to an account once; never overwrites an existing link. */
export function linkGoogleSub(userId: string, sub: string) {
  db.prepare("UPDATE users SET google_sub = ? WHERE id = ? AND google_sub IS NULL").run(sub, userId);
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

export function updateUserProfile(
  userId: string,
  updates: { fullName?: string; phone?: string | null; language?: string; profilePictureUrl?: string | null },
) {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.fullName !== undefined) {
    sets.push("full_name = ?");
    values.push(updates.fullName);
  }
  if (updates.phone !== undefined) {
    sets.push("phone = ?");
    values.push(updates.phone);
  }
  if (updates.language !== undefined) {
    sets.push("language = ?");
    values.push(updates.language);
  }
  if (updates.profilePictureUrl !== undefined) {
    sets.push("profile_picture_url = ?");
    values.push(updates.profilePictureUrl);
  }
  if (sets.length === 0) return findUserById(userId);
  values.push(userId);
  db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return findUserById(userId);
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
    phone: row.phone,
    language: row.language ?? "en",
    profilePictureUrl: row.profile_picture_url,
    companyId: row.company_id,
    isAdmin: row.is_admin === 1,
    googleSub: row.google_sub,
    createdAt: row.created_at,
  };
}
