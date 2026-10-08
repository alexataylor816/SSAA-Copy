/**
 * Table registry for the query endpoint.
 *
 * This is the replacement for the reference app's 191 Postgres RLS policies.
 * Every table the client can touch must be registered here with:
 *   - an explicit column allowlist (so a column name can never be injected)
 *   - a `scope` that ANDs in the row-visibility filter for the caller
 *   - optional per-row guards for insert/update/delete
 *
 * A table that is not registered is simply not reachable, which is what makes
 * the migration incremental: as each Lovable feature lands, its table gets an
 * entry here with real authorization.
 */
import { db } from "../db.js";
import { findEmployeeById, findEmployeeByLinkedUser, findUserRole } from "../rbac/models.js";
import { findUserById } from "../models/users.js";
import { canManagePermissions, hasLevel1OrHigher, hasPartialOrHigher, isAccountHolder } from "../rbac/permissions.js";
import type { CompanyType, PermissionLevel } from "../rbac/types.js";
import { ForbiddenError } from "../rbac/errors.js";

export interface Caller {
  userId: string;
  companyId: string | null;
  isAdmin: boolean;
  permissionLevel: PermissionLevel | null;
  isCompanyCreator: boolean;
}

export async function resolveCaller(userId: string): Promise<Caller> {
  const user = await findUserById(userId);
  if (!user) throw new ForbiddenError("User not found.");
  const role = user.companyId ? await findUserRole(user.id, user.companyId) : undefined;
  return {
    userId: user.id,
    companyId: user.companyId ?? null,
    isAdmin: user.isAdmin,
    permissionLevel: role?.permissionLevel ?? null,
    isCompanyCreator: role?.isCompanyCreator ?? false,
  };
}

export function companyTypeOf(companyId: string): CompanyType {
  const row = db
    .prepare("SELECT company_type FROM companies WHERE id = ?")
    .get(companyId) as { company_type: CompanyType } | undefined;
  return row?.company_type ?? "sub";
}

/** The set of project ids a caller can see: owned + connected + explicitly assigned. */
export function visibleProjectIds(caller: Caller): string[] {
  if (caller.isAdmin) {
    const all = db.prepare("SELECT id FROM projects").all() as { id: string }[];
    return all.map((r) => r.id);
  }
  if (!caller.companyId) return [];

  const rows = db
    .prepare(
      `SELECT id FROM projects WHERE company_id = @company
       UNION
       SELECT pc.project_id FROM project_connections pc WHERE pc.sub_company_id = @company
       UNION
       SELECT upa.project_id FROM user_project_assignments upa
         WHERE upa.user_id = @user AND upa.company_id = @company`,
    )
    .all({ company: caller.companyId, user: caller.userId }) as { id: string }[];
  return rows.map((r) => r.id);
}

export interface TableRule {
  /** Columns the client may read and write. Anything else is rejected. */
  columns: readonly string[];
  /** Extra AND-ed filters restricting which rows the caller can see. */
  scope?: (caller: Caller) => { sql: string; params: Record<string, unknown> } | null;
  /** Reject the whole write before touching the database. */
  canWrite?: (caller: Caller, rows: Record<string, unknown>[]) => void | Promise<void>;
  /** Columns the client may never write directly (server-managed). */
  readonlyColumns?: readonly string[];
}

/** Helper: build an `IN (...)` fragment from a list, or match nothing. */
function inList(column: string, values: string[], key: string) {
  if (values.length === 0) {
    return { sql: "1 = 0", params: {} };
  }
  const placeholders = values.map((_, i) => `@${key}${i}`).join(", ");
  return {
    sql: `${column} IN (${placeholders})`,
    params: Object.fromEntries(values.map((v, i) => [`${key}${i}`, v])),
  };
}

function ownCompany(caller: Caller) {
  return caller.companyId ? { sql: "company_id = @__own", params: { __own: caller.companyId } } : { sql: "1 = 0", params: {} };
}

