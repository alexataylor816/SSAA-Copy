import { Router, type RequestHandler } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { HttpError, ForbiddenError, NotFoundError, BadRequestError } from "../rbac/errors.js";
import { database } from "../db.js";
import { findUserByEmail, findUserById, setUserIsAdmin, setUserSuspended, type OperatorLevel } from "../models/users.js";
import { createResetCode } from "../models/passwordResets.js";
import { findCompanyById, findUserRole, listCompanies, setRoleCompanyCreator, updateUserRolePermission } from "../rbac/models.js";
import { getVisiblePermissions } from "../rbac/permissions.js";
import type { PermissionLevel } from "../rbac/types.js";
import { listPendingCompanyDeletions, resolveCompanyDeletion } from "../rbac/companyDeletion.js";
import { findTemplateById, listTemplates, updateTemplate, fillPlaceholders } from "../notifications/templates.js";
import { listCorrespondence, sendTemplatedEmail } from "../notifications/correspondence.js";
import { emailTransportName } from "../services/email.js";
import { signToken } from "../services/tokens.js";
import { OPERATOR_LEVELS, audit, listAudit, ownerExists, requireOperator } from "./operators.js";

export const adminRouter = Router();
adminRouter.use(requireAuth);

function route(handler: (...args: Parameters<RequestHandler>) => unknown): RequestHandler {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      next(err);
    }
  };
}

const count = async (sql: string, params: unknown[] = []) => Number((await database.get<{ n: number }>(sql, params))?.n ?? 0);
const isoDay = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const nameOf = (u: { fullName?: string | null; email: string }) => u.fullName || u.email;

/** The signed-in operator's own level, so the dashboard can hide what they can't do. */
adminRouter.get(
  "/admin/me",
  route(async (req, res) => {
    const me = await requireOperator(req);
    res.json({ userId: me.id, level: me.operatorLevel, canChange: me.operatorLevel !== "view_only", canManageOperators: await canManageOperators(me.operatorLevel), email: emailTransportName() });
  }),
);

async function canManageOperators(level: OperatorLevel | null) {
  return level === "owner" || (level === "main_operator" && !(await ownerExists()));
}

/** Platform overview: the numbers, what needs attention, and the latest activity. */
adminRouter.get(
  "/admin/overview",
  route(async (req, res) => {
    await requireOperator(req);
    const today = isoDay();
    const weekAgo = isoDay(-7);
    const weekAhead = isoDay(7);
    const [gcs, subs, users, projects, employees, pendingRequests, upcoming, edited, suspended, deletions, failedEmail, sentWeek] = await Promise.all([
      count("SELECT COUNT(*) n FROM companies WHERE company_type = 'gc'"),
      count("SELECT COUNT(*) n FROM companies WHERE company_type = 'sub'"),
      count("SELECT COUNT(*) n FROM users"),
      count("SELECT COUNT(*) n FROM projects"),
      count("SELECT COUNT(*) n FROM employees"),
      count("SELECT COUNT(*) n FROM schedule_requests WHERE status = 'pending' AND date >= ?", [today]),
      count("SELECT COUNT(*) n FROM schedule_requests WHERE status IN ('pending', 'confirmed') AND date >= ? AND date < ?", [today, weekAhead]),
      count("SELECT COUNT(*) n FROM schedule_requests WHERE edited = 1 AND status = 'confirmed' AND date >= ?", [today]),
      count("SELECT COUNT(*) n FROM users WHERE suspended_at IS NOT NULL"),
      count("SELECT COUNT(*) n FROM company_deletion_requests WHERE status = 'pending'"),
      count("SELECT COUNT(*) n FROM notification_log WHERE channel = 'email' AND status = 'failed' AND created_at >= ?", [weekAgo]),
      count("SELECT COUNT(*) n FROM notification_log WHERE status = 'sent' AND created_at >= ?", [weekAgo]),
    ]);
    const byStatus = await database.all<{ status: string; n: number }>(
      "SELECT status, COUNT(*) n FROM schedule_requests WHERE date >= ? AND date < ? GROUP BY status",
      [weekAgo, weekAhead],
    );
    const recentRequests = await database.all<{
      id: string;
      date: string;
      status: string;
      created_at: string;
      project: string;
      gc: string;
      sub: string;
    }>(
      `SELECT r.id, r.date, r.status, r.created_at, p.name project, g.name gc, s.name sub
         FROM schedule_requests r
         JOIN projects p ON p.id = r.project_id
         JOIN companies g ON g.id = r.requesting_company_id
         JOIN companies s ON s.id = r.sub_company_id
        ORDER BY r.created_at DESC LIMIT 8`,
    );
    const newestUsers = await database.all<{ id: string; full_name: string; email: string; created_at: string; company: string | null }>(
      `SELECT u.id, u.full_name, u.email, u.created_at, c.name company FROM users u LEFT JOIN companies c ON c.id = u.company_id
        ORDER BY u.created_at DESC LIMIT 6`,
    );
    res.json({
      counts: { gcs, subs, users, projects, employees, pendingRequests, upcoming, edited, suspended, deletions, failedEmail, sentWeek },
      requestsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
      recentRequests: recentRequests.map((r) => ({ id: r.id, date: r.date, status: r.status, createdAt: r.created_at, project: r.project, gc: r.gc, sub: r.sub })),
      newestUsers: newestUsers.map((u) => ({ userId: u.id, fullName: u.full_name, email: u.email, createdAt: u.created_at, companyName: u.company })),
      email: emailTransportName(),
    });
  }),
);

