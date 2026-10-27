import type { NextFunction, Request, Response } from "express";
import { database } from "../db.js";
import { verifyToken } from "../services/tokens.js";

/**
 * Things an operator can't do while viewing the app as someone else: operator tools, and acts that only
 * the account's real owner should take. Exit "view as" first.
 */
const OWNER_ONLY = [/^\/admin(\/|$)/, /^\/auth\/change-password$/, /^\/companies\/[^/]+\/deletion-requests$/];

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ error: "Missing token." });
    return;
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
    return;
  }
  req.userId = payload.sub;
  if (payload.act) {
    req.operatorId = payload.act;
    const writing = req.method !== "GET" && req.method !== "HEAD";
    if (writing && payload.ro) {
      res.status(403).json({ error: "Your operator access is view only, so you can look but not change anything." });
      return;
    }
    if (writing && OWNER_ONLY.some((re) => re.test(req.path))) {
      res.status(403).json({ error: "You're viewing the app as someone else. Exit \"view as\" to do that." });
      return;
    }
  }
  try {
    // A suspended account's existing sessions stop working too (an operator looking at it still can).
    if (!payload.act) {
      const row = await database.get<{ suspended_at: string | null }>("SELECT suspended_at FROM users WHERE id = ?", [payload.sub]);
      if (row?.suspended_at) {
        res.status(401).json({ error: "This account is suspended. Contact SSAA support." });
        return;
      }
    }
  } catch (err) {
    next(err);
    return;
  }
  next();
}
