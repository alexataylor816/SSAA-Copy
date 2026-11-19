/**
 * Manage Correspondence → "Translate to Spanish". The operator's current English draft (saved or not) is
 * translated once through the server's Claude key and handed back to the editor; nothing is saved until the
 * operator clicks Save. No AI call ever happens when a message is sent.
 */
import { claudeConfigured, translateTemplate, type TemplateText } from "../ai/claude.js";
import { HttpError } from "../rbac/errors.js";

type Translator = (english: TemplateText) => Promise<TemplateText>;
let translator: Translator = translateTemplate;
let configured: () => boolean = claudeConfigured;

/** Tests swap in a fake so they never call the real API. */
export function setTemplateTranslatorForTests(fn: Translator | null): void {
  translator = fn ?? translateTemplate;
}
export function setTemplateTranslationConfiguredForTests(fn: (() => boolean) | null): void {
  configured = fn ?? claudeConfigured;
}
export const templateTranslationAvailable = (): boolean => configured();

const placeholders = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function translateTemplateDraft(draft: Record<string, unknown>): Promise<TemplateText & { missingPlaceholders: string[] }> {
  const english: TemplateText = {
    subject: str(draft.subject),
    bodyHtml: str(draft.bodyHtml),
    pushTitle: str(draft.pushTitle),
    pushBody: str(draft.pushBody),
  };
  if (!Object.values(english).some((v) => v.trim())) throw new HttpError(400, "There's no English text to translate.");
  if (english.bodyHtml.length > 50_000) throw new HttpError(400, "The email is too long to translate.");
  if (!configured()) throw new HttpError(503, "Translation isn't set up on this server yet.");

  let spanish: TemplateText;
  try {
    spanish = await translator(english);
  } catch (err) {
    console.error("Template translation failed:", err);
    throw new HttpError(502, "Couldn't translate the template. Try again in a moment.");
  }
  // An empty English field stays empty; the rest are trimmed.
  const out: TemplateText = {
    subject: english.subject.trim() ? str(spanish.subject).trim() : "",
    bodyHtml: english.bodyHtml.trim() ? str(spanish.bodyHtml).trim() : "",
    pushTitle: english.pushTitle.trim() ? str(spanish.pushTitle).trim() : "",
    pushBody: english.pushBody.trim() ? str(spanish.pushBody).trim() : "",
  };
  const want = placeholders(Object.values(english).join(" "));
  const have = placeholders(Object.values(out).join(" "));
  const missingPlaceholders = [...want].filter((p) => !have.has(p));
  return { ...out, missingPlaceholders };
}