adminRouter.get(
  "/admin/companies",
  route(async (req, res) => {
    await requireOperator(req);
    const companies = await Promise.all(
      (await listCompanies()).map(async (c) => {
        const members = await count("SELECT COUNT(*) n FROM user_roles WHERE company_id = ?", [c.id]);
        const projects = await count(
          c.companyType === "gc"
            ? "SELECT COUNT(*) n FROM projects WHERE company_id = ?"
            : "SELECT COUNT(*) n FROM project_connections WHERE sub_company_id = ?",
          [c.id],
        );
        // Opening a company in the operator dashboard means viewing it as its main account holder.
        const holder = await database.get<{ id: string; full_name: string; email: string }>(
          `SELECT u.id, u.full_name, u.email FROM user_roles r JOIN users u ON u.id = r.user_id
            WHERE r.company_id = ? AND (r.is_company_creator = 1 OR r.permission_level = 'account_holder')
            ORDER BY r.is_company_creator DESC, r.created_at LIMIT 1`,
          [c.id],
        );
        return {
          id: c.id,
          name: c.name,
          companyType: c.companyType,
          members,
          projects,
          primaryHolder: holder ? { userId: holder.id, fullName: holder.full_name, email: holder.email } : null,
        };
      }),
    );
    res.json({ companies });
  }),
);

