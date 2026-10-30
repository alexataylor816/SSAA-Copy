/**
 * The Weekly view's server side (docs/WEEKLY_VIEW_REBUILD.md): one read of everything the grid needs,
 * one all-or-nothing publish of a whole draft, the GC's "Confirm Changes", and project assignments.
 * Response shapes mirror web/src/lib/matrixApi.ts; keep the two in step.
 *
 * Rules (section 2 of the doc):
 *  - A sub (Partial or higher) places its own crew on projects it is connected to; that is created
 *    already confirmed, marked sub-assigned and "Edited" until the GC confirms the changes.
 *  - A GC (Partial or higher) places a connected sub's crew; that is a pending request.
 *  - A sub placing someone on a project they aren't assigned to needs `allowUnassigned`.
 *  - Nobody is placed outside their posted hours or over time already held (the double-booking guard),
 *    and past weeks are locked.
 */
import crypto from "node:crypto";
import { database } from "../db.js";
import { findCompanyById, findEmployeeById, findUserRole, listCompanyEmployees } from "../rbac/models.js";
import { hasAtLeast } from "../rbac/permissions.js";
import type { CompanyType, Employee, PermissionLevel } from "../rbac/types.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../rbac/errors.js";
import { isDateLocked } from "./historicalLock.js";
import {
  clearScheduleRequestEdited,
  createScheduleRequestRow,
  findProjectById,
  findProjectConnection,
  findScheduleRequestById,
  listActiveRequestsLiteBetween,
  listActiveScheduleRequestsOnDate,
  listAvailabilityForCompany,
  listAvailabilityForEmployeeOn,
  listConnectedProjects,
  listOwnedProjects,
  listProjectConnections,
  updateScheduleRequestRow,
  updateScheduleRequestStatusRow,
} from "./models.js";
import { canSeeProject, requireUserWithCompany, toLabel } from "./service.js";
import type { Project, ScheduleRequest } from "./types.js";
import { dayLabel as localDayLabel, say } from "../i18n/index.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
// The Weekly view slides through weeks and loads more at either end; about a year is plenty.
const MAX_DAYS = 371;
const MAX_CHANGES = 200;

// --- time spans ("HH:MM"; "24:00" = end of day) ---

export interface Span {
  start: string;
  end: string;
}

const hhmm = (t: string) => t.slice(0, 5);
export const spanOf = (start: string | null, end: string | null): Span => ({
  start: start ? hhmm(start) : "00:00",
  end: end ? hhmm(end) : "24:00",
});
export const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;
const contains = (outer: Span, inner: Span) => outer.start <= inner.start && inner.end <= outer.end;

