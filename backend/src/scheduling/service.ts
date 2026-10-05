import {
  findCompanyById,
  findEmployeeById,
  findEmployeeByLinkedUser,
  findUserRole,
  listCompanyEmployees,
} from "../rbac/models.js";
import { hasPartialOrHigher } from "../rbac/permissions.js";
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

function requireUserWithCompany(userId: string) {
  const user = findUserById(userId);
  if (!user) throw new NotFoundError("User not found.");
  if (!user.companyId) throw new ConflictError("You need to be part of a company first.");
  return user;
}

function actorHasPartialOrHigher(user: User): boolean {
  if (user.isAdmin) return true;
  if (!user.companyId) return false;
  const role = findUserRole(user.id, user.companyId);
  return hasPartialOrHigher({ isAdmin: user.isAdmin, permissionLevel: role?.permissionLevel ?? null });
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

export function createProject(userId: string, params: { name: string; address?: string }): Project {
  const user = requireUserWithCompany(userId);
  if (!params.name?.trim()) {
    throw new BadRequestError("Project name is required.");
  }

  return createProjectRow({ name: params.name.trim(), address: params.address?.trim() || null, companyId: user.companyId! });
}

export function listVisibleProjects(userId: string): Project[] {
  const user = requireUserWithCompany(userId);
  const owned = listOwnedProjects(user.companyId!);
  const connected = listConnectedProjects(user.companyId!);
  return [...owned, ...connected];
}

export function connectProjectByCode(userId: string, code: string): Project {
  const user = requireUserWithCompany(userId);
  const project = findProjectByConnectionCode(code.trim());
  if (!project) {
    throw new NotFoundError("No project found for that code.");
  }
  if (project.companyId === user.companyId) {
    throw new ConflictError("That's your own project.");
  }
  if (findProjectConnection(project.id, user.companyId!)) {
    throw new ConflictError("Already connected to that project.");
  }

  createProjectConnection(project.id, user.companyId!);
  return project;
}

function canSeeProject(companyId: string, projectId: string): boolean {
  const project = findProjectById(projectId);
  if (!project) return false;
  if (project.companyId === companyId) return true;
  return !!findProjectConnection(projectId, companyId);
}

/** Companies connected to a project — who a GC can pick from when requesting people. */
export function listProjectConnectedCompanies(userId: string, projectId: string): Company[] {
  const user = requireUserWithCompany(userId);
  if (!canSeeProject(user.companyId!, projectId)) {
    throw new NotFoundError("Project not found.");
  }
  return listProjectConnections(projectId)
    .map((conn) => findCompanyById(conn.subCompanyId))
    .filter((company): company is Company => !!company);
}

function sharesAProject(companyA: string, companyB: string): boolean {
  const ownedByA = listOwnedProjects(companyA);
  if (ownedByA.some((p) => findProjectConnection(p.id, companyB))) return true;
  const ownedByB = listOwnedProjects(companyB);
  return ownedByB.some((p) => findProjectConnection(p.id, companyA));
}

/**
 * The employee roster of a company you're connected to via a shared
 * project — what a GC needs to pick who to request from a connected sub
 * (mirrors the original's cross-company RLS for `employees`).
 */
export function listConnectedCompanyEmployees(userId: string, targetCompanyId: string): Employee[] {
  const user = requireUserWithCompany(userId);
  if (!user.isAdmin && user.companyId !== targetCompanyId && !sharesAProject(user.companyId!, targetCompanyId)) {
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
}

export function setAvailability(userId: string, params: SetAvailabilityParams): Availability {
  const user = requireUserWithCompany(userId);

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
  if (params.projectId && !canSeeProject(user.companyId!, params.projectId)) {
    throw new NotFoundError("Project not found.");
  }
  assertDateUnlocked(params.date, user);

  const employee = findEmployeeByLinkedUser(user.companyId!, user.id);
  if (!employee) {
    throw new ConflictError("No employee record found for your account in this company.");
  }

  return createAvailabilityRow({
    employeeId: employee.id,
    projectId: params.allProjects ? null : params.projectId!,
    date: params.date,
    startTime: params.startTime,
    endTime: params.endTime,
    allProjects: !!params.allProjects,
  });
}

export function listAvailability(userId: string, startDate: string, endDate: string): Availability[] {
  const user = requireUserWithCompany(userId);
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw new BadRequestError("start/end must be formatted YYYY-MM-DD.");
  }
  return listAvailabilityForCompany(user.companyId!, startDate, endDate);
}

export function deleteAvailability(userId: string, availabilityId: string) {
  const user = requireUserWithCompany(userId);
  const row = findAvailabilityById(availabilityId);
  if (!row) throw new NotFoundError("Availability entry not found.");

  const employee = findEmployeeByLinkedUser(user.companyId!, user.id);
  const isOwnEntry = employee && employee.id === row.employeeId;
  if (!isOwnEntry && !user.isAdmin) {
    throw new ForbiddenError("You can only remove your own availability.");
  }
  assertDateUnlocked(row.date, user);

  deleteAvailabilityRow(availabilityId);
}

export interface CreateScheduleRequestParams {
  projectId: string;
  subCompanyId: string;
  employeeIds: string[];
  date: string;
  startTime?: string;
  endTime?: string;
  description?: string;
}

export function createScheduleRequest(userId: string, params: CreateScheduleRequestParams): ScheduleRequest {
  const user = requireUserWithCompany(userId);

  if (!actorHasPartialOrHigher(user)) {
    throw new ForbiddenError("You need Partial-level access or higher to schedule people.");
  }
  if (!DATE_RE.test(params.date)) throw new BadRequestError("date must be formatted YYYY-MM-DD.");
  if (params.startTime && !TIME_RE.test(params.startTime)) throw new BadRequestError("startTime must be formatted HH:MM.");
  if (params.endTime && !TIME_RE.test(params.endTime)) throw new BadRequestError("endTime must be formatted HH:MM.");
  if (params.startTime && params.endTime && params.startTime >= params.endTime) {
    throw new BadRequestError("startTime must be before endTime.");
  }
  if (!Array.isArray(params.employeeIds) || params.employeeIds.length === 0) {
    throw new BadRequestError("Pick at least one employee.");
  }
  if (!canSeeProject(user.companyId!, params.projectId)) {
    throw new NotFoundError("Project not found.");
  }
  assertDateUnlocked(params.date, user);

  const sameCompany = params.subCompanyId === user.companyId;
  const connected = !!findProjectConnection(params.projectId, params.subCompanyId);
  if (!sameCompany && !connected) {
    throw new BadRequestError("That company isn't connected to this project.");
  }

  for (const employeeId of params.employeeIds) {
    const employee = findEmployeeById(employeeId);
    if (!employee || employee.companyId !== params.subCompanyId) {
      throw new BadRequestError(`Employee ${employeeId} does not belong to that company.`);
    }
  }

  return createScheduleRequestRow({
    projectId: params.projectId,
    requestingCompanyId: user.companyId!,
    subCompanyId: params.subCompanyId,
    employeeIds: params.employeeIds,
    date: params.date,
    startTime: params.startTime ?? null,
    endTime: params.endTime ?? null,
    description: params.description?.trim() || null,
  });
}

export function listScheduleRequests(userId: string, startDate: string, endDate: string): ScheduleRequest[] {
  const user = requireUserWithCompany(userId);
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw new BadRequestError("start/end must be formatted YYYY-MM-DD.");
  }
  return listScheduleRequestsForCompany(user.companyId!, startDate, endDate);
}

export function updateScheduleRequestStatus(
  userId: string,
  requestId: string,
  status: ScheduleRequestStatus,
): ScheduleRequest {
  const user = requireUserWithCompany(userId);
  const req = findScheduleRequestById(requestId);
  if (!req) throw new NotFoundError("Schedule request not found.");

  if (!actorHasPartialOrHigher(user)) {
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

  updateScheduleRequestStatusRow(requestId, status);
  return findScheduleRequestById(requestId)!;
}
