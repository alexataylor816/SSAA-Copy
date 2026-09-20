import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Returns the historical lock cutoff date.
 * The lock boundary is the most recent Monday at 1:00 AM.
 * Days BEFORE that Monday (Sun and earlier) are locked.
 * The Monday itself and the rest of the week remain unlocked.
 * 
 * Returns midnight of that Monday so calendar day comparisons work correctly:
 * a day is locked if day < lockDate (i.e. before Monday midnight).
 */
export function getHistoricalLockDate(): Date {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon...
  const diff = day === 0 ? 6 : day - 1; // days since last Monday
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - diff);
  thisMonday.setHours(1, 0, 0, 0); // 1:00 AM trigger

  // If we haven't reached 1AM on Monday yet, the previous week isn't locked yet
  // so go back one more week
  if (now < thisMonday) {
    thisMonday.setDate(thisMonday.getDate() - 7);
  }

  // Return midnight of this Monday so that isBefore(day, lockDate)
  // locks Sun and earlier, but NOT Monday itself
  thisMonday.setHours(0, 0, 0, 0);
  return thisMonday;
}