/** What is left of `window` once every held span is taken out. */
export function subtract(window: Span, holds: Span[]): Span[] {
  let parts = [window];
  for (const h of holds) {
    parts = parts.flatMap((p) =>
      !overlaps(p, h)
        ? [p]
        : [
            ...(p.start < h.start ? [{ start: p.start, end: h.start }] : []),
            ...(h.end < p.end ? [{ start: h.end, end: p.end }] : []),
          ],
    );
  }
  return parts;
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "Fri, Oct 23" (or "vie, 23 oct" for a Spanish request). */
export const dayLabel = (iso: string) => localDayLabel(iso);

const firstName = (name: string) => name.split(" ")[0] || name;

// --- who is asking ---

interface Viewer {
  userId: string;
  isAdmin: boolean;
  companyId: string;
  companyType: CompanyType;
  level: PermissionLevel;
  canSchedule: boolean;
  canMakeException: boolean;
}

async function viewerFor(userId: string): Promise<Viewer> {
  const user = await requireUserWithCompany(userId);
  const company = await findCompanyById(user.companyId!);
  if (!company) throw new NotFoundError("Company not found.");
  const role = await findUserRole(user.id, company.id);
  const level: PermissionLevel = user.isAdmin ? "account_holder" : (role?.permissionLevel ?? "basic");
  const canSchedule = user.isAdmin || hasAtLeast(level, "partial");
  return {
    userId: user.id,
    isAdmin: user.isAdmin,
    companyId: company.id,
    companyType: company.companyType,
    level,
    canSchedule,
    // Luke's rule is Level 1 and up; scheduling at all already needs Partial, so in practice it's the same people.
    canMakeException: canSchedule && hasAtLeast(level, "level_1"),
  };
}

const locked = (v: Viewer, date: string) => !v.isAdmin && isDateLocked(date);

async function assignedProjectsByEmployee(employeeIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>(employeeIds.map((id) => [id, new Set<string>()]));
  if (employeeIds.length === 0) return out;
  const rows = await database.all<{ employee_id: string; project_id: string }>(
    `SELECT employee_id, project_id FROM employee_project_assignments WHERE employee_id IN (${employeeIds.map(() => "?").join(", ")})`,
    employeeIds,
  );
  for (const r of rows) out.get(r.employee_id)?.add(r.project_id);
  return out;
}

// ---------------------------------------------------------------------------
// GET /matrix
// ---------------------------------------------------------------------------

export async function getMatrix(userId: string, params: { start?: string; days?: string | number; projectId?: string }) {
  const v = await viewerFor(userId);
  const start = String(params.start ?? "");
  const days = Number(params.days ?? 14);
  if (!DATE_RE.test(start)) throw new BadRequestError("start must be formatted YYYY-MM-DD.");
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new BadRequestError(`days must be 1 to ${MAX_DAYS}.`);
  const end = addDays(start, days - 1);
  const dayList = Array.from({ length: days }, (_, i) => addDays(start, i));

  const allProjects: Project[] = [...(await listOwnedProjects(v.companyId)), ...(await listConnectedProjects(v.companyId))];
  const visibleIds = new Set(allProjects.map((p) => p.id));
  let projects = allProjects;
  if (params.projectId) {
    projects = allProjects.filter((p) => p.id === params.projectId);
    if (projects.length === 0) throw new NotFoundError("Project not found.");
  }

  // GC: the subs connected to its (shown) projects. Sub: its own crew.
  // Which of the shown projects each crew can be placed on.
  const crewProjects = new Map<string, Set<string>>();
  if (v.companyType === "sub") {
    crewProjects.set(v.companyId, new Set(projects.map((p) => p.id)));
  } else {
    for (const p of projects.filter((p) => p.companyId === v.companyId)) {
      for (const conn of await listProjectConnections(p.id)) {
        crewProjects.set(conn.subCompanyId, (crewProjects.get(conn.subCompanyId) ?? new Set()).add(p.id));
      }
    }
  }
  const crewCompanyIds = [...crewProjects.keys()];

  const crews = [];
  const crewEmployeeIds: string[] = [];
  for (const companyId of crewCompanyIds) {
    const company = await findCompanyById(companyId);
    if (!company) continue;
    const employees = await listCompanyEmployees(companyId);
    crewEmployeeIds.push(...employees.map((e) => e.id));
    crews.push({ company, employees });
  }
  crews.sort((a, b) => a.company.name.localeCompare(b.company.name));
  const assigned = await assignedProjectsByEmployee(crewEmployeeIds);
  const onCrew = new Set(crewEmployeeIds);

  // Held time per person per day, from every pending/confirmed request (any GC).
  const holds = new Map<string, Span[]>();
  const bookings = [];
  for (const r of await listActiveRequestsLiteBetween(start, end)) {
    const mine = r.employeeIds.filter((id) => onCrew.has(id));
    if (mine.length === 0) continue;
    for (const id of mine) {
      const key = `${id}|${r.date}`;
      holds.set(key, [...(holds.get(key) ?? []), spanOf(r.startTime, r.endTime)]);
    }
    const otherGc = !visibleIds.has(r.projectId);
    if (params.projectId && !otherGc && r.projectId !== params.projectId) continue;
    bookings.push({
      requestId: r.id,
      groupId: otherGc ? null : r.groupId,
      projectId: otherGc ? "" : r.projectId,
      subCompanyId: r.subCompanyId,
      employeeIds: mine,
      date: r.date,
      startTime: r.startTime ? hhmm(r.startTime) : null,
      endTime: r.endTime ? hhmm(r.endTime) : null,
      status: r.status as "pending" | "confirmed",
      assignedBySub: !otherGc && r.subAssigned,
      otherGc,
      edited: !otherGc && r.edited,
      lastEditedByCompanyId: otherGc ? null : r.lastEditedByCompanyId,
      silent: !otherGc && r.silentAssignment,
    });
  }

  const availability = [];
  for (const companyId of crewCompanyIds) {
    for (const a of await listAvailabilityForCompany(companyId, start, end)) {
      // Hours posted for some other GC's project aren't this viewer's business.
      if (!a.allProjects && a.projectId && !visibleIds.has(a.projectId)) continue;
      const window = spanOf(a.startTime, a.endTime);
      availability.push({
        id: a.id,
        employeeId: a.employeeId,
        date: a.date,
        startTime: window.start,
        endTime: window.end,
        stopLabel: a.stopLabel,
        projectId: a.projectId,
        allProjects: a.allProjects || a.projectId === null,
        free: subtract(window, holds.get(`${a.employeeId}|${a.date}`) ?? []),
      });
    }
  }

  const projectIds = projects.map((p) => p.id);
  const tasks =
    projectIds.length === 0
      ? []
      : await database.all<{ id: string; project_id: string; name: string; start_date: string; end_date: string; color: string | null }>(
          `SELECT id, project_id, name, start_date, end_date, color FROM tasks
            WHERE project_id IN (${projectIds.map(() => "?").join(", ")}) AND start_date <= ? AND end_date >= ?
            ORDER BY start_date`,
          [...projectIds, end, start],
        );

  const ownerNames = new Map<string, string>();
  for (const p of projects) {
    if (!ownerNames.has(p.companyId)) ownerNames.set(p.companyId, (await findCompanyById(p.companyId))?.name ?? "");
  }

  return {
    days: dayList,
    viewer: {
      companyId: v.companyId,
      companyType: v.companyType,
      permissionLevel: v.level,
      canSchedule: v.canSchedule,
      canAssignOwnCrew: v.companyType === "sub" && v.canSchedule,
      canMakeException: v.canMakeException,
    },
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      ownerCompanyId: p.companyId,
      ownerName: ownerNames.get(p.companyId) ?? "",
    })),
    crews: crews.map(({ company, employees }) => ({
      companyId: company.id,
      companyName: company.name,
      trade: company.trade ?? null,
      projectIds: [...(crewProjects.get(company.id) ?? [])],
      employees: employees.map((e) => ({
        id: e.id,
        name: e.name,
        jobTitle: e.jobTitle,
        assignedProjectIds: [...(assigned.get(e.id) ?? [])],
      })),
    })),
    availability,
    bookings,
    tasks: tasks.map((t) => ({
      id: t.id,
      projectId: t.project_id,
      name: t.name,
      startDate: t.start_date,
      endDate: t.end_date,
      color: t.color ?? "#64748b",
    })),
  };
}

