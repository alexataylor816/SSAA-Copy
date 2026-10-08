import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const { app } = await createApp();
let n = 0;
const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signUp(tag: string, fullName = `User ${tag}`) {
  const res = await request(app)
    .post("/auth/signup")
    .send({ email: `notif-${tag}-${Date.now()}-${n++}@example.com`, password: "hunter22", fullName });
  return { token: res.body.token as string, id: res.body.user.id as string };
}

async function company(token: string, name: string, companyType: "gc" | "sub") {
  const res = await request(app).post("/companies").set(authed(token)).send({ name, companyType });
  return res.body.company.id as string;
}

const inbox = async (token: string) =>
  (await request(app).get("/notifications").set(authed(token))).body.notifications as {
    id: string;
    eventType: string;
    title: string;
    body: string;
    link: string | null;
    readAt: string | null;
  }[];

async function connectedPair() {
  const gc = await signUp("gc", "Gina GC");
  await company(gc.token, "Notif GC", "gc");
  const project = await request(app).post("/projects").set(authed(gc.token)).send({ name: "Notif Tower" });
  const sub = await signUp("sub", "Sam Sub");
  const subCompanyId = await company(sub.token, "Notif Sub", "sub");
  await request(app).post("/projects/connect").set(authed(sub.token)).send({ code: project.body.connectionCode });
  const crew = await request(app).get(`/companies/${subCompanyId}/connected-employees`).set(authed(gc.token));
  return { gc, sub, subCompanyId, projectId: project.body.id as string, employeeId: crew.body.employees[0].id as string };
}

async function sendRequest(pair: Awaited<ReturnType<typeof connectedPair>>) {
  const res = await request(app).post("/schedule-requests").set(authed(pair.gc.token)).send({
    projectId: pair.projectId,
    subCompanyId: pair.subCompanyId,
    employeeIds: [pair.employeeId],
    date: "2099-04-07",
    startTime: "07:00",
    endTime: "15:00",
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("notifications: schedule requests", () => {
  it("tells the sub about a new request, not the GC who sent it", async () => {
    const pair = await connectedPair();
    await sendRequest(pair);

    const subInbox = await inbox(pair.sub.token);
    expect(subInbox).toHaveLength(1);
    expect(subInbox[0].title).toBe("New schedule request");
    expect(subInbox[0].body).toContain("Notif GC");
    expect(subInbox[0].link).toBe("/dashboard?day=2099-04-07");
    expect(await inbox(pair.gc.token)).toHaveLength(0);
  });

  it("tells the GC when the sub confirms", async () => {
    const pair = await connectedPair();
    const id = await sendRequest(pair);
    await request(app).patch(`/schedule-requests/${id}`).set(authed(pair.sub.token)).send({ status: "confirmed" });

    const gcInbox = await inbox(pair.gc.token);
    expect(gcInbox.map((x) => x.title)).toEqual(["Request confirmed"]);
    expect(gcInbox[0].body).toContain("Notif Sub");
  });

  it("tells the sub when the GC cancels", async () => {
    const pair = await connectedPair();
    const id = await sendRequest(pair);
    await request(app).patch(`/schedule-requests/${id}`).set(authed(pair.gc.token)).send({ status: "cancelled" });

    expect((await inbox(pair.sub.token)).map((x) => x.title)).toContain("Request cancelled");
  });

  it("skips sub members below partial, who can't act on requests", async () => {
    const pair = await connectedPair();
    const basic = await signUp("basic");
    await request(app).post(`/companies/${pair.subCompanyId}/join-requests`).set(authed(basic.token));
    const listed = await request(app).get(`/companies/${pair.subCompanyId}/join-requests`).set(authed(pair.sub.token));
    await request(app)
      .post(`/companies/${pair.subCompanyId}/join-requests/${listed.body.requests[0].id}/approve`)
      .set(authed(pair.sub.token))
      .send({ permissionLevel: "basic" });

    await sendRequest(pair);
    const basicInbox = await inbox(basic.token);
    expect(basicInbox.some((x) => x.eventType === "schedule_created")).toBe(false);
  });

  it("marks only the caller's own notifications read", async () => {
    const pair = await connectedPair();
    await sendRequest(pair);
    const [mine] = await inbox(pair.sub.token);

    await request(app).post("/notifications/read").set(authed(pair.gc.token)).send({ ids: [mine.id] });
    expect((await inbox(pair.sub.token))[0].readAt).toBeNull();

    await request(app).post("/notifications/read").set(authed(pair.sub.token)).send({});
    expect((await inbox(pair.sub.token))[0].readAt).not.toBeNull();
  });
});

describe("notifications: join requests", () => {
  it("tells approvers about a request and the requester about the outcome", async () => {
    const holder = await signUp("holder");
    const companyId = await company(holder.token, "Notif Join Co", "gc");
    const joiner = await signUp("joiner", "Jo Joiner");
    await request(app).post(`/companies/${companyId}/join-requests`).set(authed(joiner.token));

    const holderInbox = await inbox(holder.token);
    expect(holderInbox[0].title).toBe("New join request");
    expect(holderInbox[0].body).toContain("Jo Joiner");

    const listed = await request(app).get(`/companies/${companyId}/join-requests`).set(authed(holder.token));
    await request(app)
      .post(`/companies/${companyId}/join-requests/${listed.body.requests[0].id}/approve`)
      .set(authed(holder.token))
      .send({ permissionLevel: "partial" });

    expect((await inbox(joiner.token)).map((x) => x.title)).toContain("You're in");
  });
});
