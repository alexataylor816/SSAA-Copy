import crypto from "node:crypto";
import { database, db } from "../db.js";

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
export async function createResetCode(userId: string): Promise<string> {
  await database.run("DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL", [userId]);

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  await database.run("INSERT INTO password_resets (id, user_id, code_hash, expires_at) VALUES (?, ?, ?, ?)", [
    crypto.randomUUID(),
    userId,
    hashCode(code),
    expiresAt,
  ]);

  return code;
}

/** Marks the matching, unexpired code as used and returns the user id, or null if invalid. */
export async function consumeResetCode(userId: string, code: string): Promise<string | null> {
  const row = await database.get<PasswordResetRow>(
    "SELECT * FROM password_resets WHERE user_id = ? AND code_hash = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [userId, hashCode(code)],
  );

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  await database.run("UPDATE password_resets SET used_at = ? WHERE id = ?", [database.now(), row.id]);
  return row.user_id;
}
