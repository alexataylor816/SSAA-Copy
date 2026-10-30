import { Router, type RequestHandler } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { HttpError } from "../rbac/errors.js";
import { emit, emitProject } from "../realtime/index.js";
import { EVENT, ROOM } from "../realtime/events.js";
import { notifyMatrixPublish, notifyScheduleRequestCreated, notifyScheduleRequestUpdated } from "../notifications/service.js";
import { acknowledgeEdit, applyBatch, getMatrix, getProjectAssignments, setProjectAssignments, type BatchBody } from "./matrix.js";
import { findUserById } from "../models/users.js";
import {
  connectProjectByCode,
  previewProjectByCode,
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
async function callerCompanyId(userId: string): Promise<string | null> {
  return (await findUserById(userId))?.companyId ?? null;
}

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

schedulingRouter.get(
  "/projects",
  route(async (req, res) => {
    res.json({ projects: await listVisibleProjects(req.userId!) });
  }),
);

schedulingRouter.post(
  "/projects",
  route(async (req, res) => {
    const { name, address } = req.body ?? {};
    const project = await createProject(req.userId!, { name, address });
    emit(EVENT.projectConnectionChanged, { projectId: project.id, action: "created" }, ROOM.project_connections, project.id);
    res.status(201).json(project);
  }),
);

// Read-only: lets the join page show what you're about to join first.
schedulingRouter.get(
  "/projects/preview",
  route(async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code.trim()) {
      res.status(400).json({ error: "code is required." });
      return;
    }
    res.json(await previewProjectByCode(req.userId!, code));
  }),
);

schedulingRouter.post(
  "/projects/connect",
  route(async (req, res) => {
    const { code } = req.body ?? {};
    if (typeof code !== "string" || !code.trim()) {
      res.status(400).json({ error: "code is required." });
      return;
    }
    const project = await connectProjectByCode(req.userId!, code);
    const companyId = await callerCompanyId(req.userId!);
    if (companyId) {
      emit(EVENT.projectConnectionChanged, { projectId: project.id, companyId }, ROOM.project_connections, project.id);
    }
    res.status(201).json(project);
  }),
);

schedulingRouter.delete(
  "/projects/:id",
  route(async (req, res) => {
    await deleteProject(req.userId!, req.params.id);
    const companyId = await callerCompanyId(req.userId!);
    if (companyId) {
      emit(EVENT.projectConnectionChanged, { projectId: req.params.id, action: "deleted" }, ROOM.project_connections, req.params.id);
    }
    res.json({ success: true });
  }),
);

schedulingRouter.get(
  "/availability",
  route(async (req, res) => {
    const { start, end } = req.query;
    if (typeof start !== "string" || typeof end !== "string") {
      res.status(400).json({ error: "start and end query params are required (YYYY-MM-DD)." });
      return;
    }
    res.json({ availability: await listAvailability(req.userId!, start, end) });
  }),
);

