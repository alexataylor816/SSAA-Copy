import { describe, expect, it } from "vitest";
import request from "supertest";
import { startTestServer } from "./helpers/server.js";
import { setUserIsAdmin } from "../src/models/users.js";

const server = await startTestServer();
let n = 0;

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signUp(tag: string) {
  const res = await request(server)
    .post("/auth/signup")
    .send({ email: `op-${tag}-${Date.now()}-${n++}@example.com`, password: "hunter22", fullName: `Pat ${tag}` });
  return { token: res.body.token as string, id: res.body.user.id as string, email: res.body.user.email as string };
}

async function operator() {
  const op = await signUp("operator");
  await setUserIsAdmin(op.id, true);
  return op;
}

/** A GC owner with one project, so "view as" has something to see. */
async function gcOwner() {
  const owner = await signUp("gc");
  const company = (await request(server).post("/companies").set(authed(owner.token)).send({ name: `Op GC ${n}`, companyType: "gc" })).body.company;
  const project = (await request(server).post("/projects").set(authed(owner.token)).send({ name: `Op Tower ${n}` })).body;
  return { ...owner, companyId: company.id as string, project };
}

describe("operator dashboard", () => {
  it("lists every user with their company, and each company's account holder", async () => {
    const op = await operator();
    const owner = await gcOwner();
    const users = (await request(server).get("/admin/users").set(authed(op.token))).body.users;
    expect(users.find((u: { userId: string }) => u.userId === owner.id)).toMatchObject({
      companyId: owner.companyId,
      companyType: "gc",
      permissionLevel: "account_holder",
      isOperator: false,
    });
    expect(users.find((u: { userId: string }) => u.userId === op.id)).toMatchObject({ isOperator: true, companyId: null });

    const companies = (await request(server).get("/admin/companies").set(authed(op.token))).body.companies;
    expect(companies.find((c: { id: string }) => c.id === owner.companyId).primaryHolder).toMatchObject({ userId: owner.id });
  });

  it("is operators only", async () => {
    const someone = await signUp("someone");
    const owner = await gcOwner();
    expect((await request(server).get("/admin/users").set(authed(someone.token))).status).toBe(403);
    expect((await request(server).post("/admin/view-as").set(authed(someone.token)).send({ userId: owner.id })).status).toBe(403);
  });

  it("views the app as someone: their data, their permissions, and a way back", async () => {
    const op = await operator();
    const owner = await gcOwner();
    const res = await request(server).post("/admin/view-as").set(authed(op.token)).send({ userId: owner.id });
    expect(res.status).toBe(200);
    const as = res.body.token as string;

    const me = (await request(server).get("/auth/me").set(authed(as))).body;
    expect(me.user.id).toBe(owner.id);
    expect(me.viewingAs).toMatchObject({ operatorId: op.id, operatorEmail: op.email });
    expect((await request(server).get("/auth/me").set(authed(op.token))).body.viewingAs).toBeNull();

    // Same tabs, same data as the owner.
    const projects = (await request(server).get("/projects").set(authed(as))).body.projects;
    expect(projects.map((p: { id: string }) => p.id)).toContain(owner.project.id);
  });

  it("refuses operator tools and owner-only acts during view-as", async () => {
    const op = await operator();
    const owner = await gcOwner();
    const as = (await request(server).post("/admin/view-as").set(authed(op.token)).send({ userId: owner.id })).body.token as string;

    const viewAgain = await request(server).post("/admin/view-as").set(authed(as)).send({ userId: owner.id });
    expect(viewAgain.status).toBe(403);
    expect(viewAgain.body.error).toMatch(/Exit "view as"/);
    const password = await request(server).post("/auth/change-password").set(authed(as)).send({ currentPassword: "hunter22", newPassword: "hunter23" });
    expect(password.status).toBe(403);
    const deletion = await request(server).post(`/companies/${owner.companyId}/deletion-requests`).set(authed(as)).send({ reason: "x" });
    expect(deletion.status).toBe(403);
  });

  it("won't view the app as another operator", async () => {
    const op = await operator();
    const other = await operator();
    const res = await request(server).post("/admin/view-as").set(authed(op.token)).send({ userId: other.id });
    expect(res.status).toBe(403);
  });
});
