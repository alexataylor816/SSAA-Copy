import { Router, type RequestHandler } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { HttpError, ForbiddenError, NotFoundError } from "../rbac/errors.js";
import { database } from "../db.js";
import { findUserByEmail, findUserById, setUserIsAdmin } from "../models/users.js";
import { listCompanies } from "../rbac/models.js";
import {
  listPendingCompanyDeletions,
  resolveCompanyDeletion,
} from "../rbac/companyDeletion.js";
import { listTemplates, updateTemplate } from "../notifications/templates.js";

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

/** Platform admins only. Everything under /admin goes through this. */
async function requireAdmin(req: Parameters<RequestHandler>[0]): Promise<void> {
  const user = await findUserById(req.userId!);
  if (!user?.isAdmin) {
    throw new ForbiddenError("Admin access required.");
  }
}

adminRouter.get(
  "/admin/companies",
  route(async (req, res) => {
    await requireAdmin(req);
    const companies = await Promise.all(
      (await listCompanies()).map(async (c) => {
        const members = (await database.get<{ n: number }>("SELECT COUNT(*) n FROM user_roles WHERE company_id = ?", [c.id]))!.n;
        const projects = (await database.get<{ n: number }>("SELECT COUNT(*) n FROM projects WHERE company_id = ?", [c.id]))!.n;
        return { id: c.id, name: c.name, companyType: c.companyType, members, projects };
      }),
    );
    res.json({ companies });
  }),
);

adminRouter.get(
  "/admin/operators",
  route(async (req, res) => {
    await requireAdmin(req);
    const rows = await database.all<{ id: string; email: string; full_name: string }>(
      "SELECT id, email, full_name FROM users WHERE is_admin = 1 ORDER BY email",
    );
    res.json({ operators: rows.map((r) => ({ userId: r.id, email: r.email, fullName: r.full_name })) });
  }),
);

adminRouter.post(
  "/admin/operators",
  route(async (req, res) => {
    await requireAdmin(req);
    const { email, userId, isAdmin } = req.body ?? {};
    const target =
      (typeof userId === "string" && userId ? await findUserById(userId) : undefined) ??
      (typeof email === "string" && email ? await findUserByEmail(email) : undefined);
    if (!target) throw new NotFoundError("User not found.");
    if (target.id === req.userId && isAdmin === false) {
      throw new ForbiddenError("You cannot remove your own admin access.");
    }
    await setUserIsAdmin(target.id, isAdmin !== false);
    res.json({ userId: target.id, isAdmin: isAdmin !== false });
  }),
);

adminRouter.get(
  "/admin/deletion-requests",
  route(async (req, res) => {
    await requireAdmin(req);
    res.json({ requests: await listPendingCompanyDeletions() });
  }),
);

adminRouter.post(
  "/admin/deletion-requests/:id/resolve",
  route(async (req, res) => {
    await requireAdmin(req);
    await resolveCompanyDeletion(req.params.id, req.body?.approve === true);
    res.json({ success: true });
  }),
);

adminRouter.get(
  "/admin/templates",
  route(async (req, res) => {
    await requireAdmin(req);
    res.json({ templates: await listTemplates() });
  }),
);

adminRouter.patch(
  "/admin/templates/:id",
  route(async (req, res) => {
    await requireAdmin(req);
    const { subject, bodyHtml, channel, isActive } = req.body ?? {};
    const updated = await updateTemplate(req.params.id, { subject, bodyHtml, channel, isActive });
    if (!updated) throw new NotFoundError("Template not found.");
    res.json(updated);
  }),
);
