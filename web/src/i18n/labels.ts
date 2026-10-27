/**
 * Display names for values that are *stored* in English: request statuses,
 * trades and job titles. The database keeps the English value (other code
 * and the AI helper match on it); only what's shown on screen is translated.
 * Anything unknown, like a custom trade or a typed-in job title, is shown as
 * entered.
 */
import { getLanguage, tr } from "./runtime";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ""));

function lookup(prefix: string, value: string): string {
  const key = `${prefix}.${slug(value)}`;
  const text = tr(key);
  return text === key ? value : text;
}

/** pending / confirmed / rejected / cancelled → "Pendiente", … */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return lookup("status", status);
}

/** "Plumbing" → "Plomería". Custom trades are shown as typed. */
export function tradeLabel(trade: string | null | undefined): string {
  if (!trade) return "";
  if (getLanguage() === "en") return trade;
  return lookup("trade", trade);
}

/** "Foreman" → "Maestro de obra". Typed-in titles are shown as typed. */
export function jobTitleLabel(title: string | null | undefined): string {
  if (!title) return "";
  if (getLanguage() === "en") return title;
  return lookup("jobTitle", title);
}
