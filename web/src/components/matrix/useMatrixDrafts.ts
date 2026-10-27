/**
 * The Weekly view's working state (docs/WEEKLY_VIEW_REBUILD.md, O2): unsent changes ("drafts") on top
 * of what the server says, and everything the grid and side panel show, derived from both.
 *
 * Ported from the draft logic in Luke's SSAA/src/features/scheduling/matrix/ResourceMatrix.tsx, reshaped
 * around our batch endpoint: a draft either places someone (a new request) or takes someone off an
 * existing request. Moving a card is "take off here" + "place there".
 */
import { useCallback, useState } from "react";
import { freeWindows, windowOf, type TimeWindow } from "@/lib/timeWindows";
import type { BatchBody, MatrixAvailability, MatrixData, MatrixEmployee } from "@/lib/matrixApi";

export type Draft =
  | {
      id: string;
      kind: "place";
      employeeId: string;
      subCompanyId: string;
      projectId: string;
      date: string;
      start: string;
      end: string;
      stopLabel: string | null;
    }
  | { id: string; kind: "remove"; requestId: string; employeeId: string };

export type PlaceDraft = Extract<Draft, { kind: "place" }>;
export type CardStatus = "confirmed" | "pending" | "draft";

/** One card in a project/day cell. */
export interface Placement {
  key: string;
  employeeId: string;
  subCompanyId: string;
  projectId: string;
  date: string;
  start: string | null;
  end: string | null;
  stopLabel: string | null;
  status: CardStatus;
  requestId?: string;
  draftId?: string;
  edited: boolean;
  assignedBySub: boolean;
  /** Sub view: a draft putting someone on a project they aren't assigned to (red outline). */
  unassigned: boolean;
}

export interface CrewMember extends MatrixEmployee {
  subCompanyId: string;
  companyName: string;
}

/** A free stretch of someone's posted hours that day: one draggable card in the side panel. */
export interface FreeSlot {
  employeeId: string;
  availabilityId: string;
  date: string;
  start: string;
  end: string;
  stopLabel: string | null;
}

export interface Hold {
  span: TimeWindow;
  where: string;
  status: CardStatus;
  /** What holds it, so moving a card can ignore its own old spot. */
  requestId?: string;
  draftId?: string;
}

export interface MatrixModel {
  employees: Map<string, CrewMember>;
  projectNames: Map<string, string>;
  placements: Placement[];
  byCell: Map<string, Placement[]>;
  availabilityOn: (employeeId: string, date: string) => MatrixAvailability[];
  holdsOn: (employeeId: string, date: string) => Hold[];
  freeSlots: (employeeId: string, date: string, ignore?: { requestId?: string; draftId?: string }) => FreeSlot[];
}

export const cellKey = (projectId: string, date: string) => `${projectId}|${date}`;

let nextId = 0;
export const draftId = () => `d${Date.now().toString(36)}${(nextId++).toString(36)}`;

