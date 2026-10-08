import { Router, type RequestHandler } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { emit } from "../realtime/index.js";
import { EVENT, ROOM } from "../realtime/events.js";
import { notifyJoinRequestCreated, notifyJoinRequestResolved } from "../notifications/service.js";
import { HttpError } from "./errors.js";
import { listCompanies } from "./models.js";
import {
  approveJoinRequest,
  assignPermissionLevel,
  createCompany,
  getUserContext,
  listCompanyMembers,
  listEmployees,
  listJoinRequests,
  rejectJoinRequest,
  removeMember,
  requestToJoinCompany,
  transferAccountHolder,
} from "./service.js";
import type { CompanyType, PermissionLevel } from "./types.js";
import { getPendingCompanyDeletion, requestCompanyDeletion } from "./companyDeletion.js";

export const rbacRouter = Router();
rbacRouter.use(requireAuth);

/** Wraps a handler so thrown HttpErrors become the right status code instead of a 500. */
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

rbacRouter.get(
  "/rbac/me",
  route(async (req, res) => {
    res.json(await getUserContext(req.userId!));
  }),
);

rbacRouter.get(
  "/companies",
  route(async (req, res) => {
    const type = req.query.type as CompanyType | undefined;
    if (type && type !== "gc" && type !== "sub") {
      res.status(400).json({ error: "type must be 'gc' or 'sub'." });
      return;
    }
    res.json({ companies: await listCompanies(type) });
  }),
);

rbacRouter.post(
  "/companies",
  route(async (req, res) => {
    const { name, companyType, address, trade } = req.body ?? {};
    const result = await createCompany(req.userId!, { name, companyType, address, trade });
    res.status(201).json(result);
  }),
);

rbacRouter.post(
  "/companies/:companyId/join-requests",
  route(async (req, res) => {
    const result = await requestToJoinCompany(req.userId!, req.params.companyId);
    // Everyone who can approve needs to see it without a refresh.
    emit(EVENT.joinRequestCreated, { joinRequest: result }, ROOM.join_requests, req.params.companyId);
    await notifyJoinRequestCreated(req.userId!, req.params.companyId);
    res.status(201).json(result);
  }),
);

rbacRouter.get(
  "/companies/:companyId/join-requests",
  route(async (req, res) => {
    res.json({ requests: await listJoinRequests(req.params.companyId, req.userId!) });
  }),
);

rbacRouter.post(
  "/companies/:companyId/join-requests/:requestId/approve",
  route(async (req, res) => {
    const permissionLevel = req.body?.permissionLevel as PermissionLevel;
    const role = await approveJoinRequest(req.params.companyId, req.params.requestId, req.userId!, permissionLevel);
    emit(EVENT.joinRequestResolved, { status: "approved", userRole: role }, ROOM.join_requests, req.params.companyId);
    emit(EVENT.joinRequestResolved, { status: "approved" }, ROOM.user_profile, req.params.requestId);
    await notifyJoinRequestResolved(req.params.requestId, true);
    res.json(role);
  }),
);

rbacRouter.post(
  "/companies/:companyId/join-requests/:requestId/reject",
  route(async (req, res) => {
    await rejectJoinRequest(req.params.companyId, req.params.requestId, req.userId!);
    emit(EVENT.joinRequestResolved, { status: "rejected" }, ROOM.join_requests, req.params.companyId);
    await notifyJoinRequestResolved(req.params.requestId, false);
    res.json({ success: true });
  }),
);

rbacRouter.get(
  "/companies/:companyId/members",
  route(async (req, res) => {
    res.json({ members: await listCompanyMembers(req.params.companyId, req.userId!) });
  }),
);

rbacRouter.get(
  "/companies/:companyId/employees",
  route(async (req, res) => {
    res.json({ employees: await listEmployees(req.params.companyId, req.userId!) });
  }),
);

rbacRouter.patch(
  "/companies/:companyId/members/:userId",
  route(async (req, res) => {
    const permissionLevel = req.body?.permissionLevel as PermissionLevel;
    const role = await assignPermissionLevel(req.params.companyId, req.userId!, req.params.userId, permissionLevel);
    res.json(role);
  }),
);

rbacRouter.post(
  "/companies/:companyId/transfer-holder",
  route(async (req, res) => {
    const { targetUserId, demoteTo } = req.body ?? {};
    res.json(await transferAccountHolder(req.params.companyId, req.userId!, targetUserId, demoteTo ?? "full"));
  }),
);

rbacRouter.delete(
  "/companies/:companyId/members/:userId",
  route(async (req, res) => {
    await removeMember(req.params.companyId, req.userId!, req.params.userId);
    res.json({ success: true });
  }),
);

rbacRouter.post(
  "/companies/:companyId/deletion-requests",
  route(async (req, res) => {
    const { reason } = req.body ?? {};
    res.status(201).json(await requestCompanyDeletion(req.params.companyId, req.userId!, reason));
  }),
);

rbacRouter.get(
  "/companies/:companyId/deletion-requests/pending",
  route(async (req, res) => {
    res.json({ request: await getPendingCompanyDeletion(req.params.companyId, req.userId!) });
  }),
);
