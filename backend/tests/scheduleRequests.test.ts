import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const { app } = await createApp();

async function signUp(email: string, fullName = "Test User") {
  const res = await request(app).post("/auth/signup").send({ email, password: "hunter22", fullName });
  return { token: res.body.token as string, user: res.body.user as { id: string; email: string } };
}

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function makeCompany(token: string, name: string, companyType: "gc" | "sub" = "gc") {
  const res = await request(app).post("/companies").set(authed(token)).send({ name, companyType });
  return res.body as { company: { id: string }; role: { permissionLevel: string } };
}

function farFutureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

async function connectedGcAndSub() {
  const gc = await signUp(`gc-${Date.now()}-${Math.random()}@example.com`, "GC Holder");
  const gcCompany = await makeCompany(gc.token, "GC Co", "gc");
  const project = await request(app).post("/projects").set(authed(gc.token)).send({ name: "Tower" });

  const sub = await signUp(`sub-${Date.now()}-${Math.random()}@example.com`, "Sub Holder");
  const subCompany = await makeCompany(sub.token, "Sub Co", "sub");
  await request(app).post("/projects/connect").set(authed(sub.token)).send({ code: project.body.connectionCode });

  const subEmployees = await request(app).get(`/companies/${subCompany.company.id}/employees`).set(authed(sub.token));

  return { gc, gcCompany, sub, subCompany, project: project.body, subEmployeeId: subEmployees.body.employees[0].id };
}

