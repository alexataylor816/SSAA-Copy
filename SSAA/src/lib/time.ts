/**
 * Format a time value into 12-hour clock format like "1:00 PM".
 * Accepts:
 *   - "HH:mm"    e.g. "13:00"
 *   - "HH:mm:ss" e.g. "13:00:00"
 *   - Date instance
 *   - ISO string with time portion
 */
export function formatTime12(input: string | Date | null | undefined): string {
  if (input == null || input === '') return '';

  let hours: number;
  let minutes: number;

  if (input instanceof Date) {
    hours = input.getHours();
    minutes = input.getMinutes();
  } else {
    const s = String(input).trim();
    // Pure HH:mm[:ss]
    const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
      hours = parseInt(m[1], 10);
      minutes = parseInt(m[2], 10);
    } else {
      // Try parse as Date (ISO etc.)
      const d = new Date(s);
      if (isNaN(d.getTime())) return s;
      hours = d.getHours();
      minutes = d.getMinutes();
    }
  }

  const period = hours >= 12 ? 'PM' : 'AM';
  let h12 = hours % 12;
  if (h12 === 0) h12 = 12;
  const mm = minutes.toString().padStart(2, '0');
  return `${h12}:${mm} ${period}`;
}

/** Format a UTC-stored ISO timestamp (availability rows) using getUTC* */
export function formatUTCTime12(iso: string | Date | null | undefined): string {
  if (iso == null || iso === '') return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  let hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  let h12 = hours % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

/** Format a range. Returns "5:00 AM – 1:00 PM" (en-dash). */
export function formatTimeRange12(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined
): string {
  const s = formatTime12(start);
  const e = formatTime12(end);
  if (!s && !e) return '';
  if (!e) return s;
  if (!s) return e;
  return `${s} – ${e}`;
}
