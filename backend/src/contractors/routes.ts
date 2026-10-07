import { Router, type RequestHandler } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { HttpError } from "../rbac/errors.js";
import { emit } from "../realtime/index.js";
import { EVENT, ROOM } from "../realtime/events.js";
import {
  deleteConnection,
  linkConnectionProject,
  listConnectionProjectsFor,
  listMyConnections,
  requestConnection,
  respondConnection,
  swapConnectionRole,
} from "./service.js";

export const contractorsRouter = Router();
contractorsRouter.use(requireAuth);

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

function fanout(connectionId: string, companyIds: (string | null)[], payload: unknown) {
  for (const id of new Set(companyIds.filter((c): c is string => !!c))) {
    emit(EVENT.projectConnectionChanged, payload, ROOM.contractor_connections, id);
  }
}

contractorsRouter.get(
  "/contractor-connections",
  route((req, res) => {
    res.json({ connections: listMyConnections(req.userId!) });
  }),
);

contractorsRouter.post(
  "/contractor-connections",
  route((req, res) => {
    const { otherCompanyId, proposedRole } = req.body ?? {};
    const conn = requestConnection(req.userId!, otherCompanyId, proposedRole);
    fanout(conn.id, [conn.companyAId, conn.companyBId], { connectionId: conn.id, action: "requested" });
    res.status(201).json(conn);
  }),
);

contractorsRouter.post(
  "/contractor-connections/:id/respond",
  route((req, res) => {
    const { accept, confirmMainCompanyId } = req.body ?? {};
    const conn = respondConnection(req.userId!, req.params.id, accept === true, confirmMainCompanyId);
    fanout(conn.id, [conn.companyAId, conn.companyBId], { connectionId: conn.id, action: "responded" });
    res.json(conn);
  }),
);

contractorsRouter.post(
  "/contractor-connections/:id/role-swap",
  route((req, res) => {
    const { proposedMainCompanyId } = req.body ?? {};
    const { result, connection } = swapConnectionRole(req.userId!, req.params.id, proposedMainCompanyId);
    fanout(connection.id, [connection.companyAId, connection.companyBId], {
      connectionId: connection.id,
      action: result === "confirmed" ? "role-swapped" : "role-swap-requested",
    });
    res.json({ result, connection });
  }),
);

contractorsRouter.get(
  "/contractor-connections/:id/projects",
  route((req, res) => {
    res.json({ links: listConnectionProjectsFor(req.userId!, req.params.id) });
  }),
);

contractorsRouter.post(
  "/contractor-connections/:id/projects",
  route((req, res) => {
    const { projectId, shared } = req.body ?? {};
    linkConnectionProject(req.userId!, req.params.id, projectId, shared !== false);
    fanout(req.params.id, [], { connectionId: req.params.id, action: "projects-changed" });
    res.status(201).json({ success: true });
  }),
);

contractorsRouter.delete(
  "/contractor-connections/:id/projects/:projectId",
  route((req, res) => {
    linkConnectionProject(req.userId!, req.params.id, req.params.projectId, false);
    res.json({ success: true });
  }),
);

contractorsRouter.delete(
  "/contractor-connections/:id",
  route((req, res) => {
    const conn = deleteConnection(req.userId!, req.params.id);
    fanout(conn.id, [conn.companyAId, conn.companyBId], { connectionId: conn.id, action: "deleted" });
    res.json({ success: true });
  }),
);
