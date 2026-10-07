/**
 * The Postgres RPCs the Lovable components call via `supabase.rpc(...)`.
 *
 * Implemented here are the ones whose backing tables already exist. The rest
 * (contractor connections, chat, guest GC, company deletion) arrive with their
 * feature phases — until then they are simply absent from the registry, and
 * GET /capabilities reports exactly what is available so nothing silently
 * half-works.
 */
import { db } from "../db.js";
import { ForbiddenError } from "../rbac/errors.js";
import { hasLevel1OrHigher, hasPartialOrHigher, isAccountHolder } from "../rbac/permissions.js";
import { companyTypeOf, visibleProjectIds, type Caller } from "./registry.js";

type Rpc = (caller: Caller, args: Record<string, unknown>) => unknown;

export const RPC_REGISTRY: Record<string, Rpc> = {
  /** Takes no arguments, like the original: full or account holder in your own company, or admin. */
  can_manage_projects: (caller) =>
    caller.isAdmin ||
    (caller.companyId !== null && (isAccountHolder(caller) || caller.permissionLevel === "full")),

  /** Onboarding uses this to decide whether to force a password change. */
  check_user_never_logged_in: (caller) => {
    const row = db.prepare("SELECT created_at FROM users WHERE id = ?").get(caller.userId) as
      | { created_at: string }
      | undefined;
    // No login-tracking column exists yet, so treat a brand-new account as one
    // that has never logged in.
    if (!row) return false;
    const created = new Date(row.created_at.replace(" ", "T") + "Z").getTime();
    return Date.now() - created < 60_000;
  },

  /** PlanLimitDialog reads usage against subscription limits. */
  get_company_usage: (caller, args) => {
    const companyId = String(args.company_id_arg ?? args.company_id ?? caller.companyId ?? "");
    if (!companyId) throw new ForbiddenError("No company.");
    if (!caller.isAdmin && caller.companyId !== companyId) {
      throw new ForbiddenError("You are not a member of that company.");
    }
    const projectCount = (
      db.prepare("SELECT COUNT(*) AS n FROM projects WHERE company_id = ?").get(companyId) as { n: number }
    ).n;
    const employeeCount = (
      db.prepare("SELECT COUNT(*) AS n FROM employees WHERE company_id = ?").get(companyId) as { n: number }
    ).n;
    const memberCount = (
      db.prepare("SELECT COUNT(*) AS n FROM user_roles WHERE company_id = ?").get(companyId) as { n: number }
    ).n;
    return { project_count: projectCount, employee_count: employeeCount, member_count: memberCount };
  },

  /** Onboarding's "join an existing company" search. */
  search_companies_for_onboarding: (caller, args) => {
    const term = String(args.search_term ?? args.query ?? "").trim();
    if (term.length < 2) return [];
    const rows = db
      .prepare(
        `SELECT id, name, company_type FROM companies
         WHERE name LIKE ? COLLATE NOCASE AND id != ?
         ORDER BY name LIMIT 20`,
      )
      .all(`%${term}%`, caller.companyId ?? "") as { id: string; name: string; company_type: string }[];
    return rows.map((r) => ({ id: r.id, name: r.name, company_type: r.company_type }));
  },

  /** Connect-a-project flow: which subs could connect to this project. */
  search_sub_companies_for_connection: (caller, args) => {
    const term = String(args.search_term ?? args.query ?? "").trim();
    if (term.length < 2) return [];
    const projectId = String(args.project_id ?? "");
    const visible = new Set(visibleProjectIds(caller));
    const rows = db
      .prepare(
        `SELECT c.id, c.name FROM companies c
         WHERE c.company_type = 'sub' AND c.name LIKE ? COLLATE NOCASE
         ORDER BY c.name LIMIT 20`,
      )
      .all(`%${term}%`) as { id: string; name: string }[];
    return rows
      .filter((r) => visible.has(projectId))
      .filter((r) => r.id !== caller.companyId)
      .map((r) => ({ id: r.id, name: r.name }));
  },

  /** Who to notify when a project changes — email fan-out recipients. */
  get_project_notification_recipients: (caller, args) => {
    const projectId = String(args.project_id ?? "");
    const rows = db
      .prepare(
        `SELECT DISTINCT u.email AS email, u.full_name AS full_name, u.company_id AS company_id
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         WHERE ur.company_id IN (
           SELECT company_id FROM projects WHERE id = @project
           UNION SELECT sub_company_id FROM project_connections WHERE project_id = @project
         )`,
      )
      .all({ project: projectId }) as { email: string; full_name: string; company_id: string }[];
    return rows.map((r) => ({ email: r.email, full_name: r.full_name, company_id: r.company_id }));
  },

  get_project_notification_user_ids: (caller, args) => {
    const projectId = String(args.project_id ?? "");
    const rows = db
      .prepare(
        `SELECT DISTINCT u.id AS user_id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         WHERE ur.company_id IN (
           SELECT company_id FROM projects WHERE id = @project
           UNION SELECT sub_company_id FROM project_connections WHERE project_id = @project
         )`,
      )
      .all({ project: projectId }) as { user_id: string }[];
    return rows.map((r) => r.user_id);
  },

  /** Directory search for the people/roles table. */
  search_ssaa_users: (caller, args) => {
    const term = String(args.search_term ?? args.query ?? "").trim();
    if (term.length < 2) return [];
    if (!caller.isAdmin && !hasPartialOrHigher(caller)) {
      throw new ForbiddenError("You do not have permission to search the directory.");
    }
    const rows = db
      .prepare(
        `SELECT u.id, u.email, u.full_name, u.company_id, c.name AS company_name
         FROM users u LEFT JOIN companies c ON c.id = u.company_id
         WHERE u.full_name LIKE ? COLLATE NOCASE OR u.email LIKE ? COLLATE NOCASE
         ORDER BY u.full_name LIMIT 25`,
      )
      .all(`%${term}%`, `%${term}%`);
    return rows;
  },

  /** Company type helper used by several screens. */
  resolve_acting_company: (caller) => {
    if (!caller.companyId) return null;
    return { company_id: caller.companyId, company_type: companyTypeOf(caller.companyId) };
  },

  /** ProfilesModal reads these to decide what a user may still do. */
  get_user_permission_level: (caller, args) => {
    const userId = String(args.user_id ?? caller.userId);
    const row = db.prepare("SELECT permission_level FROM user_roles WHERE user_id = ?").get(userId) as
      | { permission_level: string }
      | undefined;
    return row?.permission_level ?? null;
  },

  is_account_holder: (caller, args) => {
    const userId = String(args.user_id ?? caller.userId);
    const row = db
      .prepare("SELECT permission_level, is_company_creator FROM user_roles WHERE user_id = ?")
      .get(userId) as { permission_level: string; is_company_creator: number } | undefined;
    return row?.permission_level === "account_holder" || row?.is_company_creator === 1;
  },

  has_partial_or_higher: (caller) => hasPartialOrHigher(caller),
  has_level1_or_higher: (caller) => hasLevel1OrHigher(caller),
};

/**
 * Names the reference app calls that we have not migrated yet. Kept as data so
 * `GET /capabilities` can report the gap and the UI can grey out the screen
 * instead of firing a request that 404s.
 */
export const PENDING_RPCS = [
  "create_contractor_connection_request",
  "respond_contractor_connection_request",
  "link_contractor_connection_projects",
  "unset_contractor_connection_project",
  "set_contractor_connection_project",
  "get_contractor_connection_project_links",
  "request_or_confirm_role_swap",
  "create_guest_gc_account",
  "request_company_deletion",
  "get_or_create_dm_conversation",
  "create_group_conversation",
  "list_company_contact_candidates",
];