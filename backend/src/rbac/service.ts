import { database } from "../db.js";
import { findUserById, setUserCompany, type User } from "../models/users.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "./errors.js";
import {
  createCompanyRow,
  createEmployeeRow,
  createJoinRequest,
  deleteUserRole,
  findCompanyById,
  findJoinRequestById,
  findPendingJoinRequest,
  findUserRole,
  listCompanyEmployees,
  listCompanyRoles,
  listPendingJoinRequests,
  setJoinRequestStatus,
  setRoleCompanyCreator,
  createUserRole,
  unlinkUserEmployees,
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

async function actorFor(user: User, companyId: string | null): Promise<Actor> {
  const role = companyId ? await findUserRole(user.id, companyId) : undefined;
  return {
    userId: user.id,
    isAdmin: user.isAdmin,
    companyId,
    permissionLevel: role?.permissionLevel ?? null,
    isCompanyCreator: role?.isCompanyCreator ?? false,
  };
}

async function requireUser(userId: string): Promise<User> {
  const user = await findUserById(userId);
  if (!user) throw new NotFoundError("User not found.");
  return user;
}

async function requireCompany(companyId: string): Promise<Company> {
  const company = await findCompanyById(companyId);
  if (!company) throw new NotFoundError("Company not found.");
  return company;
}

export async function createCompany(userId: string, params: { name: string; companyType: CompanyType; address?: string; trade?: string }) {
  const user = await requireUser(userId);
  if (user.companyId) {
    throw new ConflictError("You already belong to a company.");
  }
  if (!params.name?.trim()) {
    throw new BadRequestError("Company name is required.");
  }
  if (params.companyType !== "gc" && params.companyType !== "sub") {
    throw new BadRequestError("companyType must be 'gc' or 'sub'.");
  }
  const trade = params.trade?.trim() || null;
  if (trade && trade.length > 60) {
    throw new BadRequestError("Trade must be 60 characters or fewer.");
  }

  return database.transaction(async () => {
    const company = await createCompanyRow({
      name: params.name.trim(),
      companyType: params.companyType,
      address: params.address?.trim() || null,
      trade,
    });

    await setUserCompany(user.id, company.id);

    const role = await createUserRole({
      userId: user.id,
      companyId: company.id,
      permissionLevel: "account_holder",
      isCompanyCreator: true,
    });

    await createEmployeeRow({
      companyId: company.id,
      name: user.fullName,
      email: user.email,
      linkedUserId: user.id,
    });

    return { company, role };
  });
}

export async function requestToJoinCompany(userId: string, companyId: string): Promise<JoinRequest> {
  const user = await requireUser(userId);
  await requireCompany(companyId);

  if (user.companyId) {
    throw new ConflictError("You already belong to a company.");
  }
  if (await findPendingJoinRequest(userId, companyId)) {
    throw new ConflictError("You already have a pending request to join this company.");
  }

  return createJoinRequest(userId, companyId);
}

export async function listJoinRequests(
  companyId: string,
  requesterUserId: string,
): Promise<(JoinRequest & { userName: string | null; userEmail: string | null })[]> {
  const company = await requireCompany(companyId);
  const requester = await requireUser(requesterUserId);
  const actor = await actorFor(requester, companyId);

  if (!canApproveJoinRequests(company.companyType, actor)) {
    throw new ForbiddenError("Only an account holder (or, for sub companies, a full-level admin) can view join requests.");
  }

  // The approver can't look the requester up themselves (they aren't in the
  // company yet), so name the person here.
  return Promise.all(
    (await listPendingJoinRequests(companyId)).map(async (request) => {
      const user = await findUserById(request.userId);
      return { ...request, userName: user?.fullName ?? null, userEmail: user?.email ?? null };
    }),
  );
}

async function requireApprover(companyId: string, approverUserId: string): Promise<{ company: Company; actor: Actor }> {
  const company = await requireCompany(companyId);
  const approver = await requireUser(approverUserId);
  const actor = await actorFor(approver, companyId);

  if (!canApproveJoinRequests(company.companyType, actor)) {
    throw new ForbiddenError("You do not have permission to approve or reject join requests.");
  }

  return { company, actor };
}

export async function approveJoinRequest(
  companyId: string,
  requestId: string,
  approverUserId: string,
  permissionLevel: PermissionLevel,
): Promise<UserRole> {
  const { company, actor } = await requireApprover(companyId, approverUserId);

  const request = await findJoinRequestById(requestId);
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

  const targetUser = await requireUser(request.userId);
  if (targetUser.companyId) {
    throw new ConflictError("That user already belongs to a company.");
  }

  return database.transaction(async () => {
    await setUserCompany(targetUser.id, companyId);
    const role = await createUserRole({ userId: targetUser.id, companyId, permissionLevel, isCompanyCreator: false });
    await createEmployeeRow({
      companyId,
      name: targetUser.fullName,
      email: targetUser.email,
      linkedUserId: targetUser.id,
    });
    await setJoinRequestStatus(requestId, "approved");
    return role;
  });
}

export async function rejectJoinRequest(companyId: string, requestId: string, approverUserId: string): Promise<void> {
  await requireApprover(companyId, approverUserId);

  const request = await findJoinRequestById(requestId);
  if (!request || request.companyId !== companyId) {
    throw new NotFoundError("Join request not found.");
  }
  if (request.status !== "pending") {
    throw new ConflictError("This join request has already been handled.");
  }

  await setJoinRequestStatus(requestId, "rejected");
}

export async function assignPermissionLevel(
  companyId: string,
  actorUserId: string,
  targetUserId: string,
  newLevel: PermissionLevel,
): Promise<UserRole> {
  const company = await requireCompany(companyId);
  const actorUser = await requireUser(actorUserId);
  const actor = await actorFor(actorUser, companyId);

  const targetRole = await findUserRole(targetUserId, companyId);
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

  await updateUserRolePermission(targetUserId, companyId, newLevel);
  return (await findUserRole(targetUserId, companyId))!;
}

/**
 * Move main account-holder status to another member (ProfilesModal's
 * "Transfer Main Company Account Holder Status"). The previous holder steps
 * down to `demoteTo` in the same transaction so the company is never
 * holder-less in between. Only a holder or admin can initiate; the creator
 * flag moves with the status.
 */
export async function transferAccountHolder(
  companyId: string,
  actorUserId: string,
  targetUserId: string,
  demoteTo: PermissionLevel = "full",
): Promise<{ previousHolderId: string; newHolderId: string }> {
  const company = await requireCompany(companyId);
  const actor = await actorFor(await requireUser(actorUserId), companyId);

  if (!actor.isAdmin && !isAccountHolder(actor)) {
    throw new ForbiddenError("Only the account holder or an admin can transfer holdership.");
  }
  if (typeof targetUserId !== "string" || !targetUserId) {
    throw new BadRequestError("A target member is required.");
  }
  if (!getVisiblePermissions(company.companyType).includes(demoteTo) || demoteTo === "account_holder") {
    throw new BadRequestError(
      `demoteTo must be a non-holder level valid for a ${company.companyType} company.`,
    );
  }

  const targetRole = await findUserRole(targetUserId, companyId);
  if (!targetRole) {
    throw new NotFoundError("That user is not a member of this company.");
  }

  // The status moves off whoever holds it now: the actor when they are a
  // holder-member, otherwise the current creator (or any holder) — this
  // covers an admin transferring on a company's behalf.
  const actorRole = await findUserRole(actorUserId, companyId);
  const actorHolds =
    !!actorRole &&
    (actorRole.permissionLevel === "account_holder" || actorRole.isCompanyCreator);
  const currentHolderId =
    (actorHolds ? actorUserId : null) ??
    (await listCompanyRoles(companyId)).find((r) => r.isCompanyCreator)?.userId ??
    (await listCompanyRoles(companyId)).find((r) => r.permissionLevel === "account_holder")?.userId ??
    null;
  if (!currentHolderId) {
    throw new ConflictError("This company has no account holder to transfer from.");
  }
  if (currentHolderId === targetUserId) {
    throw new BadRequestError("That member already holds this company.");
  }

  await database.transaction(async () => {
    await updateUserRolePermission(targetUserId, companyId, "account_holder");
    await setRoleCompanyCreator(targetUserId, companyId, true);
    await updateUserRolePermission(currentHolderId, companyId, demoteTo);
    await setRoleCompanyCreator(currentHolderId, companyId, false);
  });

  return { previousHolderId: currentHolderId, newHolderId: targetUserId };
}

/**
 * Remove a member from the company. Holder or admin only; never yourself,
 * never the company creator (transfer holdership first), and never the last
 * remaining holder. The roster rows stay — only the login link is detached —
 * so availability history and schedule references keep working.
 */
export async function removeMember(companyId: string, actorUserId: string, targetUserId: string): Promise<void> {
  await requireCompany(companyId);
  const actor = await actorFor(await requireUser(actorUserId), companyId);

  if (!actor.isAdmin && !isAccountHolder(actor)) {
    throw new ForbiddenError("Only the account holder or an admin can remove members.");
  }
  if (typeof targetUserId !== "string" || !targetUserId) {
    throw new BadRequestError("A target member is required.");
  }
  if (actorUserId === targetUserId) {
    throw new BadRequestError("You cannot remove yourself. Transfer holdership first if you are leaving.");
  }

  const targetRole = await findUserRole(targetUserId, companyId);
  if (!targetRole) {
    throw new NotFoundError("That user is not a member of this company.");
  }
  if (targetRole.isCompanyCreator) {
    throw new BadRequestError("Transfer the account holder status before removing the company creator.");
  }
  const targetIsHolder = targetRole.permissionLevel === "account_holder";
  if (targetIsHolder) {
    const otherHolders = (await listCompanyRoles(companyId)).filter(
      (r) => r.userId !== targetUserId && (r.permissionLevel === "account_holder" || r.isCompanyCreator),
    );
    if (otherHolders.length === 0) {
      throw new ConflictError("Cannot remove the last account holder. Transfer holdership first.");
    }
  }

  await database.transaction(async () => {
    await deleteUserRole(targetUserId, companyId);
    await setUserCompany(targetUserId, null);
    await unlinkUserEmployees(targetUserId, companyId);
  });
}

export interface CompanyMember {
  userId: string;
  email: string;
  fullName: string;
  permissionLevel: PermissionLevel;
  isCompanyCreator: boolean;
}

export async function listCompanyMembers(companyId: string, requesterUserId: string): Promise<CompanyMember[]> {
  await requireCompany(companyId);
  const requester = await requireUser(requesterUserId);

  if (!requester.isAdmin && requester.companyId !== companyId) {
    throw new ForbiddenError("You are not a member of this company.");
  }

  return Promise.all(
    (await listCompanyRoles(companyId)).map(async (role) => {
      const member = await findUserById(role.userId);
      return {
        userId: role.userId,
        email: member?.email ?? "",
        fullName: member?.fullName ?? "",
        permissionLevel: role.permissionLevel,
        isCompanyCreator: role.isCompanyCreator,
      };
    }),
  );
}

export async function listEmployees(companyId: string, requesterUserId: string) {
  await requireCompany(companyId);
  const requester = await requireUser(requesterUserId);

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

export async function getUserContext(userId: string): Promise<UserContext> {
  const user = await requireUser(userId);
  const company = user.companyId ? (await findCompanyById(user.companyId)) ?? null : null;
  const actor = await actorFor(user, user.companyId);
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
