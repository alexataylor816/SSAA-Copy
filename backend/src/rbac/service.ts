import { db } from "../db.js";
import { findUserById, setUserCompany, type User } from "../models/users.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "./errors.js";
import {
  createCompanyRow,
  createEmployeeRow,
  createJoinRequest,
  findCompanyById,
  findJoinRequestById,
  findPendingJoinRequest,
  findUserRole,
  listCompanyEmployees,
  listCompanyRoles,
  listPendingJoinRequests,
  setJoinRequestStatus,
  createUserRole,
  updateUserRolePermission,
} from "./models.js";
import {
  canApproveJoinRequests,
  canAssignPermission,
  canManagePermissions,
  getVisiblePermissions,
  hasLevel1OrHigher,
  hasPartialOrHigher,
  isAccountHolder,
  isBasicUser,
  type Actor,
} from "./permissions.js";
import type { Company, CompanyType, JoinRequest, PermissionLevel, UserRole } from "./types.js";

function actorFor(user: User, companyId: string | null): Actor {
  const role = companyId ? findUserRole(user.id, companyId) : undefined;
  return {
    userId: user.id,
    isAdmin: user.isAdmin,
    companyId,
    permissionLevel: role?.permissionLevel ?? null,
    isCompanyCreator: role?.isCompanyCreator ?? false,
  };
}

function requireUser(userId: string): User {
  const user = findUserById(userId);
  if (!user) throw new NotFoundError("User not found.");
  return user;
}

function requireCompany(companyId: string): Company {
  const company = findCompanyById(companyId);
  if (!company) throw new NotFoundError("Company not found.");
  return company;
}

export function createCompany(userId: string, params: { name: string; companyType: CompanyType; address?: string }) {
  const user = requireUser(userId);
  if (user.companyId) {
    throw new ConflictError("You already belong to a company.");
  }
  if (!params.name?.trim()) {
    throw new BadRequestError("Company name is required.");
  }
  if (params.companyType !== "gc" && params.companyType !== "sub") {
    throw new BadRequestError("companyType must be 'gc' or 'sub'.");
  }

  const run = db.transaction(() => {
    const company = createCompanyRow({
      name: params.name.trim(),
      companyType: params.companyType,
      address: params.address?.trim() || null,
    });

    setUserCompany(user.id, company.id);

    const role = createUserRole({
      userId: user.id,
      companyId: company.id,
      permissionLevel: "account_holder",
      isCompanyCreator: true,
    });

    createEmployeeRow({
      companyId: company.id,
      name: user.fullName,
      email: user.email,
      linkedUserId: user.id,
    });

    return { company, role };
  });

  return run();
}

export function requestToJoinCompany(userId: string, companyId: string): JoinRequest {
  const user = requireUser(userId);
  requireCompany(companyId);

  if (user.companyId) {
    throw new ConflictError("You already belong to a company.");
  }
  if (findPendingJoinRequest(userId, companyId)) {
    throw new ConflictError("You already have a pending request to join this company.");
  }

  return createJoinRequest(userId, companyId);
}

export function listJoinRequests(companyId: string, requesterUserId: string): JoinRequest[] {
  const company = requireCompany(companyId);
  const requester = requireUser(requesterUserId);
  const actor = actorFor(requester, companyId);

  if (!canApproveJoinRequests(company.companyType, actor)) {
    throw new ForbiddenError("Only an account holder (or, for sub companies, a full-level admin) can view join requests.");
  }

  return listPendingJoinRequests(companyId);
}

function requireApprover(companyId: string, approverUserId: string): { company: Company; actor: Actor } {
  const company = requireCompany(companyId);
  const approver = requireUser(approverUserId);
  const actor = actorFor(approver, companyId);

  if (!canApproveJoinRequests(company.companyType, actor)) {
    throw new ForbiddenError("You do not have permission to approve or reject join requests.");
  }

  return { company, actor };
}

export function approveJoinRequest(
  companyId: string,
  requestId: string,
  approverUserId: string,
  permissionLevel: PermissionLevel,
): UserRole {
  const { company, actor } = requireApprover(companyId, approverUserId);

  const request = findJoinRequestById(requestId);
  if (!request || request.companyId !== companyId) {
    throw new NotFoundError("Join request not found.");
  }
  if (request.status !== "pending") {
    throw new ConflictError("This join request has already been handled.");
  }
  if (!getVisiblePermissions(company.companyType).includes(permissionLevel)) {
    throw new BadRequestError(`${permissionLevel} is not a valid permission level for a ${company.companyType} company.`);
  }
  if ((permissionLevel === "full" || permissionLevel === "account_holder") && !actor.isAdmin && !isAccountHolder(actor)) {
    throw new ForbiddenError("Only an account holder or admin can grant that level.");
  }

  const targetUser = requireUser(request.userId);
  if (targetUser.companyId) {
    throw new ConflictError("That user already belongs to a company.");
  }

  const run = db.transaction(() => {
    setUserCompany(targetUser.id, companyId);
    const role = createUserRole({ userId: targetUser.id, companyId, permissionLevel, isCompanyCreator: false });
    createEmployeeRow({
      companyId,
      name: targetUser.fullName,
      email: targetUser.email,
      linkedUserId: targetUser.id,
    });
    setJoinRequestStatus(requestId, "approved");
    return role;
  });

  return run();
}

