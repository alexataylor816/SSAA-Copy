const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatMonthLabel(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

/** Returns a 6-week (42 day) grid starting on the Sunday on/before the 1st of the month. */
export function getMonthGrid(monthDate: Date): Date[] {
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function isToday(date: Date): boolean {
  return toDateKey(date) === toDateKey(new Date());
}

/**
 * Matches the backend's getHistoricalLockDate (backend/src/scheduling/historicalLock.ts):
 * the most recent Monday at 1:00 AM. Dates before that Monday are locked.
 */
export function getHistoricalLockDate(now = new Date()): Date {
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - diff);
  thisMonday.setHours(1, 0, 0, 0);
  if (now < thisMonday) {
    thisMonday.setDate(thisMonday.getDate() - 7);
  }
  thisMonday.setHours(0, 0, 0, 0);
  return thisMonday;
}

export function isDateLocked(date: Date, now = new Date()): boolean {
  return date < getHistoricalLockDate(now);
}

/**
 * Parses a YYYY-MM-DD key into a local-midnight Date.
 *
 * `new Date('2026-11-02')` parses as UTC midnight, which lands on the previous
 * day for anyone west of Greenwich — that bug is invisible in UTC CI and shows
 * up as tasks shifted one day early in California. Building from parts keeps
 * the value in local time, matching toDateKey's round trip.
 */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(date: Date, delta: number): Date {
  const next = new Date(date);
  next.setDate(date.getDate() + delta);
  return next;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatWeekdayShort(date: Date): string {
  return WEEKDAY_SHORT[date.getDay()];
}
