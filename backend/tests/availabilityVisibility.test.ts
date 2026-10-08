import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const { app } = await createApp();
let n = 0;

async function account(tag: string, companyType: "gc" | "sub") {
  const signup = await request(app)
    .post("/auth/signup")
    .send({ email: `avis-${tag}-${Date.now()}-${n++}@example.com`, password: "hunter22", fullName: `User ${tag}` });
  const token = signup.body.token as string;
  await request(app).post("/companies").set({ Authorization: `Bearer ${token}` }).send({ name: `${tag} Co`, companyType });
  return token;
}

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

function visibleAvailability(token: string) {
  return request(app)
    .post("/query")
    .set(authed(token))
    .send({ table: "availability", operation: "select", filters: [{ op: "eq", column: "date", value: "2099-05-06" }] });
}

describe("availability: multiple stops", () => {
  it("stores each stop with its number and label", async () => {
    const sub = await account("stops", "sub");
    for (const [stopNumber, startTime, endTime] of [
      [1, "06:00", "10:00"],
      [2, "13:00", "17:00"],
    ] as const) {
      const res = await request(app)
        .post("/availability")
        .set(authed(sub))
        .send({ date: "2099-06-02", startTime, endTime, allProjects: true, stopNumber });
      expect(res.status).toBe(201);
      expect(res.body.stopLabel).toBe(`Stop #${stopNumber}`);
    }
    const listed = await request(app).get("/availability?start=2099-06-02&end=2099-06-02").set(authed(sub));
    const stops = listed.body.availability.map((a: { stopNumber: number }) => a.stopNumber).sort();
    expect(stops).toEqual([1, 2]);
  });

  it("rejects a stop number outside 1-10", async () => {
    const sub = await account("badstop", "sub");
    const res = await request(app)
      .post("/availability")
      .set(authed(sub))
      .send({ date: "2099-06-02", startTime: "06:00", endTime: "10:00", allProjects: true, stopNumber: 0 });
    expect(res.status).toBe(400);
  });
});

/** Mirrors the original's "View availability" policy (20260723223933). */
describe("availability visibility", () => {
  async function gcWithTwoSubs() {
    const gc = await account("gc", "gc");
    const project = await request(app).post("/projects").set(authed(gc)).send({ name: "Avis Tower" });
    const subA = await account("subA", "sub");
    const subB = await account("subB", "sub");
    for (const sub of [subA, subB]) {
      await request(app).post("/projects/connect").set(authed(sub)).send({ code: project.body.connectionCode });
    }
    return { gc, subA, subB, projectId: project.body.id as string };
  }

  it("shows the GC a connected sub's all-projects hours", async () => {
    const { gc, subA } = await gcWithTwoSubs();
    const posted = await request(app)
      .post("/availability")
      .set(authed(subA))
      .send({ date: "2099-05-06", startTime: "07:00", endTime: "15:00", allProjects: true });
    expect(posted.status).toBe(201);

    const seen = await visibleAvailability(gc);
    expect(seen.status).toBe(200);
    expect(seen.body.data.map((r: { id: string }) => r.id)).toContain(posted.body.id);
  });

  it("hides a sub's hours from a rival sub on the same project", async () => {
    const { subA, subB, projectId } = await gcWithTwoSubs();
    const posted = await request(app)
      .post("/availability")
      .set(authed(subA))
      .send({ date: "2099-05-06", startTime: "07:00", endTime: "15:00", projectId });
    expect(posted.status).toBe(201);

    const seen = await visibleAvailability(subB);
    expect(seen.body.data.map((r: { id: string }) => r.id)).not.toContain(posted.body.id);
  });

  it("hides a sub's hours from a GC it isn't connected to", async () => {
    const { subA } = await gcWithTwoSubs();
    const stranger = await account("strangerGc", "gc");
    const posted = await request(app)
      .post("/availability")
      .set(authed(subA))
      .send({ date: "2099-05-06", startTime: "07:00", endTime: "15:00", allProjects: true });

    const seen = await visibleAvailability(stranger);
    expect(seen.body.data.map((r: { id: string }) => r.id)).not.toContain(posted.body.id);
  });
});
