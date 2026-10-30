/**
 * The Translate button on chat messages: English ↔ Spanish through the server's Claude key (the browser
 * never sees it). Each message is translated once per language and kept, so re-opening a chat or a
 * second reader costs nothing. Only people who can read the conversation can translate its messages.
 */
import { database } from "../db.js";
import { claudeConfigured, translateChat } from "../ai/claude.js";
import { asLang, type Lang } from "../i18n/index.js";
import { findUserById } from "../models/users.js";
import { BadRequestError, HttpError, NotFoundError } from "../rbac/errors.js";
import { requireReadableConversation } from "./service.js";

export async function ensureMessageTranslationTables(): Promise<void> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS message_translations (
      message_id TEXT NOT NULL,
      lang TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (message_id, lang)
    )
  `);
}

type Translator = (text: string, to: Lang) => Promise<string>;
let translator: Translator = translateChat;
/** Tests swap in a fake so they don't call the real API. */
export function setTranslatorForTests(fn: Translator | null): void {
  translator = fn ?? translateChat;
}
let configured: () => boolean = claudeConfigured;
export function setTranslationConfiguredForTests(fn: (() => boolean) | null): void {
  configured = fn ?? claudeConfigured;
}

export function translationAvailable(): boolean {
  return configured();
}

export async function translateMessageFor(
  userId: string,
  messageId: string,
  toRaw: unknown,
): Promise<{ messageId: string; lang: Lang; body: string; cached: boolean }> {
  if (toRaw !== undefined && toRaw !== "en" && toRaw !== "es") throw new BadRequestError("to must be 'en' or 'es'.");
  const user = await findUserById(userId);
  if (!user) throw new NotFoundError("User not found.");
  const lang: Lang = toRaw === "en" || toRaw === "es" ? toRaw : asLang(user.language);

  const message = await database.get<{ id: string; conversation_id: string; body: string; kind: string }>(
    "SELECT id, conversation_id, body, kind FROM messages WHERE id = ?",
    [messageId],
  );
  if (!message) throw new NotFoundError("Message not found.");
  // Same rule as reading the chat: strangers get "not found", not a hint that it exists.
  await requireReadableConversation(message.conversation_id, userId);

  const saved = await database.get<{ body: string }>("SELECT body FROM message_translations WHERE message_id = ? AND lang = ?", [
    message.id,
    lang,
  ]);
  if (saved) return { messageId: message.id, lang, body: saved.body, cached: true };

  if (!configured()) throw new HttpError(503, "Translation isn't set up on this server yet.");
  let body: string;
  try {
    body = await translator(message.body, lang);
  } catch (err) {
    console.error("Message translation failed:", err);
    throw new HttpError(502, "Couldn't translate that message. Try again in a moment.");
  }
  if (!body) throw new HttpError(502, "Couldn't translate that message. Try again in a moment.");

  const insertIgnore = database.dialect === "mysql" ? "INSERT IGNORE" : "INSERT OR IGNORE";
  await database.run(`${insertIgnore} INTO message_translations (message_id, lang, body, created_at) VALUES (?, ?, ?, ?)`, [
    message.id,
    lang,
    body,
    database.now(),
  ]);
  return { messageId: message.id, lang, body, cached: false };
}
