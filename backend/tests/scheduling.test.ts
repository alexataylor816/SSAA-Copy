import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const { app } = createApp();

async function signUp(email: string, fullName = "Test User") {
  const res = await request(app).post("/auth/signup").send({ email, password: "hunter22", fullName });
  return { token: res.body.token as string, user: res.body.user as { id: string; email: string } };
}

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function makeCompany(token: string, name: string, companyType: "gc" | "sub" = "gc") {
  const res = await request(app).post("/companies").set(authed(token)).send({ name, companyType });
  return res.body.company as { id: string };
}

describe("scheduling: projects", () => {
  it("creates a project with a unique connection code", async () => {
    const { token } = await signUp("projowner@example.com");
    await makeCompany(token, "Owner Co");

    const res = await request(app).post("/projects").set(authed(token)).send({ name: "Tower A" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Tower A");
    expect(res.body.connectionCode).toMatch(/^[a-f0-9]{8}$/);
  });

  it("refuses to create a project without a company", async () => {
    const { token } = await signUp("nocompany@example.com");
    const res = await request(app).post("/projects").set(authed(token)).send({ name: "Orphan Project" });
    expect(res.status).toBe(409);
  });

  it("lets another company connect via the connection code", async () => {
    const owner = await signUp("gcowner@example.com");
    await makeCompany(owner.token, "GC Co", "gc");
    const project = await request(app).post("/projects").set(authed(owner.token)).send({ name: "Bridge B" });

    const sub = await signUp("subconnector@example.com");
    await makeCompany(sub.token, "Sub Co", "sub");

    const connect = await request(app)
      .post("/projects/connect")
      .set(authed(sub.token))
      .send({ code: project.body.connectionCode });
    expect(connect.status).toBe(201);
    expect(connect.body.id).toBe(project.body.id);

    const list = await request(app).get("/projects").set(authed(sub.token));
    expect(list.body.projects.map((p: { id: string }) => p.id)).toContain(project.body.id);
  });

  it("rejects an unknown connection code", async () => {
    const { token } = await signUp("badcode@example.com");
    await makeCompany(token, "Some Co", "sub");
    const res = await request(app).post("/projects/connect").set(authed(token)).send({ code: "zzzzzzzz" });
    expect(res.status).toBe(404);
  });

  it("rejects connecting twice", async () => {
    const owner = await signUp("gcowner2@example.com");
    await makeCompany(owner.token, "GC Co 2", "gc");
    const project = await request(app).post("/projects").set(authed(owner.token)).send({ name: "Bridge C" });

    const sub = await signUp("subconnector2@example.com");
    await makeCompany(sub.token, "Sub Co 2", "sub");
    await request(app).post("/projects/connect").set(authed(sub.token)).send({ code: project.body.connectionCode });

    const again = await request(app)
      .post("/projects/connect")
      .set(authed(sub.token))
      .send({ code: project.body.connectionCode });
    expect(again.status).toBe(409);
  });

  it("lets the owner see which companies are connected to a project", async () => {
    const owner = await signUp("gcowner3@example.com");
    await makeCompany(owner.token, "GC Co 3", "gc");
    const project = await request(app).post("/projects").set(authed(owner.token)).send({ name: "Bridge D" });

    const sub = await signUp("subconnector3@example.com");
    await makeCompany(sub.token, "Sub Co 3", "sub");
    await request(app).post("/projects/connect").set(authed(sub.token)).send({ code: project.body.connectionCode });

    const res = await request(app).get(`/projects/${project.body.id}/connections`).set(authed(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.companies).toHaveLength(1);
    expect(res.body.companies[0].name).toBe("Sub Co 3");
  });

  it("blocks an outsider from listing a project's connections", async () => {
    const owner = await signUp("gcowner4@example.com");
    await makeCompany(owner.token, "GC Co 4", "gc");
    const project = await request(app).post("/projects").set(authed(owner.token)).send({ name: "Bridge E" });

    const outsider = await signUp("outsider4@example.com");
    await makeCompany(outsider.token, "Outsider Co 4", "sub");

    const res = await request(app).get(`/projects/${project.body.id}/connections`).set(authed(outsider.token));
    expect(res.status).toBe(404);
  });

  it("lets a GC view a connected sub's employee roster, but not an unconnected company's", async () => {
    const owner = await signUp("gcowner5@example.com");
    await makeCompany(owner.token, "GC Co 5", "gc");
    const project = await request(app).post("/projects").set(authed(owner.token)).send({ name: "Bridge F" });

    const sub = await signUp("subconnector5@example.com", "Sub Holder 5");
    const subCompany = await makeCompany(sub.token, "Sub Co 5", "sub");
    await request(app).post("/projects/connect").set(authed(sub.token)).send({ code: project.body.connectionCode });

    const visible = await request(app)
      .get(`/companies/${subCompany.id}/connected-employees`)
      .set(authed(owner.token));
    expect(visible.status).toBe(200);
    expect(visible.body.employees).toHaveLength(1);
    expect(visible.body.employees[0].name).toBe("Sub Holder 5");

    const outsider = await signUp("outsider5@example.com");
    await makeCompany(outsider.token, "Outsider Co 5", "sub");
    const blocked = await request(app)
      .get(`/companies/${subCompany.id}/connected-employees`)
      .set(authed(outsider.token));
    expect(blocked.status).toBe(403);
  });
});

describe("scheduling: availability", () => {
  function farFutureDate(daysAhead: number): string {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    return d.toISOString().slice(0, 10);
  }

  it("lets an employee set availability for all projects", async () => {
    const { token } = await signUp("avail1@example.com");
    await makeCompany(token, "Avail Co", "sub");

    const date = farFutureDate(10);
    const res = await request(app)
      .post("/availability")
      .set(authed(token))
      .send({ date, startTime: "08:00", endTime: "16:00", allProjects: true });

    expect(res.status).toBe(201);
    expect(res.body.allProjects).toBe(true);
    expect(res.body.projectId).toBeNull();
  });

  it("lets an employee set availability for a specific visible project", async () => {
    const { token } = await signUp("avail2@example.com");
    await makeCompany(token, "Avail Co 2", "gc");
    const project = await request(app).post("/projects").set(authed(token)).send({ name: "Own Project" });

    const date = farFutureDate(10);
    const res = await request(app)
      .post("/availability")
      .set(authed(token))
      .send({ date, startTime: "09:00", endTime: "12:00", projectId: project.body.id });

    expect(res.status).toBe(201);
    expect(res.body.projectId).toBe(project.body.id);
  });

  it("rejects availability for a project the company can't see", async () => {
    const owner = await signUp("avail3owner@example.com");
    await makeCompany(owner.token, "Avail Owner Co", "gc");
    const project = await request(app).post("/projects").set(authed(owner.token)).send({ name: "Private Project" });

    const outsider = await signUp("avail3outsider@example.com");
    await makeCompany(outsider.token, "Outsider Co", "sub");

    const res = await request(app)
      .post("/availability")
      .set(authed(outsider.token))
      .send({ date: farFutureDate(10), startTime: "09:00", endTime: "12:00", projectId: project.body.id });
    expect(res.status).toBe(404);
  });

  it("rejects an invalid time range", async () => {
    const { token } = await signUp("avail4@example.com");
    await makeCompany(token, "Avail Co 4", "sub");

    const res = await request(app)
      .post("/availability")
      .set(authed(token))
      .send({ date: farFutureDate(10), startTime: "16:00", endTime: "08:00", allProjects: true });
    expect(res.status).toBe(400);
  });

  it("rejects setting availability on a locked historical date", async () => {
    const { token } = await signUp("avail5@example.com");
    await makeCompany(token, "Avail Co 5", "sub");

    const res = await request(app)
      .post("/availability")
      .set(authed(token))
      .send({ date: "2020-01-01", startTime: "08:00", endTime: "16:00", allProjects: true });
    expect(res.status).toBe(403);
  });

  it("lists availability within a date range and lets the owner delete their entry", async () => {
    const { token } = await signUp("avail6@example.com");
    await makeCompany(token, "Avail Co 6", "sub");

    const date = farFutureDate(15);
    const created = await request(app)
      .post("/availability")
      .set(authed(token))
      .send({ date, startTime: "08:00", endTime: "16:00", allProjects: true });

    const start = farFutureDate(14);
    const end = farFutureDate(16);
    const listed = await request(app).get(`/availability?start=${start}&end=${end}`).set(authed(token));
    expect(listed.body.availability.map((a: { id: string }) => a.id)).toContain(created.body.id);

    const del = await request(app).delete(`/availability/${created.body.id}`).set(authed(token));
    expect(del.status).toBe(200);

    const listedAfter = await request(app).get(`/availability?start=${start}&end=${end}`).set(authed(token));
    expect(listedAfter.body.availability.map((a: { id: string }) => a.id)).not.toContain(created.body.id);
  });

  it("blocks deleting someone else's availability", async () => {
    const owner = await signUp("avail7owner@example.com");
    await makeCompany(owner.token, "Avail Co 7", "sub");
    const date = farFutureDate(20);
    const created = await request(app)
      .post("/availability")
      .set(authed(owner.token))
      .send({ date, startTime: "08:00", endTime: "16:00", allProjects: true });

    const other = await signUp("avail7other@example.com");
    await makeCompany(other.token, "Avail Co 7b", "sub");

    const res = await request(app).delete(`/availability/${created.body.id}`).set(authed(other.token));
    expect(res.status).toBe(403);
  });
});
