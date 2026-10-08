import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { listNotifications, markNotificationsRead } from "./service.js";

export const notificationsRouter = Router();

// Express 4 doesn't catch rejected promises, so errors go to next() the way a synchronous throw would.
notificationsRouter.get("/notifications", requireAuth, async (req, res, next) => {
  try {
    res.json({ notifications: await listNotifications(req.userId!) });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post("/notifications/read", requireAuth, async (req, res, next) => {
  try {
    await markNotificationsRead(req.userId!, req.body?.ids);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
