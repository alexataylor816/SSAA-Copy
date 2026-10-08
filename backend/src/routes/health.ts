import { Router } from "express";
import { database } from "../db.js";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  try {
    await database.get("SELECT 1");
    res.json({ status: "ok", db: `${database.dialect} ok` });
  } catch (err) {
    res.status(500).json({ status: "error", db: String(err) });
  }
});
