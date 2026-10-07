import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const { app } = createApp();

async function signUp(email: string) {
  const res = await request(app).post("/auth/signup").send({ email, password: "hunter22", fullName: "Test User" });
  return res.body.token as string;
}

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

const canManageProjects = (token: string) =>
  request(app).post("/rpc/can_manage_projects").set(authed(token)).send({});

describe("rpc: can_manage_projects", () => {
  it("is true for an account holder when called with no arguments", async () => {
    const holder = await signUp(`cmp-holder-${Date.now()}@example.com`);
    await request(app).post("/companies").set(authed(holder)).send({ name: "CMP Co", companyType: "sub" });

    const res = await canManageProjects(holder);
    expect(res.status).toBe(200);
    expect(res.body.data).toBe(true);
  });

  it("is false for a user without a company", async () => {
    const loner = await signUp(`cmp-loner-${Date.now()}@example.com`);
    const res = await canManageProjects(loner);
    expect(res.status).toBe(200);
    expect(res.body.data).toBe(false);
  });

  it("is false below full", async () => {
    const holder = await signUp(`cmp-gc-${Date.now()}@example.com`);
    const company = await request(app).post("/companies").set(authed(holder)).send({ name: "CMP GC", companyType: "gc" });
    const companyId = company.body.company.id;

    const member = await signUp(`cmp-partial-${Date.now()}@example.com`);
    await request(app).post(`/companies/${companyId}/join-requests`).set(authed(member));
    const listed = await request(app).get(`/companies/${companyId}/join-requests`).set(authed(holder));
    await request(app)
      .post(`/companies/${companyId}/join-requests/${listed.body.requests[0].id}/approve`)
      .set(authed(holder))
      .send({ permissionLevel: "partial" });

    const res = await canManageProjects(member);
    expect(res.status).toBe(200);
    expect(res.body.data).toBe(false);
  });
});
