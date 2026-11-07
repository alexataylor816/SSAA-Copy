import { database } from "../db.js";
import { buildScheduleRecommendations, eligibleEmployees, overlaps, validDate, validTime, type RecommendationTask, type ExistingScheduleRequest } from "./recommendationRules.js";
import { normalizeTrade } from "./taskTrades.js";
import {
  findCompanyById,
  findEmployeeById,
  findEmployeeByLinkedUser,
  findUserRole,
  listCompanyEmployees,
} from "../rbac/models.js";
import { hasAtLeast, hasPartialOrHigher } from "../rbac/permissions.js";
import type { Company, Employee } from "../rbac/types.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../rbac/errors.js";
import { findUserById, type User } from "../models/users.js";
import { isDateLocked } from "./historicalLock.js";
import {
  createAvailabilityRow,
  createProjectConnection,
  createProjectRow,
  createScheduleRequestRow,
  deleteAvailabilityRow,
  deleteProjectAndChildren,
  findAvailabilityById,
  findProjectByConnectionCode,
  findProjectConnection,
  findProjectById,
  findScheduleRequestById,
  listAvailabilityForCompany,
  listConnectedProjects,
  listOwnedProjects,
  listProjectConnections,
  listScheduleRequestsForCompany,
  updateScheduleRequestStatusRow,
} from "./models.js";
import type { Availability, Project, ScheduleRequest, ScheduleRequestStatus } from "./types.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

async function requireUserWithCompany(userId: string) {
  const user = await findUserById(userId);
  if (!user) throw new NotFoundError("User not found.");
  if (!user.companyId) throw new ConflictError("You need to be part of a company first.");
  return user;
}

async function actorHasPartialOrHigher(user: User): Promise<boolean> {
  if (user.isAdmin) return true;
  if (!user.companyId) return false;
  const role = await findUserRole(user.id, user.companyId);
  return hasPartialOrHigher({ isAdmin: user.isAdmin, permissionLevel: role?.permissionLevel ?? null });
}

/**
 * Project create/delete gate. Mirrors the reference's can_manage_projects():
 * full or account holder only — the dashboard's "+ New" button already hides
 * itself under the same rule, but the API never enforced it.
 */
async function actorHasFullOrHigher(user: User): Promise<boolean> {
  if (user.isAdmin) return true;
  if (!user.companyId) return false;
  const role = await findUserRole(user.id, user.companyId);
  const level = role?.permissionLevel ?? null;
  return level !== null && hasAtLeast(level, "full");
}

/**
 * Every mutation that writes to a dated row goes through here, so the
 * historical lock can't be bypassed by calling the API directly instead of
 * going through the UI. Admins bypass (mirrors the original's MOA bypass).
 */
function assertDateUnlocked(date: string, user: User): void {
  if (user.isAdmin) return;
  if (!DATE_RE.test(date)) throw new BadRequestError("date must be formatted YYYY-MM-DD.");
  if (isDateLocked(date)) {
    throw new ForbiddenError("That date is locked — historical records can't be modified.");
  }
}

export async function createProject(userId: string, params: { name: string; address?: string }): Promise<Project> {
  const user = await requireUserWithCompany(userId);
  if (!params.name?.trim()) {
    throw new BadRequestError("Project name is required.");
  }
  if (!(await actorHasFullOrHigher(user))) {
    throw new ForbiddenError("You need Full-level access or higher to create projects.");
  }

  return await createProjectRow({ name: params.name.trim(), address: params.address?.trim() || null, companyId: user.companyId! });
}

/**
 * Delete an owned project and everything hanging off it. SQLite foreign keys
 * are not enforced in SQLite (foreign_keys is never turned on), so children are removed explicitly
 * in one transaction: connections, availability on the project, requests,
 * tasks, aliases, assignments, and the messaging channel (+ its messages,
 * reads, and participants).
 */
export async function deleteProject(userId: string, projectId: string): Promise<void> {
  const user = await requireUserWithCompany(userId);
  const project = await findProjectById(projectId);
  if (!project || project.companyId !== user.companyId) {
    throw new NotFoundError("Project not found.");
  }
  if (!(await actorHasFullOrHigher(user))) {
    throw new ForbiddenError("You need Full-level access or higher to delete projects.");
  }

  await deleteProjectAndChildren(projectId);
}