// ---------------------------------------------------------------------------
// POST /schedule-requests/batch
// ---------------------------------------------------------------------------

export interface BatchCreate {
  projectId: string;
  subCompanyId: string;
  employeeIds: string[];
  date: string;
  startTime?: string;
  endTime?: string;
  description?: string;
}

export interface BatchUpdate {
  requestId: string;
  employeeIds: string[];
  date?: string;
  projectId?: string;
  startTime?: string | null;
  endTime?: string | null;
}

export interface NotifyChoice {
  gcEmail: boolean;
  gcPush: boolean;
  personnelEmail: boolean;
  personnelPush: boolean;
}

export interface BatchBody {
  create?: BatchCreate[];
  update?: BatchUpdate[];
  cancel?: string[];
  dryRun?: boolean;
  allowUnassigned?: boolean;
  notify?: NotifyChoice;
  editReason?: string;
}

interface UnassignedPair {
  employeeId: string;
  employeeName: string;
  jobTitle: string | null;
  projectId: string;
  projectName: string;
  date: string;
}

export interface BatchResult {
  groupId: string;
  created: { requestId: string; index: number }[];
  updated: string[];
  cancelled: string[];
  skipped: { kind: "create" | "update"; index: number; reason: string }[];
  unassigned: UnassignedPair[];
  notified: { email: boolean; push: boolean };
}

