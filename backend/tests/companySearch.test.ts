import { describe, expect, it } from "vitest";
import request from "supertest";
import { startTestServer } from "./helpers/server.js";

const server = await startTestServer();
const tag = Date.now();

async function signUp(email: string) {
  const res = await request(server).post("/auth/signup").send({ email, password: "hunter22", fullName: "Test User" });
  return res.body.token as string;
}

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function company(token: string, name: string, companyType: "gc" | "sub", address?: string) {
  const res = await request(server).post("/companies").set(authed(token)).send({ name, companyType, address });
  return res.body.company.id as string;
}

describe("company search", () => {
  it("never hands out the whole directory", async () => {
    const token = await signUp(`search-none-${tag}@example.com`);
    for (const q of [undefined, "", "ab", "  ab  "]) {
      const res = await request(server).get("/companies").query(q === undefined ? {} : { q }).set(authed(token));
      expect(res.status).toBe(400);
      expect(res.body.companies).toBeUndefined();
    }
  });

  it("finds a company by part of its name, without its address", async () => {
    const owner = await signUp(`search-owner-${tag}@example.com`);
    const id = await company(owner, `Zephyr Plumbing ${tag}`, "sub", "1 Secret St");
    const seeker = await signUp(`search-seeker-${tag}@example.com`);

    const res = await request(server).get("/companies").query({ q: "zephyr plum" }).set(authed(seeker));
    expect(res.status).toBe(200);
    const match = res.body.companies.find((c: { id: string }) => c.id === id);
    expect(match).toMatchObject({ name: `Zephyr Plumbing ${tag}`, companyType: "sub" });
    expect(match).not.toHaveProperty("address");
  });

  it("returns at most a handful of matches", async () => {
    const owners = await Promise.all(
      Array.from({ length: 10 }, (_, i) => signUp(`search-many-${i}-${tag}@example.com`)),
    );
    await Promise.all(owners.map((token, i) => company(token, `Quokka Builders ${i} ${tag}`, "gc")));
    const seeker = await signUp(`search-many-seeker-${tag}@example.com`);

    const res = await request(server).get("/companies").query({ q: "quokka" }).set(authed(seeker));
    expect(res.status).toBe(200);
    expect(res.body.companies.length).toBeLessThanOrEqual(8);
  });

  it("treats % and _ as plain characters, not wildcards", async () => {
    const seeker = await signUp(`search-wild-${tag}@example.com`);
    const res = await request(server).get("/companies").query({ q: "%%%" }).set(authed(seeker));
    expect(res.status).toBe(200);
    expect(res.body.companies).toEqual([]);
  });

  it("leaves your own company out of the results", async () => {
    const owner = await signUp(`search-self-${tag}@example.com`);
    const id = await company(owner, `Narwhal Electric ${tag}`, "sub");
    const res = await request(server).get("/companies").query({ q: "narwhal" }).set(authed(owner));
    expect(res.body.companies.map((c: { id: string }) => c.id)).not.toContain(id);
  });

  it("shows an invited company by id, and 404s for a stale link", async () => {
    const owner = await signUp(`search-invite-${tag}@example.com`);
    const id = await company(owner, `Ibis GC ${tag}`, "gc", "2 Hidden Ave");
    const invitee = await signUp(`search-invitee-${tag}@example.com`);

    const res = await request(server).get(`/companies/${id}/summary`).set(authed(invitee));
    expect(res.status).toBe(200);
    expect(res.body.company).toEqual({ id, name: `Ibis GC ${tag}`, companyType: "gc", trade: null });

    const gone = await request(server).get("/companies/not-a-real-id/summary").set(authed(invitee));
    expect(gone.status).toBe(404);
  });

  it("requires sign-in", async () => {
    expect((await request(server).get("/companies").query({ q: "anything" })).status).toBe(401);
  });
});
