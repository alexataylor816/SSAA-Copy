import { describe, expect, it } from "vitest";
import request from "supertest";
import { startTestServer } from "./helpers/server.js";

const server = await startTestServer();
let seq = 0;

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function signUp(tag: string) {
  const email = `join-${tag}-${Date.now()}-${seq++}@example.com`;
  const res = await request(server).post("/auth/signup").send({ email, password: "hunter22", fullName: tag });
  return { token: res.body.token as string, email };
}

async function company(token: string, companyType: "gc" | "sub") {
  const res = await request(server).post("/companies").set(authed(token)).send({ name: `Join ${companyType} ${seq++}`, companyType });
  return res.body.company.id as string;
}

/** Adds a new person to the company at the given level, the way the app does it. */
async function member(ownerToken: string, companyId: string, level: string) {
  const person = await signUp(level);
  await request(server).post(`/companies/${companyId}/join-requests`).set(authed(person.token));
  const list = await request(server).get(`/companies/${companyId}/join-requests`).set(authed(ownerToken));
  const mine = list.body.requests.find((r: { userEmail: string }) => r.userEmail === person.email);
  await request(server)
    .post(`/companies/${companyId}/join-requests/${mine.id}/approve`)
    .set(authed(ownerToken))
    .send({ permissionLevel: level });
  return person;
}

async function gcProject() {
  const gc = await signUp("gc");
  await company(gc.token, "gc");
  const project = await request(server).post("/projects").set(authed(gc.token)).send({ name: "Riverside" });
  return { gc, code: project.body.connectionCode as string, projectId: project.body.id as string };
}

const preview = (token: string, code: string) => request(server).get("/projects/preview").query({ code }).set(authed(token));
const connect = (token: string, code: string) => request(server).post("/projects/connect").set(authed(token)).send({ code });

describe("joining a project by code or invite link", () => {
  it("shows a sub owner what they're joining, then connects", async () => {
    const { code, projectId } = await gcProject();
    const sub = await signUp("sub");
    await company(sub.token, "sub");

    const before = await preview(sub.token, code);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ project: { id: projectId, name: "Riverside" }, status: "available", canConnect: true, reason: null });
    expect(before.body.gcCompanyName).toMatch(/^Join gc/);

    expect((await connect(sub.token, code)).status).toBe(201);
    expect((await preview(sub.token, code)).body).toMatchObject({ status: "connected", canConnect: false });
  });

  it("lets a sub's office manager (Partial) connect", async () => {
    const { code } = await gcProject();
    const owner = await signUp("sub-owner");
    const subId = await company(owner.token, "sub");
    const manager = await member(owner.token, subId, "partial");
    expect((await preview(manager.token, code)).body.canConnect).toBe(true);
    expect((await connect(manager.token, code)).status).toBe(201);
  });

  it("keeps crew members (Level 1, Basic) from committing the whole company", async () => {
    const { code } = await gcProject();
    const owner = await signUp("sub-owner");
    const subId = await company(owner.token, "sub");
    for (const level of ["level_1", "basic"]) {
      const crew = await member(owner.token, subId, level);
      const view = await preview(crew.token, code);
      expect(view.body).toMatchObject({ status: "available", canConnect: false });
      expect(view.body.reason).toMatch(/owner/i);
      expect((await connect(crew.token, code)).status).toBe(403);
    }
  });

  it("doesn't let another GC join a project as if it were a sub", async () => {
    const { code } = await gcProject();
    const otherGc = await signUp("gc2");
    await company(otherGc.token, "gc");
    expect((await preview(otherGc.token, code)).body).toMatchObject({ canConnect: false });
    expect((await connect(otherGc.token, code)).status).toBe(403);
  });

  it("recognises your own project", async () => {
    const { gc, code } = await gcProject();
    expect((await preview(gc.token, code)).body).toMatchObject({ status: "own", canConnect: false });
    expect((await connect(gc.token, code)).status).toBe(409);
  });

  it("asks someone with no company to set one up first", async () => {
    const { code } = await gcProject();
    const loner = await signUp("loner");
    expect((await preview(loner.token, code)).body).toMatchObject({ canConnect: false, reason: "Set up or join your company first." });
    expect((await connect(loner.token, code)).status).toBe(409);
  });

  it("404s an unknown code and needs sign-in", async () => {
    const sub = await signUp("sub");
    expect((await preview(sub.token, "NOPE1234")).status).toBe(404);
    expect((await request(server).get("/projects/preview").query({ code: "X" })).status).toBe(401);
  });
});
