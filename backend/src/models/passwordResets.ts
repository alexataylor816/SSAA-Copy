import crypto from "node:crypto";
import { db } from "../db.js";

const CODE_TTL_MS = 15 * 60 * 1000;

interface PasswordResetRow {
  id: string;
  user_id: string;
  code_hash: string;
  expires_at: string;
  used_at: string | null;
}

export function ensurePasswordResetsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/** Generates a 6-digit reset code for the user, invalidating any earlier ones. */
export function createResetCode(userId: string): string {
  db.prepare("DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL").run(userId);

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  db.prepare(
    "INSERT INTO password_resets (id, user_id, code_hash, expires_at) VALUES (?, ?, ?, ?)",
  ).run(crypto.randomUUID(), userId, hashCode(code), expiresAt);

  return code;
}

/** Marks the matching, unexpired code as used and returns the user id, or null if invalid. */
export function consumeResetCode(userId: string, code: string): string | null {
  const row = db
    .prepare(
      "SELECT * FROM password_resets WHERE user_id = ? AND code_hash = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1",
    )
    .get(userId, hashCode(code)) as PasswordResetRow | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?").run(row.id);
  return row.user_id;
}
