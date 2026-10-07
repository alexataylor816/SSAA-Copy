import { PERMISSION_HIERARCHY, type CompanyType, type PermissionLevel } from "./types.js";

export function rank(level: PermissionLevel): number {
  return PERMISSION_HIERARCHY[level];
}

export function hasAtLeast(level: PermissionLevel, minimum: PermissionLevel): boolean {
  return rank(level) >= rank(minimum);
}

export interface Actor {
  userId: string;
  isAdmin: boolean;
  companyId: string | null;
  permissionLevel: PermissionLevel | null;
  isCompanyCreator: boolean;
}

export function isAccountHolder(actor: Pick<Actor, "permissionLevel" | "isCompanyCreator">): boolean {
  return actor.permissionLevel === "account_holder" || actor.isCompanyCreator === true;
}

export function hasPartialOrHigher(actor: Pick<Actor, "isAdmin" | "permissionLevel">): boolean {
  return actor.isAdmin || (actor.permissionLevel !== null && hasAtLeast(actor.permissionLevel, "partial"));
}

export function hasLevel1OrHigher(actor: Pick<Actor, "isAdmin" | "permissionLevel">): boolean {
  return actor.isAdmin || (actor.permissionLevel !== null && hasAtLeast(actor.permissionLevel, "level_1"));
}

export function isBasicUser(permissionLevel: PermissionLevel | null): boolean {
  return permissionLevel === "basic";
}

/**
 * Which permission levels are assignable for a company of this type.
 * GCs only use the top 3 tiers — level_1/basic are a sub-only "foreman /
 * basic worker" concept (SSAA/src/components/dashboard/ProfilesModal.tsx).
 */
export function getVisiblePermissions(companyType: CompanyType): PermissionLevel[] {
  return companyType === "gc"
    ? ["account_holder", "full", "partial"]
    : ["account_holder", "full", "partial", "level_1", "basic"];
}

/**
 * Who may see/act on pending company join requests.
 * GC: account holder only. Sub: account holder or a `full`-level admin.
 */
export function canApproveJoinRequests(
  companyType: CompanyType,
  actor: Pick<Actor, "isAdmin" | "permissionLevel" | "isCompanyCreator">,
): boolean {
  if (actor.isAdmin) return true;
  if (isAccountHolder(actor)) return true;
  if (companyType === "sub" && actor.permissionLevel === "full") return true;
  return false;
}

/** Who may open the team permission-editing UI at all (target-specific rules follow in canAssignPermission). */
export function canManagePermissions(actor: Pick<Actor, "isAdmin" | "permissionLevel" | "isCompanyCreator">): boolean {
  if (actor.isAdmin || isAccountHolder(actor)) return true;
  return actor.permissionLevel === "full" || actor.permissionLevel === "partial";
}

export interface AssignPermissionCheck {
  actor: Actor;
  targetUserId: string;
  targetCurrentLevel: PermissionLevel;
  newLevel: PermissionLevel;
  companyType: CompanyType;
}

/**
 * Mirrors ProfilesModal.tsx's assignability rules:
 * - Can't change your own level (unless admin).
 * - Can't change someone at an equal-or-higher rank than you (unless admin/account holder).
 * - Only admin or account holder can assign `full` or `account_holder`.
 * - The new level must be one the company type actually uses.
 */
export function canAssignPermission(check: AssignPermissionCheck): { allowed: boolean; reason?: string } {
  const { actor, targetUserId, targetCurrentLevel, newLevel, companyType } = check;

  if (!getVisiblePermissions(companyType).includes(newLevel)) {
    return { allowed: false, reason: `${newLevel} is not a valid permission level for a ${companyType} company.` };
  }
  if (!canManagePermissions(actor)) {
    return { allowed: false, reason: "You do not have permission to manage team roles." };
  }
  if (actor.userId === targetUserId && !actor.isAdmin) {
    return { allowed: false, reason: "You cannot change your own permission level." };
  }
  if (!actor.isAdmin && !isAccountHolder(actor) && rank(targetCurrentLevel) >= rank(actor.permissionLevel ?? "basic")) {
    return { allowed: false, reason: "You cannot change someone at your level or higher." };
  }
  if ((newLevel === "full" || newLevel === "account_holder") && !actor.isAdmin && !isAccountHolder(actor)) {
    return { allowed: false, reason: "Only an account holder or admin can assign that level." };
  }

  return { allowed: true };
}