export async function listVisibleProjects(userId: string): Promise<Project[]> {
  const user = await requireUserWithCompany(userId);
  const owned = await listOwnedProjects(user.companyId!);
  const connected = await listConnectedProjects(user.companyId!);
  return [...owned, ...connected];
}

/** What someone holding a project's code (typed or from an invite link) is about to join. */
export interface ProjectPreview {
  project: { id: string; name: string; address: string | null };
  gcCompanyName: string;
  /** Your own company's name, for "Connect <it> to this project"; null if you have none. */
  yourCompanyName: string | null;
  /** "own": your company's project; "connected": already joined; "available": can join now. */
  status: "own" | "connected" | "available";
  /** Whether you yourself may connect your company (a subcontractor's owner or manager). */
  canConnect: boolean;
  /** Why not, in words the join page can show as-is. */
  reason: string | null;
}

/**
 * Who may connect their company to a GC's project: GCs own projects and bring
 * subcontractors onto them, so the joining company must be a sub, and the
 * person doing it must be able to commit that company's crews (Partial or
 * higher). Crew members (Level 1 / Basic) see the project but ask their owner.
 */
async function connectBlocker(user: User): Promise<string | null> {
  const company = user.companyId ? await findCompanyById(user.companyId) : undefined;
  if (!company) return "Set up or join your company first.";
  if (company.companyType !== "sub" && !user.isAdmin) {
    return "Only subcontractor companies join a GC's project. To work with another GC, use Connected companies.";
  }
  if (!(await actorHasPartialOrHigher(user))) {
    return "Ask your company's owner or office manager to connect the company to this project.";
  }
  return null;
}

export async function previewProjectByCode(userId: string, code: string): Promise<ProjectPreview> {
  const user = await findUserById(userId);
  if (!user) throw new NotFoundError("User not found.");
  const project = await findProjectByConnectionCode(code.trim());
  if (!project) throw new NotFoundError("No project found for that code. Check it with the general contractor.");
  const gc = await findCompanyById(project.companyId);
  const yours = user.companyId ? await findCompanyById(user.companyId) : undefined;
  const status =
    project.companyId === user.companyId
      ? "own"
      : user.companyId && (await findProjectConnection(project.id, user.companyId))
        ? "connected"
        : "available";
  const reason = status === "available" ? await connectBlocker(user) : null;
  return {
    project: { id: project.id, name: project.name, address: project.address },
    gcCompanyName: gc?.name ?? "A general contractor",
    yourCompanyName: yours?.name ?? null,
    status,
    canConnect: status === "available" && reason === null,
    reason,
  };
}

export async function connectProjectByCode(userId: string, code: string): Promise<Project> {
  const user = await requireUserWithCompany(userId);
  const project = await findProjectByConnectionCode(code.trim());
  if (!project) {
    throw new NotFoundError("No project found for that code.");
  }
  if (project.companyId === user.companyId) {
    throw new ConflictError("That's your own project.");
  }
  if (await findProjectConnection(project.id, user.companyId!)) {
    throw new ConflictError("Already connected to that project.");
  }
  const blocker = await connectBlocker(user);
  if (blocker) throw new ForbiddenError(blocker);

  await createProjectConnection(project.id, user.companyId!);
  return project;
}

async function canSeeProject(companyId: string, projectId: string): Promise<boolean> {
  const project = await findProjectById(projectId);
  if (!project) return false;
  if (project.companyId === companyId) return true;
  return !!(await findProjectConnection(projectId, companyId));
}

/** Companies connected to a project — who a GC can pick from when requesting people. */
export async function listProjectConnectedCompanies(userId: string, projectId: string): Promise<Company[]> {
  const user = await requireUserWithCompany(userId);
  if (!(await canSeeProject(user.companyId!, projectId))) {
    throw new NotFoundError("Project not found.");
  }
  const companies = await Promise.all(
    (await listProjectConnections(projectId)).map((conn) => findCompanyById(conn.subCompanyId)),
  );
  return companies.filter((company): company is Company => !!company);
}

