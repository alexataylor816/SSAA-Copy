import { describe, expect, it } from "vitest";
import request from "supertest";
import { startTestServer } from "./helpers/server.js";

const server = await startTestServer();

async function signUp(email: string, fullName = "Test User") {
  const res = await request(server).post("/auth/signup").send({ email, password: "hunter22", fullName });
  return { token: res.body.token as string, user: res.body.user as { id: string; email: string } };
}

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function makeCompany(token: string, name: string, companyType: "gc" | "sub" = "gc") {
  const res = await request(server).post("/companies").set(authed(token)).send({ name, companyType });
  return res.body.company as { id: string };
}

function farFutureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

describe("scheduling: projects", () => {
  it("creates a project with a unique connection code", async () => {
    const { token } = await signUp("projowner@example.com");
    await makeCompany(token, "Owner Co");

    const res = await request(server).post("/projects").set(authed(token)).send({ name: "Tower A" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Tower A");
    expect(res.body.connectionCode).toMatch(/^[a-f0-9]{8}$/);
  });

  it("refuses to create a project without a company", async () => {
    const { token } = await signUp("nocompany@example.com");
    const res = await request(server).post("/projects").set(authed(token)).send({ name: "Orphan Project" });
    expect(res.status).toBe(409);
  });

  it("lets another company connect via the connection code", async () => {
    const owner = await signUp("gcowner@example.com");
    await makeCompany(owner.token, "GC Co", "gc");
    const project = await request(server).post("/projects").set(authed(owner.token)).send({ name: "Bridge B" });

    const sub = await signUp("subconnector@example.com");
    await makeCompany(sub.token, "Sub Co", "sub");

    const connect = await request(server)
      .post("/projects/connect")
      .set(authed(sub.token))
      .send({ code: project.body.connectionCode });
    expect(connect.status).toBe(201);
    expect(connect.body.id).toBe(project.body.id);

    const list = await request(server).get("/projects").set(authed(sub.token));
    expect(list.body.projects.map((p: { id: string }) => p.id)).toContain(project.body.id);
  });

  it("rejects an unknown connection code", async () => {
    const { token } = await signUp("badcode@example.com");
    await makeCompany(token, "Some Co", "sub");
    const res = await request(server).post("/projects/connect").set(authed(token)).send({ code: "zzzzzzzz" });
    expect(res.status).toBe(404);
  });

  it("rejects connecting twice", async () => {
    const owner = await signUp("gcowner2@example.com");
    await makeCompany(owner.token, "GC Co 2", "gc");
    const project = await request(server).post("/projects").set(authed(owner.token)).send({ name: "Bridge C" });

    const sub = await signUp("subconnector2@example.com");
    await makeCompany(sub.token, "Sub Co 2", "sub");
    await request(server).post("/projects/connect").set(authed(sub.token)).send({ code: project.body.connectionCode });

    const again = await request(server)
      .post("/projects/connect")
      .set(authed(sub.token))
      .send({ code: project.body.connectionCode });
    expect(again.status).toBe(409);
  });

  it("lets the owner see which companies are connected to a project", async () => {
    const owner = await signUp("gcowner3@example.com");
    await makeCompany(owner.token, "GC Co 3", "gc");
    const project = await request(server).post("/projects").set(authed(owner.token)).send({ name: "Bridge D" });

    const sub = await signUp("subconnector3@example.com");
    await makeCompany(sub.token, "Sub Co 3", "sub");
    await request(server).post("/projects/connect").set(authed(sub.token)).send({ code: project.body.connectionCode });

    const res = await request(server).get(`/projects/${project.body.id}/connections`).set(authed(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.companies).toHaveLength(1);
    expect(res.body.companies[0].name).toBe("Sub Co 3");
  });

  it("blocks an outsider from listing a project's connections", async () => {
    const owner = await signUp("gcowner4@example.com");
    await makeCompany(owner.token, "GC Co 4", "gc");
    const project = await request(server).post("/projects").set(authed(owner.token)).send({ name: "Bridge E" });

    const outsider = await signUp("outsider4@example.com");
    await makeCompany(outsider.token, "Outsider Co 4", "sub");

    const res = await request(server).get(`/projects/${project.body.id}/connections`).set(authed(outsider.token));
    expect(res.status).toBe(404);
  });

  it("lets a GC view a connected sub's employee roster, but not an unconnected company's", async () => {
    const owner = await signUp("gcowner5@example.com");
    await makeCompany(owner.token, "GC Co 5", "gc");
    const project = await request(server).post("/projects").set(authed(owner.token)).send({ name: "Bridge F" });

    const sub = await signUp("subconnector5@example.com", "Sub Holder 5");
    const subCompany = await makeCompany(sub.token, "Sub Co 5", "sub");
    await request(server).post("/projects/connect").set(authed(sub.token)).send({ code: project.body.connectionCode });

    const visible = await request(server)
      .get(`/companies/${subCompany.id}/connected-employees`)
      .set(authed(owner.token));
    expect(visible.status).toBe(200);
    expect(visible.body.employees).toHaveLength(1);
    expect(visible.body.employees[0].name).toBe("Sub Holder 5");

    const outsider = await signUp("outsider5@example.com");
    await makeCompany(outsider.token, "Outsider Co 5", "sub");
    const blocked = await request(server)
      .get(`/companies/${subCompany.id}/connected-employees`)
      .set(authed(outsider.token));
    expect(blocked.status).toBe(403);
  });
});

describe("scheduling: availability", () => {
  it("lets an employee set availability for all projects", async () => {
    const { token } = await signUp("avail1@example.com");
    await makeCompany(token, "Avail Co", "sub");

    const date = farFutureDate(10);
    const res = await request(server)
      .post("/availability")
      .set(authed(token))
      .send({ date, startTime: "08:00", endTime: "16:00", allProjects: true });

    expect(res.status).toBe(201);
    expect(res.body.allProjects).toBe(true);
    expect(res.body.projectId).toBeNull();
  });

  it("lets an employee set availability for a specific visible project", async () => {
    const { token } = await signUp("avail2@example.com");
    await makeCompany(token, "Avail Co 2", "gc");
    const project = await request(server).post("/projects").set(authed(token)).send({ name: "Own Project" });

    const date = farFutureDate(10);
    const res = await request(server)
      .post("/availability")
      .set(authed(token))
      .send({ date, startTime: "09:00", endTime: "12:00", projectId: project.body.id });

    expect(res.status).toBe(201);
    expect(res.body.projectId).toBe(project.body.id);
  });

  it("rejects availability for a project the company can't see", async () => {
    const owner = await signUp("avail3owner@example.com");
    await makeCompany(owner.token, "Avail Owner Co", "gc");
    const project = await request(server).post("/projects").set(authed(owner.token)).send({ name: "Private Project" });

    const outsider = await signUp("avail3outsider@example.com");
    await makeCompany(outsider.token, "Outsider Co", "sub");

    const res = await request(server)
      .post("/availability")
      .set(authed(outsider.token))
      .send({ date: farFutureDate(10), startTime: "09:00", endTime: "12:00", projectId: project.body.id });
    expect(res.status).toBe(404);
  });

  it("rejects an invalid time range", async () => {
    const { token } = await signUp("avail4@example.com");
    await makeCompany(token, "Avail Co 4", "sub");

    const res = await request(server)
      .post("/availability")
      .set(authed(token))
      .send({ date: farFutureDate(10), startTime: "16:00", endTime: "08:00", allProjects: true });
    expect(res.status).toBe(400);
  });

  it("rejects setting availability on a locked historical date", async () => {
    const { token } = await signUp("avail5@example.com");
    await makeCompany(token, "Avail Co 5", "sub");

    const res = await request(server)
      .post("/availability")
      .set(authed(token))
      .send({ date: "2020-01-01", startTime: "08:00", endTime: "16:00", allProjects: true });
    expect(res.status).toBe(403);
  });

  it("lists availability within a date range and lets the owner delete their entry", async () => {
    const { token } = await signUp("avail6@example.com");
    await makeCompany(token, "Avail Co 6", "sub");

    const date = farFutureDate(15);
    const created = await request(server)
      .post("/availability")
      .set(authed(token))
      .send({ date, startTime: "08:00", endTime: "16:00", allProjects: true });

    const start = farFutureDate(14);
    const end = farFutureDate(16);
    const listed = await request(server).get(`/availability?start=${start}&end=${end}`).set(authed(token));
    expect(listed.body.availability.map((a: { id: string }) => a.id)).toContain(created.body.id);

    const del = await request(server).delete(`/availability/${created.body.id}`).set(authed(token));
    expect(del.status).toBe(200);

    const listedAfter = await request(server).get(`/availability?start=${start}&end=${end}`).set(authed(token));
    expect(listedAfter.body.availability.map((a: { id: string }) => a.id)).not.toContain(created.body.id);
  });

  it("blocks deleting someone else's availability", async () => {
    const owner = await signUp("avail7owner@example.com");
    await makeCompany(owner.token, "Avail Co 7", "sub");
    const date = farFutureDate(20);
    const created = await request(server)
      .post("/availability")
      .set(authed(owner.token))
      .send({ date, startTime: "08:00", endTime: "16:00", allProjects: true });

    const other = await signUp("avail7other@example.com");
    await makeCompany(other.token, "Avail Co 7b", "sub");

    const res = await request(server).delete(`/availability/${created.body.id}`).set(authed(other.token));
    expect(res.status).toBe(403);
  });
});

/**
 * Publishing hours for somebody other than yourself. The original app allowed
 * this through RLS on `availability` (target employee merely had to be on your
 * own roster) and narrowed it in the UI by permission level: ProfilesModal.tsx
 * gives partial/full/account_holder "manage schedules" and says level_1 and
 * basic "cannot edit availability".
 */
describe("scheduling: availability for another employee", () => {
  /** A company with one extra, unlinked employee on the roster. */
  async function companyWithCrew(token: string, name: string, employeeName: string) {
    const company = await makeCompany(token, name, "sub");
    // Employees are created through the /query facade, which is what the web
    // client's CreateTaskModal/ProfilesModal equivalents call.
    const res = await request(server)
      .post("/query")
      .set(authed(token))
      .send({ table: "employees", operation: "insert", data: { company_id: company.id, name: employeeName } });
    expect(res.status).toBe(200);
    return { companyId: company.id, employeeId: res.body.data[0].id as string };
  }

  /** Adds `joiner` to the company at an explicit permission level. */
  async function addMember(holderToken: string, companyId: string, joinerToken: string, permissionLevel: string) {
    const join = await request(server)
      .post(`/companies/${companyId}/join-requests`)
      .set(authed(joinerToken));
    expect(join.status).toBe(201);
    const listed = await request(server)
      .get(`/companies/${companyId}/join-requests`)
      .set(authed(holderToken));
    const approve = await request(server)
      .post(`/companies/${companyId}/join-requests/${listed.body.requests[0].id}/approve`)
      .set(authed(holderToken))
      .send({ permissionLevel });
    expect(approve.status).toBe(200);
  }

  it("lets an account holder publish availability for a crew member", async () => {
    const holder = await signUp("schedgc@example.com");
    const { employeeId } = await companyWithCrew(holder.token, "GC Scheduling Co", "Dana Crew");

    const res = await request(server)
      .post("/availability")
      .set(authed(holder.token))
      .send({
        date: farFutureDate(30),
        startTime: "07:00",
        endTime: "15:00",
        allProjects: true,
        employeeId,
      });

    expect(res.status).toBe(201);
    expect(res.body.employeeId).toBe(employeeId);

    // And it has to be visible to the company, not just accepted.
    const listed = await request(server)
      .get(`/availability?start=${farFutureDate(29)}&end=${farFutureDate(31)}`)
      .set(authed(holder.token));
    expect(listed.body.availability.map((a: { id: string }) => a.id)).toContain(res.body.id);
  });

  it("lets a partial-level member publish availability for a crew member", async () => {
    const holder = await signUp("partialholder@example.com");
    const { companyId, employeeId } = await companyWithCrew(holder.token, "Partial Co", "Robin Crew");
    const partial = await signUp("partialmember@example.com");
    await addMember(holder.token, companyId, partial.token, "partial");

    const res = await request(server)
      .post("/availability")
      .set(authed(partial.token))
      .send({ date: farFutureDate(31), startTime: "08:00", endTime: "16:00", allProjects: true, employeeId });
    expect(res.status).toBe(201);
    expect(res.body.employeeId).toBe(employeeId);
  });

  it("refuses a level_1 member publishing for someone else", async () => {
    // ProfilesModal.tsx: level_1 "Cannot edit availability."
    const holder = await signUp("l1holder@example.com");
    const { companyId, employeeId } = await companyWithCrew(holder.token, "L1 Co", "Sam Crew");
    const levelOne = await signUp("l1member@example.com");
    await addMember(holder.token, companyId, levelOne.token, "level_1");

    const res = await request(server)
      .post("/availability")
      .set(authed(levelOne.token))
      .send({ date: farFutureDate(32), startTime: "08:00", endTime: "16:00", allProjects: true, employeeId });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/partial-level/i);
  });

  it("refuses a basic member publishing for someone else", async () => {
    // ProfilesModal.tsx: basic "Cannot edit or change any availability."
    const holder = await signUp("basicholder@example.com");
    const { companyId, employeeId } = await companyWithCrew(holder.token, "Basic Co", "Kim Crew");
    const basic = await signUp("basicmember@example.com");
    await addMember(holder.token, companyId, basic.token, "basic");

    const res = await request(server)
      .post("/availability")
      .set(authed(basic.token))
      .send({ date: farFutureDate(33), startTime: "08:00", endTime: "16:00", allProjects: true, employeeId });
    expect(res.status).toBe(403);
  });

  it("still lets a basic member publish their own availability", async () => {
    // Naming yourself must never need a permission check, otherwise the basic
    // worker flow ("here's when I'm free") disappears.
    const holder = await signUp("ownselfholder@example.com");
    const company = await makeCompany(holder.token, "Own Self Co", "sub");
    const basic = await signUp("ownselfbasic@example.com");
    await addMember(holder.token, company.id, basic.token, "basic");

    const res = await request(server)
      .post("/availability")
      .set(authed(basic.token))
      .send({ date: farFutureDate(34), startTime: "08:00", endTime: "16:00", allProjects: true });
    expect(res.status).toBe(201);
  });

  it("refuses publishing for an employee of a company you are merely connected to", async () => {
    // Booking another company's crew is what schedule-requests are for; the
    // availability table must not be a back door into that.
    const gc = await signUp("crossgc@example.com");
    const gcCompany = await companyWithCrew(gc.token, "Cross GC Co", "Casey Crew");

    const sub = await signUp("crosssub@example.com");
    await makeCompany(sub.token, "Cross Sub Co", "sub");
    const project = await request(server).post("/projects").set(authed(gc.token)).send({ name: "Cross Tower" });
    await request(server)
      .post("/projects/connect")
      .set(authed(sub.token))
      .send({ code: project.body.connectionCode });

    const res = await request(server)
      .post("/availability")
      .set(authed(sub.token))
      .send({
        date: farFutureDate(35),
        startTime: "08:00",
        endTime: "16:00",
        allProjects: true,
        employeeId: gcCompany.employeeId,
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/your own company/i);
  });

  it("refuses an unknown employee id", async () => {
    const holder = await signUp("ghostemployee@example.com");
    await makeCompany(holder.token, "Ghost Co", "sub");

    const res = await request(server)
      .post("/availability")
      .set(authed(holder.token))
      .send({ date: farFutureDate(36), startTime: "08:00", endTime: "16:00", allProjects: true, employeeId: "nope" });
    expect(res.status).toBe(404);
  });

  it("applies the same permission rule to deleting someone else's entry", async () => {
    const holder = await signUp("delgc@example.com");
    const { companyId, employeeId } = await companyWithCrew(holder.token, "Delete GC Co", "Jules Crew");

    const basic = await signUp("delbasic@example.com");
    await addMember(holder.token, companyId, basic.token, "basic");
    const partial = await signUp("delpartial@example.com");
    await addMember(holder.token, companyId, partial.token, "partial");

    // A basic member cannot remove a crew member's hours...
    const forBasic = await request(server)
      .post("/availability")
      .set(authed(holder.token))
      .send({ date: farFutureDate(37), startTime: "08:00", endTime: "16:00", allProjects: true, employeeId });
    expect(forBasic.status).toBe(201);
    expect((await request(server).delete(`/availability/${forBasic.body.id}`).set(authed(basic.token))).status).toBe(403);

    // ...but a partial one can, exactly as with publishing.
    const forPartial = await request(server)
      .post("/availability")
      .set(authed(holder.token))
      .send({ date: farFutureDate(38), startTime: "08:00", endTime: "16:00", allProjects: true, employeeId });
    expect(forPartial.status).toBe(201);
    expect((await request(server).delete(`/availability/${forPartial.body.id}`).set(authed(partial.token))).status).toBe(200);
  });
});

describe("scheduling: project create/delete permissions", () => {
  async function addMember(holderToken: string, companyId: string, joinerToken: string, permissionLevel: string) {
    await request(server).post(`/companies/${companyId}/join-requests`).set(authed(joinerToken));
    const listed = await request(server).get(`/companies/${companyId}/join-requests`).set(authed(holderToken));
    const approve = await request(server)
      .post(`/companies/${companyId}/join-requests/${listed.body.requests[0].id}/approve`)
      .set(authed(holderToken))
      .send({ permissionLevel });
    expect(approve.status).toBe(200);
  }

  it("lets the holder create but refuses basic and partial members", async () => {
    const holder = await signUp(`pd-holder-${Date.now()}@example.com`);
    const company = await makeCompany(holder.token, "PD Co", "sub");

    const created = await request(server).post("/projects").set(authed(holder.token)).send({ name: "PD Tower" });
    expect(created.status).toBe(201);

    const basic = await signUp(`pd-basic-${Date.now()}@example.com`);
    await addMember(holder.token, company.id, basic.token, "basic");
    const basicTry = await request(server).post("/projects").set(authed(basic.token)).send({ name: "Sneaky" });
    expect(basicTry.status).toBe(403);

    const partial = await signUp(`pd-partial-${Date.now()}@example.com`);
    await addMember(holder.token, company.id, partial.token, "partial");
    const partialTry = await request(server).post("/projects").set(authed(partial.token)).send({ name: "Sneaky 2" });
    expect(partialTry.status).toBe(403);
  });

  it("deletes an owned project with its children, and refuses others", async () => {
    const holder = await signUp(`pdel-holder-${Date.now()}@example.com`);
    const company = await makeCompany(holder.token, "PDel Co", "gc");
    const project = await request(server).post("/projects").set(authed(holder.token)).send({ name: "Doomed" });
    expect(project.status).toBe(201);

    // Hang an availability row + schedule request off the project first.
    const avail = await request(server)
      .post("/availability")
      .set(authed(holder.token))
      .send({ date: farFutureDate(40), startTime: "08:00", endTime: "16:00", projectId: project.body.id });
    expect(avail.status).toBe(201);

    const partial = await signUp(`pdel-partial-${Date.now()}@example.com`);
    await addMember(holder.token, company.id, partial.token, "partial");
    const partialDel = await request(server).delete(`/projects/${project.body.id}`).set(authed(partial.token));
    expect(partialDel.status).toBe(403);

    const sub = await signUp(`pdel-sub-${Date.now()}@example.com`);
    await makeCompany(sub.token, "PDel Sub", "sub");
    const subDel = await request(server).delete(`/projects/${project.body.id}`).set(authed(sub.token));
    expect(subDel.status).toBe(404);

    const del = await request(server).delete(`/projects/${project.body.id}`).set(authed(holder.token));
    expect(del.status).toBe(200);

    const listed = await request(server).get("/projects").set(authed(holder.token));
    expect(listed.body.projects.some((p: { id: string }) => p.id === project.body.id)).toBe(false);

    const availLeft = await request(server)
      .get(`/availability?start=${farFutureDate(39)}&end=${farFutureDate(41)}`)
      .set(authed(holder.token));
    expect(availLeft.body.availability.some((a: { id: string }) => a.id === avail.body.id)).toBe(false);
  });
});
