import crypto from "node:crypto";
import { database, db } from "../db.js";

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

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const row = await database.get<UserRow>("SELECT * FROM users WHERE email = ?", [email.toLowerCase()]);
  return row ? mapRow(row) : undefined;
}

export async function findUserById(id: string): Promise<User | undefined> {
  const row = await database.get<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
  return row ? mapRow(row) : undefined;
}

export async function findUserByGoogleSub(sub: string): Promise<User | undefined> {
  const row = await database.get<UserRow>("SELECT * FROM users WHERE google_sub = ?", [sub]);
  return row ? mapRow(row) : undefined;
}

/** Links a Google subject to an account once; never overwrites an existing link. */
export async function linkGoogleSub(userId: string, sub: string) {
  await database.run("UPDATE users SET google_sub = ? WHERE id = ? AND google_sub IS NULL", [sub, userId]);
}

export async function createUser(params: { email: string; passwordHash: string; fullName: string }): Promise<User> {
  const id = crypto.randomUUID();
  await database.run("INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)", [
    id,
    params.email.toLowerCase(),
    params.passwordHash,
    params.fullName,
  ]);
  return (await findUserById(id))!;
}

export async function updateUserPassword(userId: string, passwordHash: string) {
  await database.run("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, userId]);
}

export async function updateUserProfile(
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
  await database.run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, values);
  return findUserById(userId);
}

export async function setUserCompany(userId: string, companyId: string | null) {
  await database.run("UPDATE users SET company_id = ? WHERE id = ?", [companyId, userId]);
}

export async function setUserIsAdmin(userId: string, isAdmin: boolean) {
  await database.run("UPDATE users SET is_admin = ? WHERE id = ?", [isAdmin ? 1 : 0, userId]);
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