async function sharesAProject(companyA: string, companyB: string): Promise<boolean> {
  for (const p of await listOwnedProjects(companyA)) {
    if (await findProjectConnection(p.id, companyB)) return true;
  }
  for (const p of await listOwnedProjects(companyB)) {
    if (await findProjectConnection(p.id, companyA)) return true;
  }
  return false;
}

/**
 * The employee roster of a company you're connected to via a shared
 * project — what a GC needs to pick who to request from a connected sub
 * (mirrors the original's cross-company RLS for `employees`).
 */
export async function listConnectedCompanyEmployees(userId: string, targetCompanyId: string): Promise<Employee[]> {
  const user = await requireUserWithCompany(userId);
  if (!user.isAdmin && user.companyId !== targetCompanyId && !(await sharesAProject(user.companyId!, targetCompanyId))) {
    throw new ForbiddenError("You can only view employees of a company connected to a shared project.");
  }
  return listCompanyEmployees(targetCompanyId);
}

export interface SetAvailabilityParams {
  date: string;
  startTime: string;
  endTime: string;
  projectId?: string;
  allProjects?: boolean;
  /** Publish hours for this employee instead of the caller themself. */
  employeeId?: string;
  /** Which stop this is when someone works several separate blocks in a day (1-based). */
  stopNumber?: number;
}

/**
 * Which employee row a write to `availability` is allowed to land on.
 *
 * This used to always resolve the employee linked to the caller, so a GC or an
 * account holder could never publish a crew's hours for them — which is why
 * ResourceMatrix had to render every other employee's row read-only.
 *
 * The original app allowed it through RLS rather than through the REST layer:
 * the insert/update/delete policies on `availability` required only that the
 * target employee belong to the caller's own company
 * (20251213144102_90db3129, "Manage availability"), and the UI narrowed that
 * with permission level — ProfilesModal.tsx describes partial/full/account_holder
 * as able to "manage schedules", while level_1 and basic explicitly "cannot
 * edit availability".
 *
 * So: naming yourself is always allowed, naming somebody else needs
 * Partial-level or higher, and the employee has to be on your own roster.
 * Deliberately *not* allowed for a connected sub's employees — a GC booking
 * another company's crew goes through the schedule-request flow, which is the
 * entire point of it.
 */
async function resolveEmployeeToSchedule(user: User, employeeId?: string): Promise<Employee> {
  const ownEmployee = await findEmployeeByLinkedUser(user.companyId!, user.id);
  const targetId = employeeId ?? ownEmployee?.id;
  if (!targetId) {
    throw new ConflictError("No employee record found for your account in this company.");
  }

  const target = await findEmployeeById(targetId);
  if (!target) {
    throw new NotFoundError("Employee not found.");
  }
  if (ownEmployee && target.id === ownEmployee.id) return target;

  if (target.companyId !== user.companyId) {
    throw new ForbiddenError("You can only publish availability for employees of your own company.");
  }
  if (!(await actorHasPartialOrHigher(user))) {
    throw new ForbiddenError(
      "You need Partial-level access or higher to publish availability for other people.",
    );
  }
  return target;
}

export async function setAvailability(userId: string, params: SetAvailabilityParams): Promise<Availability> {
  const user = await requireUserWithCompany(userId);

  if (!DATE_RE.test(params.date)) throw new BadRequestError("date must be formatted YYYY-MM-DD.");
  if (!TIME_RE.test(params.startTime) || !TIME_RE.test(params.endTime)) {
    throw new BadRequestError("startTime/endTime must be formatted HH:MM.");
  }
  if (params.startTime >= params.endTime) {
    throw new BadRequestError("startTime must be before endTime.");
  }
  if (!params.allProjects && !params.projectId) {
    throw new BadRequestError("Provide a projectId, or set allProjects.");
  }
  if (params.projectId && !(await canSeeProject(user.companyId!, params.projectId))) {
    throw new NotFoundError("Project not found.");
  }
  assertDateUnlocked(params.date, user);

  const employee = await resolveEmployeeToSchedule(user, params.employeeId);

  const stop = params.stopNumber;
  if (stop !== undefined && stop !== null && (!Number.isInteger(stop) || stop < 1 || stop > 10)) {
    throw new BadRequestError("stopNumber must be a whole number from 1 to 10.");
  }

  return await createAvailabilityRow({
    employeeId: employee.id,
    projectId: params.allProjects ? null : params.projectId!,
    date: params.date,
    startTime: params.startTime,
    endTime: params.endTime,
    allProjects: !!params.allProjects,
    stopNumber: stop ?? null,
    // Same label the original generates.
    stopLabel: stop ? `Stop #${stop}` : null,
  });
}