/** One company: its people and their levels, projects, crew and recent requests. */
adminRouter.get(
  "/admin/companies/:id",
  route(async (req, res) => {
    await requireOperator(req);
    const company = await findCompanyById(req.params.id);
    if (!company) throw new NotFoundError("Company not found.");
    const members = await database.all<{ id: string; full_name: string; email: string; permission_level: string; is_company_creator: number; suspended_at: string | null }>(
      `SELECT u.id, u.full_name, u.email, r.permission_level, r.is_company_creator, u.suspended_at
         FROM user_roles r JOIN users u ON u.id = r.user_id WHERE r.company_id = ? ORDER BY u.full_name`,
      [company.id],
    );
    const projects = await database.all<{ id: string; name: string; address: string | null; owner: string | null }>(
      company.companyType === "gc"
        ? "SELECT p.id, p.name, p.address, NULL owner FROM projects p WHERE p.company_id = ? ORDER BY p.name"
        : `SELECT p.id, p.name, p.address, c.name owner FROM project_connections pc JOIN projects p ON p.id = pc.project_id
             JOIN companies c ON c.id = p.company_id WHERE pc.sub_company_id = ? ORDER BY p.name`,
      [company.id],
    );
    const employees = await count("SELECT COUNT(*) n FROM employees WHERE company_id = ?", [company.id]);
    const requests = await database.all<{ id: string; date: string; status: string; project: string; other: string }>(
      `SELECT r.id, r.date, r.status, p.name project, CASE WHEN r.sub_company_id = ? THEN g.name ELSE s.name END other
         FROM schedule_requests r JOIN projects p ON p.id = r.project_id
         JOIN companies g ON g.id = r.requesting_company_id JOIN companies s ON s.id = r.sub_company_id
        WHERE r.sub_company_id = ? OR r.requesting_company_id = ?
        ORDER BY r.date DESC, r.created_at DESC LIMIT 15`,
      [company.id, company.id, company.id],
    );
    res.json({
      company: { id: company.id, name: company.name, companyType: company.companyType, address: company.address ?? null },
      levels: getVisiblePermissions(company.companyType),
      members: members.map((m) => ({
        userId: m.id,
        fullName: m.full_name,
        email: m.email,
        permissionLevel: m.permission_level,
        isCreator: Number(m.is_company_creator) === 1,
        suspended: !!m.suspended_at,
      })),
      projects: projects.map((p) => ({ id: p.id, name: p.name, address: p.address, ownerName: p.owner })),
      employees,
      requests,
      correspondence: await listCorrespondence({ companyId: company.id, limit: 20 }),
      audit: await listAudit({ targetId: company.id, limit: 20 }),
    });
  }),
);

/** Make someone the company's main account holder; the previous one stays in the company at full access. */
adminRouter.post(
  "/admin/companies/:id/account-holder",
  route(async (req, res) => {
    const me = await requireOperator(req, "change");
    const company = await findCompanyById(req.params.id);
    if (!company) throw new NotFoundError("Company not found.");
    const target = typeof req.body?.userId === "string" ? await findUserById(req.body.userId) : undefined;
    const role = target ? await findUserRole(target.id, company.id) : undefined;
    if (!target || !role) throw new BadRequestError("That person isn't in this company.");
    const previous = await database.all<{ user_id: string }>(
      "SELECT user_id FROM user_roles WHERE company_id = ? AND user_id <> ? AND (permission_level = 'account_holder' OR is_company_creator = 1)",
      [company.id, target.id],
    );
    for (const p of previous) {
      await updateUserRolePermission(p.user_id, company.id, "full");
      await setRoleCompanyCreator(p.user_id, company.id, false);
    }
    await updateUserRolePermission(target.id, company.id, "account_holder");
    await setRoleCompanyCreator(target.id, company.id, true);
    await audit(me.id, "transfer_account_holder", `Made ${nameOf(target)} the account holder of ${company.name}`, { type: "company", id: company.id });
    res.json({ success: true });
  }),
);

adminRouter.get(
  "/admin/users",
  route(async (req, res) => {
    await requireOperator(req);
    const rows = await database.all<{
      id: string;
      email: string;
      full_name: string;
      is_admin: number | boolean;
      operator_level: string | null;
      suspended_at: string | null;
      company_id: string | null;
      company_name: string | null;
      company_type: string | null;
      permission_level: string | null;
    }>(
      `SELECT u.id, u.email, u.full_name, u.is_admin, u.operator_level, u.suspended_at, u.company_id, c.name AS company_name, c.company_type, r.permission_level
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         LEFT JOIN user_roles r ON r.user_id = u.id AND r.company_id = u.company_id
        ORDER BY u.full_name, u.email`,
    );
    res.json({
      users: rows.map((r) => ({
        userId: r.id,
        email: r.email,
        fullName: r.full_name,
        isOperator: !!Number(r.is_admin),
        operatorLevel: Number(r.is_admin) ? (r.operator_level ?? "main_operator") : null,
        suspended: !!r.suspended_at,
        companyId: r.company_id,
        companyName: r.company_name,
        companyType: r.company_type,
        permissionLevel: r.permission_level,
      })),
    });
  }),
);

