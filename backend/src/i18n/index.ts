/**
 * English/Spanish on the server.
 *
 * - The web app sends Accept-Language on every request; `languageMiddleware` remembers it for the
 *   rest of that request, and the error handler translates the `error` text it sends back.
 * - Messages built from pieces (names, dates, times) call `say()` so the whole sentence is in one
 *   language.
 * - Notifications and emails go out in the *recipient's* language (users.language), passed explicitly.
 *
 * English is the default everywhere: a request without the header (tests, scripts, older clients)
 * gets exactly the text it always did.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { ES } from "./es.js";

export type Lang = "en" | "es";

const store = new AsyncLocalStorage<{ lang: Lang; explicit: boolean }>();

/** "es", "es-MX", "es-MX,es;q=0.9,en;q=0.8" → "es"; anything else → "en". */
export function parseLang(value: unknown): Lang {
  if (typeof value !== "string") return "en";
  return /^\s*es\b/i.test(value) ? "es" : "en";
}

/** A stored users.language value → Lang. */
export function asLang(value: unknown): Lang {
  return value === "es" ? "es" : "en";
}

export function languageMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers["accept-language"];
  store.run({ lang: parseLang(header), explicit: typeof header === "string" && header.trim() !== "" }, next);
}

/** The language the request asked for, or null when it didn't say (no Accept-Language header). */
export function requestedLang(): Lang | null {
  const s = store.getStore();
  return s?.explicit ? s.lang : null;
}

/** The language of the request being handled ("en" outside a request). */
export function requestLang(): Lang {
  return store.getStore()?.lang ?? "en";
}

type Vars = Record<string, string | number | null | undefined>;

const fill = (text: string, vars?: Vars) =>
  vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? "") : m)) : text;

/**
 * `say("{name} has no hours posted on {day}.", { name, day })` — the English text is the key.
 * Uses the request's language unless one is given.
 */
export function say(english: string, vars?: Vars, lang: Lang = requestLang()): string {
  const text = lang === "es" ? (ES[english] ?? english) : english;
  return fill(text, vars);
}

/** Exact English messages → Spanish, plus the ones with {placeholders}. Built once. */
const PATTERNS: { re: RegExp; es: string; names: string[] }[] = Object.entries(ES)
  // whole sentences only, so a short fragment like "on {project}" can't match an unrelated error
  .filter(([en]) => /\{\w+\}/.test(en) && /[.?!]$/.test(en))
  .map(([en, es]) => {
    const names: string[] = [];
    const source = en
      .split(/(\{\w+\})/)
      .map((part) => {
        const m = part.match(/^\{(\w+)\}$/);
        if (m) {
          names.push(m[1]);
          return "(.+?)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    return { re: new RegExp(`^${source}$`), es, names };
  });

/**
 * Translates a finished English message (an error thrown somewhere in the code) when the request is
 * in Spanish. Unknown text is returned unchanged.
 */
export function translateMessage(message: string, lang: Lang = requestLang()): string {
  if (lang !== "es") return message;
  const exact = ES[message];
  if (exact) return exact;
  for (const p of PATTERNS) {
    const m = message.match(p.re);
    if (m) return fill(p.es, Object.fromEntries(p.names.map((n, i) => [n, m[i + 1]])));
  }
  return message;
}

/** "2026-10-23" → "Fri, Oct 23" / "vie, 23 oct" */
export function dayLabel(iso: string, lang: Lang = requestLang()): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** "07:00" → "7:00 AM" / "7:00 a.m." */
export function clockLabel(hhmm: string, lang: Lang = requestLang()): string {
  const [h, m] = hhmm.split(":").map(Number);
  const mm = String(m).padStart(2, "0");
  if (lang === "es") return `${h % 12 || 12}:${mm} ${h < 12 ? "a.m." : "p.m."}`;
  return `${h % 12 || 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
}
