/**
 * The PostgREST-shaped surface the Lovable components talk to.
 *
 *   POST /query              — table reads/writes through the registry
 *   POST /rpc/:name          — the Postgres RPCs the reference app calls
 *   POST /functions/:name    — the Supabase edge functions
 *
 * Only registered names are reachable, so the migration surface grows one
 * feature at a time instead of all at once.
 */
import express, { Router, type RequestHandler } from "express";
import { HttpError } from "../rbac/errors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { runQuery, type QueryRequest } from "./executor.js";
import { resolveCaller } from "./registry.js";
import { RPC_REGISTRY } from "./rpc.js";

export const queryRouter = Router();

queryRouter.use(express.json({ limit: "2mb" }));

function handle(handler: (...args: Parameters<RequestHandler>) => unknown): RequestHandler {
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

/** Errors from the executor are all Forbidden/BadRequest by construction. */
function statusFor(err: unknown): number {
  if (err instanceof HttpError) return err.status;
  if (err instanceof Error && /Unknown column|unsupported|managed by the server|onConflict/i.test(err.message)) {
    return 400;
  }
  return 500;
}

queryRouter.post(
  "/query",
  requireAuth,
  handle(async (req, res) => {
    const caller = await resolveCaller(req.userId!);
    try {
      res.json({ data: await runQuery(caller, req.body as QueryRequest) });
    } catch (err) {
      res.status(statusFor(err)).json({ error: err instanceof Error ? err.message : "Query failed." });
    }
  }),
);

queryRouter.post(
  "/rpc/:name",
  requireAuth,
  handle(async (req, res) => {
    const caller = await resolveCaller(req.userId!);
    const fn = RPC_REGISTRY[req.params.name];
    if (!fn) {
      res.status(404).json({ error: `Function rpc/${req.params.name} is not available yet.` });
      return;
    }
    try {
      res.json({ data: await fn(caller, req.body ?? {}) });
    } catch (err) {
      res.status(statusFor(err)).json({ error: err instanceof Error ? err.message : "rpc failed." });
    }
  }),
);

/** Probe used by the web client to show which parts have been migrated. */
queryRouter.get(
  "/capabilities",
  requireAuth,
  handle((_req, res) => {
    res.json({ rpc: Object.keys(RPC_REGISTRY).sort() });
  }),
);