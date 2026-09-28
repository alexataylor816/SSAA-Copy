import crypto from "node:crypto";
import { db } from "../db.js";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  createdAt: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  created_at: string;
}

export function ensureUsersTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
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

function mapRow(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    fullName: row.full_name,
    createdAt: row.created_at,
  };
}
