/** Small shared helpers for the Weekly view (kept out of component files so Fast Refresh works). */
import type { FreeSlot, Placement } from "./useMatrixDrafts";

/** Grid geometry: every day column and the sticky project column have fixed widths, so scroll maths is exact. */
export const DAY_COL = 148;
export const PROJECT_COL = 180;

export type Density = "full" | "compact" | "minimal";

/** Cards shrink as a cell fills, like Luke's: up to 3 full, up to 6 compact, then names only. */
export const densityFor = (count: number): Density => (count <= 3 ? "full" : count <= 6 ? "compact" : "minimal");

export const initialsOf = (name: string) => {
  const parts = name.split(" ").filter(Boolean);
  return (parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : name.slice(0, 2)).toUpperCase();
};

export const cardDragId = (p: Placement) => `card::${p.key}`;
export const slotDragId = (s: FreeSlot) => `slot::${s.employeeId}::${s.availabilityId}::${s.date}::${s.start}`;
