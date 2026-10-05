/**
 * Ported from SSAA/src/lib/utils.ts's getHistoricalLockDate(): the lock
 * boundary is the most recent Monday at 1:00 AM. Dates before that Monday
 * are locked (read-only) so past schedules can't be silently rewritten.
 *
 * The original only enforced this in the UI (ScheduleModal.tsx) — admins
 * bypass it here too (mirroring the original's MOA bypass), but we also
 * enforce it server-side, since a frontend-only guard is trivially bypassed
 * by calling the API directly.
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

export function isDateLocked(dateStr: string, now = new Date()): boolean {
  const lockDate = getHistoricalLockDate(now);
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date < lockDate;
}
