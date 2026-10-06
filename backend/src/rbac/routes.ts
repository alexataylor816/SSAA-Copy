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

rbacRouter.get(
  "/rbac/me",
  route((req, res) => {
    res.json(getUserContext(req.userId!));
  }),
);

rbacRouter.get(
  "/companies",
  route((req, res) => {
    const type = req.query.type as CompanyType | undefined;
    if (type && type !== "gc" && type !== "sub") {
      res.status(400).json({ error: "type must be 'gc' or 'sub'." });
      return;
    }
    res.json({ companies: listCompanies(type) });
  }),
);

rbacRouter.post(
  "/companies",
  route((req, res) => {
    const { name, companyType, address, trade } = req.body ?? {};
    const result = createCompany(req.userId!, { name, companyType, address, trade });
    res.status(201).json(result);
  }),
);

rbacRouter.post(
  "/companies/:companyId/join-requests",
  route((req, res) => {
    const result = requestToJoinCompany(req.userId!, req.params.companyId);
    // Everyone who can approve needs to see it without a refresh.
    emit(EVENT.joinRequestCreated, { joinRequest: result }, ROOM.join_requests, req.params.companyId);
    notifyJoinRequestCreated(req.userId!, req.params.companyId);
    res.status(201).json(result);
  }),
);

rbacRouter.get(
  "/companies/:companyId/join-requests",
  route((req, res) => {
    res.json({ requests: listJoinRequests(req.params.companyId, req.userId!) });
  }),
);

rbacRouter.post(
  "/companies/:companyId/join-requests/:requestId/approve",
  route((req, res) => {
    const permissionLevel = req.body?.permissionLevel as PermissionLevel;
    const role = approveJoinRequest(req.params.companyId, req.params.requestId, req.userId!, permissionLevel);
    emit(EVENT.joinRequestResolved, { status: "approved", userRole: role }, ROOM.join_requests, req.params.companyId);
    emit(EVENT.joinRequestResolved, { status: "approved" }, ROOM.user_profile, req.params.requestId);
    notifyJoinRequestResolved(req.params.requestId, true);
    res.json(role);
  }),
);

rbacRouter.post(
  "/companies/:companyId/join-requests/:requestId/reject",
  route((req, res) => {
    rejectJoinRequest(req.params.companyId, req.params.requestId, req.userId!);
    emit(EVENT.joinRequestResolved, { status: "rejected" }, ROOM.join_requests, req.params.companyId);
    notifyJoinRequestResolved(req.params.requestId, false);
    res.json({ success: true });
  }),
);

rbacRouter.get(
  "/companies/:companyId/members",
  route((req, res) => {
    res.json({ members: listCompanyMembers(req.params.companyId, req.userId!) });
  }),
);

rbacRouter.get(
  "/companies/:companyId/employees",
  route((req, res) => {
    res.json({ employees: listEmployees(req.params.companyId, req.userId!) });
  }),
);

rbacRouter.patch(
  "/companies/:companyId/members/:userId",
  route((req, res) => {
    const permissionLevel = req.body?.permissionLevel as PermissionLevel;
    const role = assignPermissionLevel(req.params.companyId, req.userId!, req.params.userId, permissionLevel);
    res.json(role);
  }),
);

rbacRouter.post(
  "/companies/:companyId/transfer-holder",
  route((req, res) => {
    const { targetUserId, demoteTo } = req.body ?? {};
    res.json(transferAccountHolder(req.params.companyId, req.userId!, targetUserId, demoteTo ?? "full"));
  }),
);

rbacRouter.delete(
  "/companies/:companyId/members/:userId",
  route((req, res) => {
    removeMember(req.params.companyId, req.userId!, req.params.userId);
    res.json({ success: true });
  }),
);

rbacRouter.post(
  "/companies/:companyId/deletion-requests",
  route((req, res) => {
    const { reason } = req.body ?? {};
    res.status(201).json(requestCompanyDeletion(req.params.companyId, req.userId!, reason));
  }),
);

rbacRouter.get(
  "/companies/:companyId/deletion-requests/pending",
  route((req, res) => {
    res.json({ request: getPendingCompanyDeletion(req.params.companyId, req.userId!) });
  }),
);
