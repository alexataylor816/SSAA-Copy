/**
 * Free time = posted availability minus what's already requested or booked.
 * Times are "HH:MM" strings, which compare correctly as text. A request with
 * no times holds the whole day (same rule as the server's double-booking guard).
 */
export interface TimeWindow {
  start: string;
  end: string;
}

export const DAY_START = "00:00";
export const DAY_END = "24:00";

export function windowOf(startTime: string | null | undefined, endTime: string | null | undefined): TimeWindow {
  return { start: startTime || DAY_START, end: endTime || DAY_END };
}

export const overlapsWindow = (a: TimeWindow, b: TimeWindow) => a.start < b.end && b.start < a.end;

/** The part of `taken` that falls inside `base`, or null. */
export function clip(taken: TimeWindow, base: TimeWindow): TimeWindow | null {
  const start = taken.start > base.start ? taken.start : base.start;
  const end = taken.end < base.end ? taken.end : base.end;
  return start < end ? { start, end } : null;
}

/** What's left of `base` after removing every window in `taken`, in order. */
export function freeWindows(base: TimeWindow, taken: TimeWindow[]): TimeWindow[] {
  const cuts = taken
    .map((t) => clip(t, base))
    .filter((t): t is TimeWindow => t !== null)
    .sort((a, b) => a.start.localeCompare(b.start));
  const free: TimeWindow[] = [];
  let cursor = base.start;
  for (const cut of cuts) {
    if (cut.start > cursor) free.push({ start: cursor, end: cut.start });
    if (cut.end > cursor) cursor = cut.end;
  }
  if (cursor < base.end) free.push({ start: cursor, end: base.end });
  return free;
}

/** "13:30" -> "1:30 PM" ("24:00" -> "12:00 AM"). */
export function fmtTime(value: string | null | undefined): string {
  if (!value) return "";
  const [h, m] = value.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 || h === 24 ? "AM" : "PM"}`;
}