/** Thrown inside one change to skip it with a reason the screen can show as-is. */
class Skip extends Error {}

function checkTimes(start: unknown, end: unknown) {
  if (start != null && (typeof start !== "string" || !TIME_RE.test(start))) throw new BadRequestError("startTime must be formatted HH:MM.");
  if (end != null && (typeof end !== "string" || !TIME_RE.test(end))) throw new BadRequestError("endTime must be formatted HH:MM.");
  if (typeof start === "string" && typeof end === "string" && start >= end) throw new BadRequestError("startTime must be before endTime.");
}

/**
 * Validates and applies a whole Weekly-view draft. Each change is checked on its own; one that breaks a
 * rule is skipped with a reason and the rest still go through. With `dryRun` nothing is written, which
 * is how the screen finds unassigned placements to ask about before publishing.
 *
 * Returns the requests it wrote so the route can emit realtime events and send notifications.
 */
export async function applyBatch(userId: string, body: BatchBody): Promise<{ result: BatchResult; touched: ScheduleRequest[] }> {
  const v = await viewerFor(userId);
  if (!v.canSchedule) throw new ForbiddenError("You need Partial-level access or higher to schedule people.");

  const creates = body.create ?? [];
  const updates = body.update ?? [];
  const cancels = body.cancel ?? [];
  if (!Array.isArray(creates) || !Array.isArray(updates) || !Array.isArray(cancels)) {
    throw new BadRequestError("create, update and cancel must be lists.");
  }
  if (creates.length + updates.length + cancels.length > MAX_CHANGES) {
    throw new BadRequestError(`Publish at most ${MAX_CHANGES} changes at a time.`);
  }
  if (body.allowUnassigned && !v.canMakeException) {
    throw new ForbiddenError(
      "You do not have permission to assign employees to projects they are not assigned to. Ask an admin to update assignments in Manage Team Profiles.",
    );
  }
  const editReason = typeof body.editReason === "string" ? body.editReason.trim().slice(0, 500) || null : null;
  const dryRun = !!body.dryRun;
  const isSub = v.companyType === "sub";

  const result: BatchResult = {
    groupId: crypto.randomUUID(),
    created: [],
    updated: [],
    cancelled: [],
    skipped: [],
    unassigned: [],
    notified: { email: false, push: false },
  };
  const touchedIds: string[] = [];

  // Small caches: a draft names the same people and projects over and over.
  const employees = new Map<string, Employee | undefined>();
  const employee = async (id: string) => {
    if (!employees.has(id)) employees.set(id, await findEmployeeById(id));
    return employees.get(id);
  };
  const projects = new Map<string, Project | undefined>();
  const project = async (id: string) => {
    if (!projects.has(id)) projects.set(id, await findProjectById(id));
    return projects.get(id);
  };
  const seen = new Map<string, boolean>();
  const viewerSees = async (projectId: string) => {
    if (!seen.has(projectId)) seen.set(projectId, await canSeeProject(v.companyId, projectId));
    return seen.get(projectId)!;
  };
  const assignments = new Map<string, Set<string>>();
  const assignedTo = async (employeeId: string) => {
    if (!assignments.has(employeeId)) {
      assignments.set(employeeId, (await assignedProjectsByEmployee([employeeId])).get(employeeId)!);
    }
    return assignments.get(employeeId)!;
  };

  // Time this batch frees up (cancelled or rewritten requests) and time it takes (new placements).
  const released = new Set<string>();
  const taken: { employeeId: string; date: string; span: Span }[] = [];

  async function clash(employeeIds: string[], date: string, span: Span, selfId?: string): Promise<string | null> {
    for (const other of await listActiveScheduleRequestsOnDate(date)) {
      if (other.id === selfId || released.has(other.id)) continue;
      const otherSpan = spanOf(other.startTime, other.endTime);
      if (!overlaps(span, otherSpan)) continue;
      const hit = employeeIds.find((id) => other.employeeIds.includes(id));
      if (!hit) continue;
      const name = firstName(other.employeeNames[other.employeeIds.indexOf(hit)] ?? say("That person"));
      const when = other.startTime && other.endTime ? `${toLabel(otherSpan.start)}–${toLabel(otherSpan.end)}` : say("all day");
      const where = (await viewerSees(other.projectId))
        ? say("on {project}", { project: (await project(other.projectId))?.name ?? say("another project") })
        : say("with another contractor");
      const status = say(other.status === "confirmed" ? "booked" : "requested");
      return say("{name} is already {status} {when} {where} on {day}.", { name, status, when, where, day: dayLabel(date) });
    }
    for (const t of taken) {
      if (t.date === date && employeeIds.includes(t.employeeId) && overlaps(span, t.span)) {
        const name = firstName((await employee(t.employeeId))?.name ?? say("That person"));
        return say("{name} is placed twice at the same time on {day} in this change.", { name, day: dayLabel(date) });
      }
    }
    return null;
  }

  async function hoursGap(emp: Employee, projectId: string, date: string, span: Span, timed: boolean): Promise<string | null> {
    const usable = (await listAvailabilityForEmployeeOn(emp.id, date)).filter(
      (a) => a.allProjects || a.projectId === null || a.projectId === projectId,
    );
    if (usable.length === 0) return say("{name} has no hours posted on {day}.", { name: firstName(emp.name), day: dayLabel(date) });
    if (timed && !usable.some((a) => contains(spanOf(a.startTime, a.endTime), span))) {
      return say("{name}'s posted hours on {day} don't cover {start}–{end}.", {
        name: firstName(emp.name),
        day: dayLabel(date),
        start: toLabel(span.start),
        end: toLabel(span.end),
      });
    }
    return null;
  }

  /** Sub only: who is going somewhere they aren't assigned. Throws Skip unless the user confirmed the exception. */
  async function checkAssignments(people: Employee[], projectId: string, date: string) {
    if (!isSub) return;
    const misses: Employee[] = [];
    for (const emp of people) if (!(await assignedTo(emp.id)).has(projectId)) misses.push(emp);
    if (misses.length === 0) return;
    const projectName = (await project(projectId))?.name ?? say("Project");
    for (const emp of misses) {
      if (!result.unassigned.some((u) => u.employeeId === emp.id && u.projectId === projectId)) {
        result.unassigned.push({ employeeId: emp.id, employeeName: emp.name, jobTitle: emp.jobTitle, projectId, projectName, date });
      }
    }
    if (!dryRun && !body.allowUnassigned) {
      throw new Skip(
        say(misses.length === 1 ? "{names} is not assigned to {project}." : "{names} are not assigned to {project}.", {
          names: misses.map((e) => e.name).join(", "),
          project: projectName,
        }),
      );
    }
  }

  async function crewOf(ids: unknown, companyId: string): Promise<Employee[]> {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new BadRequestError("employeeIds must be a list of ids.");
    const out: Employee[] = [];
    for (const id of new Set(ids as string[])) {
      const emp = await employee(id);
      if (!emp || emp.companyId !== companyId) throw new Skip(say("Someone in this change isn't on that company's crew."));
      out.push(emp);
    }
    return out;
  }

  const run = async () => {
    // 1. Cancellations first, so the time they free up can be reused below.
    for (const id of cancels) {
      if (typeof id !== "string") throw new BadRequestError("cancel must be a list of request ids.");
      const req = await findScheduleRequestById(id);
      if (!req) throw new NotFoundError("Schedule request not found.");
      if (v.companyId !== req.requestingCompanyId && v.companyId !== req.subCompanyId) {
        throw new ForbiddenError("You are not part of this request.");
      }
      if (req.status !== "pending" && req.status !== "confirmed") continue; // already closed elsewhere
      if (locked(v, req.date)) throw new ForbiddenError("That date is locked — historical records can't be modified.");
      released.add(req.id);
      result.cancelled.push(req.id);
      if (!dryRun) {
        await updateScheduleRequestStatusRow(req.id, "cancelled", editReason);
        touchedIds.push(req.id);
      }
    }

    // 2. Edits to existing requests: moves, and people added or taken off.
    for (const [index, u] of updates.entries()) {
      try {
        if (!u || typeof u.requestId !== "string") throw new BadRequestError("Each update needs a requestId.");
        checkTimes(u.startTime, u.endTime);
        if (u.date !== undefined && !DATE_RE.test(u.date)) throw new BadRequestError("date must be formatted YYYY-MM-DD.");
        const req = await findScheduleRequestById(u.requestId);
        if (!req || (req.status !== "pending" && req.status !== "confirmed")) {
          throw new Skip(say("That booking was already changed or cancelled. Refresh and try again."));
        }
        const subSide = v.companyId === req.subCompanyId;
        if (!subSide && v.companyId !== req.requestingCompanyId) throw new Skip(say("You can't change that booking."));
        const projectId = u.projectId ?? req.projectId;
        const date = u.date ?? req.date;
        const startTime = u.startTime !== undefined ? u.startTime : req.startTime;
        const endTime = u.endTime !== undefined ? u.endTime : req.endTime;
        if (locked(v, req.date) || locked(v, date)) throw new Skip(say("That week is locked."));
        const project_ = await project(projectId);
        if (!project_ || !(await viewerSees(projectId))) throw new Skip(say("Project not found."));
        if (projectId !== req.projectId && project_.companyId !== req.subCompanyId && !(await findProjectConnection(projectId, req.subCompanyId))) {
          throw new Skip(say("{company} isn't connected to {project}.", { company: req.subCompanyName ?? say("That company"), project: project_.name }));
        }

        const people = await crewOf(u.employeeIds, req.subCompanyId);
        if (people.length === 0) {
          // Everyone taken off: the request goes away.
          released.add(req.id);
          result.cancelled.push(req.id);
          if (!dryRun) {
            await updateScheduleRequestStatusRow(req.id, "cancelled", editReason);
            touchedIds.push(req.id);
          }
          continue;
        }

        const span = spanOf(startTime, endTime);
        const moved = projectId !== req.projectId || date !== req.date || startTime !== req.startTime || endTime !== req.endTime;
        const added = people.filter((e) => !req.employeeIds.includes(e.id));
        // People who stay put where they were already booked don't need their hours re-checked.
        for (const emp of moved ? people : added) {
          const gap = await hoursGap(emp, projectId, date, span, !!(startTime && endTime));
          if (gap) throw new Skip(gap);
        }
        await checkAssignments(projectId !== req.projectId ? people : added, projectId, date);
        const hit = await clash(people.map((e) => e.id), date, span, req.id);
        if (hit) throw new Skip(hit);

        released.add(req.id);
        for (const emp of people) taken.push({ employeeId: emp.id, date, span });
        result.updated.push(req.id);
        if (!dryRun) {
          await updateScheduleRequestRow(req.id, {
            projectId,
            employeeIds: people.map((e) => e.id),
            date,
            startTime: startTime ?? null,
            endTime: endTime ?? null,
            // The sub's own changes stand; a GC's change goes back to the sub to confirm.
            status: subSide ? "confirmed" : "pending",
            edited: true,
            lastEditedByCompanyId: v.companyId,
            subAssigned: req.subAssigned || (subSide && added.length > 0),
            groupId: result.groupId,
            editReason,
          });
          touchedIds.push(req.id);
        }
      } catch (err) {
        if (!(err instanceof Skip)) throw err;
        result.skipped.push({ kind: "update", index, reason: err.message });
      }
    }

    // 3. New placements.
    for (const [index, c] of creates.entries()) {
      try {
        if (!c || typeof c.projectId !== "string" || typeof c.subCompanyId !== "string") {
          throw new BadRequestError("Each placement needs a projectId and subCompanyId.");
        }
        if (typeof c.date !== "string" || !DATE_RE.test(c.date)) throw new BadRequestError("date must be formatted YYYY-MM-DD.");
        checkTimes(c.startTime, c.endTime);
        if (locked(v, c.date)) throw new Skip(say("That week is locked."));
        const project_ = await project(c.projectId);
        if (!project_ || !(await viewerSees(c.projectId))) throw new Skip(say("Project not found."));
        if (isSub && c.subCompanyId !== v.companyId) throw new Skip(say("You can only place your own crew."));
        if (c.subCompanyId !== project_.companyId && !(await findProjectConnection(c.projectId, c.subCompanyId))) {
          const name = (await findCompanyById(c.subCompanyId))?.name ?? "That company";
          throw new Skip(say("{company} isn't connected to {project}.", { company: name, project: project_.name }));
        }

        const people = await crewOf(c.employeeIds, c.subCompanyId);
        if (people.length === 0) throw new BadRequestError("Pick at least one employee.");
        const span = spanOf(c.startTime ?? null, c.endTime ?? null);
        for (const emp of people) {
          const gap = await hoursGap(emp, c.projectId, c.date, span, !!(c.startTime && c.endTime));
          if (gap) throw new Skip(gap);
        }
        await checkAssignments(people, c.projectId, c.date);
        const hit = await clash(people.map((e) => e.id), c.date, span);
        if (hit) throw new Skip(hit);

        for (const emp of people) taken.push({ employeeId: emp.id, date: c.date, span });
        if (dryRun) {
          result.created.push({ requestId: "", index });
          continue;
        }
        const notifying = !!body.notify && Object.values(body.notify).some(Boolean);
        const row = await createScheduleRequestRow({
          projectId: c.projectId,
          // A sub's own placement still belongs to the GC's project, so the GC sees it in its lists.
          requestingCompanyId: isSub ? project_.companyId : v.companyId,
          subCompanyId: c.subCompanyId,
          employeeIds: people.map((e) => e.id),
          date: c.date,
          startTime: c.startTime ?? null,
          endTime: c.endTime ?? null,
          description: typeof c.description === "string" ? c.description.trim() || null : null,
          imageUrls: [],
          status: isSub ? "confirmed" : "pending",
          edited: isSub,
          lastEditedByCompanyId: isSub ? v.companyId : null,
          subAssigned: isSub,
          silentAssignment: isSub && !notifying,
          groupId: result.groupId,
        });
        result.created.push({ requestId: row.id, index });
        touchedIds.push(row.id);
      } catch (err) {
        if (!(err instanceof Skip)) throw err;
        result.skipped.push({ kind: "create", index, reason: err.message });
      }
    }
  };

  if (dryRun) await run();
  else await database.transaction(run);

  const touched: ScheduleRequest[] = [];
  for (const id of touchedIds) {
    const req = await findScheduleRequestById(id);
    if (req) touched.push(req);
  }
  return { result, touched };
}

