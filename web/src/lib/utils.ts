/**
 * Ported from SSAA/src/lib/utils.ts. Verbatim except for the header comment,
 * so shadcn components port across without edits.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Ported from SSAA/src/lib/utils.ts. The lock boundary is the most recent
 * Monday at 1:00 AM. Days BEFORE that Monday (Sunday and earlier) are locked;
 * Monday itself and the rest of the week remain editable.
 *
 * Returns midnight of that Monday so a plain `isBefore(day, lockDate)` locks
 * Sunday and earlier without also locking Monday.
 */
export function getHistoricalLockDate(): Date {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const diff = day === 0 ? 6 : day - 1; // days since the most recent Monday
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - diff);
  thisMonday.setHours(1, 0, 0, 0);

  // Before 1 AM on Monday the previous week isn't locked yet.
  if (now < thisMonday) {
    thisMonday.setDate(thisMonday.getDate() - 7);
  }

  thisMonday.setHours(0, 0, 0, 0);
  return thisMonday;
}