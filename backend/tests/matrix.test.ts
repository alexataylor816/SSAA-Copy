import { describe, expect, it } from "vitest";
import request from "supertest";
import { startTestServer } from "./helpers/server.js";

const server = await startTestServer();
let n = 0;

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signUp(tag: string) {
  const res = await request(server)
    .post("/auth/signup")
    .send({ email: `matrix-${tag}-${Date.now()}-${n++}@example.com`, password: "hunter22", fullName: `Pat ${tag}` });
  return res.body.token as string;
}

const isoIn = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * A GC with Riverside and Main St, and a sub connected to both whose one crew member (the owner)
 * has posted 7:00–15:30 two weeks out.
 */
async function setup() {
  const gc = await signUp("gc");
  const gcCompanyId = (await request(server).post("/companies").set(authed(gc)).send({ name: `Matrix GC ${n}`, companyType: "gc" })).body
    .company.id as string;
  const riverside = (await request(server).post("/projects").set(authed(gc)).send({ name: "Riverside" })).body;
  const mainSt = (await request(server).post("/projects").set(authed(gc)).send({ name: "Main St" })).body;
  const sub = await signUp("sub");
  const subCompanyId = (await request(server).post("/companies").set(authed(sub)).send({ name: `Matrix Sub ${n}`, companyType: "sub" })).body
    .company.id as string;
  for (const p of [riverside, mainSt]) await request(server).post("/projects/connect").set(authed(sub)).send({ code: p.connectionCode });
  const employeeId = (await request(server).get(`/companies/${subCompanyId}/employees`).set(authed(sub))).body.employees[0].id as string;
  const date = isoIn(14);
  await request(server)
    .post("/availability")
    .set(authed(sub))
    .send({ date, startTime: "07:00", endTime: "15:30", allProjects: true, employeeId });

  const batch = (token: string, body: object) => request(server).post("/schedule-requests/batch").set(authed(token)).send(body);
  const place = (projectId: string, startTime = "07:00", endTime = "12:00", on = date) => ({
    projectId,
    subCompanyId,
    employeeIds: [employeeId],
    date: on,
    startTime,
    endTime,
  });
  const matrix = (token: string) =>
    request(server).get(`/matrix?start=${date}&days=7`).set(authed(token));
  return { gc, gcCompanyId, sub, subCompanyId, employeeId, riverside, mainSt, date, batch, place, matrix };
}

describe("GET /matrix", () => {
  it("gives the GC its projects, the connected crew and their free time", async () => {
    const { gc, riverside, mainSt, subCompanyId, employeeId, batch, place, matrix } = await setup();
    let res = await matrix(gc);
    expect(res.status).toBe(200);
    expect(res.body.viewer).toMatchObject({ companyType: "gc", canSchedule: true, canAssignOwnCrew: false });
    expect(res.body.projects.map((p: { name: string }) => p.name).sort()).toEqual(["Main St", "Riverside"]);
    expect(res.body.crews).toHaveLength(1);
    expect(res.body.crews[0]).toMatchObject({ companyId: subCompanyId });
    expect(res.body.crews[0].employees[0]).toMatchObject({ id: employeeId, assignedProjectIds: [] });
    expect(res.body.availability[0].free).toEqual([{ start: "07:00", end: "15:30" }]);

    expect((await batch(gc, { create: [place(riverside.id)], cancel: [] })).body.created).toHaveLength(1);
    res = await matrix(gc);
    expect(res.body.availability[0].free).toEqual([{ start: "12:00", end: "15:30" }]);
    expect(res.body.bookings[0]).toMatchObject({ projectId: riverside.id, status: "pending", assignedBySub: false, otherGc: false });

    // One project at a time.
    res = await request(server).get(`/matrix?start=${res.body.days[0]}&days=7&projectId=${mainSt.id}`).set(authed(gc));
    expect(res.body.projects).toHaveLength(1);
    expect(res.body.bookings).toHaveLength(0);
  });

  it("hides another GC's project behind 'otherGc'", async () => {
    const { sub, employeeId, subCompanyId, date, gc, matrix } = await setup();
    const other = await signUp("othergc");
    await request(server).post("/companies").set(authed(other)).send({ name: `Other GC ${n}`, companyType: "gc" });
    const tower = (await request(server).post("/projects").set(authed(other)).send({ name: "Secret Tower" })).body;
    await request(server).post("/projects/connect").set(authed(sub)).send({ code: tower.connectionCode });
    await request(server)
      .post("/schedule-requests/batch")
      .set(authed(other))
      .send({ create: [{ projectId: tower.id, subCompanyId, employeeIds: [employeeId], date, startTime: "13:00", endTime: "15:30" }], cancel: [] });

    const res = await matrix(gc);
    const hidden = res.body.bookings.find((b: { otherGc: boolean }) => b.otherGc);
    expect(hidden).toMatchObject({ projectId: "", groupId: null });
    expect(JSON.stringify(res.body)).not.toMatch(/Secret Tower/);
    expect(res.body.availability[0].free).toEqual([{ start: "07:00", end: "13:00" }]);
  });

  it("rejects a bad range", async () => {
    const { gc } = await setup();
    expect((await request(server).get("/matrix?start=nope&days=7").set(authed(gc))).status).toBe(400);
    expect((await request(server).get(`/matrix?start=${isoIn(0)}&days=400`).set(authed(gc))).status).toBe(400);
  });
});

