/**
 * Language state shared by React and plain modules.
 *
 * Components use `useLanguage().t` so they re-render when the language
 * changes. Code that runs outside a component (API client, helpers in lib/,
 * toast text built in plain functions) uses `tr()` and `dateLocale()` here,
 * which read the same current language.
 */
import { es as dateFnsEs } from "date-fns/locale";
import { Language, getTranslation } from "./translations";

const STORAGE_KEY = "ssaa-language";

function readStored(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "es") return stored;
  } catch {
    /* storage blocked: fall back to English */
  }
  return "en";
}

let current: Language = typeof window === "undefined" ? "en" : readStored();
const listeners = new Set<(lang: Language) => void>();

export function getLanguage(): Language {
  return current;
}

export function setLanguage(lang: Language): void {
  if (lang === current) return;
  current = lang;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  listeners.forEach((fn) => fn(lang));
}

export function onLanguageChange(fn: (lang: Language) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "es";
}

export type Replacements = Record<string, string | number | null | undefined>;

/** Translate outside React. Inside components prefer `useLanguage().t`. */
export function tr(key: string, replacements?: Replacements): string {
  return getTranslation(key, current, replacements);
}

/** BCP-47 locale for dates and numbers. Spanish uses Mexican formats. */
export function dateLocale(lang: Language = current): string {
  return lang === "es" ? "es-MX" : "en-US";
}

if (typeof document !== "undefined") document.documentElement.lang = current;


/** date-fns locale option for the current language (undefined = English). */
export function dateFnsLocale(lang: Language = current) {
  return lang === "es" ? dateFnsEs : undefined;
}

/** Formats a date with Intl in the current language. */
export function formatDate(d: Date, options: Intl.DateTimeFormatOptions): string {
  return d.toLocaleDateString(dateLocale(), options);
}

/** "9:51 PM" / "9:51 p.m." */
export function formatTime(d: Date): string {
  return d.toLocaleTimeString(dateLocale(), { hour: "numeric", minute: "2-digit" });
}

/** "AM"/"PM" in English, "a.m."/"p.m." in Spanish (Mexico). */
export function dayPeriod(p: "am" | "pm"): string {
  if (current === "es") return p === "am" ? "a.m." : "p.m.";
  return p === "am" ? "AM" : "PM";
}