const TASKS: TableRule = {
  columns: [
    "id",
    "project_id",
    "assigned_company_id",
    "name",
    "description",
    "start_date",
    "end_date",
    "color",
    "status",
    "sort_order",
    "created_at",
    "updated_at",
  ],
  scope: (caller) => inList("project_id", visibleProjectIds(caller), "vp"),
  canWrite: (caller, rows) => {
    if (!hasLevel1OrHigher(caller)) {
      throw new ForbiddenError("You need Foreman-level access or higher to edit the schedule.");
    }
    const allowed = new Set(visibleProjectIds(caller));
    for (const row of rows) {
      // Inserts carry project_id. Updates address the row by id instead, so
      // fall back to the project the task already belongs to — otherwise every
      // update would be rejected for "not accessing project undefined".
      const projectId =
        row.project_id ??
        (row.id
          ? (db.prepare("SELECT project_id FROM tasks WHERE id = ?").get(String(row.id)) as
              | { project_id: string }
              | undefined)?.project_id
          : undefined);
      if (projectId == null || !allowed.has(String(projectId))) {
        throw new ForbiddenError("You do not have access to that project.");
      }
    }
  },
};

export const TABLE_RULES: Record<string, TableRule> = {
  users: {
    columns: ["id", "email", "full_name", "phone", "language", "profile_picture_url", "company_id", "is_admin", "created_at"],
    // Never expose password_hash.
    scope: (caller) =>
      caller.isAdmin ? null : { sql: "(id = @__self OR company_id = @__own)", params: { __self: caller.userId, __own: caller.companyId } },
    canWrite: (caller) => {
      if (!caller.isAdmin) throw new ForbiddenError("Only admins can change user records.");
    },
    readonlyColumns: ["is_admin", "created_at"],
  },

  companies: {
    columns: ["id", "name", "company_type", "address", "trade", "created_at", "updated_at"],
    scope: (caller) => {
      if (caller.isAdmin) return null;
      // A company is visible if you belong to it, own one of its projects,
      // or you are connected to one of its projects.
      const rows = db
        .prepare(
          `SELECT id FROM companies WHERE id = @__own
           UNION SELECT company_id FROM projects WHERE company_id = @__own
           UNION SELECT pc.sub_company_id FROM project_connections pc
             JOIN projects p ON p.id = pc.project_id WHERE p.company_id = @__own
           UNION SELECT pc.sub_company_id FROM project_connections pc WHERE pc.sub_company_id = @__own`,
        )
        .all({ __own: caller.companyId }) as { id: string }[];
      return inList("id", rows.map((r) => r.id), "cv");
    },
    canWrite: async (caller, rows) => {
      for (const row of rows) {
        if (row.id && row.id !== caller.companyId) {
          const role = caller.companyId ? await findUserRole(caller.userId, String(row.id)) : undefined;
          if (!caller.isAdmin && !role) {
            throw new ForbiddenError("You are not a member of that company.");
          }
          if (!caller.isAdmin && !isAccountHolder({ permissionLevel: role?.permissionLevel ?? null, isCompanyCreator: role?.isCompanyCreator ?? false })) {
            throw new ForbiddenError("Only the account holder can edit company details.");
          }
        }
      }
    },
    readonlyColumns: ["created_at"],
  },

  user_roles: {
    columns: ["id", "user_id", "company_id", "permission_level", "is_company_creator", "created_at", "updated_at"],
    scope: (caller) =>
      caller.isAdmin
        ? null
        : hasPartialOrHigher(caller)
          ? ownCompany(caller)
          : { sql: "user_id = @__self", params: { __self: caller.userId } },
    canWrite: (caller) => {
      if (!canManagePermissions(caller)) {
        throw new ForbiddenError("You do not have permission to manage team roles.");
      }
    },
    readonlyColumns: ["is_company_creator", "created_at"],
  },

  company_join_requests: {
    columns: ["id", "user_id", "company_id", "status", "created_at", "updated_at"],
    scope: (caller) =>
      caller.isAdmin || hasPartialOrHigher(caller)
        ? null
        : { sql: "user_id = @__self", params: { __self: caller.userId } },
    canWrite: (caller) => {
      if (!hasPartialOrHigher(caller)) {
        throw new ForbiddenError("You need Partial-level access or higher to manage join requests.");
      }
    },
    readonlyColumns: ["user_id", "company_id", "created_at"],
  },

  employees: {
    columns: ["id", "company_id", "name", "email", "phone", "job_title", "employee_number", "linked_user_id", "created_at"],
    scope: (caller) => {
      if (caller.isAdmin) return null;
      // Own company, or a company you share a project with.
      const rows = db
        .prepare(
          `SELECT company_id AS id FROM employees WHERE company_id = @__own
           UNION SELECT e.company_id FROM employees e
             JOIN project_connections pc ON pc.sub_company_id = e.company_id
             JOIN projects p ON p.id = pc.project_id WHERE p.company_id = @__own
           UNION SELECT e.company_id FROM employees e
             JOIN project_connections pc ON pc.sub_company_id = @__own
             JOIN projects p ON p.id = pc.project_id WHERE p.company_id = e.company_id`,
        )
        .all({ __own: caller.companyId }) as { id: string }[];
      return inList("company_id", rows.map((r) => r.id), "ev");
    },
    canWrite: (caller, rows) => {
      if (!canManagePermissions(caller)) {
        throw new ForbiddenError("You do not have permission to manage your team roster.");
      }
      for (const row of rows) {
        if (row.company_id && caller.companyId && row.company_id !== caller.companyId && !caller.isAdmin) {
          throw new ForbiddenError("You can only manage employees of your own company.");
        }
      }
    },
    readonlyColumns: ["created_at"],
  },

  projects: {
    columns: ["id", "name", "address", "company_id", "connection_code", "created_at", "updated_at"],
    scope: (caller) => inList("id", visibleProjectIds(caller), "pv"),
    canWrite: (caller, rows) => {
      if (!hasLevel1OrHigher(caller)) {
        throw new ForbiddenError("You need Foreman-level access or higher to manage projects.");
      }
      for (const row of rows) {
        const isUpdate = !!row.id;
        if (isUpdate) {
          if (!visibleProjectIds(caller).includes(String(row.id))) {
            throw new ForbiddenError("You do not have access to that project.");
          }
        } else if (row.company_id && row.company_id !== caller.companyId && !caller.isAdmin) {
          throw new ForbiddenError("You can only create projects for your own company.");
        }
      }
    },
    readonlyColumns: ["connection_code", "created_at"],
  },

  project_connections: {
    columns: ["id", "project_id", "sub_company_id", "connected_at"],
    scope: (caller) => {
      if (caller.isAdmin) return null;
      return inList("project_id", visibleProjectIds(caller), "cv");
    },
    canWrite: (caller, rows) => {
      if (!hasLevel1OrHigher(caller)) {
        throw new ForbiddenError("You need Foreman-level access or higher to manage project connections.");
      }
    },
    readonlyColumns: ["connected_at"],
  },

  project_aliases: {
    columns: ["id", "project_id", "company_id", "name", "address", "created_at", "updated_at"],
    scope: (caller) => ownCompany(caller),
    canWrite: (caller, rows) => {
      if (!hasLevel1OrHigher(caller)) {
        throw new ForbiddenError("You need Foreman-level access or higher to edit project aliases.");
      }
      for (const row of rows) {
        if (row.company_id && row.company_id !== caller.companyId && !caller.isAdmin) {
          throw new ForbiddenError("You can only set aliases for your own company.");
        }
      }
    },
    readonlyColumns: ["created_at"],
  },

  tasks: TASKS,

  user_project_assignments: {
    columns: ["id", "user_id", "project_id", "company_id", "created_at"],
    scope: (caller) => inList("project_id", visibleProjectIds(caller), "uv"),
    canWrite: (caller, rows) => {
      if (!hasPartialOrHigher(caller)) {
        throw new ForbiddenError("You need Partial-level access or higher to change project access.");
      }
    },
    readonlyColumns: ["created_at"],
  },

  employee_project_assignments: {
    columns: ["id", "employee_id", "project_id", "company_id", "created_at"],
    scope: (caller) => {
      if (caller.isAdmin) return null;
      const rows = db
        .prepare(
          `SELECT project_id AS id FROM employee_project_assignments WHERE company_id = @__own
           UNION SELECT project_id FROM employee_project_assignments
             WHERE project_id IN (SELECT id FROM projects WHERE company_id = @__own)`,
        )
        .all({ __own: caller.companyId }) as { id: string }[];
      return inList("project_id", rows.map((r) => r.id), "av");
    },
    canWrite: (caller, rows) => {
      if (!hasPartialOrHigher(caller)) {
        throw new ForbiddenError("You need Partial-level access or higher to change project assignments.");
      }
    },
    readonlyColumns: ["created_at"],
  },

  availability: {
    columns: [
      "id",
      "employee_id",
      "project_id",
      "date",
      "start_time",
      "end_time",
      "all_projects",
      "stop_number",
      "stop_label",
      "created_at",
    ],
    scope: (caller) => {
      if (caller.isAdmin) return null;
      // The original's "View availability" policy: your own crew, plus the crew
      // of any sub connected to one of your projects. Keyed by employee, so a
      // sub's "all projects" hours (project_id NULL) reach the GC, and a sub
      // never sees a rival sub's hours on a shared project.
      const rows = db
        .prepare(
          `SELECT a.id FROM availability a JOIN employees e ON e.id = a.employee_id
             WHERE e.company_id = @__own
           UNION SELECT a.id FROM availability a
             JOIN employees e ON e.id = a.employee_id
             JOIN project_connections pc ON pc.sub_company_id = e.company_id
             JOIN projects p ON p.id = pc.project_id
            WHERE p.company_id = @__own`,
        )
        .all({ __own: caller.companyId }) as { id: string }[];
      return inList("id", rows.map((r) => r.id), "av");
    },
    canWrite: async (caller, rows) => {
      // Same rule as the REST path (`resolveEmployeeToSchedule` in
      // scheduling/service.ts): yourself always, someone else on your own
      // roster at partial+, never a connected company's crew. `employee_id`
      // is NOT NULL on this table, so a row whose target can't be resolved
      // is refused rather than guessed at. One deliberate difference from
      // REST: the facade has no "omit the target, mean yourself" default —
      // callers must name employee_id explicitly.
      const ownEmployee = caller.companyId
        ? await findEmployeeByLinkedUser(caller.companyId, caller.userId)
        : undefined;
      for (const row of rows) {
        const namedId =
          typeof row.employee_id === "string" && row.employee_id ? row.employee_id : null;
        let target = namedId ? await findEmployeeById(namedId) : undefined;
        if (!target && typeof row.id === "string" && row.id) {
          // Updates name the row by id without repeating employee_id.
          const existing = db
            .prepare("SELECT employee_id FROM availability WHERE id = ?")
            .get(row.id) as { employee_id: string } | undefined;
          target = existing ? await findEmployeeById(existing.employee_id) : undefined;
        }
        if (ownEmployee && target && target.id === ownEmployee.id) continue;
        if (!target || target.companyId !== caller.companyId) {
          throw new ForbiddenError("You can only change availability for employees of your own company.");
        }
        if (!hasPartialOrHigher(caller)) {
          throw new ForbiddenError(
            "You need Partial-level access or higher to change someone else's availability.",
          );
        }
      }
    },
    readonlyColumns: ["created_at"],
  },

  schedule_requests: {
    columns: [
      "id",
      "project_id",
      "requesting_company_id",
      "sub_company_id",
      "employee_ids",
      "date",
      "start_time",
      "end_time",
      "description",
      "status",
      "created_at",
      "updated_at",
    ],
    scope: (caller) =>
      caller.isAdmin
        ? null
        : {
            sql: "(requesting_company_id = @__own OR sub_company_id = @__own)",
            params: { __own: caller.companyId },
          },
    canWrite: (caller) => {
      if (!hasPartialOrHigher(caller)) {
        throw new ForbiddenError("You need Partial-level access or higher to act on schedule requests.");
      }
    },
    readonlyColumns: ["project_id", "requesting_company_id", "sub_company_id", "created_at"],
  },

  password_resets: {
    columns: [],
    scope: () => ({ sql: "1 = 0", params: {} }),
  },
};