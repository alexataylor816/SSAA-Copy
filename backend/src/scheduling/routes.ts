import { Router, type RequestHandler } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { HttpError } from "../rbac/errors.js";
import { emit, emitProject } from "../realtime/index.js";
import { EVENT, ROOM } from "../realtime/events.js";
import { notifyScheduleRequestCreated, notifyScheduleRequestUpdated } from "../notifications/service.js";
import { findUserById } from "../models/users.js";
import {
  connectProjectByCode,
  createProject,
  createScheduleRequest,
  deleteAvailability,
  deleteProject,
  listAvailability,
  listConnectedCompanyEmployees,
  listProjectConnectedCompanies,
  listScheduleRequests,
  listVisibleProjects,
  setAvailability,
  updateScheduleRequestStatus,
} from "./service.js";
import type { ScheduleRequestStatus } from "./types.js";

export const schedulingRouter = Router();
schedulingRouter.use(requireAuth);

/** The company a mutation belongs to, so we can emit to the right rooms. */
function callerCompanyId(userId: string): string | null {
  return findUserById(userId)?.companyId ?? null;
}

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

schedulingRouter.get(
  "/projects",
  route((req, res) => {
    res.json({ projects: listVisibleProjects(req.userId!) });
  }),
);

schedulingRouter.post(
  "/projects",
  route((req, res) => {
    const { name, address } = req.body ?? {};
    const project = createProject(req.userId!, { name, address });
    emit(EVENT.projectConnectionChanged, { projectId: project.id, action: "created" }, ROOM.project_connections, project.id);
    res.status(201).json(project);
  }),
);

schedulingRouter.post(
  "/projects/connect",
  route((req, res) => {
    const { code } = req.body ?? {};
    if (typeof code !== "string" || !code.trim()) {
      res.status(400).json({ error: "code is required." });
      return;
    }
    const project = connectProjectByCode(req.userId!, code);
    const companyId = callerCompanyId(req.userId!);
    if (companyId) {
      emit(EVENT.projectConnectionChanged, { projectId: project.id, companyId }, ROOM.project_connections, project.id);
    }
    res.status(201).json(project);
  }),
);

schedulingRouter.delete(
  "/projects/:id",
  route((req, res) => {
    deleteProject(req.userId!, req.params.id);
    const companyId = callerCompanyId(req.userId!);
    if (companyId) {
      emit(EVENT.projectConnectionChanged, { projectId: req.params.id, action: "deleted" }, ROOM.project_connections, req.params.id);
    }
    res.json({ success: true });
  }),
);

schedulingRouter.get(
  "/availability",
  route((req, res) => {
    const { start, end } = req.query;
    if (typeof start !== "string" || typeof end !== "string") {
      res.status(400).json({ error: "start and end query params are required (YYYY-MM-DD)." });
      return;
    }
    res.json({ availability: listAvailability(req.userId!, start, end) });
  }),
);

schedulingRouter.post(
  "/availability",
  route((req, res) => {
    const { date, startTime, endTime, projectId, allProjects, employeeId } = req.body ?? {};
    const entry = setAvailability(req.userId!, { date, startTime, endTime, projectId, allProjects, employeeId });
    const companyId = callerCompanyId(req.userId!);
    if (companyId) {
      // The target employee is always on the caller's own roster (enforced in
      // resolveEmployeeToSchedule), so one room is enough — no cross-company fanout.
      emit(EVENT.availabilityChanged, { action: "created", entry }, ROOM.availability, companyId);
    }
    res.status(201).json(entry);
  }),
);

schedulingRouter.delete(
  "/availability/:id",
  route((req, res) => {
    deleteAvailability(req.userId!, req.params.id);
    const companyId = callerCompanyId(req.userId!);
    if (companyId) {
      emit(EVENT.availabilityChanged, { action: "deleted", id: req.params.id }, ROOM.availability, companyId);
    }
    res.json({ success: true });
  }),
);

schedulingRouter.get(
  "/projects/:id/connections",
  route((req, res) => {
    res.json({ companies: listProjectConnectedCompanies(req.userId!, req.params.id) });
  }),
);

schedulingRouter.get(
  "/companies/:id/connected-employees",
  route((req, res) => {
    res.json({ employees: listConnectedCompanyEmployees(req.userId!, req.params.id) });
  }),
);

schedulingRouter.get(
  "/schedule-requests",
  route((req, res) => {
    const { start, end } = req.query;
    if (typeof start !== "string" || typeof end !== "string") {
      res.status(400).json({ error: "start and end query params are required (YYYY-MM-DD)." });
      return;
    }
    res.json({ requests: listScheduleRequests(req.userId!, start, end) });
  }),
);

schedulingRouter.post(
  "/schedule-requests",
  route((req, res) => {
    const { projectId, subCompanyId, employeeIds, date, startTime, endTime, description, imageUrls } =
      req.body ?? {};
    const request = createScheduleRequest(req.userId!, {
      projectId,
      subCompanyId,
      employeeIds,
      date,
      startTime,
      endTime,
      description,
      imageUrls,
    });
    // Both companies care: the GC that asked, and the sub whose crew was named.
    emitProject(EVENT.scheduleRequestCreated, { request }, projectId, [subCompanyId, callerCompanyId(req.userId!) ?? ""]);
    notifyScheduleRequestCreated(req.userId!, request);
    res.status(201).json(request);
  }),
);

schedulingRouter.patch(
  "/schedule-requests/:id",
  route((req, res) => {
    const status = req.body?.status as ScheduleRequestStatus;
    const statusReason = req.body?.statusReason as string | undefined;
    const request = updateScheduleRequestStatus(req.userId!, req.params.id, status, statusReason);
    emitProject(
      EVENT.scheduleRequestUpdated,
      { request },
      request.projectId,
      [request.requestingCompanyId, request.subCompanyId],
    );
    notifyScheduleRequestUpdated(req.userId!, request);
    res.json(request);
  }),
);