export async function listAvailability(userId: string, startDate: string, endDate: string): Promise<Availability[]> {
  const user = await requireUserWithCompany(userId);
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw new BadRequestError("start/end must be formatted YYYY-MM-DD.");
  }
  return await listAvailabilityForCompany(user.companyId!, startDate, endDate);
}

export async function deleteAvailability(userId: string, availabilityId: string) {
  const user = await requireUserWithCompany(userId);
  const row = await findAvailabilityById(availabilityId);
  if (!row) throw new NotFoundError("Availability entry not found.");

  const ownEmployee = await findEmployeeByLinkedUser(user.companyId!, user.id);
  const isOwnEntry = !!ownEmployee && ownEmployee.id === row.employeeId;
  if (!isOwnEntry) {
    // Removing somebody else's hours is the same privilege as publishing them,
    // so it goes through the same check rather than a blanket admin-only rule.
    const owner = await findEmployeeById(row.employeeId);
    if (!owner || owner.companyId !== user.companyId || !(await actorHasPartialOrHigher(user))) {
      throw new ForbiddenError("You can only remove your own availability.");
    }
  }
  assertDateUnlocked(row.date, user);

  await deleteAvailabilityRow(availabilityId);
}

export interface CreateScheduleRequestParams {
  taskId?: string;
  taskTrade?: string;
  projectId: string;
  subCompanyId: string;
  employeeIds: string[];
  date: string;
  startTime?: string;
  endTime?: string;
  description?: string;
  /** Photo attachments, as `/uploads/*` URLs previously returned by POST /uploads. */
  imageUrls?: string[];
}

