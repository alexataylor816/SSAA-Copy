import { describe, expect, it } from "vitest";
import request from "supertest";
import { startTestServer } from "./helpers/server.js";
import { database } from "../src/db.js";
const server = await startTestServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
let serial = 0;
async function company(type: "gc" | "sub", trade?: string) {
  const signup = await request(server).post("/auth/signup").send({ email: `recommender-${++serial}@example.com`, password: "LocalQA123!", fullName: `QA ${serial}` });
  const token = signup.body.token;
  const created = await request(server).post("/companies").set(auth(token)).send({ name: `QA ${serial}`, companyType: type, trade });
  expect(created.status).toBe(201);
  const id = created.body.company.id;
  const roster = await request(server).get(`/companies/${id}/employees`).set(auth(token));
  return { token, id, employeeId: roster.body.employees[0].id as string };
}
async function fixture() {
  const gc = await company("gc"), sub = await company("sub", "Electrical");
  const project = (await request(server).post("/projects").set(auth(gc.token)).send({ name: "Local QA" })).body;
  await request(server).post("/projects/connect").set(auth(sub.token)).send({ code: project.connectionCode });
  const day = new Date(); day.setDate(day.getDate() + 2);
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const task = await request(server).post("/query").set(auth(gc.token)).send({ table: "tasks", operation: "insert", data: { project_id: project.id, name: "Electrical Rough In", trade: "Electrical", start_date: date, end_date: date, duration: "1 day", predecessors: "2FS" } });
  expect(task.status).toBe(200);
  const taskId = task.body.data[0].id;
  const availability = await request(server).post("/availability").set(auth(sub.token)).send({ employeeId: sub.employeeId, date, startTime: "08:00", endTime: "16:00", allProjects: true });
  expect(availability.status).toBe(201);
  const body = { taskId, taskTrade: "Electrical", projectId: project.id, subCompanyId: sub.id, employeeIds: [sub.employeeId], date, startTime: "08:00", endTime: "16:00" };
  const preview = () => request(server).post(`/projects/${project.id}/recommendations`).set(auth(gc.token)).send({ taskIds: [taskId], subIds: [sub.id], weeks: [1], headcount: 1, startTime: "08:00", endTime: "16:00" });
  const send = (changes = {}) => request(server).post("/schedule-requests").set(auth(gc.token)).send({ ...body, ...changes });
  return { gc, sub, project, taskId, date, body, preview, send, availabilityId: availability.body.id };
}
describe("server-backed recommendation workflow (isolated local QA)", () => {
  it("previews without sending, then sends a normal pending request to its employer", async () => {
    const f = await fixture();
    const preview = await f.preview(); expect(preview.status).toBe(200);
    expect(preview.body.recommendations[0]).toMatchObject({ headcount: 1, availableCount: 1, reason: null });
    const before = await request(server).get(`/schedule-requests?start=${f.date}&end=${f.date}`).set(auth(f.gc.token));
    expect(before.body.requests).toEqual([]);
    const sent = await f.send(); expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ taskId: f.taskId, subCompanyId: f.sub.id, status: "pending" });
    const gcApprove = await request(server).patch(`/schedule-requests/${sent.body.id}`).set(auth(f.gc.token)).send({ status: "confirmed" });
    expect(gcApprove.status).toBe(403);
    const subApprove = await request(server).patch(`/schedule-requests/${sent.body.id}`).set(auth(f.sub.token)).send({ status: "confirmed" });
    expect(subApprove.status).toBe(200);
    const refresh = await f.preview(); expect(refresh.body.recommendations[0].existingStatus).toBe("confirmed");
    const duplicate = await f.send(); expect(duplicate.status).toBe(409); expect(duplicate.body.error).toMatch(/Already confirmed/);
  });
  it("returns pending status after refresh and blocks simultaneous duplicate sends", async () => {
    const f = await fixture();
    const responses = await Promise.all([f.send(), f.send()]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const preview = await f.preview(); expect(preview.body.recommendations[0].reason).toMatch(/Already pending/);
  });
  it("revalidates availability changed after a draft", async () => {
    const f = await fixture(); await f.preview();
    await request(server).delete(`/availability/${f.availabilityId}`).set(auth(f.sub.token));
    const res = await f.send(); expect(res.status).toBe(409); expect(res.body.error).toMatch(/Only 0 of the 1/);
  });
  it.each(["unresolved", "wrong trade", "deleted", "moved dates", "completed", "disconnected", "wrong employer"])("blocks stale %s drafts", async (scenario) => {
    const f = await fixture(); await f.preview();
    if (scenario === "unresolved") await database.run("UPDATE tasks SET trade = NULL WHERE id = ?", [f.taskId]);
    if (scenario === "wrong trade") await database.run("UPDATE companies SET trade = 'Drywall' WHERE id = ?", [f.sub.id]);
    if (scenario === "deleted") await database.run("DELETE FROM tasks WHERE id = ?", [f.taskId]);
    if (scenario === "moved dates") await database.run("UPDATE tasks SET end_date = '2000-01-01' WHERE id = ?", [f.taskId]);
    if (scenario === "completed") await database.run("UPDATE tasks SET status = 'complete' WHERE id = ?", [f.taskId]);
    if (scenario === "disconnected") await database.run("DELETE FROM project_connections WHERE project_id = ?", [f.project.id]);
    if (scenario === "wrong employer") await database.run("UPDATE employees SET company_id = ? WHERE id = ?", [f.gc.id, f.sub.employeeId]);
    const res = await f.send(); expect([400, 409]).toContain(res.status);
  });
  it("blocks another GC's cross-project booking without disclosing that project", async () => {
    const f = await fixture(), other = await company("gc");
    const project = (await request(server).post("/projects").set(auth(other.token)).send({ name: "Private QA project" })).body;
    await request(server).post("/projects/connect").set(auth(f.sub.token)).send({ code: project.connectionCode });
    const booked = await request(server).post("/schedule-requests").set(auth(other.token)).send({ ...f.body, taskId: undefined, projectId: project.id });
    expect(booked.status).toBe(201);
    const preview = await f.preview(); expect(preview.body.recommendations[0].availableCount).toBe(0);
    expect(JSON.stringify(preview.body)).not.toContain("Private QA project");
    const res = await f.send(); expect(res.status).toBe(409);
  });
  it("allows another non-overlapping stop on the same day", async () => {
    const f = await fixture();
    const other = await request(server).post("/schedule-requests").set(auth(f.gc.token)).send({ ...f.body, taskId: undefined, startTime: "16:00", endTime: "18:00" });
    expect(other.status).toBe(201); expect((await f.send()).status).toBe(201);
  });
  it("rejects invalid crew, date, and time inputs", async () => {
    const f = await fixture();
    for (const changes of [{ employeeIds: [] }, { employeeIds: [f.sub.employeeId, f.sub.employeeId] }, { date: "2026-02-30" }, { startTime: "25:00" }, { startTime: "16:00", endTime: "08:00" }]) expect((await f.send(changes)).status).toBe(400);
    const excessive = await request(server).post(`/projects/${f.project.id}/recommendations`).set(auth(f.gc.token)).send({ taskIds: [f.taskId], subIds: [f.sub.id], weeks: [1], headcount: 5, startTime: "08:00", endTime: "16:00" });
    expect(excessive.body.recommendations[0]).toMatchObject({ headcount: 5, availableCount: 1 });
  });
  it("retains imported metadata and persists manual trade/color corrections", async () => {
    const f = await fixture();
    const updated = await request(server).post("/query").set(auth(f.gc.token)).send({ table: "tasks", operation: "update", filters: [{ column: "id", op: "eq", value: f.taskId }], data: { trade: "Drywall", color: "#0284c7" } });
    expect(updated.status).toBe(200);
    const row = await database.get<{ trade: string; color: string; duration: string; predecessors: string }>("SELECT * FROM tasks WHERE id = ?", [f.taskId]);
    expect(row).toMatchObject({ trade: "Drywall", color: "#0284c7", duration: "1 day", predecessors: "2FS" });
    expect((await f.send()).status).toBe(409);
  });
  it("blocks query-facade writes that bypass scheduling validation", async () => {
    const f = await fixture(), sent = await f.send();
    const res = await request(server).post("/query").set(auth(f.gc.token)).send({ table: "schedule_requests", operation: "update", filters: [{ column: "id", op: "eq", value: sent.body.id }], data: { status: "confirmed" } });
    expect(res.status).toBe(403);
  });
  it("releases rejected/cancelled requests so a replacement can be reviewed", async () => {
    const f = await fixture(), sent = await f.send();
    expect((await request(server).patch(`/schedule-requests/${sent.body.id}`).set(auth(f.sub.token)).send({ status: "rejected" })).status).toBe(200);
    expect((await f.preview()).body.recommendations[0].reason).toBeNull();
    const again = await f.send(); expect(again.status).toBe(201);
    expect((await request(server).patch(`/schedule-requests/${again.body.id}`).set(auth(f.gc.token)).send({ status: "cancelled" })).status).toBe(200);
    expect((await f.send()).status).toBe(201);
  });
});