export function rejectJoinRequest(companyId: string, requestId: string, approverUserId: string): void {
  requireApprover(companyId, approverUserId);

  const request = findJoinRequestById(requestId);
  if (!request || request.companyId !== companyId) {
    throw new NotFoundError("Join request not found.");
  }
  if (request.status !== "pending") {
    throw new ConflictError("This join request has already been handled.");
  }

  setJoinRequestStatus(requestId, "rejected");
}

export function assignPermissionLevel(
  companyId: string,
  actorUserId: string,
  targetUserId: string,
  newLevel: PermissionLevel,
): UserRole {
  const company = requireCompany(companyId);
  const actorUser = requireUser(actorUserId);
  const actor = actorFor(actorUser, companyId);

  const targetRole = findUserRole(targetUserId, companyId);
  if (!targetRole) {
    throw new NotFoundError("That user is not a member of this company.");
  }

  const check = canAssignPermission({
    actor,
    targetUserId,
    targetCurrentLevel: targetRole.permissionLevel,
    newLevel,
    companyType: company.companyType,
  });
  if (!check.allowed) {
    throw new ForbiddenError(check.reason);
  }

  updateUserRolePermission(targetUserId, companyId, newLevel);
  return findUserRole(targetUserId, companyId)!;
}

export interface CompanyMember {
  userId: string;
  email: string;
  fullName: string;
  permissionLevel: PermissionLevel;
  isCompanyCreator: boolean;
}

export function listCompanyMembers(companyId: string, requesterUserId: string): CompanyMember[] {
  requireCompany(companyId);
  const requester = requireUser(requesterUserId);

  if (!requester.isAdmin && requester.companyId !== companyId) {
    throw new ForbiddenError("You are not a member of this company.");
  }

  return listCompanyRoles(companyId).map((role) => {
    const member = findUserById(role.userId);
    return {
      userId: role.userId,
      email: member?.email ?? "",
      fullName: member?.fullName ?? "",
      permissionLevel: role.permissionLevel,
      isCompanyCreator: role.isCompanyCreator,
    };
  });
}

export function listEmployees(companyId: string, requesterUserId: string) {
  requireCompany(companyId);
  const requester = requireUser(requesterUserId);

  if (!requester.isAdmin && requester.companyId !== companyId) {
    throw new ForbiddenError("You are not a member of this company.");
  }

  return listCompanyEmployees(companyId);
}

/**
 * Every capability the API actually enforces, resolved server-side.
 *
 * Clients used to re-derive these from `permissionLevel` and guessed wrong:
 * the UI gated join-request approval on `hasPartialOrHigher` while the service
 * requires `canApproveJoinRequests`, so `partial` users saw controls that
 * always 403'd. Clients must read these flags instead of recomputing them.
 */
export interface UserCapabilities {
  canApproveJoinRequests: boolean;
  canRemoveAnyAvailability: boolean;
  canSchedulePeople: boolean;
  canRespondToScheduleRequests: boolean;
  canManageTeam: boolean;
  isReadOnlyScheduling: boolean;
}

export interface UserContext {
  isAdmin: boolean;
  company: Company | null;
  permissionLevel: PermissionLevel | null;
  isAccountHolder: boolean;
  hasPartialOrHigher: boolean;
  hasLevel1OrHigher: boolean;
  isBasicUser: boolean;
  visiblePermissions: PermissionLevel[];
  capabilities: UserCapabilities;
}

export function getUserContext(userId: string): UserContext {
  const user = requireUser(userId);
  const company = user.companyId ? findCompanyById(user.companyId) ?? null : null;
  const actor = actorFor(user, user.companyId);
  const isSchedulingActor = hasPartialOrHigher(actor);

  return {
    isAdmin: user.isAdmin,
    company,
    permissionLevel: actor.permissionLevel,
    isAccountHolder: isAccountHolder(actor),
    hasPartialOrHigher: isSchedulingActor,
    hasLevel1OrHigher: hasLevel1OrHigher(actor),
    isBasicUser: isBasicUser(actor.permissionLevel),
    visiblePermissions: company ? getVisiblePermissions(company.companyType) : [],
    capabilities: {
      canApproveJoinRequests: company ? canApproveJoinRequests(company.companyType, actor) : false,
      // scheduling/service.ts deleteAvailability: own entry or isAdmin only.
      canRemoveAnyAvailability: user.isAdmin,
      canSchedulePeople: isSchedulingActor,
      canRespondToScheduleRequests: isSchedulingActor,
      canManageTeam: canManagePermissions(actor),
      // Mirrors Dashboard.tsx's readOnly force for basic / sub-level_1 users.
      isReadOnlyScheduling: !hasLevel1OrHigher(actor),
    },
  };
}
