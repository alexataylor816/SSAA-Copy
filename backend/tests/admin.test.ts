import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { setUserIsAdmin } from "../src/models/users.js";

const { app } = await createApp();

async function signUp(email: string) {
  const res = await request(app).post("/auth/signup").send({ email, password: "hunter22", fullName: "Test User" });
  return { token: res.body.token as string, user: res.body.user as { id: string; email: string } };
}

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function admin() {
  const a = await signUp(`adm-${Date.now()}-${Math.random()}@example.com`);
  await setUserIsAdmin(a.user.id, true);
  return a;
}

describe("admin", () => {
  it("refuses every admin route for non-admins", async () => {
    const u = await signUp(`nonadm-${Date.now()}@example.com`);
    for (const [method, path] of [
      ["get", "/admin/companies"],
      ["get", "/admin/operators"],
      ["get", "/admin/deletion-requests"],
      ["get", "/admin/templates"],
    ] as const) {
      const res =
        method === "get"
          ? await request(app).get(path).set(authed(u.token))
          : await request(app).post(path).set(authed(u.token)).send({});
      expect(res.status).toBe(403);
    }
  });

  it("manages templates: list seeded, update, bad channel rejected", async () => {
    const a = await admin();
    const list = await request(app).get("/admin/templates").set(authed(a.token));
    expect(list.status).toBe(200);
    expect(list.body.templates.length).toBeGreaterThanOrEqual(7);
    const first = list.body.templates[0];

    const updated = await request(app)
      .patch(`/admin/templates/${first.id}`)
      .set(authed(a.token))
      .send({ subject: "New subject", isActive: false });
    expect(updated.status).toBe(200);
    expect(updated.body.subject).toBe("New subject");
    expect(updated.body.isActive).toBe(false);

    const bad = await request(app)
      .patch(`/admin/templates/${first.id}`)
      .set(authed(a.token))
      .send({ channel: "carrier-pigeon" });
    expect(bad.status).toBe(400);

    const missing = await request(app)
      .patch("/admin/templates/00000000-0000-0000-0000-000000000000")
      .set(authed(a.token))
      .send({ subject: "x" });
    expect(missing.status).toBe(404);
  });

  it("grants and revokes operator status, but not its own", async () => {
    const a = await admin();
    const u = await signUp(`op-${Date.now()}@example.com`);

    const grant = await request(app).post("/admin/operators").set(authed(a.token)).send({ email: u.user.email });
    expect(grant.status).toBe(200);
    expect(grant.body.isAdmin).toBe(true);

    const ops = await request(app).get("/admin/operators").set(authed(a.token));
    expect(ops.body.operators.some((o: { email: string }) => o.email === u.user.email)).toBe(true);

    const revoke = await request(app)
      .post("/admin/operators")
      .set(authed(a.token))
      .send({ userId: u.user.id, isAdmin: false });
    expect(revoke.body.isAdmin).toBe(false);

    const selfDemote = await request(app)
      .post("/admin/operators")
      .set(authed(a.token))
      .send({ userId: a.user.id, isAdmin: false });
    expect(selfDemote.status).toBe(403);
  });

  it("approves a deletion by removing the company and detaching members", async () => {
    const a = await admin();
    const holder = await signUp(`delh-${Date.now()}@example.com`);
    const company = await request(app)
      .post("/companies")
      .set(authed(holder.token))
      .send({ name: "Doomed Co", companyType: "gc" });
    const companyId = company.body.company.id as string;
    await request(app).post("/projects").set(authed(holder.token)).send({ name: "Doomed Project" });

    const filed = await request(app)
      .post(`/companies/${companyId}/deletion-requests`)
      .set(authed(holder.token))
      .send({ reason: "test" });
    expect(filed.status).toBe(201);

    const queue = await request(app).get("/admin/deletion-requests").set(authed(a.token));
    expect(queue.body.requests.some((r: { id: string }) => r.id === filed.body.id)).toBe(true);

    const approved = await request(app)
      .post(`/admin/deletion-requests/${filed.body.id}/resolve`)
      .set(authed(a.token))
      .send({ approve: true });
    expect(approved.status).toBe(200);

    const companies = await request(app).get("/admin/companies").set(authed(a.token));
    expect(companies.body.companies.some((c: { id: string }) => c.id === companyId)).toBe(false);

    // Holder login survives but belongs nowhere.
    const me = await request(app)
      .post("/query")
      .set(authed(holder.token))
      .send({ table: "users", operation: "select", filters: [{ op: "eq", column: "id", value: holder.user.id }] });
    expect(me.body.data[0].company_id).toBeNull();
  });

  it("rejects a deletion without touching the company", async () => {
    const a = await admin();
    const holder = await signUp(`delhr-${Date.now()}@example.com`);
    const company = await request(app)
      .post("/companies")
      .set(authed(holder.token))
      .send({ name: "Spared Co", companyType: "sub" });
    const filed = await request(app)
      .post(`/companies/${company.body.company.id}/deletion-requests`)
      .set(authed(holder.token))
      .send({});
    const rejected = await request(app)
      .post(`/admin/deletion-requests/${filed.body.id}/resolve`)
      .set(authed(a.token))
      .send({ approve: false });
    expect(rejected.status).toBe(200);

    const queue = await request(app).get("/admin/deletion-requests").set(authed(a.token));
    expect(queue.body.requests.some((r: { id: string }) => r.id === filed.body.id)).toBe(false);
  });
});