// ---------------------------------------------------------------------------
// "Confirm Changes" and project assignments
// ---------------------------------------------------------------------------

/** The other company has seen the edit: clear the "Edited" tag. */
export async function acknowledgeEdit(userId: string, requestId: string): Promise<ScheduleRequest> {
  const v = await viewerFor(userId);
  if (!v.canSchedule) throw new ForbiddenError("You need Partial-level access or higher to act on schedule requests.");
  const req = await findScheduleRequestById(requestId);
  if (!req) throw new NotFoundError("Schedule request not found.");
  if (v.companyId !== req.requestingCompanyId && v.companyId !== req.subCompanyId) {
    throw new ForbiddenError("You are not part of this request.");
  }
  if (req.edited && req.lastEditedByCompanyId === v.companyId) {
    throw new ForbiddenError("The other company confirms these changes, not the one that made them.");
  }
  if (req.edited) await clearScheduleRequestEdited(req.id);
  return (await findScheduleRequestById(req.id))!;
}

/** Which of your own employees and users are assigned to a project. */
export async function getProjectAssignments(userId: string, projectId: string) {
  const v = await viewerFor(userId);
  if (!(await canSeeProject(v.companyId, projectId))) throw new NotFoundError("Project not found.");
  const employeeRows = await database.all<{ employee_id: string }>(
    "SELECT employee_id FROM employee_project_assignments WHERE project_id = ? AND company_id = ?",
    [projectId, v.companyId],
  );
  const userRows = await database.all<{ user_id: string }>(
    "SELECT user_id FROM user_project_assignments WHERE project_id = ? AND company_id = ?",
    [projectId, v.companyId],
  );
  return { projectId, employeeIds: employeeRows.map((r) => r.employee_id), userIds: userRows.map((r) => r.user_id) };
}