export async function createScheduleRequest(userId: string, params: CreateScheduleRequestParams): Promise<ScheduleRequest> {
  if (typeof params.projectId !== "string" || !params.projectId || typeof params.subCompanyId !== "string" || !params.subCompanyId) throw new BadRequestError("Choose a project and subcontractor.");
  if (params.taskTrade !== undefined && typeof params.taskTrade !== "string") throw new BadRequestError("Review the task trade.");
  return scheduleWrite(params.projectId, params.subCompanyId, () => createValidatedScheduleRequest(userId, params));
}
async function createValidatedScheduleRequest(userId: string, params: CreateScheduleRequestParams): Promise<ScheduleRequest> {
  const user = await requireUserWithCompany(userId);

  if (!(await actorHasPartialOrHigher(user))) {
    throw new ForbiddenError("You need Partial-level access or higher to schedule people.");
  }
  if (!validDate(params.date)) throw new BadRequestError("Choose a valid schedule date (YYYY-MM-DD).");
  if ((params.startTime != null && !validTime(params.startTime)) || (params.endTime != null && !validTime(params.endTime))) throw new BadRequestError("Choose valid start and end times (HH:MM).");
  if (!!params.startTime !== !!params.endTime) throw new BadRequestError("Choose both start and end times.");
  if (params.startTime && params.endTime && params.startTime >= params.endTime) {
    throw new BadRequestError("startTime must be before endTime.");
  }
  if (!Array.isArray(params.employeeIds) || params.employeeIds.length === 0 || params.employeeIds.length > 500) {
    throw new BadRequestError("Pick at least one employee.");
  }
  if (!(await canSeeProject(user.companyId!, params.projectId))) {
    throw new NotFoundError("Project not found.");
  }
  assertDateUnlocked(params.date, user);

  if (new Set(params.employeeIds).size !== params.employeeIds.length || params.employeeIds.some((id) => typeof id !== "string" || !id)) throw new BadRequestError("Choose each worker only once.");
  const sameCompany = params.subCompanyId === user.companyId;
  const connected = !!(await findProjectConnection(params.projectId, params.subCompanyId));
  if (!sameCompany && !connected) {
    throw new BadRequestError("That company isn't connected to this project.");
  }

  for (const employeeId of params.employeeIds) {
    const employee = await findEmployeeById(employeeId);
    if (!employee || employee.companyId !== params.subCompanyId) {
      throw new BadRequestError(`Employee ${employeeId} does not belong to that company.`);
    }
  }

  if (params.taskId !== undefined) {
    if (typeof params.taskId !== "string" || !params.taskId) throw new BadRequestError("Choose a valid schedule task.");
    const project = await findProjectById(params.projectId);
    if (project?.companyId !== user.companyId) throw new ForbiddenError("Only the project's GC can send a task recommendation.");
    const task = await database.get<RecommendationTask>("SELECT * FROM tasks WHERE id = ? AND project_id = ?", [params.taskId, params.projectId]);
    if (!task) throw new ConflictError("This task no longer exists. Review the schedule before sending.");
    if (!task.trade) throw new ConflictError("This task needs review. Choose its trade before sending.");
    if (task.status === "complete") throw new ConflictError("This task is already complete.");
    if (params.taskTrade && normalizeTrade(params.taskTrade) !== normalizeTrade(task.trade)) throw new ConflictError("The task trade changed. Review the recommendation before sending.");
    const sub = await findCompanyById(params.subCompanyId);
    if (!connected || sub?.companyType !== "sub") throw new ConflictError("This subcontractor is no longer connected to the project.");
    if (normalizeTrade(sub.trade) !== normalizeTrade(task.trade)) throw new ConflictError(`This subcontractor does not match the task trade (${task.trade}). Choose a matching subcontractor.`);
    if (!validDate(task.start_date) || !validDate(task.end_date) || params.date < task.start_date || params.date > task.end_date) throw new ConflictError("The task dates changed. Choose a date within the task schedule.");
    if (!params.startTime || !params.endTime) throw new BadRequestError("Choose a start and end time for this recommendation.");
    const requests = await bookingHistory(params.date, params.date);
    const existing = requests.find((r) => r.taskId === task.id && ["pending", "confirmed"].includes(r.status));
    if (existing) throw new ConflictError(`Already ${existing.status}: this task has a request for this date. Review the existing request.`);
    const availability = await listAvailabilityForCompany(params.subCompanyId, params.date, params.date);
    const eligible = eligibleEmployees({ employeeIds: params.employeeIds, projectId: params.projectId, date: params.date, startTime: params.startTime, endTime: params.endTime, availability, requests });
    if (eligible.length < params.employeeIds.length) throw new ConflictError(`Only ${eligible.length} of the ${params.employeeIds.length} workers are still available. Review the recommendation before sending.`);
  }
  // Photos must be files this server actually served: no remote URLs, no
  // path escapes, and few enough to keep the request readable.
  const imageUrls = params.imageUrls ?? [];
  if (!Array.isArray(imageUrls) || imageUrls.length > 6) {
    throw new BadRequestError("Attach at most 6 photos.");
  }
  for (const url of imageUrls) {
    if (typeof url !== "string" || !/^\/uploads\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.(png|jpe?g|webp|gif)$/i.test(url)) {
      throw new BadRequestError("Photo attachments must be images uploaded to this server.");
    }
  }

  await assertNoBookingConflict(params, undefined);
  return await createScheduleRequestRow({
    projectId: params.projectId,
    taskId: params.taskId,
    requestingCompanyId: user.companyId!,
    subCompanyId: params.subCompanyId,
    employeeIds: params.employeeIds,
    date: params.date,
    startTime: params.startTime ?? null,
    endTime: params.endTime ?? null,
    description: params.description?.trim() || null,
    imageUrls,
  });
}