schedulingRouter.post(
  "/availability",
  route(async (req, res) => {
    const { date, startTime, endTime, projectId, allProjects, employeeId, stopNumber } = req.body ?? {};
    const entry = await setAvailability(req.userId!, { date, startTime, endTime, projectId, allProjects, employeeId, stopNumber });
    const companyId = await callerCompanyId(req.userId!);
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
  route(async (req, res) => {
    await deleteAvailability(req.userId!, req.params.id);
    const companyId = await callerCompanyId(req.userId!);
    if (companyId) {
      emit(EVENT.availabilityChanged, { action: "deleted", id: req.params.id }, ROOM.availability, companyId);
    }
    res.json({ success: true });
  }),
);

schedulingRouter.get(
  "/projects/:id/connections",
  route(async (req, res) => {
    res.json({ companies: await listProjectConnectedCompanies(req.userId!, req.params.id) });
  }),
);

schedulingRouter.get(
  "/companies/:id/connected-employees",
  route(async (req, res) => {
    res.json({ employees: await listConnectedCompanyEmployees(req.userId!, req.params.id) });
  }),
);

schedulingRouter.get(
  "/schedule-requests",
  route(async (req, res) => {
    const { start, end } = req.query;
    if (typeof start !== "string" || typeof end !== "string") {
      res.status(400).json({ error: "start and end query params are required (YYYY-MM-DD)." });
      return;
    }
    res.json({ requests: await listScheduleRequests(req.userId!, start, end) });
  }),
);

schedulingRouter.post(
  "/schedule-requests",
  route(async (req, res) => {
    const { projectId, subCompanyId, employeeIds, date, startTime, endTime, description, imageUrls } =
      req.body ?? {};
    const request = await createScheduleRequest(req.userId!, {
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
    emitProject(EVENT.scheduleRequestCreated, { request }, projectId, [subCompanyId, (await callerCompanyId(req.userId!)) ?? ""]);
    await notifyScheduleRequestCreated(req.userId!, request);
    res.status(201).json(request);
  }),
);

schedulingRouter.patch(
  "/schedule-requests/:id",
  route(async (req, res) => {
    const status = req.body?.status as ScheduleRequestStatus;
    const statusReason = req.body?.statusReason as string | undefined;
    const request = await updateScheduleRequestStatus(req.userId!, req.params.id, status, statusReason);
    emitProject(
      EVENT.scheduleRequestUpdated,
      { request },
      request.projectId,
      [request.requestingCompanyId, request.subCompanyId],
    );
    await notifyScheduleRequestUpdated(req.userId!, request);
    res.json(request);
  }),
);

// --- Weekly view (docs/WEEKLY_VIEW_REBUILD.md) ---

schedulingRouter.get(
  "/matrix",
  route(async (req, res) => {
    const { start, days, projectId } = req.query;
    res.json(
      await getMatrix(req.userId!, {
        start: typeof start === "string" ? start : undefined,
        days: typeof days === "string" ? days : undefined,
        projectId: typeof projectId === "string" && projectId ? projectId : undefined,
      }),
    );
  }),
);

schedulingRouter.post(
  "/schedule-requests/batch",
  route(async (req, res) => {
    const body = (req.body ?? {}) as BatchBody;
    const { result, touched } = await applyBatch(req.userId!, body);
    if (!body.dryRun && touched.length > 0) {
      for (const request of touched) {
        emitProject(EVENT.scheduleRequestUpdated, { request }, request.projectId, [request.requestingCompanyId, request.subCompanyId]);
      }
      // No choice sent: a GC's requests still ping the sub in the app (as before); a sub's own changes stay silent.
      const actorCompanyId = (await callerCompanyId(req.userId!)) ?? "";
      const isGcSend = touched.some((r) => r.requestingCompanyId === actorCompanyId && r.subCompanyId !== actorCompanyId);
      const n = body.notify;
      result.notified = await notifyMatrixPublish(req.userId!, actorCompanyId, touched, {
        toCompanyEmail: !!n?.gcEmail,
        toCompanyPush: n ? !!n.gcPush : isGcSend,
        toPersonnelEmail: !!n?.personnelEmail,
        toPersonnelPush: !!n?.personnelPush,
      });
    }
    res.json(result);
  }),
);

schedulingRouter.post(
  "/schedule-requests/:id/acknowledge-edit",
  route(async (req, res) => {
    const request = await acknowledgeEdit(req.userId!, req.params.id);
    emitProject(EVENT.scheduleRequestUpdated, { request }, request.projectId, [request.requestingCompanyId, request.subCompanyId]);
    res.json(request);
  }),
);

schedulingRouter.get(
  "/projects/:id/assignments",
  route(async (req, res) => {
    res.json(await getProjectAssignments(req.userId!, req.params.id));
  }),
);

schedulingRouter.put(
  "/projects/:id/assignments",
  route(async (req, res) => {
    res.json(await setProjectAssignments(req.userId!, req.params.id, req.body ?? {}));
  }),
);
