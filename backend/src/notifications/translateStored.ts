/**
 * Spanish for notifications saved before each one was kept in both languages. The stored English text
 * is matched against the event's standard English wording to recover the names, dates and counts, which
 * are then put into the Spanish wording. Text an operator customised, or anything that doesn't match,
 * is left as it was.
 */
import { say } from "../i18n/index.js";
import { ENGLISH_PUSH, SPANISH_TEMPLATES } from "./templates.js";

const WEEKDAYS: Record<string, string> = { Sun: "dom", Mon: "lun", Tue: "mar", Wed: "mié", Thu: "jue", Fri: "vie", Sat: "sáb" };
const MONTHS: Record<string, string> = {
  Jan: "ene", Feb: "feb", Mar: "mar", Apr: "abr", May: "may", Jun: "jun", Jul: "jul", Aug: "ago", Sep: "sept", Oct: "oct", Nov: "nov", Dec: "dic",
};

/** Dates, times, counts and fallback words inside a value, from English to Spanish. */
function valueToSpanish(value: string): string {
  const exact = say(value, undefined, "es");
  if (exact !== value) return exact;
  return value
    .replace(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})\b/g, (_m, wd: string, mo: string, d: string) => `${WEEKDAYS[wd]}, ${d} ${MONTHS[mo]}`)
    .replace(/\b(\d{1,2}:\d{2}) (AM|PM)\b/g, (_m, t: string, p: string) => `${t} ${p === "AM" ? "a.m." : "p.m."}`)
    .replace(/^1 person$/, "1 persona")
    .replace(/^(\d+) people$/, "$1 personas")
    .replace(/^1 change$/, "1 cambio")
    .replace(/^(\d+) changes$/, "$1 cambios")
    .replace(/^Reason: /, "Motivo: ");
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "{a} did {b}." → a regex that captures a and b, tolerant of empty placeholders and trimmed spaces. */
function matcher(template: string): { re: RegExp; names: string[] } {
  const names: string[] = [];
  const source = template
    .replace(/\s+/g, " ")
    .trim()
    .split(/(\s*\{\w+\})/)
    .map((part) => {
      const m = part.match(/^(\s*)\{(\w+)\}$/);
      if (!m) return escape(part);
      names.push(m[2]);
      return m[1] ? "(?:\\s+(.*?))?" : "(.*?)";
    })
    .join("");
  return { re: new RegExp(`^${source}$`, "s"), names };
}

const MATCHERS = Object.fromEntries(Object.entries(ENGLISH_PUSH).map(([event, t]) => [event, matcher(t.body)]));

export function translateStoredNotification(
  eventType: string,
  title: string,
  body: string | null,
): { title: string; body: string | null } | null {
  const en = ENGLISH_PUSH[eventType];
  const es = SPANISH_TEMPLATES[eventType]?.push;
  if (!en || !es) return null;
  const outTitle = title === en.title ? es.title : title;
  if (!body) return { title: outTitle, body };
  const m = MATCHERS[eventType];
  const hit = body.replace(/\s+/g, " ").trim().match(m.re);
  if (!hit) return { title: outTitle, body };
  const vars = Object.fromEntries(m.names.map((n, i) => [n, valueToSpanish(hit[i + 1] ?? "")]));
  const outBody = es.body.replace(/\{(\w+)\}/g, (_x, n: string) => vars[n] ?? "").replace(/\s+/g, " ").trim();
  return { title: outTitle, body: outBody };
}