export async function listScheduleRequests(userId: string, startDate: string, endDate: string): Promise<ScheduleRequest[]> {
  const user = await requireUserWithCompany(userId);
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw new BadRequestError("start/end must be formatted YYYY-MM-DD.");
  }
  return await listScheduleRequestsForCompany(user.companyId!, startDate, endDate);
}

export async function updateScheduleRequestStatus(
  userId: string,
  requestId: string,
  status: ScheduleRequestStatus,
  reason?: string,
): Promise<ScheduleRequest> {
  const initial = await findScheduleRequestById(requestId);
  if (!initial) throw new NotFoundError("Schedule request not found.");
  return scheduleWrite(initial.projectId, initial.subCompanyId, () => updateValidatedStatus(userId, requestId, status, reason));
}
async function updateValidatedStatus(userId: string, requestId: string, status: ScheduleRequestStatus, reason?: string): Promise<ScheduleRequest> {
  const user = await requireUserWithCompany(userId);
  const req = await findScheduleRequestById(requestId);
  if (!req) throw new NotFoundError("Schedule request not found.");

  if (!(await actorHasPartialOrHigher(user))) {
    throw new ForbiddenError("You need Partial-level access or higher to act on schedule requests.");
  }
  assertDateUnlocked(req.date, user);

  if (status === "confirmed" || status === "rejected") {
    if (user.companyId !== req.subCompanyId) {
      throw new ForbiddenError("Only the company whose personnel are scheduled can respond to this request.");
    }
    if (req.status !== "pending") {
      throw new ConflictError("This request has already been handled.");
    }
  } else if (status === "cancelled") {
    if (user.companyId !== req.requestingCompanyId && user.companyId !== req.subCompanyId) {
      throw new ForbiddenError("You are not part of this request.");
    }
    if (req.status === "cancelled" || req.status === "rejected") {
      throw new ConflictError("This request is already closed.");
    }
  } else {
    throw new BadRequestError("status must be confirmed, rejected, or cancelled.");
  }

  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (trimmed.length > 500) {
    throw new BadRequestError("Reason must be 500 characters or fewer.");
  }

  if (status === "confirmed") {
    for (const id of req.employeeIds) {
      if ((await findEmployeeById(id))?.companyId !== user.companyId) throw new ConflictError("A worker no longer belongs to your company. Review this request.");
    }
    await assertNoBookingConflict(req, req.id);
    if (req.taskId && req.startTime && req.endTime) {
      const availability = await listAvailabilityForCompany(req.subCompanyId, req.date, req.date);
      const requests = (await bookingHistory(req.date, req.date)).filter((r) => r.id !== req.id);
      const eligible = eligibleEmployees({ ...req, startTime: req.startTime, endTime: req.endTime, availability, requests });
      if (eligible.length < req.employeeIds.length) throw new ConflictError("Availability changed while this request was pending. Review the crew before confirming.");
    }
  }
  await updateScheduleRequestStatusRow(requestId, status, trimmed || null);
  return (await findScheduleRequestById(requestId))!;
}

/** Minimal booking facts, including other GCs' projects; never returned as raw
 * cross-project history to the browser. The UI only receives eligible workers. */