/** One person: account, company and level, plus what was sent to them and what operators did. */
adminRouter.get(
  "/admin/users/:id",
  route(async (req, res) => {
    await requireOperator(req);
    const user = await findUserById(req.params.id);
    if (!user) throw new NotFoundError("User not found.");
    const company = user.companyId ? await findCompanyById(user.companyId) : undefined;
    const role = company ? await findUserRole(user.id, company.id) : undefined;
    res.json({
      user: {
        userId: user.id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        createdAt: user.createdAt,
        isOperator: user.isAdmin,
        operatorLevel: user.operatorLevel,
        suspended: !!user.suspendedAt,
        suspendedAt: user.suspendedAt,
        signInMethod: user.passwordHash.startsWith("google-oauth:") ? "google" : "password",
      },
      company: company ? { id: company.id, name: company.name, companyType: company.companyType } : null,
      permissionLevel: role?.permissionLevel ?? null,
      isCreator: role?.isCompanyCreator ?? false,
      levels: company ? getVisiblePermissions(company.companyType) : [],
      correspondence: await listCorrespondence({ userId: user.id, limit: 25 }),
      audit: await listAudit({ targetId: user.id, limit: 20 }),
    });
  }),
);

/** Support: email the person a password reset code. When email can't go out, the code comes back to the operator to pass on. */
adminRouter.post(
  "/admin/users/:id/password-reset",
  route(async (req, res) => {
    const me = await requireOperator(req, "change");
    const user = await findUserById(req.params.id);
    if (!user) throw new NotFoundError("User not found.");
    const code = await createResetCode(user.id);
    const status = await sendTemplatedEmail({ eventType: "password_reset", to: user.email, vars: { code, email: user.email }, recipientUserId: user.id, actorUserId: me.id });
    await audit(me.id, "password_reset", `Sent a password reset code to ${nameOf(user)} (${status === "sent" ? "emailed" : "given to operator"})`, { type: "user", id: user.id });
    res.json({ emailed: status === "sent", code: status === "sent" ? undefined : code, expiresInMinutes: 15 });
  }),
);

/** Support: change someone's level in their company (account holder goes through the transfer instead). */
adminRouter.patch(
  "/admin/users/:id/level",
  route(async (req, res) => {
    const me = await requireOperator(req, "change");
    const user = await findUserById(req.params.id);
    if (!user?.companyId) throw new NotFoundError("That person isn't in a company.");
    const company = (await findCompanyById(user.companyId))!;
    const level = req.body?.permissionLevel as PermissionLevel;
    if (!getVisiblePermissions(company.companyType).includes(level) || level === "account_holder") {
      throw new BadRequestError("Pick a level this company uses. To change the account holder, use Make account holder.");
    }
    const role = await findUserRole(user.id, company.id);
    if (!role) throw new NotFoundError("That person isn't in this company.");
    if (role.permissionLevel === "account_holder" || role.isCompanyCreator) {
      throw new BadRequestError("Make someone else the account holder first.");
    }
    await updateUserRolePermission(user.id, company.id, level);
    await audit(me.id, "change_level", `Changed ${nameOf(user)} at ${company.name} from ${role.permissionLevel} to ${level}`, { type: "user", id: user.id });
    res.json({ success: true });
  }),
);

/** Support: suspend (can't sign in, current sessions stop working) or restore an account. */
adminRouter.post(
  "/admin/users/:id/suspend",
  route(async (req, res) => {
    const me = await requireOperator(req, "change");
    const user = await findUserById(req.params.id);
    if (!user) throw new NotFoundError("User not found.");
    if (user.id === me.id) throw new ForbiddenError("You can't suspend yourself.");
    if (user.isAdmin) throw new ForbiddenError("Remove their operator access first.");
    const suspended = req.body?.suspended !== false;
    await setUserSuspended(user.id, suspended);
    await audit(me.id, suspended ? "suspend" : "restore", `${suspended ? "Suspended" : "Restored"} ${nameOf(user)}`, { type: "user", id: user.id });
    res.json({ suspended });
  }),
);

