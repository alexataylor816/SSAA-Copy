import { beforeEach, describe, expect, it } from "vitest";
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

describe("rbac", () => {
  describe("company creation", () => {
    it("makes the creator the account holder", async () => {
      const { token } = await signUp("holder@example.com");

      const res = await request(app)
        .post("/companies")
        .set(authed(token))
        .send({ name: "Acme Builders", companyType: "gc" });

      expect(res.status).toBe(201);
      expect(res.body.company.companyType).toBe("gc");
      expect(res.body.role.permissionLevel).toBe("account_holder");
      expect(res.body.role.isCompanyCreator).toBe(true);
    });

    it("refuses to create a second company for the same user", async () => {
      const { token } = await signUp("second@example.com");
      await request(app).post("/companies").set(authed(token)).send({ name: "First Co", companyType: "sub" });

      const res = await request(app)
        .post("/companies")
        .set(authed(token))
        .send({ name: "Second Co", companyType: "sub" });

      expect(res.status).toBe(409);
    });

    it("rejects an invalid company type", async () => {
      const { token } = await signUp("badtype@example.com");
      const res = await request(app)
        .post("/companies")
        .set(authed(token))
        .send({ name: "Weird Co", companyType: "vendor" });
      expect(res.status).toBe(400);
    });
  });

  describe("join requests", () => {
    it("lets an account holder approve a join request and assign a level", async () => {
      const holder = await signUp("gcholder@example.com");
      const company = await request(app)
        .post("/companies")
        .set(authed(holder.token))
        .send({ name: "GC Co", companyType: "gc" });
      const companyId = company.body.company.id;

      const joiner = await signUp("joiner@example.com");
      const joinRes = await request(app)
        .post(`/companies/${companyId}/join-requests`)
        .set(authed(joiner.token));
      expect(joinRes.status).toBe(201);

      const listed = await request(app)
        .get(`/companies/${companyId}/join-requests`)
        .set(authed(holder.token));
      expect(listed.status).toBe(200);
      expect(listed.body.requests).toHaveLength(1);

      const approve = await request(app)
        .post(`/companies/${companyId}/join-requests/${listed.body.requests[0].id}/approve`)
        .set(authed(holder.token))
        .send({ permissionLevel: "partial" });
      expect(approve.status).toBe(200);
      expect(approve.body.permissionLevel).toBe("partial");

      const members = await request(app)
        .get(`/companies/${companyId}/members`)
        .set(authed(holder.token));
      expect(members.body.members).toHaveLength(2);
    });

    it("blocks a non-approver from viewing join requests", async () => {
      const holder = await signUp("gcholder2@example.com");
      const company = await request(app)
        .post("/companies")
        .set(authed(holder.token))
        .send({ name: "GC Co 2", companyType: "gc" });
      const companyId = company.body.company.id;

      // A basic-level sub member of a *different* company should not be able to view this company's requests.
      const outsider = await signUp("outsider@example.com");
      const res = await request(app)
        .get(`/companies/${companyId}/join-requests`)
        .set(authed(outsider.token));
      expect(res.status).toBe(403);
    });

    it("rejects a level a GC company can't use", async () => {
      const holder = await signUp("gcholder3@example.com");
      const company = await request(app)
        .post("/companies")
        .set(authed(holder.token))
        .send({ name: "GC Co 3", companyType: "gc" });
      const companyId = company.body.company.id;

      const joiner = await signUp("joiner2@example.com");
      const joinRes = await request(app)
        .post(`/companies/${companyId}/join-requests`)
        .set(authed(joiner.token));

      const approve = await request(app)
        .post(`/companies/${companyId}/join-requests/${joinRes.body.id}/approve`)
        .set(authed(holder.token))
        .send({ permissionLevel: "basic" });
      expect(approve.status).toBe(400);
    });
  });

  describe("permission assignment", () => {
    async function setUpSubCompanyWithTwoMembers() {
      const holder = await signUp(`subholder-${Date.now()}@example.com`);
      const company = await request(app)
        .post("/companies")
        .set(authed(holder.token))
        .send({ name: "Sub Co", companyType: "sub" });
      const companyId = company.body.company.id;

      const member = await signUp(`submember-${Date.now()}@example.com`);
      const joinRes = await request(app).post(`/companies/${companyId}/join-requests`).set(authed(member.token));
      await request(app)
        .post(`/companies/${companyId}/join-requests/${joinRes.body.id}/approve`)
        .set(authed(holder.token))
        .send({ permissionLevel: "basic" });

      return { holder, member, companyId };
    }

    it("lets the account holder promote a member", async () => {
      const { holder, member, companyId } = await setUpSubCompanyWithTwoMembers();

      const res = await request(app)
        .patch(`/companies/${companyId}/members/${member.user.id}`)
        .set(authed(holder.token))
        .send({ permissionLevel: "level_1" });

      expect(res.status).toBe(200);
      expect(res.body.permissionLevel).toBe("level_1");
    });

    it("blocks a member from promoting themselves", async () => {
      const { member, companyId } = await setUpSubCompanyWithTwoMembers();

      const res = await request(app)
        .patch(`/companies/${companyId}/members/${member.user.id}`)
        .set(authed(member.token))
        .send({ permissionLevel: "account_holder" });

      expect(res.status).toBe(403);
    });

    it("blocks a basic member from granting account_holder to someone else", async () => {
      const { holder, member, companyId } = await setUpSubCompanyWithTwoMembers();

      // give member 'full' so they pass canManagePermissions, but they still
      // can't hand out account_holder/full themselves
      await request(app)
        .patch(`/companies/${companyId}/members/${member.user.id}`)
        .set(authed(holder.token))
        .send({ permissionLevel: "full" });

      const third = await signUp(`subthird-${Date.now()}@example.com`);
      const joinRes = await request(app).post(`/companies/${companyId}/join-requests`).set(authed(third.token));
      await request(app)
        .post(`/companies/${companyId}/join-requests/${joinRes.body.id}/approve`)
        .set(authed(member.token))
        .send({ permissionLevel: "basic" });

      const res = await request(app)
        .patch(`/companies/${companyId}/members/${third.user.id}`)
        .set(authed(member.token))
        .send({ permissionLevel: "account_holder" });

      expect(res.status).toBe(403);
    });
  });

  describe("GET /rbac/me", () => {
    it("reflects no company for a brand new user", async () => {
      const { token } = await signUp("lonely@example.com");
      const res = await request(app).get("/rbac/me").set(authed(token));
      expect(res.status).toBe(200);
      expect(res.body.company).toBeNull();
      expect(res.body.isAccountHolder).toBe(false);
    });

    it("reflects account-holder status after creating a company", async () => {
      const { token } = await signUp("meholder@example.com");
      await request(app).post("/companies").set(authed(token)).send({ name: "Me Co", companyType: "sub" });

      const res = await request(app).get("/rbac/me").set(authed(token));
      expect(res.body.company.name).toBe("Me Co");
      expect(res.body.isAccountHolder).toBe(true);
      expect(res.body.hasPartialOrHigher).toBe(true);
      expect(res.body.visiblePermissions).toEqual(["account_holder", "full", "partial", "level_1", "basic"]);
    });
  });

  describe("GET /companies/:id/employees", () => {
    it("returns the employee roster for a member", async () => {
      const holder = await signUp("emplholder@example.com", "Empl Holder");
      const company = await request(app)
        .post("/companies")
        .set(authed(holder.token))
        .send({ name: "Empl Co", companyType: "sub" });

      const res = await request(app)
        .get(`/companies/${company.body.company.id}/employees`)
        .set(authed(holder.token));

      expect(res.status).toBe(200);
      expect(res.body.employees).toHaveLength(1);
      expect(res.body.employees[0].name).toBe("Empl Holder");
      expect(res.body.employees[0].linkedUserId).toBe(holder.user.id);
    });

    it("blocks a non-member from viewing the roster", async () => {
      const holder = await signUp("emplholder2@example.com");
      const company = await request(app)
        .post("/companies")
        .set(authed(holder.token))
        .send({ name: "Empl Co 2", companyType: "sub" });

      const outsider = await signUp("embloutsider@example.com");
      const res = await request(app)
        .get(`/companies/${company.body.company.id}/employees`)
        .set(authed(outsider.token));
      expect(res.status).toBe(403);
    });
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/rbac/me");
    expect(res.status).toBe(401);
  });
});