async function bookingHistory(start: string, end: string): Promise<ExistingScheduleRequest[]> {
  const rows = await database.all<{ id: string; task_id: string | null; date: string; employee_ids: string; status: string; start_time: string | null; end_time: string | null }>(
    "SELECT id, task_id, date, employee_ids, status, start_time, end_time FROM schedule_requests WHERE date BETWEEN ? AND ? AND status IN ('pending', 'confirmed')", [start, end]);
  return rows.map((r) => ({ id: r.id, taskId: r.task_id, date: r.date, employeeIds: JSON.parse(r.employee_ids), status: r.status, startTime: r.start_time, endTime: r.end_time }));
}
async function assertNoBookingConflict(params: { employeeIds: string[]; date: string; startTime?: string | null; endTime?: string | null }, excludeId?: string) {
  const requests = await bookingHistory(params.date, params.date);
  if (requests.some((r) => r.id !== excludeId && r.employeeIds.some((id) => params.employeeIds.includes(id)) && overlaps(params.startTime, params.endTime, r.startTime, r.endTime))) throw new ConflictError("One or more workers already have an overlapping pending or confirmed request. Review the crew or choose another time.");
}
// SQLite has one connection; serialize scheduling writes before starting the
// async transaction. MySQL locks the project and actual employer, protecting
// both task duplicates and cross-project crew conflicts across API processes.
let scheduleQueue: Promise<unknown> = Promise.resolve();
async function scheduleWrite<T>(projectId: string, employerId: string, work: () => Promise<T>): Promise<T> {
  const run = () => database.transaction(async () => {
    if (database.dialect === "mysql") {
      await database.get("SELECT id FROM projects WHERE id = ? FOR UPDATE", [projectId]);
      await database.get("SELECT id FROM companies WHERE id = ? FOR UPDATE", [employerId]);
    }
    return work();
  });
  if (database.dialect !== "sqlite") return run();
  const result = scheduleQueue.then(run, run);
  scheduleQueue = result.catch(() => undefined);
  return result;
}
export interface RecommendationInput { taskIds: string[]; subIds: string[]; weeks: number[]; headcount: number; startTime: string; endTime: string; date?: string }
export async function previewScheduleRecommendations(userId: string, projectId: string, input: RecommendationInput) {
  const user = await requireUserWithCompany(userId);
  const project = await findProjectById(projectId);
  if (!project || project.companyId !== user.companyId) throw new ForbiddenError("Choose one of your projects to recommend a crew.");
  if (!(await actorHasPartialOrHigher(user))) throw new ForbiddenError("You need Partial-level access or higher to schedule people.");
  if (!Array.isArray(input.taskIds) || !input.taskIds.length || input.taskIds.length > 200 || input.taskIds.some((id) => typeof id !== "string")) throw new BadRequestError("Select between 1 and 200 tasks.");
  if (!Array.isArray(input.subIds) || input.subIds.some((id) => typeof id !== "string")) throw new BadRequestError("Choose connected subcontractors.");
  if (!Array.isArray(input.weeks) || !input.weeks.length || input.weeks.some((w) => !Number.isInteger(w) || w < 1 || w > 3)) throw new BadRequestError("Choose weeks 1, 2, or 3.");
  if (!Number.isInteger(input.headcount) || input.headcount < 1 || input.headcount > 500) throw new BadRequestError("Choose a whole crew size between 1 and 500.");
  if (!validTime(input.startTime) || !validTime(input.endTime) || input.startTime >= input.endTime) throw new BadRequestError("Choose valid start and end times.");
  if (input.date !== undefined) { if (!validDate(input.date)) throw new BadRequestError("Choose a valid date."); assertDateUnlocked(input.date, user); }
  const tasks = (await database.all<RecommendationTask>("SELECT * FROM tasks WHERE project_id = ? ORDER BY sort_order, id", [projectId])).filter((t) => input.taskIds.includes(t.id));
  if (tasks.length !== new Set(input.taskIds).size) throw new ConflictError("A selected task no longer exists. Refresh the schedule.");
  const subs = (await listProjectConnectedCompanies(userId, projectId)).filter((c) => c.companyType === "sub");
  if (input.subIds.some((id) => !subs.some((s) => s.id === id))) throw new ConflictError("A selected subcontractor is no longer connected. Refresh the schedule.");
  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 21);
  const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const start = input.date ?? local(windowStart), end = input.date && input.date > local(windowEnd) ? input.date : local(windowEnd);
  const selected = subs.filter((s) => input.subIds.includes(s.id));
  const employeesByCompany: Record<string, string[]> = {};
  const availability: Availability[] = [];
  for (const sub of selected) {
    employeesByCompany[sub.id] = (await listCompanyEmployees(sub.id)).map((e) => e.id);
    availability.push(...await listAvailabilityForCompany(sub.id, start, end));
  }
  const requests = await bookingHistory(start, end);
  return buildScheduleRecommendations({ tasks, subs, selectedSubs: selected, weeks: input.weeks, headcount: input.headcount, startTime: input.startTime, endTime: input.endTime, date: input.date, employeesByCompany, availability, requests, now });
}
