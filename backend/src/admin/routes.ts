import { Router, type RequestHandler } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { HttpError, ForbiddenError, NotFoundError } from "../rbac/errors.js";
import { db } from "../db.js";
import { findUserByEmail, findUserById, setUserIsAdmin } from "../models/users.js";
import { listCompanies } from "../rbac/models.js";
import {
  listPendingCompanyDeletions,
  resolveCompanyDeletion,
} from "../rbac/companyDeletion.js";
import { listTemplates, updateTemplate } from "../notifications/templates.js";

export const adminRouter = Router();
adminRouter.use(requireAuth);

function route(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    try {
      handler(req, res, next);
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
function requireAdmin(req: Parameters<RequestHandler>[0]): void {
  const user = findUserById(req.userId!);
  if (!user?.isAdmin) {
    throw new ForbiddenError("Admin access required.");
  }
}

adminRouter.get(
  "/admin/companies",
  route((req, res) => {
    requireAdmin(req);
    const companies = listCompanies().map((c) => {
      const members = (db.prepare("SELECT COUNT(*) n FROM user_roles WHERE company_id = ?").get(c.id) as { n: number }).n;
      const projects = (db.prepare("SELECT COUNT(*) n FROM projects WHERE company_id = ?").get(c.id) as { n: number }).n;
      return { id: c.id, name: c.name, companyType: c.companyType, members, projects };
    });
    res.json({ companies });
  }),
);

adminRouter.get(
  "/admin/operators",
  route((req, res) => {
    requireAdmin(req);
    const rows = db
      .prepare("SELECT id, email, full_name FROM users WHERE is_admin = 1 ORDER BY email")
      .all() as { id: string; email: string; full_name: string }[];
    res.json({ operators: rows.map((r) => ({ userId: r.id, email: r.email, fullName: r.full_name })) });
  }),
);

adminRouter.post(
  "/admin/operators",
  route((req, res) => {
    requireAdmin(req);
    const { email, userId, isAdmin } = req.body ?? {};
    const target =
      (typeof userId === "string" && userId ? findUserById(userId) : undefined) ??
      (typeof email === "string" && email ? findUserByEmail(email) : undefined);
    if (!target) throw new NotFoundError("User not found.");
    if (target.id === req.userId && isAdmin === false) {
      throw new ForbiddenError("You cannot remove your own admin access.");
    }
    setUserIsAdmin(target.id, isAdmin !== false);
    res.json({ userId: target.id, isAdmin: isAdmin !== false });
  }),
);

adminRouter.get(
  "/admin/deletion-requests",
  route((req, res) => {
    requireAdmin(req);
    res.json({ requests: listPendingCompanyDeletions() });
  }),
);

adminRouter.post(
  "/admin/deletion-requests/:id/resolve",
  route((req, res) => {
    requireAdmin(req);
    resolveCompanyDeletion(req.params.id, req.body?.approve === true);
    res.json({ success: true });
  }),
);

adminRouter.get(
  "/admin/templates",
  route((req, res) => {
    requireAdmin(req);
    res.json({ templates: listTemplates() });
  }),
);

adminRouter.patch(
  "/admin/templates/:id",
  route((req, res) => {
    requireAdmin(req);
    const { subject, bodyHtml, channel, isActive } = req.body ?? {};
    const updated = updateTemplate(req.params.id, { subject, bodyHtml, channel, isActive });
    if (!updated) throw new NotFoundError("Template not found.");
    res.json(updated);
  }),
);
