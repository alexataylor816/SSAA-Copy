/**
 * Role model, ported from the Lovable app's company_type + user_roles system
 * (SSAA/src/contexts/AuthContext.tsx, SSAA/src/components/dashboard/ProfilesModal.tsx).
 *
 * Simplified from the original: no operator sub-levels (main_operator vs
 * operator), no impersonation, no hard-coded "OMO" super-admin email, no
 * guest-company auto-account-holder path. `isAdmin` replaces the original's
 * `profiles.role === 'moa'` platform-admin flag.
 */

export type CompanyType = "gc" | "sub";

export const PERMISSION_LEVELS = ["basic", "level_1", "partial", "full", "account_holder"] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export const PERMISSION_HIERARCHY: Record<PermissionLevel, number> = {
  basic: 0,
  level_1: 1,
  partial: 2,
  full: 3,
  account_holder: 4,
};

export interface Company {
  id: string;
  name: string;
  companyType: CompanyType;
  address: string | null;
  trade: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserRole {
  id: string;
  userId: string;
  companyId: string;
  permissionLevel: PermissionLevel;
  isCompanyCreator: boolean;
  createdAt: string;
  updatedAt: string;
}

export type JoinRequestStatus = "pending" | "approved" | "rejected";

export interface JoinRequest {
  id: string;
  userId: string;
  companyId: string;
  status: JoinRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Employee {
  id: string;
  companyId: string;
  name: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  /** Optional payroll/HR identifier, shown on timesheet exports (the original's employees.employee_id). */
  employeeNumber: string | null;
  linkedUserId: string | null;
  createdAt: string;
}