adminRouter.get(
  "/admin/operators",
  route(async (req, res) => {
    const me = await requireOperator(req);
    const rows = await database.all<{ id: string; email: string; full_name: string; operator_level: string | null }>(
      "SELECT id, email, full_name, operator_level FROM users WHERE is_admin = 1 ORDER BY email",
    );
    res.json({
      canManage: await canManageOperators(me.operatorLevel),
      operators: rows.map((r) => ({ userId: r.id, email: r.email, fullName: r.full_name, level: r.operator_level ?? "main_operator" })),
    });
  }),
);

/** Grant, change or revoke operator access. Owner only (or a main operator while there's no owner). */
adminRouter.post(
  "/admin/operators",
  route(async (req, res) => {
    const me = await requireOperator(req, "operators");
    const { email, userId, isAdmin } = req.body ?? {};
    const level = (req.body?.level ?? "main_operator") as OperatorLevel;
    if (!OPERATOR_LEVELS.includes(level)) throw new BadRequestError("Unknown operator level.");
    if (level === "owner" && me.operatorLevel !== "owner" && (await ownerExists())) throw new ForbiddenError("Only the owner can name an owner.");
    const target =
      (typeof userId === "string" && userId ? await findUserById(userId) : undefined) ??
      (typeof email === "string" && email ? await findUserByEmail(email) : undefined);
    if (!target) throw new NotFoundError("No account with that email. They need to sign up first.");
    if (target.id === me.id && (isAdmin === false || level !== me.operatorLevel)) {
      throw new ForbiddenError("You can't change your own operator access.");
    }
    await setUserIsAdmin(target.id, isAdmin !== false, level);
    await audit(
      me.id,
      isAdmin === false ? "revoke_operator" : "set_operator",
      isAdmin === false ? `Removed operator access from ${nameOf(target)}` : `Made ${nameOf(target)} ${level.replace("_", " ")}`,
      { type: "user", id: target.id },
    );
    res.json({ userId: target.id, isAdmin: isAdmin !== false, level: isAdmin === false ? null : level });
  }),
);

adminRouter.get(
  "/admin/deletion-requests",
  route(async (req, res) => {
    await requireOperator(req);
    res.json({ requests: await listPendingCompanyDeletions() });
  }),
);

adminRouter.post(
  "/admin/deletion-requests/:id/resolve",
  route(async (req, res) => {
    const me = await requireOperator(req, "change");
    const pending = (await listPendingCompanyDeletions()).find((r) => r.id === req.params.id);
    const approve = req.body?.approve === true;
    await resolveCompanyDeletion(req.params.id, approve);
    await audit(
      me.id,
      approve ? "approve_deletion" : "reject_deletion",
      `${approve ? "Approved deletion of" : "Rejected deletion of"} ${pending?.companyName ?? "a company"}`,
      pending ? { type: "company", id: pending.companyId } : undefined,
    );
    res.json({ success: true });
  }),
);

adminRouter.get(
  "/admin/templates",
  route(async (req, res) => {
    await requireOperator(req);
    res.json({ templates: await listTemplates(), email: emailTransportName() });
  }),
);

adminRouter.patch(
  "/admin/templates/:id",
  route(async (req, res) => {
    const me = await requireOperator(req, "change");
    const { displayName, description, subject, bodyHtml, channel, isActive, pushTitle, pushBody, pushActive } = req.body ?? {};
    const updated = await updateTemplate(req.params.id, { displayName, description, subject, bodyHtml, channel, isActive, pushTitle, pushBody, pushActive });
    if (!updated) throw new NotFoundError("Template not found.");
    const what = [
      subject !== undefined || bodyHtml !== undefined ? "email text" : null,
      pushTitle !== undefined || pushBody !== undefined ? "push text" : null,
      isActive !== undefined ? `email ${isActive ? "on" : "off"}` : null,
      pushActive !== undefined ? `push ${pushActive ? "on" : "off"}` : null,
      displayName !== undefined ? "name" : null,
      description !== undefined ? "description" : null,
    ].filter(Boolean);
    await audit(me.id, "edit_template", `Edited "${updated.displayName ?? updated.eventType}" (${what.join(", ") || "no change"})`, { type: "template", id: updated.id });
    res.json(updated);
  }),
);