/** Replace your company's assignments on a project (the Team page's editor). */
export async function setProjectAssignments(userId: string, projectId: string, body: { employeeIds?: unknown; userIds?: unknown }) {
  const v = await viewerFor(userId);
  if (!v.canSchedule) throw new ForbiddenError("You need Partial-level access or higher to change project assignments.");
  if (!(await canSeeProject(v.companyId, projectId))) throw new NotFoundError("Project not found.");
  const ids = (value: unknown, label: string): string[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some((x) => typeof x !== "string")) throw new BadRequestError(`${label} must be a list of ids.`);
    return [...new Set(value as string[])];
  };
  const employeeIds = ids(body.employeeIds, "employeeIds");
  const userIds = ids(body.userIds, "userIds");

  if (employeeIds) {
    for (const id of employeeIds) {
      const emp = await findEmployeeById(id);
      if (!emp || emp.companyId !== v.companyId) throw new BadRequestError("You can only assign your own employees.");
    }
  }
  if (userIds) {
    for (const id of userIds) {
      const row = await database.get<{ id: string }>("SELECT id FROM users WHERE id = ? AND company_id = ?", [id, v.companyId]);
      if (!row) throw new BadRequestError("You can only assign people in your own company.");
    }
  }

  await database.transaction(async () => {
    if (employeeIds) {
      await database.run("DELETE FROM employee_project_assignments WHERE project_id = ? AND company_id = ?", [projectId, v.companyId]);
      for (const id of employeeIds) {
        await database.run(
          "INSERT INTO employee_project_assignments (id, employee_id, project_id, company_id) VALUES (?, ?, ?, ?)",
          [crypto.randomUUID(), id, projectId, v.companyId],
        );
      }
    }
    if (userIds) {
      await database.run("DELETE FROM user_project_assignments WHERE project_id = ? AND company_id = ?", [projectId, v.companyId]);
      for (const id of userIds) {
        await database.run(
          "INSERT INTO user_project_assignments (id, user_id, project_id, company_id) VALUES (?, ?, ?, ?)",
          [crypto.randomUUID(), id, projectId, v.companyId],
        );
      }
    }
  });
  return getProjectAssignments(userId, projectId);
}
