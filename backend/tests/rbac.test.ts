import { beforeEach, describe, expect, it } from "vitest";
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
      // The approver must be able to tell who is asking.
      expect(listed.body.requests[0].userEmail).toBe("joiner@example.com");
      expect(listed.body.requests[0].userName).toBeTruthy();

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

  describe("transfer holdership", () => {
    async function companyWithMember(level: string) {
      const holder = await signUp(`th-holder-${Date.now()}-${Math.random()}@example.com`);
      const company = await request(app)
        .post("/companies")
        .set(authed(holder.token))
        .send({ name: "Transfer Co", companyType: "sub" });
      const companyId = company.body.company.id as string;

      const member = await signUp(`th-member-${Date.now()}-${Math.random()}@example.com`);
      await request(app).post(`/companies/${companyId}/join-requests`).set(authed(member.token));
      const listed = await request(app).get(`/companies/${companyId}/join-requests`).set(authed(holder.token));
      await request(app)
        .post(`/companies/${companyId}/join-requests/${listed.body.requests[0].id}/approve`)
        .set(authed(holder.token))
        .send({ permissionLevel: level });
      return { holder, member, companyId };
    }

    async function levels(token: string, companyId: string) {
      const res = await request(app).get(`/companies/${companyId}/members`).set(authed(token));
      expect(res.status).toBe(200);
      return new Map(res.body.members.map((m: { userId: string; permissionLevel: string }) => [m.userId, m.permissionLevel]));
    }

    it("moves holder status and steps the previous holder down", async () => {
      const { holder, member, companyId } = await companyWithMember("full");

      const res = await request(app)
        .post(`/companies/${companyId}/transfer-holder`)
        .set(authed(holder.token))
        .send({ targetUserId: member.user.id, demoteTo: "partial" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ previousHolderId: holder.user.id, newHolderId: member.user.id });

      const after = await levels(holder.token, companyId);
      expect(after.get(member.user.id)).toBe("account_holder");
      expect(after.get(holder.user.id)).toBe("partial");
    });

    it("refuses transfer by a non-holder, to self, to a stranger, or with a holder demoteTo", async () => {
      const { holder, member, companyId } = await companyWithMember("partial");
      const outsider = await signUp(`th-out-${Date.now()}-${Math.random()}@example.com`);

      const byMember = await request(app)
        .post(`/companies/${companyId}/transfer-holder`)
        .set(authed(member.token))
        .send({ targetUserId: holder.user.id });
      expect(byMember.status).toBe(403);

      const toSelf = await request(app)
        .post(`/companies/${companyId}/transfer-holder`)
        .set(authed(holder.token))
        .send({ targetUserId: holder.user.id });
      expect(toSelf.status).toBe(400);

      const toStranger = await request(app)
        .post(`/companies/${companyId}/transfer-holder`)
        .set(authed(holder.token))
        .send({ targetUserId: outsider.user.id });
      expect(toStranger.status).toBe(404);

      const holderDemote = await request(app)
        .post(`/companies/${companyId}/transfer-holder`)
        .set(authed(holder.token))
        .send({ targetUserId: member.user.id, demoteTo: "account_holder" });
      expect(holderDemote.status).toBe(400);
    });
  });

  describe("remove member", () => {
    async function companyWithMember(level: string) {
      const holder = await signUp(`rm-holder-${Date.now()}-${Math.random()}@example.com`);
      const company = await request(app)
        .post("/companies")
        .set(authed(holder.token))
        .send({ name: "Removal Co", companyType: "sub" });
      const companyId = company.body.company.id as string;

      const member = await signUp(`rm-member-${Date.now()}-${Math.random()}@example.com`);
      await request(app).post(`/companies/${companyId}/join-requests`).set(authed(member.token));
      const listed = await request(app).get(`/companies/${companyId}/join-requests`).set(authed(holder.token));
      await request(app)
        .post(`/companies/${companyId}/join-requests/${listed.body.requests[0].id}/approve`)
        .set(authed(holder.token))
        .send({ permissionLevel: level });
      return { holder, member, companyId };
    }

    it("removes a member and detaches them from the company", async () => {
      const { holder, member, companyId } = await companyWithMember("basic");

      const res = await request(app)
        .delete(`/companies/${companyId}/members/${member.user.id}`)
        .set(authed(holder.token));
      expect(res.status).toBe(200);

      const members = await request(app).get(`/companies/${companyId}/members`).set(authed(holder.token));
      expect(members.body.members.some((m: { userId: string }) => m.userId === member.user.id)).toBe(false);

      // The removed login still works but belongs nowhere now.
      const me = await request(app)
        .post("/query")
        .set(authed(member.token))
        .send({ table: "users", operation: "select", filters: [{ op: "eq", column: "id", value: member.user.id }] });
      expect(me.body.data[0].company_id).toBeNull();
    });

    it("refuses self-removal, creator removal, and removal by non-holders", async () => {
      const { holder, member, companyId } = await companyWithMember("partial");

      const self = await request(app)
        .delete(`/companies/${companyId}/members/${holder.user.id}`)
        .set(authed(holder.token));
      expect(self.status).toBe(400);

      // Promote the member, then have them try to remove the creator holder.
      await request(app)
        .patch(`/companies/${companyId}/members/${member.user.id}`)
        .set(authed(holder.token))
        .send({ permissionLevel: "account_holder" });
      const creator = await request(app)
        .delete(`/companies/${companyId}/members/${holder.user.id}`)
        .set(authed(member.token));
      expect(creator.status).toBe(400);

      // Removing a non-creator holder works while the creator remains.
      const ok = await request(app)
        .delete(`/companies/${companyId}/members/${member.user.id}`)
        .set(authed(holder.token));
      expect(ok.status).toBe(200);

      const nonHolder = await signUp(`rm-nh-${Date.now()}-${Math.random()}@example.com`);
      await request(app).post(`/companies/${companyId}/join-requests`).set(authed(nonHolder.token));
      const listed = await request(app).get(`/companies/${companyId}/join-requests`).set(authed(holder.token));
      await request(app)
        .post(`/companies/${companyId}/join-requests/${listed.body.requests[0].id}/approve`)
        .set(authed(holder.token))
        .send({ permissionLevel: "partial" });
      const denied = await request(app)
        .delete(`/companies/${companyId}/members/${holder.user.id}`)
        .set(authed(nonHolder.token));
      expect(denied.status).toBe(403);
    });
  });

  describe("company trade", () => {
    it("stores an optional trade and rejects overlong ones", async () => {
      const holder = await signUp(`trade-${Date.now()}@example.com`);
      const created = await request(app)
        .post("/companies")
        .set(authed(holder.token))
        .send({ name: "Trade Co", companyType: "sub", trade: "Plumbing" });
      expect(created.status).toBe(201);
      expect(created.body.company.trade).toBe("Plumbing");

      const listed = await request(app).get("/companies").set(authed(holder.token));
      expect(listed.body.companies.find((c: { id: string; trade: string }) => c.id === created.body.company.id)?.trade).toBe(
        "Plumbing",
      );

      const holder2 = await signUp(`trade2-${Date.now()}@example.com`);
      const tooLong = await request(app)
        .post("/companies")
        .set(authed(holder2.token))
        .send({ name: "Trade Co 2", companyType: "sub", trade: "x".repeat(61) });
      expect(tooLong.status).toBe(400);
    });
  });
});