describe("schedule requests", () => {
  it("lets a GC request a connected sub's employee, and the sub confirms it", async () => {
    const { gc, sub, project, subCompany, subEmployeeId } = await connectedGcAndSub();
    const date = farFutureDate(10);

    const created = await request(app)
      .post("/schedule-requests")
      .set(authed(gc.token))
      .send({
        projectId: project.id,
        subCompanyId: subCompany.company.id,
        employeeIds: [subEmployeeId],
        date,
        startTime: "08:00",
        endTime: "16:00",
      });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("pending");
    const subEmployees = await request(app).get(`/companies/${subCompany.company.id}/employees`).set(authed(sub.token));
    const expectedName = subEmployees.body.employees.find((e: { id: string }) => e.id === subEmployeeId)?.name;
    expect(created.body.employeeNames).toEqual([expectedName]);

    const confirm = await request(app)
      .patch(`/schedule-requests/${created.body.id}`)
      .set(authed(sub.token))
      .send({ status: "confirmed" });
    expect(confirm.status).toBe(200);
    expect(confirm.body.status).toBe("confirmed");
  });

  it("blocks the requesting company from confirming its own request", async () => {
    const { gc, project, subCompany, subEmployeeId } = await connectedGcAndSub();
    const date = farFutureDate(10);

    const created = await request(app)
      .post("/schedule-requests")
      .set(authed(gc.token))
      .send({ projectId: project.id, subCompanyId: subCompany.company.id, employeeIds: [subEmployeeId], date });

    const res = await request(app)
      .patch(`/schedule-requests/${created.body.id}`)
      .set(authed(gc.token))
      .send({ status: "confirmed" });
    expect(res.status).toBe(403);
  });

  it("lets the sub reject a request, and rejects a second response", async () => {
    const { sub, gc, project, subCompany, subEmployeeId } = await connectedGcAndSub();
    const date = farFutureDate(10);

    const created = await request(app)
      .post("/schedule-requests")
      .set(authed(gc.token))
      .send({ projectId: project.id, subCompanyId: subCompany.company.id, employeeIds: [subEmployeeId], date });

    const rejected = await request(app)
      .patch(`/schedule-requests/${created.body.id}`)
      .set(authed(sub.token))
      .send({ status: "rejected" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe("rejected");

    const again = await request(app)
      .patch(`/schedule-requests/${created.body.id}`)
      .set(authed(sub.token))
      .send({ status: "confirmed" });
    expect(again.status).toBe(409);
  });

  it("lets either side cancel a pending request", async () => {
    const { gc, project, subCompany, subEmployeeId } = await connectedGcAndSub();
    const date = farFutureDate(10);

    const created = await request(app)
      .post("/schedule-requests")
      .set(authed(gc.token))
      .send({ projectId: project.id, subCompanyId: subCompany.company.id, employeeIds: [subEmployeeId], date });

    const cancelled = await request(app)
      .patch(`/schedule-requests/${created.body.id}`)
      .set(authed(gc.token))
      .send({ status: "cancelled" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
  });

  it("rejects requesting an employee who doesn't belong to the named sub company", async () => {
    const { gc, project, subCompany } = await connectedGcAndSub();
    const outsider = await signUp(`outsider-${Date.now()}@example.com`, "Outsider");
    const outsiderCompany = await makeCompany(outsider.token, "Outsider Co", "sub");
    const outsiderEmployees = await request(app)
      .get(`/companies/${outsiderCompany.company.id}/employees`)
      .set(authed(outsider.token));

    const res = await request(app)
      .post("/schedule-requests")
      .set(authed(gc.token))
      .send({
        projectId: project.id,
        subCompanyId: subCompany.company.id,
        employeeIds: [outsiderEmployees.body.employees[0].id],
        date: farFutureDate(10),
      });
    expect(res.status).toBe(400);
  });

  it("rejects requesting a sub that isn't connected to the project", async () => {
    const { gc, project } = await connectedGcAndSub();
    const unconnectedSub = await signUp(`unconnected-${Date.now()}@example.com`, "Unconnected");
    const unconnectedCompany = await makeCompany(unconnectedSub.token, "Unconnected Co", "sub");

    const res = await request(app)
      .post("/schedule-requests")
      .set(authed(gc.token))
      .send({
        projectId: project.id,
        subCompanyId: unconnectedCompany.company.id,
        employeeIds: ["nonexistent"],
        date: farFutureDate(10),
      });
    expect(res.status).toBe(400);
  });

  it("blocks a basic-level user from creating a schedule request", async () => {
    const { gc, sub, project, subCompany, subEmployeeId } = await connectedGcAndSub();

    // Demote the GC holder is impossible (can't demote self), so instead add
    // a second GC member at basic-equivalent level via a sub company join
    // flow isn't applicable to GC (basic isn't GC-visible) — use the sub
    // side: add a second sub member at 'basic' and have them try to request
    // from within their own company context (self-scheduling requires
    // partial+ too).
    const member = await signUp(`basicmember-${Date.now()}@example.com`, "Basic Member");
    const joinRes = await request(app)
      .post(`/companies/${subCompany.company.id}/join-requests`)
      .set(authed(member.token));
    await request(app)
      .post(`/companies/${subCompany.company.id}/join-requests/${joinRes.body.id}/approve`)
      .set(authed(sub.token))
      .send({ permissionLevel: "basic" });

    const res = await request(app)
      .post("/schedule-requests")
      .set(authed(member.token))
      .send({
        projectId: project.id,
        subCompanyId: subCompany.company.id,
        employeeIds: [subEmployeeId],
        date: farFutureDate(10),
      });
    expect(res.status).toBe(403);
  });

  it("lists requests visible to both the requesting and sub company", async () => {
    const { gc, sub, project, subCompany, subEmployeeId } = await connectedGcAndSub();
    const date = farFutureDate(12);
    await request(app)
      .post("/schedule-requests")
      .set(authed(gc.token))
      .send({ projectId: project.id, subCompanyId: subCompany.company.id, employeeIds: [subEmployeeId], date });

    const fromGc = await request(app).get(`/schedule-requests?start=${date}&end=${date}`).set(authed(gc.token));
    const fromSub = await request(app).get(`/schedule-requests?start=${date}&end=${date}`).set(authed(sub.token));
    expect(fromGc.body.requests).toHaveLength(1);
    expect(fromSub.body.requests).toHaveLength(1);
  });
});

describe("schedule request photos", () => {
  // A 1x1 transparent PNG; big enough for multer's sniffing, small enough
  // to never trip the size limit.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  async function uploadPhoto(token: string, filename = "site.png", contentType = "image/png", body: Buffer = png) {
    return request(app).post("/uploads").set(authed(token)).attach("photo", body, { filename, contentType });
  }

  it("refuses anonymous uploads", async () => {
    const res = await request(app).post("/uploads").attach("photo", png, {
      filename: "site.png",
      contentType: "image/png",
    });
    expect(res.status).toBe(401);
  });

  it("refuses non-images with a 400, not a 500", async () => {
    const { gc } = await connectedGcAndSub();
    const res = await request(app)
      .post("/uploads")
      .set(authed(gc.token))
      .attach("photo", Buffer.from("definitely not an image"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only jpeg, png, webp, or gif/i);
  });

  it("stores a photo and serves it back at the returned URL", async () => {
    const { gc } = await connectedGcAndSub();
    const uploaded = await uploadPhoto(gc.token);
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.url).toMatch(/^\/uploads\/schedule-requests\/[A-Za-z0-9._-]+\.png$/);

    const served = await request(app).get(uploaded.body.url);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toMatch(/image\/png/);
  });

  it("round-trips photo URLs on a schedule request and rejects remote URLs", async () => {
    const { gc, sub, project, subCompany, subEmployeeId } = await connectedGcAndSub();
    const uploaded = await uploadPhoto(gc.token);
    const url = uploaded.body.url as string;
    const date = farFutureDate(13);

    const created = await request(app)
      .post("/schedule-requests")
      .set(authed(gc.token))
      .send({
        projectId: project.id,
        subCompanyId: subCompany.company.id,
        employeeIds: [subEmployeeId],
        date,
        imageUrls: [url],
      });
    expect(created.status).toBe(201);
    expect(created.body.imageUrls).toEqual([url]);

    const listed = await request(app).get(`/schedule-requests?start=${date}&end=${date}`).set(authed(sub.token));
    expect(listed.body.requests[0].imageUrls).toEqual([url]);

    const remote = await request(app)
      .post("/schedule-requests")
      .set(authed(gc.token))
      .send({
        projectId: project.id,
        subCompanyId: subCompany.company.id,
        employeeIds: [subEmployeeId],
        date,
        imageUrls: ["https://evil.example/photo.png"],
      });
    expect(remote.status).toBe(400);

    const tooMany = await request(app)
      .post("/schedule-requests")
      .set(authed(gc.token))
      .send({
        projectId: project.id,
        subCompanyId: subCompany.company.id,
        employeeIds: [subEmployeeId],
        date,
        imageUrls: Array(7).fill(url),
      });
    expect(tooMany.status).toBe(400);
  });

  it("records an optional reason on reject/cancel and rejects overlong ones", async () => {
    const { gc, sub, project, subCompany, subEmployeeId } = await connectedGcAndSub();
    const date = farFutureDate(14);

    const created = await request(app)
      .post("/schedule-requests")
      .set(authed(gc.token))
      .send({ projectId: project.id, subCompanyId: subCompany.company.id, employeeIds: [subEmployeeId], date });
    expect(created.status).toBe(201);
    expect(created.body.statusReason).toBeNull();
    expect(created.body.requestingCompanyName).toBeTruthy();
    expect(created.body.subCompanyName).toBeTruthy();

    const rejected = await request(app)
      .patch(`/schedule-requests/${created.body.id}`)
      .set(authed(sub.token))
      .send({ status: "rejected", statusReason: "Crew is on another job that day." });
    expect(rejected.status).toBe(200);
    expect(rejected.body.statusReason).toBe("Crew is on another job that day.");

    const listed = await request(app).get(`/schedule-requests?start=${date}&end=${date}`).set(authed(gc.token));
    expect(listed.body.requests[0].statusReason).toBe("Crew is on another job that day.");

    const created2 = await request(app)
      .post("/schedule-requests")
      .set(authed(gc.token))
      .send({ projectId: project.id, subCompanyId: subCompany.company.id, employeeIds: [subEmployeeId], date });
    const tooLong = await request(app)
      .patch(`/schedule-requests/${created2.body.id}`)
      .set(authed(sub.token))
      .send({ status: "rejected", statusReason: "x".repeat(501) });
    expect(tooLong.status).toBe(400);
  });
});
