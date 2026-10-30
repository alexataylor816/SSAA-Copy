import { describe, expect, it } from "vitest";
import request from "supertest";
import { startTestServer } from "./helpers/server.js";

const server = await startTestServer();
let n = 0;

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signUp(tag: string) {
  const res = await request(server)
    .post("/auth/signup")
    .send({ email: `book-${tag}-${Date.now()}-${n++}@example.com`, password: "hunter22", fullName: `User ${tag}` });
  return res.body.token as string;
}

/** A GC with two projects, and a sub on both, with one crew member (the owner). */
async function setup() {
  const gc = await signUp("gc");
  await request(server).post("/companies").set(authed(gc)).send({ name: `Book GC ${n}`, companyType: "gc" });
  const a = (await request(server).post("/projects").set(authed(gc)).send({ name: "Tower A" })).body;
  const b = (await request(server).post("/projects").set(authed(gc)).send({ name: "Tower B" })).body;
  const sub = await signUp("sub");
  const subCompanyId = (await request(server).post("/companies").set(authed(sub)).send({ name: `Book Sub ${n}`, companyType: "sub" })).body
    .company.id as string;
  for (const p of [a, b]) await request(server).post("/projects/connect").set(authed(sub)).send({ code: p.connectionCode });
  const employeeId = (await request(server).get(`/companies/${subCompanyId}/employees`).set(authed(sub))).body.employees[0].id as string;
  const d = new Date();
  d.setDate(d.getDate() + 14);
  const date = d.toISOString().slice(0, 10);
  const ask = (projectId: string, startTime?: string, endTime?: string) =>
    request(server)
      .post("/schedule-requests")
      .set(authed(gc))
      .send({ projectId, subCompanyId, employeeIds: [employeeId], date, startTime, endTime });
  return { gc, sub, a, b, ask };
}

describe("no double booking", () => {
  it("books part of a day and leaves the rest bookable", async () => {
    const { a, b, ask } = await setup();
    expect((await ask(a.id, "07:00", "12:00")).status).toBe(201);
    // Back to back is fine: 12:00 is free again.
    expect((await ask(b.id, "12:00", "15:30")).status).toBe(201);
  });

  it("refuses an overlapping time, naming who and when", async () => {
    const { a, b, ask } = await setup();
    expect((await ask(a.id, "07:00", "12:00")).status).toBe(201);
    const clash = await ask(b.id, "10:00", "14:00");
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatch(/already requested 7:00 AM–12:00 PM/);
    expect(clash.body.error).toMatch(/Tower A/);
  });

  it("treats a request with no times as the whole day", async () => {
    const { a, b, ask } = await setup();
    expect((await ask(a.id)).status).toBe(201);
    expect((await ask(b.id, "06:00", "07:00")).status).toBe(409);
  });

  it("says booked once confirmed, and frees the time when cancelled", async () => {
    const { gc, sub, a, b, ask } = await setup();
    const first = await ask(a.id, "07:00", "12:00");
    await request(server).patch(`/schedule-requests/${first.body.id}`).set(authed(sub)).send({ status: "confirmed" });
    const clash = await ask(b.id, "08:00", "09:00");
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatch(/is booked/);

    await request(server).patch(`/schedule-requests/${first.body.id}`).set(authed(gc)).send({ status: "cancelled" });
    expect((await ask(b.id, "08:00", "09:00")).status).toBe(201);
  });
});
