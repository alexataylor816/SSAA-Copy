import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { getHistoricalLockDate } from "../src/scheduling/historicalLock.js";

const { app } = await createApp();

async function signUp(email: string, fullName = "Test User") {
  const res = await request(app).post("/auth/signup").send({ email, password: "hunter22", fullName });
  return { token: res.body.token as string, user: res.body.user as { id: string; email: string } };
}

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** A YYYY-MM-DD string comfortably before the lock boundary. */
function lockedDate(): string {
  const lock = getHistoricalLockDate();
  const d = new Date(lock);
  d.setDate(d.getDate() - 3);
  return d.toISOString().slice(0, 10);
}

function futureDate(): string {
  const d = new Date(getHistoricalLockDate());
  d.setDate(d.getDate() + 3);
  return d.toISOString().slice(0, 10);
}

/** A GC and a sub connected by a shared project, plus the sub's one employee. */
async function connectedGcAndSub() {
  const gc = await signUp(`gc-${Date.now()}-${Math.random()}@example.com`, "GC Holder");
  const gcCompany = await request(app)
    .post("/companies")
    .set(authed(gc.token))
    .send({ name: "GC Co", companyType: "gc" });
  const project = await request(app).post("/projects").set(authed(gc.token)).send({ name: "Tower" });

  const sub = await signUp(`sub-${Date.now()}-${Math.random()}@example.com`, "Sub Holder");
  const subCompany = await request(app)
    .post("/companies")
    .set(authed(sub.token))
    .send({ name: "Sub Co", companyType: "sub" });
  await request(app).post("/projects/connect").set(authed(sub.token)).send({ code: project.body.connectionCode });

  const employees = await request(app).get(`/companies/${subCompany.body.company.id}/employees`).set(authed(sub.token));

  return {
    gc,
    sub,
    gcCompany: gcCompany.body.company,
    subCompany: subCompany.body.company,
    project: project.body,
    subEmployeeId: employees.body.employees[0].id as string,
  };
}

describe("historical lock", () => {
  it("locks dates before the most recent Monday 01:00", () => {
    const lock = getHistoricalLockDate(new Date("2026-06-17T12:00:00")); // a Wednesday
    expect(lock.getDay()).toBe(1); // Monday
    expect(lock.getHours()).toBe(0);
    expect(lock.getDate()).toBe(15);
  });

  it("rolls back a week when asked before Monday 01:00", () => {
    const sundayNight = getHistoricalLockDate(new Date("2026-06-14T23:00:00")); // Sunday
    expect(sundayNight.getDay()).toBe(1);
    expect(sundayNight.getDate()).toBe(8);
  });

  it("rejects creating availability on a locked date", async () => {
    const { token } = await signUp("lock-avail@example.com");
    await request(app).post("/companies").set(authed(token)).send({ name: "Lock Co", companyType: "gc" });

    const res = await request(app)
      .post("/availability")
      .set(authed(token))
      .send({ date: lockedDate(), startTime: "08:00", endTime: "12:00", allProjects: true });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/locked/i);
  });

  it("still accepts availability on an unlocked date", async () => {
    const { token } = await signUp("unlock-avail@example.com");
    await request(app).post("/companies").set(authed(token)).send({ name: "Open Co", companyType: "gc" });

    const res = await request(app)
      .post("/availability")
      .set(authed(token))
      .send({ date: futureDate(), startTime: "08:00", endTime: "12:00", allProjects: true });

    expect(res.status).toBe(201);
  });

  it("rejects deleting availability on a locked date", async () => {
    const { token } = await signUp("lock-del@example.com");
    await request(app).post("/companies").set(authed(token)).send({ name: "Delete Co", companyType: "gc" });

    const created = await request(app)
      .post("/availability")
      .set(authed(token))
      .send({ date: futureDate(), startTime: "08:00", endTime: "12:00", allProjects: true });
    expect(created.status).toBe(201);

    // Backdate the row so the delete targets a locked day.
    const { database } = await import("../src/db.js");
    await database.run("UPDATE availability SET date = ? WHERE id = ?", [lockedDate(), created.body.id]);

    const res = await request(app).delete(`/availability/${created.body.id}`).set(authed(token));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/locked/i);
  });

  it("rejects creating a schedule request on a locked date", async () => {
    const { gc, project, subCompany, subEmployeeId } = await connectedGcAndSub();

    const res = await request(app)
      .post("/schedule-requests")
      .set(authed(gc.token))
      .send({
        projectId: project.id,
        subCompanyId: subCompany.id,
        employeeIds: [subEmployeeId],
        date: lockedDate(),
        startTime: "08:00",
        endTime: "16:00",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/locked/i);
  });

  it("rejects responding to a schedule request whose date is locked", async () => {
    const { gc, sub, project, subCompany, subEmployeeId } = await connectedGcAndSub();

    const created = await request(app)
      .post("/schedule-requests")
      .set(authed(gc.token))
      .send({
        projectId: project.id,
        subCompanyId: subCompany.id,
        employeeIds: [subEmployeeId],
        date: futureDate(),
        startTime: "08:00",
        endTime: "16:00",
      });
    expect(created.status).toBe(201);

    const { database } = await import("../src/db.js");
    await database.run("UPDATE schedule_requests SET date = ? WHERE id = ?", [lockedDate(), created.body.id]);

    const res = await request(app)
      .patch(`/schedule-requests/${created.body.id}`)
      .set(authed(sub.token))
      .send({ status: "confirmed" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/locked/i);
  });
});

describe("capabilities", () => {
  it("returns server-resolved capabilities instead of leaving clients to guess", async () => {
    const { token } = await signUp("caps@example.com");
    await request(app).post("/companies").set(authed(token)).send({ name: "Caps Co", companyType: "gc" });

    const res = await request(app).get("/rbac/me").set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.capabilities).toEqual({
      // Company creator is the account holder.
      canApproveJoinRequests: true,
      canManageTeam: true,
      canSchedulePeople: true,
      canRespondToScheduleRequests: true,
      // Account holder is above level_1, so not read-only.
      isReadOnlyScheduling: false,
      // Only isAdmin may remove other people's availability.
      canRemoveAnyAvailability: false,
    });
  });

  it("reports read-only scheduling for a company with no role yet", async () => {
    const { token } = await signUp("caps-nocompany@example.com");
    const res = await request(app).get("/rbac/me").set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.company).toBeNull();
    expect(res.body.capabilities.canApproveJoinRequests).toBe(false);
    expect(res.body.capabilities.canManageTeam).toBe(false);
  });
});