describe("POST /schedule-requests/batch: the sub schedules its own crew", () => {
  it("asks about unassigned placements, skips them without the OK, books them with it", async () => {
    const { sub, gc, mainSt, batch, place, matrix } = await setup();

    const dry = await batch(sub, { create: [place(mainSt.id)], cancel: [], dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body.unassigned).toHaveLength(1);
    expect(dry.body.unassigned[0]).toMatchObject({ projectName: "Main St" });
    expect((await matrix(gc)).body.bookings).toHaveLength(0); // dry run wrote nothing

    const blocked = await batch(sub, { create: [place(mainSt.id)], cancel: [] });
    expect(blocked.body.created).toHaveLength(0);
    expect(blocked.body.skipped[0].reason).toMatch(/is not assigned to Main St/);

    const ok = await batch(sub, { create: [place(mainSt.id)], cancel: [], allowUnassigned: true });
    expect(ok.body.created).toHaveLength(1);
    const booking = (await matrix(gc)).body.bookings[0];
    expect(booking).toMatchObject({ status: "confirmed", assignedBySub: true, edited: true, silent: true });
  });

  it("doesn't ask once the person is assigned to the project", async () => {
    const { sub, employeeId, riverside, batch, place } = await setup();
    const put = await request(server).put(`/projects/${riverside.id}/assignments`).set(authed(sub)).send({ employeeIds: [employeeId] });
    expect(put.body.employeeIds).toEqual([employeeId]);
    const res = await batch(sub, { create: [place(riverside.id)], cancel: [] });
    expect(res.body.unassigned).toHaveLength(0);
    expect(res.body.created).toHaveLength(1);
  });

  it("won't let a sub place someone else's crew", async () => {
    const { sub, gc, gcCompanyId, riverside, batch } = await setup();
    const gcEmployee = (await request(server).get(`/companies/${gcCompanyId}/employees`).set(authed(gc))).body.employees[0].id;
    const res = await batch(sub, {
      create: [{ projectId: riverside.id, subCompanyId: gcCompanyId, employeeIds: [gcEmployee], date: isoIn(14), startTime: "07:00", endTime: "12:00" }],
      cancel: [],
    });
    expect(res.body.skipped[0].reason).toMatch(/only place your own crew/);
  });

  it("tells the GC when asked to, and stays quiet otherwise", async () => {
    const { sub, gc, riverside, batch, place } = await setup();
    const before = (await request(server).get("/notifications").set(authed(gc))).body.notifications.length;
    await batch(sub, { create: [place(riverside.id, "07:00", "09:00")], cancel: [], allowUnassigned: true });
    expect((await request(server).get("/notifications").set(authed(gc))).body.notifications.length).toBe(before);

    const res = await batch(sub, {
      create: [place(riverside.id, "09:00", "11:00")],
      cancel: [],
      allowUnassigned: true,
      notify: { gcEmail: false, gcPush: true, personnelEmail: false, personnelPush: false },
    });
    expect(res.body.notified.push).toBe(true);
    const list = (await request(server).get("/notifications").set(authed(gc))).body.notifications;
    expect(list[0]).toMatchObject({ title: "Schedule edited" });
    expect(list[0].body).toMatch(/1 change on Riverside/);
  });
});

describe("POST /schedule-requests/batch: rules for everyone", () => {
  it("skips people with no hours, outside their hours, or already held", async () => {
    const { gc, riverside, mainSt, batch, place } = await setup();
    const res = await batch(gc, {
      create: [
        place(riverside.id, "07:00", "12:00", isoIn(15)), // no hours that day
        place(riverside.id, "05:00", "08:00"), // starts before their hours
        place(riverside.id, "07:00", "12:00"), // fine
        place(mainSt.id, "11:00", "13:00"), // overlaps the one above, in the same publish
      ],
      cancel: [],
    });
    expect(res.body.created.map((c: { index: number }) => c.index)).toEqual([2]);
    const reasons = res.body.skipped.map((s: { index: number; reason: string }) => [s.index, s.reason]);
    expect(reasons[0]).toEqual([0, expect.stringMatching(/has no hours posted/)]);
    expect(reasons[1]).toEqual([1, expect.stringMatching(/don't cover 5:00 AM–8:00 AM/)]);
    expect(reasons[2]).toEqual([3, expect.stringMatching(/already requested 7:00 AM–12:00 PM on Riverside/)]);
  });

  it("locks past weeks", async () => {
    const { gc, riverside, batch, place } = await setup();
    const res = await batch(gc, { create: [place(riverside.id, "07:00", "12:00", isoIn(-14))], cancel: [] });
    expect(res.body.skipped[0].reason).toBe("That week is locked.");
  });

  it("needs Partial access or higher", async () => {
    const { riverside, batch, place } = await setup();
    const nobody = await signUp("nocompany");
    expect((await batch(nobody, { create: [place(riverside.id)], cancel: [] })).status).toBe(409);
  });
});

describe("edits, Confirm Changes and cancelling", () => {
  it("a GC edit goes back to the sub; a sub edit stands but shows as Edited", async () => {
    const { gc, sub, riverside, mainSt, employeeId, batch, place, matrix } = await setup();
    const created = (await batch(gc, { create: [place(riverside.id)], cancel: [] })).body.created[0].requestId;
    await request(server).patch(`/schedule-requests/${created}`).set(authed(sub)).send({ status: "confirmed" });

    // The GC moves it to the afternoon: back to pending for the sub.
    let res = await batch(gc, { create: [], cancel: [], update: [{ requestId: created, employeeIds: [employeeId], startTime: "12:00", endTime: "15:30" }] });
    expect(res.body.updated).toEqual([created]);
    let booking = (await matrix(gc)).body.bookings[0];
    expect(booking).toMatchObject({ status: "pending", edited: true, startTime: "12:00" });

    // The sub confirming the GC's edit clears the tag.
    const confirmed = await request(server).patch(`/schedule-requests/${created}`).set(authed(sub)).send({ status: "confirmed" });
    expect(confirmed.body).toMatchObject({ status: "confirmed", edited: false });

    // The sub moves it to Main St: confirmed, Edited by the sub.
    res = await batch(sub, {
      create: [],
      cancel: [],
      allowUnassigned: true,
      update: [{ requestId: created, employeeIds: [employeeId], projectId: mainSt.id }],
    });
    expect(res.body.updated).toEqual([created]);
    booking = (await matrix(gc)).body.bookings[0];
    expect(booking).toMatchObject({ projectId: mainSt.id, status: "confirmed", edited: true });

    // Only the GC confirms the sub's changes.
    expect((await request(server).post(`/schedule-requests/${created}/acknowledge-edit`).set(authed(sub))).status).toBe(403);
    const ack = await request(server).post(`/schedule-requests/${created}/acknowledge-edit`).set(authed(gc));
    expect(ack.status).toBe(200);
    expect(ack.body.edited).toBe(false);
  });

  it("taking everyone off cancels, and frees the time in the same publish", async () => {
    const { gc, riverside, mainSt, batch, place, matrix } = await setup();
    const first = (await batch(gc, { create: [place(riverside.id)], cancel: [] })).body.created[0].requestId;
    const res = await batch(gc, { create: [place(mainSt.id)], cancel: [first] });
    expect(res.body.cancelled).toEqual([first]);
    expect(res.body.created).toHaveLength(1);
    const bookings = (await matrix(gc)).body.bookings;
    expect(bookings).toHaveLength(1);
    expect(bookings[0].projectId).toBe(mainSt.id);

    const second = bookings[0].requestId;
    const empty = await batch(gc, { create: [], cancel: [], update: [{ requestId: second, employeeIds: [] }] });
    expect(empty.body.cancelled).toEqual([second]);
    expect((await matrix(gc)).body.bookings).toHaveLength(0);
  });
});

describe("telling the crew", () => {
  it("'notify personnel' sends each person a chat message saying where and when", async () => {
    const { sub, subCompanyId, riverside, date } = await setup();
    // A crew member with their own login joins the sub's company.
    const crew = await signUp("crew");
    await request(server).post(`/companies/${subCompanyId}/join-requests`).set(authed(crew));
    const pending = (await request(server).get(`/companies/${subCompanyId}/join-requests`).set(authed(sub))).body.requests[0];
    await request(server).post(`/companies/${subCompanyId}/join-requests/${pending.id}/approve`).set(authed(sub)).send({ permissionLevel: "basic" });
    const crewEmployee = (await request(server).get(`/companies/${subCompanyId}/employees`).set(authed(sub))).body.employees.find(
      (e: { name: string }) => e.name === "Pat crew",
    );
    await request(server)
      .post("/availability")
      .set(authed(sub))
      .send({ date, startTime: "07:00", endTime: "15:30", allProjects: true, employeeId: crewEmployee.id });

    const res = await request(server)
      .post("/schedule-requests/batch")
      .set(authed(sub))
      .send({
        create: [{ projectId: riverside.id, subCompanyId, employeeIds: [crewEmployee.id], date, startTime: "07:00", endTime: "12:00" }],
        cancel: [],
        allowUnassigned: true,
        notify: { gcEmail: false, gcPush: false, personnelEmail: false, personnelPush: true },
      });
    expect(res.body.created).toHaveLength(1);

    const convs = (await request(server).get("/conversations").set(authed(crew))).body.conversations;
    const dm = convs.find((c: { type: string }) => c.type === "dm");
    expect(dm?.lastMessage?.body).toMatch(/you're scheduled at Riverside on .+, 7:00 AM–12:00 PM/);
  });
});