/** Everything the screens show, from the server's data plus the unsent drafts. */
export function buildModel(data: MatrixData, drafts: Draft[]): MatrixModel {
  const employees = new Map<string, CrewMember>();
  for (const crew of data.crews) {
    for (const e of crew.employees) employees.set(e.id, { ...e, subCompanyId: crew.companyId, companyName: crew.companyName });
  }
  const projectNames = new Map(data.projects.map((p) => [p.id, p.name]));
  const isSub = data.viewer.companyType === "sub";

  const removed = new Set(drafts.filter((d) => d.kind === "remove").map((d) => `${d.requestId}|${d.employeeId}`));
  const placements: Placement[] = [];
  const holds = new Map<string, Hold[]>();
  const hold = (employeeId: string, date: string, h: Hold) => {
    const key = `${employeeId}|${date}`;
    holds.set(key, [...(holds.get(key) ?? []), h]);
  };

  for (const b of data.bookings) {
    for (const employeeId of b.employeeIds) {
      if (removed.has(`${b.requestId}|${employeeId}`)) continue;
      const where = b.otherGc ? "with another contractor" : `on ${projectNames.get(b.projectId) ?? "another project"}`;
      hold(employeeId, b.date, { span: windowOf(b.startTime, b.endTime), where, status: b.status, requestId: b.requestId });
      if (b.otherGc || !projectNames.has(b.projectId)) continue;
      placements.push({
        key: `${b.requestId}|${employeeId}`,
        employeeId,
        subCompanyId: b.subCompanyId,
        projectId: b.projectId,
        date: b.date,
        start: b.startTime,
        end: b.endTime,
        stopLabel: null,
        status: b.status,
        requestId: b.requestId,
        // Only the other company sees "Edited" (it's what they need to confirm).
        edited: b.edited && b.lastEditedByCompanyId !== data.viewer.companyId,
        assignedBySub: b.assignedBySub,
        unassigned: false,
      });
    }
  }
  for (const d of drafts) {
    if (d.kind !== "place") continue;
    hold(d.employeeId, d.date, { span: { start: d.start, end: d.end }, where: `on ${projectNames.get(d.projectId) ?? "a project"}`, status: "draft", draftId: d.id });
    const emp = employees.get(d.employeeId);
    placements.push({
      key: d.id,
      employeeId: d.employeeId,
      subCompanyId: d.subCompanyId,
      projectId: d.projectId,
      date: d.date,
      start: d.start,
      end: d.end,
      stopLabel: d.stopLabel,
      status: "draft",
      draftId: d.id,
      edited: false,
      assignedBySub: false,
      unassigned: isSub && !!emp && !emp.assignedProjectIds.includes(d.projectId),
    });
  }

  const byCell = new Map<string, Placement[]>();
  for (const p of placements) {
    const key = cellKey(p.projectId, p.date);
    byCell.set(key, [...(byCell.get(key) ?? []), p]);
  }
  for (const list of byCell.values()) list.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));

  const availability = new Map<string, MatrixAvailability[]>();
  for (const a of data.availability) {
    const key = `${a.employeeId}|${a.date}`;
    availability.set(key, [...(availability.get(key) ?? []), a].sort((x, y) => x.startTime.localeCompare(y.startTime)));
  }
  const availabilityOn = (employeeId: string, date: string) => availability.get(`${employeeId}|${date}`) ?? [];
  const holdsOn = (employeeId: string, date: string) => holds.get(`${employeeId}|${date}`) ?? [];

  const freeSlots = (employeeId: string, date: string, ignore?: { requestId?: string; draftId?: string }) => {
    const taken = holdsOn(employeeId, date)
      .filter((h) => !(ignore?.draftId && h.draftId === ignore.draftId) && !(ignore?.requestId && h.requestId === ignore.requestId))
      .map((h) => h.span);
    return availabilityOn(employeeId, date).flatMap((a) =>
      freeWindows({ start: a.startTime, end: a.endTime }, taken).map((w) => ({
        employeeId,
        availabilityId: a.id,
        date,
        start: w.start,
        end: w.end,
        stopLabel: a.stopLabel,
      })),
    );
  };

  return { employees, projectNames, placements, byCell, availabilityOn, holdsOn, freeSlots };
}

/** Turn drafts into one publish: creates grouped by project/day/sub/time, take-offs as updates or cancels. */
export function toBatch(data: MatrixData, drafts: Draft[]): { body: BatchBody; createDrafts: string[][]; updateDrafts: string[][] } {
  const removals = new Map<string, Draft[]>();
  for (const d of drafts) if (d.kind === "remove") removals.set(d.requestId, [...(removals.get(d.requestId) ?? []), d]);

  const update: NonNullable<BatchBody["update"]> = [];
  const updateDrafts: string[][] = [];
  const cancel: string[] = [];
  for (const [requestId, list] of removals) {
    const booking = data.bookings.find((b) => b.requestId === requestId);
    if (!booking) continue;
    const off = new Set(list.map((d) => (d.kind === "remove" ? d.employeeId : "")));
    const remaining = booking.employeeIds.filter((id) => !off.has(id));
    if (remaining.length === 0) cancel.push(requestId);
    else {
      update.push({ requestId, employeeIds: remaining });
      updateDrafts.push(list.map((d) => d.id));
    }
  }

  const groups = new Map<string, { create: BatchBody["create"][number]; ids: string[] }>();
  for (const d of drafts) {
    if (d.kind !== "place") continue;
    const key = [d.projectId, d.subCompanyId, d.date, d.start, d.end].join("|");
    const group = groups.get(key) ?? {
      create: { projectId: d.projectId, subCompanyId: d.subCompanyId, employeeIds: [], date: d.date, startTime: d.start, endTime: d.end },
      ids: [],
    };
    if (!group.create.employeeIds.includes(d.employeeId)) group.create.employeeIds.push(d.employeeId);
    group.ids.push(d.id);
    groups.set(key, group);
  }
  const values = [...groups.values()];
  return { body: { create: values.map((g) => g.create), update, cancel }, createDrafts: values.map((g) => g.ids), updateDrafts };
}

/** Draft list with undo-free, order-preserving edits. */
export function useMatrixDrafts() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const revert = useCallback(() => setDrafts([]), []);
  return { drafts, setDrafts, revert };
}