/** Sample values for previews and test sends. */
const SAMPLES: Record<string, string> = {
  project_name: "Riverside Office Build",
  project_names: "Riverside Office Build",
  project_address: " (4100 River Rd, College Park, MD)",
  requesting_company: "Terrapin Builders",
  sub_company: "Keystone Framing & Drywall",
  cancelling_company: "Terrapin Builders",
  company_name: "Keystone Framing & Drywall",
  scheduled_date: "Tue, Oct 27",
  dates: "Tue, Oct 27, Wed, Oct 28",
  start_time: "7:00 AM",
  end_time: "3:30 PM",
  time_range: ", 7:00 AM–3:30 PM",
  crew_count: "2 people",
  crew_names: "Mike Rivera, Pete Alvarez",
  change_count: "3 changes",
  reason: "Reason: crew is on another job.",
  employee_name: "Mike",
  requester_name: "Sam Okafor",
  requester_email: "sam.okafor@example.com",
  user_name: "Sam Okafor",
  code: "123456",
  email: "sam.okafor@example.com",
};

/** Sends the template's email, filled with sample values, to the operator's own address. */
adminRouter.post(
  "/admin/templates/:id/test",
  route(async (req, res) => {
    const me = await requireOperator(req, "change");
    const template = await findTemplateById(req.params.id);
    if (!template) throw new NotFoundError("Template not found.");
    const status = await sendTemplatedEmail({ eventType: template.eventType, to: me.email, vars: SAMPLES, recipientUserId: me.id, actorUserId: me.id });
    res.json({ status, to: me.email, subject: fillPlaceholders(template.subject, SAMPLES) });
  }),
);

adminRouter.get(
  "/admin/samples",
  route(async (req, res) => {
    await requireOperator(req);
    res.json({ samples: SAMPLES });
  }),
);

/** The correspondence log: every email, bell notification and automatic chat message. */
adminRouter.get(
  "/admin/correspondence",
  route(async (req, res) => {
    await requireOperator(req);
    const q = req.query;
    res.json({
      entries: await listCorrespondence({
        channel: typeof q.channel === "string" ? q.channel : undefined,
        status: typeof q.status === "string" ? q.status : undefined,
        q: typeof q.q === "string" ? q.q : undefined,
        limit: Number(q.limit) || 200,
      }),
    });
  }),
);

adminRouter.get(
  "/admin/audit-log",
  route(async (req, res) => {
    await requireOperator(req);
    res.json({ entries: await listAudit({ limit: Number(req.query.limit) || 200 }) });
  }),
);

/**
 * "View as": a session for another user, so the operator sees exactly what they see (same tabs, same
 * permissions). The token records the operator (`act`) and lasts 8 hours; operator tools and owner-only
 * acts are refused on it, and a view-only operator's session can't change anything (middleware/requireAuth.ts).
 */
adminRouter.post(
  "/admin/view-as",
  route(async (req, res) => {
    const me = await requireOperator(req);
    const target = typeof req.body?.userId === "string" ? await findUserById(req.body.userId) : undefined;
    if (!target) throw new NotFoundError("User not found.");
    if (target.isAdmin) throw new ForbiddenError("Operators can't view the app as another operator.");
    const readOnly = me.operatorLevel === "view_only";
    const token = signToken({ sub: target.id, email: target.email, act: me.id, ...(readOnly ? { ro: true } : {}) }, "8h");
    await audit(me.id, "view_as", `Viewed the app as ${nameOf(target)}${readOnly ? " (read only)" : ""}`, { type: "user", id: target.id });
    res.json({ token, readOnly, user: { id: target.id, email: target.email, fullName: target.fullName } });
  }),
);
