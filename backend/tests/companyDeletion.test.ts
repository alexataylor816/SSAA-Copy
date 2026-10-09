import { describe, expect, it } from "vitest";
import request from "supertest";
import { startTestServer } from "./helpers/server.js";

const server = await startTestServer();

async function signUp(email: string) {
  const res = await request(server).post("/auth/signup").send({ email, password: "hunter22", fullName: "Test User" });
  return { token: res.body.token as string, user: res.body.user as { id: string; email: string } };
}

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function holderWithCompany(tag: string) {
  const holder = await signUp(`cd-holder-${tag}-${Date.now()}@example.com`);
  const company = await request(server)
    .post("/companies")
    .set(authed(holder.token))
    .send({ name: `Deletion Co ${tag}`, companyType: "gc" });
  return { holder, companyId: company.body.company.id as string };
}

describe("company deletion requests", () => {
  it("lets the holder file and view a pending request, and blocks duplicates", async () => {
    const { holder, companyId } = await holderWithCompany("a");

    const none = await request(server)
      .get(`/companies/${companyId}/deletion-requests/pending`)
      .set(authed(holder.token));
    expect(none.status).toBe(200);
    expect(none.body.request).toBeNull();

    const filed = await request(server)
      .post(`/companies/${companyId}/deletion-requests`)
      .set(authed(holder.token))
      .send({ reason: "Closing shop." });
    expect(filed.status).toBe(201);
    expect(filed.body.status).toBe("pending");
    expect(filed.body.reason).toBe("Closing shop.");

    const dupe = await request(server)
      .post(`/companies/${companyId}/deletion-requests`)
      .set(authed(holder.token))
      .send({});
    expect(dupe.status).toBe(409);

    const pending = await request(server)
      .get(`/companies/${companyId}/deletion-requests/pending`)
      .set(authed(holder.token));
    expect(pending.body.request.id).toBe(filed.body.id);
  });

  it("refuses non-holders and outsiders, and caps reason length", async () => {
    const { holder, companyId } = await holderWithCompany("b");

    const member = await signUp(`cd-member-${Date.now()}@example.com`);
    await request(server).post(`/companies/${companyId}/join-requests`).set(authed(member.token));
    const listed = await request(server).get(`/companies/${companyId}/join-requests`).set(authed(holder.token));
    await request(server)
      .post(`/companies/${companyId}/join-requests/${listed.body.requests[0].id}/approve`)
      .set(authed(holder.token))
      .send({ permissionLevel: "partial" });

    const byMember = await request(server)
      .post(`/companies/${companyId}/deletion-requests`)
      .set(authed(member.token))
      .send({});
    expect(byMember.status).toBe(403);

    const peek = await request(server)
      .get(`/companies/${companyId}/deletion-requests/pending`)
      .set(authed(member.token));
    expect(peek.status).toBe(200);

    const outsider = await signUp(`cd-out-${Date.now()}@example.com`);
    const outsiderPeek = await request(server)
      .get(`/companies/${companyId}/deletion-requests/pending`)
      .set(authed(outsider.token));
    expect(outsiderPeek.status).toBe(403);

    const long = await request(server)
      .post(`/companies/${companyId}/deletion-requests`)
      .set(authed(holder.token))
      .send({ reason: "x".repeat(501) });
    expect(long.status).toBe(400);
  });
});
