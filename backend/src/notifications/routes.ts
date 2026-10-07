import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { listNotifications, markNotificationsRead } from "./service.js";

export const notificationsRouter = Router();

notificationsRouter.get("/notifications", requireAuth, (req, res) => {
  res.json({ notifications: listNotifications(req.userId!) });
});

notificationsRouter.post("/notifications/read", requireAuth, (req, res) => {
  markNotificationsRead(req.userId!, req.body?.ids);
  res.json({ ok: true });
});
