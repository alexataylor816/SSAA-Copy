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

async function company(token: string, name: string, companyType: "gc" | "sub" = "gc") {
  const res = await request(server).post("/companies").set(authed(token)).send({ name, companyType });
  return res.body.company.id as string;
}

async function pair(tag: string, aType: "gc" | "sub" = "gc") {
  const a = await signUp(`cc-a-${tag}-${Date.now()}@example.com`);
  const aCo = await company(a.token, `CC A ${tag}`, aType);
  const b = await signUp(`cc-b-${tag}-${Date.now()}@example.com`);
  const bCo = await company(b.token, `CC B ${tag}`, "sub");
  return { a, aCo, b, bCo };
}

describe("contractor connections", () => {
  it("requests, lists with direction, and accepts with a main side", async () => {
    const { a, aCo, b, bCo } = await pair("req");

    const created = await request(server)
      .post("/contractor-connections")
      .set(authed(a.token))
      .send({ otherCompanyId: bCo, proposedRole: "main" });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("pending");

    const aList = await request(server).get("/contractor-connections").set(authed(a.token));
    expect(aList.body.connections[0].direction).toBe("outgoing");
    const bList = await request(server).get("/contractor-connections").set(authed(b.token));
    expect(bList.body.connections[0].direction).toBe("incoming");
    expect(bList.body.connections[0].otherCompanyName).toBeTruthy();

    // Initiator cannot accept its own request.
    const selfAccept = await request(server)
      .post(`/contractor-connections/${created.body.id}/respond`)
      .set(authed(a.token))
      .send({ accept: true });
    expect(selfAccept.status).toBe(403);

    const accepted = await request(server)
      .post(`/contractor-connections/${created.body.id}/respond`)
      .set(authed(b.token))
      .send({ accept: true });
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe("accepted");
    expect(accepted.body.mainCompanyId).toBe(aCo);

    const again = await request(server)
      .post(`/contractor-connections/${created.body.id}/respond`)
      .set(authed(b.token))
      .send({ accept: true });
    expect(again.status).toBe(409);
  });

  it("refuses self-links, strangers, duplicates-as-new-rows, and basic members", async () => {
    const { a, aCo, b, bCo } = await pair("ref", "sub");

    const self = await request(server)
      .post("/contractor-connections")
      .set(authed(a.token))
      .send({ otherCompanyId: aCo, proposedRole: "main" });
    expect(self.status).toBe(400);

    const ghost = await request(server)
      .post("/contractor-connections")
      .set(authed(a.token))
      .send({ otherCompanyId: "00000000-0000-0000-0000-000000000000", proposedRole: "sub" });
    expect(ghost.status).toBe(404);

    await request(server).post("/contractor-connections").set(authed(a.token)).send({ otherCompanyId: bCo, proposedRole: "sub" });
    // Re-requesting from either side re-opens the same row instead of duplicating.
    const re = await request(server)
      .post("/contractor-connections")
      .set(authed(b.token))
      .send({ otherCompanyId: aCo, proposedRole: "main" });
    expect(re.status).toBe(201);
    const list = await request(server).get("/contractor-connections").set(authed(a.token));
    expect(list.body.connections).toHaveLength(1);

    const basic = await signUp(`cc-basic-${Date.now()}@example.com`);
    await request(server).post(`/companies/${aCo}/join-requests`).set(authed(basic.token));
    const listed = await request(server).get(`/companies/${aCo}/join-requests`).set(authed(a.token));
    await request(server)
      .post(`/companies/${aCo}/join-requests/${listed.body.requests[0].id}/approve`)
      .set(authed(a.token))
      .send({ permissionLevel: "basic" });
    const denied = await request(server)
      .post("/contractor-connections")
      .set(authed(basic.token))
      .send({ otherCompanyId: bCo, proposedRole: "main" });
    expect(denied.status).toBe(403);
  });

  it("links/unlinks projects on the main side only, and swaps roles in two steps", async () => {
    const { a, b, bCo } = await pair("link");
    const project = await request(server).post("/projects").set(authed(a.token)).send({ name: "Shared Tower" });
    const created = await request(server)
      .post("/contractor-connections")
      .set(authed(a.token))
      .send({ otherCompanyId: bCo, proposedRole: "main" });
    await request(server)
      .post(`/contractor-connections/${created.body.id}/respond`)
      .set(authed(b.token))
      .send({ accept: true });

    // Sub side cannot manage links.
    const subLink = await request(server)
      .post(`/contractor-connections/${created.body.id}/projects`)
      .set(authed(b.token))
      .send({ projectId: project.body.id, shared: true });
    expect(subLink.status).toBe(403);

    const linked = await request(server)
      .post(`/contractor-connections/${created.body.id}/projects`)
      .set(authed(a.token))
      .send({ projectId: project.body.id, shared: true });
    expect(linked.status).toBe(201);

    const links = await request(server)
      .get(`/contractor-connections/${created.body.id}/projects`)
      .set(authed(b.token));
    expect(links.body.links).toHaveLength(1);
    expect(links.body.links[0].shared).toBe(true);

    const unlinked = await request(server)
      .delete(`/contractor-connections/${created.body.id}/projects/${project.body.id}`)
      .set(authed(a.token));
    expect(unlinked.status).toBe(200);

    // Role swap: request from one side, confirm from the other.
    const req1 = await request(server)
      .post(`/contractor-connections/${created.body.id}/role-swap`)
      .set(authed(b.token))
      .send({ proposedMainCompanyId: bCo });
    expect(req1.body.result).toBe("requested");
    const req2 = await request(server)
      .post(`/contractor-connections/${created.body.id}/role-swap`)
      .set(authed(a.token))
      .send({ proposedMainCompanyId: bCo });
    expect(req2.body.result).toBe("confirmed");
    expect(req2.body.connection.mainCompanyId).toBe(bCo);
  });

  it("deletes a connection its members can see", async () => {
    const { a, b, bCo } = await pair("del");
    const created = await request(server)
      .post("/contractor-connections")
      .set(authed(a.token))
      .send({ otherCompanyId: bCo, proposedRole: "main" });
    const del = await request(server).delete(`/contractor-connections/${created.body.id}`).set(authed(b.token));
    expect(del.status).toBe(200);
    const list = await request(server).get("/contractor-connections").set(authed(a.token));
    expect(list.body.connections).toHaveLength(0);
  });
});
