/**
 * Platform-wide switches the operators control (Operator Dashboard → Manage SSAA). Stored as text so new
 * settings need no schema change. `key` is a reserved word in MySQL, so the column is `setting_key`.
 */
import { database } from "../db.js";

export async function ensurePlatformSettingsTables(): Promise<void> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      setting_key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT,
      updated_by TEXT
    )
  `);
}

export interface PlatformSettings {
  /** The "Traducir" button in Messages. On unless an operator turns it off. */
  messageTranslationEnabled: boolean;
}

const DEFAULTS: Record<string, string> = { message_translation_enabled: "true" };

async function read(key: string): Promise<string> {
  const row = await database.get<{ value: string | null }>("SELECT value FROM platform_settings WHERE setting_key = ?", [key]);
  return row?.value ?? DEFAULTS[key];
}

async function write(key: string, value: string, userId: string): Promise<void> {
  const now = new Date().toISOString();
  const exists = await database.get("SELECT setting_key FROM platform_settings WHERE setting_key = ?", [key]);
  if (exists) {
    await database.run("UPDATE platform_settings SET value = ?, updated_at = ?, updated_by = ? WHERE setting_key = ?", [value, now, userId, key]);
  } else {
    await database.run("INSERT INTO platform_settings (setting_key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)", [key, value, now, userId]);
  }
}

export async function messageTranslationEnabled(): Promise<boolean> {
  return (await read("message_translation_enabled")) !== "false";
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  return { messageTranslationEnabled: await messageTranslationEnabled() };
}

/** Applies the fields that were sent; returns what changed (for the audit log) and the new settings. */
export async function updatePlatformSettings(patch: Partial<PlatformSettings>, userId: string): Promise<{ changed: string[]; settings: PlatformSettings }> {
  const changed: string[] = [];
  if (typeof patch.messageTranslationEnabled === "boolean") {
    const before = await messageTranslationEnabled();
    await write("message_translation_enabled", String(patch.messageTranslationEnabled), userId);
    if (before !== patch.messageTranslationEnabled) changed.push(`Turned message translation ${patch.messageTranslationEnabled ? "on" : "off"}`);
  }
  return { changed, settings: await getPlatformSettings() };
}
