/**
 * Where a card may land (docs/WEEKLY_VIEW_REBUILD.md, O3). Mirrors the server's batch rules so a bad drop
 * snaps back with the reason straight away instead of failing at Publish; the server still has the
 * final say. Dropping someone on a project they aren't assigned to is allowed (it's outlined in red and
 * asked about at Publish), so that is not checked here.
 */
import { buildModel, draftId, type Draft, type FreeSlot, type Placement } from "./useMatrixDrafts";
import type { MatrixData } from "@/lib/matrixApi";
import { dateLocale, tr } from "@/i18n/runtime";

export type DragSource =
  | { kind: "side"; slot: FreeSlot }
  | { kind: "card"; placement: Placement }
  | { kind: "copy"; employeeId: string; start: string | null; end: string | null };

export interface DropTarget {
  projectId: string;
  date: string;
}

/** ok: the new draft list. Not ok: why (null = nothing to do, e.g. dropped where it already is). */
export type DropResult = { ok: true; drafts: Draft[]; reason?: undefined } | { ok: false; reason: string | null; drafts?: undefined };

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Same rule as the server's historical lock: anything before this week's Monday. */
export function isLockedDate(date: string, now = new Date()): boolean {
  const monday = new Date(now);
  monday.setDate(now.getDate() - (now.getDay() === 0 ? 6 : now.getDay() - 1));
  return date < iso(monday);
}

export const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(dateLocale(), { weekday: "short", month: "short", day: "numeric" });

/** "07:00" -> "7a", "15:30" -> "3:30p". */
export function shortTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const hh = h % 12 || 12;
  return `${hh}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 || h === 24 ? "a" : "p"}`;
}

const firstName = (name: string) => name.split(" ")[0] || name;

const employeeOf = (source: DragSource) =>
  source.kind === "side" ? source.slot.employeeId : source.kind === "card" ? source.placement.employeeId : source.employeeId;

export function applyDrop(data: MatrixData, drafts: Draft[], source: DragSource, target: DropTarget): DropResult {
  const model = buildModel(data, drafts);
  const emp = model.employees.get(employeeOf(source));
  const projectName = model.projectNames.get(target.projectId) ?? "that project";
  if (!emp) return { ok: false, reason: tr("canDrop.thatPersonIsnTOnA") };

  if (isLockedDate(target.date) || (source.kind === "card" && isLockedDate(source.placement.date))) {
    return { ok: false, reason: tr("canDrop.thatWeekIsLocked") };
  }
  if (!data.viewer.canSchedule) return { ok: false, reason: tr("canDrop.youDonTHavePermissionTo") };
  if (data.viewer.companyType === "sub" && emp.subCompanyId !== data.viewer.companyId) {
    return { ok: false, reason: tr("canDrop.youCanOnlyPlaceYourOwn") };
  }
  const crew = data.crews.find((c) => c.companyId === emp.subCompanyId);
  if (!crew?.projectIds.includes(target.projectId)) {
    return { ok: false, reason: tr("canDrop.isnTConnectedTo", { companyName: emp.companyName, projectName: projectName }) };
  }

  const card = source.kind === "card" ? source.placement : null;
  if (card && card.projectId === target.projectId && card.date === target.date) return { ok: false, reason: null };

  // Moving a booked card back to where it was booked: just undo the take-off.
  const undo = drafts.find((d) => {
    if (d.kind !== "remove" || d.employeeId !== emp.id) return false;
    const b = data.bookings.find((x) => x.requestId === d.requestId);
    return !!b && b.projectId === target.projectId && b.date === target.date;
  });
  if (undo) {
    const rest = drafts.filter((d) => d.id !== undo.id && d.id !== card?.draftId);
    return { ok: true, drafts: rest };
  }

  const posted = model
    .availabilityOn(emp.id, target.date)
    .filter((a) => a.allProjects || !a.projectId || a.projectId === target.projectId);
  if (posted.length === 0) {
    return { ok: false, reason: tr("canDrop.hasNoHoursPostedOn", { name: firstName(emp.name), date: dayLabel(target.date) }) };
  }
  const usable = new Set(posted.map((a) => a.id));
  const free = model
    .freeSlots(emp.id, target.date, card ? { requestId: card.requestId, draftId: card.draftId } : undefined)
    .filter((s) => usable.has(s.availabilityId));

  // Keep the same times when they still fit (same day, or a pasted schedule); otherwise take the first free stretch.
  const wanted =
    source.kind === "side"
      ? source.slot.date === target.date
        ? { start: source.slot.start, end: source.slot.end }
        : null
      : source.kind === "card"
        ? card!.start && card!.end
          ? { start: card!.start, end: card!.end }
          : null
        : source.start && source.end
          ? { start: source.start, end: source.end }
          : null;
  const fits = wanted && free.find((s) => s.start <= wanted.start && wanted.end <= s.end);
  const sameStop = source.kind === "side" ? free.find((s) => s.stopLabel === source.slot.stopLabel) : undefined;
  const slot = fits ? { ...fits, ...wanted } : (sameStop ?? free[0]);

  if (!slot) {
    const window = { start: posted[0].startTime, end: posted[posted.length - 1].endTime };
    const blocker = model
      .holdsOn(emp.id, target.date)
      .find((h) => h.draftId !== card?.draftId && h.requestId !== card?.requestId && h.span.start < window.end && window.start < h.span.end);
    const when = blocker ? `${shortTime(blocker.span.start)}–${shortTime(blocker.span.end)}` : "";
    return {
      ok: false,
      reason: blocker
        ? tr("canDrop.isAlready", { name: firstName(emp.name), status: tr(blocker.status === "confirmed" ? "canDrop.statusBooked" : blocker.status === "draft" ? "canDrop.statusPlaced" : "canDrop.statusRequested"), when, where: blocker.where })
        : tr("canDrop.hasNoFreeTimeLeftOn", { name: firstName(emp.name), date: dayLabel(target.date) }),
    };
  }

  // Already on this project at that time (e.g. dropped twice): nothing to do. A second, separate stretch
  // the same day is fine, like Luke's multiple stops.
  const sameTime = (model.byCell.get(`${target.projectId}|${target.date}`) ?? []).some(
    (p) => p.employeeId === emp.id && p.key !== card?.key && (p.start ?? "00:00") < slot.end && slot.start < (p.end ?? "24:00"),
  );
  if (sameTime) return { ok: false, reason: null };

  let next = drafts;
  if (card?.draftId) next = next.filter((d) => d.id !== card.draftId);
  else if (card?.requestId) next = [...next, { id: draftId(), kind: "remove", requestId: card.requestId, employeeId: emp.id }];
  next = [
    ...next,
    {
      id: draftId(),
      kind: "place",
      employeeId: emp.id,
      subCompanyId: emp.subCompanyId,
      projectId: target.projectId,
      date: target.date,
      start: slot.start,
      end: slot.end,
      stopLabel: slot.stopLabel,
    },
  ];
  return { ok: true, drafts: next };
}

/** Take a card off the grid: a draft just goes away; a sent booking becomes a take-off draft. */
export function applyRemove(drafts: Draft[], placement: Placement): DropResult {
  if (isLockedDate(placement.date)) return { ok: false, reason: tr("canDrop.thatWeekIsLocked") };
  if (placement.draftId) return { ok: true, drafts: drafts.filter((d) => d.id !== placement.draftId) };
  if (!placement.requestId) return { ok: false, reason: null };
  return { ok: true, drafts: [...drafts, { id: draftId(), kind: "remove", requestId: placement.requestId, employeeId: placement.employeeId }] };
}
