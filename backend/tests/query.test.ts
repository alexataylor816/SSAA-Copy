import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const { app } = await createApp();

async function signUp(email: string) {
  const res = await request(app).post("/auth/signup").send({ email, password: "hunter22", fullName: "Test User" });
  return { token: res.body.token as string, id: res.body.user.id as string };
}

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function query(token: string) {
  return (body: Record<string, unknown>) => request(app).post("/query").set(authed(token)).send(body);
}

async function companyWithProject(token: string, name: string, companyType: "gc" | "sub" = "gc") {
  await request(app).post("/companies").set(authed(token)).send({ name, companyType });
  const res = await request(app).post("/projects").set(authed(token)).send({ name: `${name} Project` });
  // /projects answers in camelCase, unlike the /query rows it mirrors.
  return res.body as { id: string; companyId: string; connectionCode: string };
}

function q() {
  return request(app).post("/query");
}

describe("query api: shape", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await q().send({ table: "companies", operation: "select" });
    expect(res.status).toBe(401);
  });

  it("rejects a table that is not registered", async () => {
    const { token } = await signUp(`unknown-${Date.now()}@example.com`);
    const res = await query(token)({ table: "conversations", operation: "select" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not available/i);
  });

  it("rejects an unknown column instead of interpolating it into SQL", async () => {
    const { token } = await signUp(`col-${Date.now()}@example.com`);
    const res = await query(token)({
      table: "companies",
      operation: "select",
      filters: [{ op: "eq", column: "name; DROP TABLE users--", value: "x" }],
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/unknown column/i);
  });

  it("never exposes password_hash", async () => {
    const { token } = await signUp(`secret-${Date.now()}@example.com`);
    const res = await query(token)({ table: "users", operation: "select" });
    expect(res.status).toBe(200);
    for (const row of res.body.data) {
      expect(row).not.toHaveProperty("password_hash");
    }
  });

  it("refuses password_resets entirely", async () => {
    const { token } = await signUp(`reset-${Date.now()}@example.com`);
    const res = await query(token)({ table: "password_resets", operation: "select" });
    expect(res.status).toBe(403);
  });

  it("refuses an unscoped delete", async () => {
    const { token } = await signUp(`nodelete-${Date.now()}@example.com`);
    await companyWithProject(token, "No Delete Co");
    const res = await query(token)({ table: "projects", operation: "delete" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/every row/i);
  });

  it("rejects writing a server-managed column", async () => {
    const { token } = await signUp(`managed-${Date.now()}@example.com`);
    const project = await companyWithProject(token, "Managed Co");
    const res = await query(token)({
      table: "projects",
      operation: "update",
      data: { id: project.id, connection_code: "deadbeef" },
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/managed by the server/i);
  });

  it("generates the id on insert instead of trusting the client", async () => {
    const { token } = await signUp(`genid-${Date.now()}@example.com`);
    const company = await request(app).post("/companies").set(authed(token)).send({ name: "Gen Id Co", companyType: "gc" });

    const inserted = await query(token)({
      table: "employees",
      operation: "insert",
      data: { company_id: company.body.company.id, name: "Generated Id" },
    });
    expect(inserted.status).toBe(200);
    expect(inserted.body.data[0].id).toBeTruthy();
    expect(inserted.body.data[0].created_at).toBeTruthy();

    // And the generated id must actually address the row.
    const employees = await query(token)({ table: "employees", operation: "select" });
    expect(employees.body.data.some((e: { id: string }) => e.id === inserted.body.data[0].id)).toBe(true);
  });

  it("ignores a client-supplied id on insert", async () => {
    const { token } = await signUp(`forged-${Date.now()}@example.com`);
    const company = await request(app).post("/companies").set(authed(token)).send({ name: "Forged Co", companyType: "gc" });
    const inserted = await query(token)({
      table: "employees",
      operation: "insert",
      data: { id: "attacker-chosen-id", company_id: company.body.company.id, name: "Forged" },
    });
    expect(inserted.status).toBe(200);
    expect(inserted.body.data[0].id).not.toBe("attacker-chosen-id");
  });

  it("lets you update a row by its id", async () => {
    const { token } = await signUp(`upd-${Date.now()}@example.com`);
    const company = await request(app).post("/companies").set(authed(token)).send({ name: "Upd Co", companyType: "gc" });
    const inserted = await query(token)({
      table: "employees",
      operation: "insert",
      data: { company_id: company.body.company.id, name: "Before" },
    });
    expect(inserted.status).toBe(200);

    const updated = await query(token)({
      table: "employees",
      operation: "update",
      data: { id: inserted.body.data[0].id, name: "After" },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data[0].name).toBe("After");
  });

  it("refuses an update with no id, which would hit every visible row", async () => {
    const { token } = await signUp(`noid-${Date.now()}@example.com`);
    await companyWithProject(token, "No Id Co");
    const res = await query(token)({
      table: "employees",
      operation: "update",
      data: { name: "Everyone" },
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/must include its id/i);
  });

  it("updates a row named by an id filter, the way a ported page writes it", async () => {
    // `.update({ ... }).eq("id", id)` is the idiomatic PostgREST shape and the
    // one the reference app's components use. It used to throw "Each updated row
    // must include its id" because the id was read from the payload, not the
    // filter, forcing every caller to inline the id a second time.
    const { token } = await signUp(`filterid-${Date.now()}@example.com`);
    const company = await request(app).post("/companies").set(authed(token)).send({ name: "Filter Id Co", companyType: "gc" });
    const inserted = await query(token)({
      table: "employees",
      operation: "insert",
      data: { company_id: company.body.company.id, name: "Before" },
    });
    const id = inserted.body.data[0].id as string;

    const updated = await query(token)({
      table: "employees",
      operation: "update",
      data: { name: "After" },
      filters: [{ op: "eq", column: "id", value: id }],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data[0].name).toBe("After");
    expect(updated.body.data[0].id).toBe(id);
  });

  it("updates a task through an id filter without the payload naming a project", async () => {
    // Same path as above, but for tasks: canWrite has to resolve the project
    // from the row, so the filter-derived id has to be merged before the guard
    // runs or the guard sees no id at all.
    const { token } = await signUp(`taskfilter-${Date.now()}@example.com`);
    const project = await companyWithProject(token, "Task Filter Co");
    const inserted = await query(token)({
      table: "tasks",
      operation: "insert",
      data: { project_id: project.id, name: "Framing", start_date: "2026-11-02", end_date: "2026-11-06" },
    });
    const id = inserted.body.data[0].id as string;

    const updated = await query(token)({
      table: "tasks",
      operation: "update",
      data: { status: "complete" },
      filters: [{ op: "eq", column: "id", value: id }],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data[0].status).toBe("complete");
  });

  it("still refuses an id filter that names more than one row", async () => {
    const { token } = await signUp(`ambig-${Date.now()}@example.com`);
    const company = await request(app).post("/companies").set(authed(token)).send({ name: "Ambig Co", companyType: "gc" });
    const first = await query(token)({
      table: "employees",
      operation: "insert",
      data: { company_id: company.body.company.id, name: "One" },
    });
    const second = await query(token)({
      table: "employees",
      operation: "insert",
      data: { company_id: company.body.company.id, name: "Two" },
    });
    const ids = [first.body.data[0].id, second.body.data[0].id];

    const inFilter = await query(token)({
      table: "employees",
      operation: "update",
      data: { name: "Both" },
      filters: [{ op: "in", column: "id", value: ids }],
    });
    expect(inFilter.status).toBe(403);

    const twoEqs = await query(token)({
      table: "employees",
      operation: "update",
      data: { name: "Both" },
      filters: [
        { op: "eq", column: "id", value: ids[0] },
        { op: "eq", column: "id", value: ids[1] },
      ],
    });
    expect(twoEqs.status).toBe(403);

    // Nothing may have been written by either attempt. (Creating a company also
    // adds the account holder as an employee, so only the two named rows are
    // checked here rather than the whole list.)
    const after = await query(token)({ table: "employees", operation: "select" });
    const names = after.body.data.map((e: { name: string }) => e.name);
    expect(names).toContain("One");
    expect(names).toContain("Two");
    expect(names).not.toContain("Both");
  });

  it("refuses an id filter that targets a row you cannot see", async () => {
    // The filter supplies the id now, so the id filter must not become a way
    // around row-level scoping.
    const owner = await signUp(`fown-${Date.now()}@example.com`);
    const stranger = await signUp(`fstr-${Date.now()}@example.com`);
    const project = await companyWithProject(owner.token, "Filter Owner Co");
    await companyWithProject(stranger.token, "Filter Stranger Co");

    const inserted = await query(owner.token)({
      table: "tasks",
      operation: "insert",
      data: { project_id: project.id, name: "Secret", start_date: "2026-11-02", end_date: "2026-11-06" },
    });
    const id = inserted.body.data[0].id as string;

    const res = await query(stranger.token)({
      table: "tasks",
      operation: "update",
      data: { name: "Hijacked" },
      filters: [{ op: "eq", column: "id", value: id }],
    });
    expect(res.status).toBe(403);

    const still = await query(owner.token)({ table: "tasks", operation: "select" });
    expect(still.body.data[0].name).toBe("Secret");
  });

  it("updates a task by id even though the payload carries no project_id", async () => {
    // Regression: TASKS.canWrite used to read row.project_id unconditionally,
    // so an update-by-id was rejected with "you do not have access to that
    // project" because the value it compared was the string "undefined".
    const { token } = await signUp(`task-${Date.now()}@example.com`);
    const project = await companyWithProject(token, "Task Co");

    const inserted = await query(token)({
      table: "tasks",
      operation: "insert",
      data: { project_id: project.id, name: "Framing", start_date: "2026-11-02", end_date: "2026-11-06" },
    });
    expect(inserted.status).toBe(200);

    const updated = await query(token)({
      table: "tasks",
      operation: "update",
      data: { id: inserted.body.data[0].id, name: "Framing + steel", status: "in_progress" },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data[0].name).toBe("Framing + steel");
    expect(updated.body.data[0].status).toBe("in_progress");
  });

  it("refuses to update a task on a project you cannot see", async () => {
    const owner = await signUp(`task-own-${Date.now()}@example.com`);
    const stranger = await signUp(`task-str-${Date.now()}@example.com`);
    const project = await companyWithProject(owner.token, "Owner Co");
    await companyWithProject(stranger.token, "Stranger Co");

    const inserted = await query(owner.token)({
      table: "tasks",
      operation: "insert",
      data: { project_id: project.id, name: "Secret", start_date: "2026-11-02", end_date: "2026-11-06" },
    });
    const id = inserted.body.data[0].id;

    const res = await query(stranger.token)({
      table: "tasks",
      operation: "update",
      data: { id, name: "Hijacked" },
    });
    expect(res.status).toBe(403);
  });
});

describe("query api: row-level scoping", () => {
  it("only returns your own company's projects", async () => {
    const alice = await signUp(`alice-scope-${Date.now()}@example.com`);
    const bob = await signUp(`bob-scope-${Date.now()}@example.com`);
    await companyWithProject(alice.token, "Alice Co", "gc");
    await companyWithProject(bob.token, "Bob Co", "gc");

    const mine = await query(alice.token)({ table: "projects", operation: "select" });
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].name).toBe("Alice Co Project");

    const theirs = await query(bob.token)({ table: "projects", operation: "select" });
    expect(theirs.body.data[0].name).toBe("Bob Co Project");
  });

  it("lets a connected sub see the GC's project but not an unrelated project", async () => {
    const gc = await signUp(`gc-conn-${Date.now()}@example.com`);
    const gcProject = await companyWithProject(gc.token, "GC Conn", "gc");

    const sub = await signUp(`sub-conn-${Date.now()}@example.com`);
    await request(app).post("/companies").set(authed(sub.token)).send({ name: "Sub Conn", companyType: "sub" });
    await request(app)
      .post("/projects/connect")
      .set(authed(sub.token))
      .send({ code: gcProject.connectionCode });

    const stranger = await signUp(`stranger-${Date.now()}@example.com`);
    await companyWithProject(stranger.token, "Stranger Co", "gc");

    const visible = await query(sub.token)({ table: "projects", operation: "select" });
    expect(visible.body.data.map((p: { id: string }) => p.id)).toContain(gcProject.id);
    expect(visible.body.data.map((p: { id: string }) => p.id)).not.toContain(
      (await query(stranger.token)({ table: "projects", operation: "select" })).body.data[0].id,
    );
  });

  it("scopes tasks to projects the caller can see", async () => {
    const owner = await signUp(`owner-task-${Date.now()}@example.com`);
    const project = await companyWithProject(owner.token, "Task Owner", "gc");

    const created = await query(owner.token)({
      table: "tasks",
      operation: "insert",
      data: { project_id: project.id, name: "Pour footings", start_date: "2026-07-01", end_date: "2026-07-03" },
    });
    expect(created.status).toBe(200);

    const outsider = await signUp(`outsider-task-${Date.now()}@example.com`);
    await companyWithProject(outsider.token, "Outsider Co", "gc");
    const seen = await query(outsider.token)({ table: "tasks", operation: "select" });
    expect(seen.body.data).toHaveLength(0);
  });

  it("rejects inserting a task against a project you cannot see", async () => {
    const owner = await signUp(`owner-t2-${Date.now()}@example.com`);
    const project = await companyWithProject(owner.token, "Task Owner 2", "gc");

    const outsider = await signUp(`outsider-t2-${Date.now()}@example.com`);
    await companyWithProject(outsider.token, "Outsider Co 2", "gc");

    const res = await query(outsider.token)({
      table: "tasks",
      operation: "insert",
      data: { project_id: project.id, name: "Sneaky", start_date: "2026-07-01", end_date: "2026-07-01" },
    });
    expect(res.status).toBe(403);
  });

  it("only shows you your own availability and company schedule requests", async () => {
    const alice = await signUp(`alice-av-${Date.now()}@example.com`);
    const aliceCompany = await companyWithProject(alice.token, "Alice Av", "gc");

    const bob = await signUp(`bob-av-${Date.now()}@example.com`);
    await companyWithProject(bob.token, "Bob Av", "gc");

    await request(app)
      .post("/availability")
      .set(authed(alice.token))
      .send({ date: "2099-01-02", startTime: "08:00", endTime: "12:00", allProjects: true });

    const bobSees = await query(bob.token)({ table: "availability", operation: "select" });
    expect(bobSees.body.data).toHaveLength(0);

    const aliceSees = await query(alice.token)({ table: "availability", operation: "select" });
    expect(aliceSees.body.data).toHaveLength(1);

    // The service validates that every named employee really belongs to the sub,
    // so use a real one rather than a placeholder id.
    const crew = await request(app)
      .get(`/companies/${aliceCompany.companyId}/employees`)
      .set(authed(alice.token));
    expect(crew.body.employees.length).toBeGreaterThan(0);

    const req = await request(app)
      .post("/schedule-requests")
      .set(authed(alice.token))
      .send({
        projectId: aliceCompany.id,
        subCompanyId: aliceCompany.companyId,
        employeeIds: [crew.body.employees[0].id],
        date: "2099-01-02",
      });
    expect(req.status, JSON.stringify(req.body)).toBe(201);

    const bobReqs = await query(bob.token)({ table: "schedule_requests", operation: "select" });
    expect(bobReqs.body.data).toHaveLength(0);
  });
});

describe("query api: filters", () => {
  it("supports eq, in, gte and ilike", async () => {
    const { token } = await signUp(`filters-${Date.now()}@example.com`);
    await companyWithProject(token, "Filter Co", "gc");
    await request(app).post("/projects").set(authed(token)).send({ name: "Second Project" });

    const byName = await query(token)({
      table: "projects",
      operation: "select",
      filters: [{ op: "ilike", column: "name", value: "second%" }],
    });
    expect(byName.body.data).toHaveLength(1);
    expect(byName.body.data[0].name).toBe("Second Project");

    const byIn = await query(token)({
      table: "projects",
      operation: "select",
      filters: [{ op: "in", column: "name", value: ["Filter Co Project"] }],
    });
    expect(byIn.body.data).toHaveLength(1);

    const byGte = await query(token)({
      table: "projects",
      operation: "select",
      filters: [{ op: "gte", column: "created_at", value: "1970-01-01" }],
      order: [{ column: "created_at", ascending: true }],
      limit: 1,
    });
    expect(byGte.body.data).toHaveLength(1);
  });

  it("matches everything on an empty in() list, like PostgREST", async () => {
    const { token } = await signUp(`emptyin-${Date.now()}@example.com`);
    await companyWithProject(token, "Empty In Co", "gc");
    const res = await query(token)({
      table: "projects",
      operation: "select",
      filters: [{ op: "in", column: "id", value: [] }],
    });
    expect(res.body.data).toHaveLength(0);
  });

  it("returns employee_ids as an array, not a JSON string", async () => {
    const gc = await signUp(`gc-json-${Date.now()}@example.com`);
    const gcCompany = await request(app)
      .post("/companies")
      .set(authed(gc.token))
      .send({ name: "JSON GC", companyType: "gc" });
    const project = await request(app).post("/projects").set(authed(gc.token)).send({ name: "JSON Project" });

    const sub = await signUp(`sub-json-${Date.now()}@example.com`);
    const subCompany = await request(app)
      .post("/companies")
      .set(authed(sub.token))
      .send({ name: "JSON Sub", companyType: "sub" });
    await request(app)
      .post("/projects/connect")
      .set(authed(sub.token))
      .send({ code: project.body.connectionCode });
    const employees = await request(app)
      .get(`/companies/${subCompany.body.company.id}/employees`)
      .set(authed(sub.token));

    await request(app)
      .post("/schedule-requests")
      .set(authed(gc.token))
      .send({
        projectId: project.body.id,
        subCompanyId: subCompany.body.company.id,
        employeeIds: [employees.body.employees[0].id],
        date: "2099-02-02",
      });

    const res = await query(gc.token)({ table: "schedule_requests", operation: "select" });
    expect(res.body.data).toHaveLength(1);
    expect(Array.isArray(res.body.data[0].employee_ids)).toBe(true);
    expect(gcCompany.body.company.id).toBeTruthy();
  });
});

describe("query api: rpc", () => {
  it("404s an rpc that has not been migrated, naming it", async () => {
    const { token } = await signUp(`rpc-${Date.now()}@example.com`);
    const res = await request(app).post("/rpc/create_guest_gc_account").set(authed(token)).send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not available yet/i);
  });

  it("answers get_company_usage", async () => {
    const { token } = await signUp(`usage-${Date.now()}@example.com`);
    await companyWithProject(token, "Usage Co", "gc");
    const res = await request(app).post("/rpc/get_company_usage").set(authed(token)).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.project_count).toBe(1);
    expect(res.body.data.employee_count).toBeGreaterThanOrEqual(1);
  });

  it("refuses get_company_usage for a company you do not belong to", async () => {
    const { token } = await signUp(`usage-other-${Date.now()}@example.com`);
    const res = await request(app)
      .post("/rpc/get_company_usage")
      .set(authed(token))
      .send({ company_id_arg: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(403);
  });

  it("reports which rpcs exist", async () => {
    const { token } = await signUp(`caps-${Date.now()}@example.com`);
    const res = await request(app).get("/capabilities").set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.rpc).toContain("get_company_usage");
    expect(res.body.rpc).not.toContain("create_guest_gc_account");
  });
});

/**
 * The facade's availability rule must agree with the REST rule
 * (`resolveEmployeeToSchedule`): yourself always, someone else on your own
 * roster at partial+, never another company's crew. It used to be a flat
 * level_1-or-higher gate, which was simultaneously too lax (level_1 writing
 * for others) and too strict (basic workers naming themselves).
 */
describe("query api: availability writes follow the REST rule", () => {
  async function companyWithCrew(token: string, name: string, employeeName: string) {
    const res = await request(app).post("/companies").set(authed(token)).send({ name, companyType: "sub" });
    const companyId = res.body.company.id as string;
    const crew = await query(token)({
      table: "employees",
      operation: "insert",
      data: { company_id: companyId, name: employeeName },
    });
    expect(crew.status).toBe(200);
    return { companyId, employeeId: crew.body.data[0].id as string };
  }

  async function addMember(holderToken: string, companyId: string, joinerToken: string, permissionLevel: string) {
    const join = await request(app).post(`/companies/${companyId}/join-requests`).set(authed(joinerToken));
    expect(join.status).toBe(201);
    const listed = await request(app).get(`/companies/${companyId}/join-requests`).set(authed(holderToken));
    const approve = await request(app)
      .post(`/companies/${companyId}/join-requests/${listed.body.requests[0].id}/approve`)
      .set(authed(holderToken))
      .send({ permissionLevel });
    expect(approve.status).toBe(200);
  }

  /** The employee row the company auto-created for `userId`. */
  async function ownEmployeeId(token: string, userId: string) {
    const res = await query(token)({ table: "employees", operation: "select" });
    expect(res.status).toBe(200);
    const self = (res.body.data as { id: string; linked_user_id: string | null }[]).find(
      (e) => e.linked_user_id === userId,
    );
    expect(self).toBeTruthy();
    return self!.id;
  }

  function availabilityRow(employeeId: string) {
    return {
      employee_id: employeeId,
      date: "2099-03-04",
      start_time: "08:00",
      end_time: "16:00",
      all_projects: 1,
    };
  }

  it("refuses a level_1 member inserting for someone else", async () => {
    const holder = await signUp(`fq-holder1-${Date.now()}@example.com`);
    const { companyId, employeeId } = await companyWithCrew(holder.token, "FQ Co 1", "FQ Crew 1");
    const levelOne = await signUp(`fq-l1-${Date.now()}@example.com`);
    await addMember(holder.token, companyId, levelOne.token, "level_1");

    const res = await query(levelOne.token)({
      table: "availability",
      operation: "insert",
      data: availabilityRow(employeeId),
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/partial-level/i);
  });

  it("lets a partial member insert for a crew member", async () => {
    const holder = await signUp(`fq-holder2-${Date.now()}@example.com`);
    const { companyId, employeeId } = await companyWithCrew(holder.token, "FQ Co 2", "FQ Crew 2");
    const partial = await signUp(`fq-partial-${Date.now()}@example.com`);
    await addMember(holder.token, companyId, partial.token, "partial");

    const res = await query(partial.token)({
      table: "availability",
      operation: "insert",
      data: availabilityRow(employeeId),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data[0].employee_id).toBe(employeeId);
  });

  it("lets a basic member insert their own availability by naming themselves", async () => {
    const holder = await signUp(`fq-holder3-${Date.now()}@example.com`);
    const { companyId } = await companyWithCrew(holder.token, "FQ Co 3", "FQ Crew 3");
    const basic = await signUp(`fq-basic-${Date.now()}@example.com`);
    await addMember(holder.token, companyId, basic.token, "basic");

    const selfId = await ownEmployeeId(basic.token, basic.id);
    const res = await query(basic.token)({
      table: "availability",
      operation: "insert",
      data: availabilityRow(selfId),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("refuses a target on another company even for an account holder", async () => {
    const holderA = await signUp(`fq-holderA-${Date.now()}@example.com`);
    const { employeeId } = await companyWithCrew(holderA.token, "FQ Co A", "FQ Crew A");

    const holderB = await signUp(`fq-holderB-${Date.now()}@example.com`);
    await companyWithCrew(holderB.token, "FQ Co B", "FQ Crew B");

    const res = await query(holderB.token)({
      table: "availability",
      operation: "insert",
      data: availabilityRow(employeeId),
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/own company/i);
  });

  it("refuses an employee id that does not resolve", async () => {
    const holder = await signUp(`fq-holder5-${Date.now()}@example.com`);
    await companyWithCrew(holder.token, "FQ Co 5", "FQ Crew 5");

    const res = await query(holder.token)({
      table: "availability",
      operation: "insert",
      data: availabilityRow("no-such-employee"),
    });
    expect(res.status).toBe(403);
  });

  it("applies the same rule to updates addressed by id", async () => {
    const holder = await signUp(`fq-holder6-${Date.now()}@example.com`);
    const { companyId, employeeId } = await companyWithCrew(holder.token, "FQ Co 6", "FQ Crew 6");
    const levelOne = await signUp(`fq-l1u-${Date.now()}@example.com`);
    await addMember(holder.token, companyId, levelOne.token, "level_1");

    const created = await query(holder.token)({
      table: "availability",
      operation: "insert",
      data: availabilityRow(employeeId),
    });
    expect(created.status).toBe(200);
    const rowId = created.body.data[0].id as string;

    const denied = await query(levelOne.token)({
      table: "availability",
      operation: "update",
      data: { id: rowId, start_time: "09:00" },
    });
    expect(denied.status).toBe(403);

    const partial = await signUp(`fq-partialu-${Date.now()}@example.com`);
    await addMember(holder.token, companyId, partial.token, "partial");
    const allowed = await query(partial.token)({
      table: "availability",
      operation: "update",
      data: { id: rowId, start_time: "09:00" },
    });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
  });

  it("refuses a basic member deleting someone else's availability", async () => {
    // The executor's delete path never ran canWrite at all: scope-visibility
    // was the only gate, so this used to succeed.
    const holder = await signUp(`fq-holder7-${Date.now()}@example.com`);
    const { companyId, employeeId } = await companyWithCrew(holder.token, "FQ Co 7", "FQ Crew 7");
    const basic = await signUp(`fq-basicd-${Date.now()}@example.com`);
    await addMember(holder.token, companyId, basic.token, "basic");

    const created = await query(holder.token)({
      table: "availability",
      operation: "insert",
      data: availabilityRow(employeeId),
    });
    expect(created.status).toBe(200);
    const rowId = created.body.data[0].id as string;

    const denied = await query(basic.token)({
      table: "availability",
      operation: "delete",
      filters: [{ op: "eq", column: "id", value: rowId }],
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatch(/someone else's availability/i);

    const partial = await signUp(`fq-partiald-${Date.now()}@example.com`);
    await addMember(holder.token, companyId, partial.token, "partial");
    const allowed = await query(partial.token)({
      table: "availability",
      operation: "delete",
      filters: [{ op: "eq", column: "id", value: rowId }],
    });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
  });

  it("enforces the roster guard on employee deletes too, not just availability", async () => {
    const holder = await signUp(`fq-holder8-${Date.now()}@example.com`);
    const { companyId, employeeId } = await companyWithCrew(holder.token, "FQ Co 8", "FQ Crew 8");
    const basic = await signUp(`fq-basicd8-${Date.now()}@example.com`);
    await addMember(holder.token, companyId, basic.token, "basic");

    const denied = await query(basic.token)({
      table: "employees",
      operation: "delete",
      filters: [{ op: "eq", column: "id", value: employeeId }],
    });
    expect(denied.status).toBe(403);
  });
});