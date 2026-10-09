/**
 * Regression tests for the sort_order contract that the dashboard's LeftPanel
 * drag-reorder depends on. The behaviour lives in the query executor, but it
 * only becomes visible through a project, so these go through the real API
 * rather than calling the executor directly.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import { startTestServer } from "./helpers/server.js";

const server = await startTestServer();

async function signUp(email: string) {
  const res = await request(server).post("/auth/signup").send({ email, password: "hunter22", fullName: "Test User" });
  return { token: res.body.token as string, id: res.body.user.id as string };
}

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function query(token: string) {
  return (body: Record<string, unknown>) => request(server).post("/query").set(authed(token)).send(body);
}

async function projectAndToken(label: string) {
  const { token } = await signUp(`sort-${label}-${Date.now()}@example.com`);
  await request(server).post("/companies").set(authed(token)).send({ name: `Sort ${label}`, companyType: "gc" });
  const res = await request(server).post("/projects").set(authed(token)).send({ name: `Sort ${label} Project` });
  return { token, projectId: res.body.id as string };
}

type TaskRow = { id: string; name: string; sort_order: number };

async function insertTask(token: string, projectId: string, name: string, extra: Record<string, unknown> = {}) {
  const res = await query(token)({
    table: "tasks",
    operation: "insert",
    data: { project_id: projectId, name, start_date: "2026-11-03", end_date: "2026-11-05", ...extra },
  });
  expect(res.status).toBe(200);
  return res.body.data[0] as TaskRow;
}

async function listTasks(token: string, projectId: string): Promise<TaskRow[]> {
  const res = await query(token)({
    table: "tasks",
    operation: "select",
    filters: [{ op: "eq", column: "project_id", value: projectId }],
    order: [{ column: "sort_order", ascending: true }],
  });
  expect(res.status).toBe(200);
  return res.body.data as TaskRow[];
}

describe("tasks sort_order", () => {
  it("appends an omitted sort_order instead of tying every task at 0", async () => {
    const { token, projectId } = await projectAndToken("append");
    await insertTask(token, projectId, "First");
    await insertTask(token, projectId, "Second");
    await insertTask(token, projectId, "Third");

    const rows = await listTasks(token, projectId);
    expect(rows.map((t) => t.sort_order)).toEqual([0, 1, 2]);
    expect(rows.map((t) => t.name)).toEqual(["First", "Second", "Third"]);
  });

  it("keeps numbering scoped to the project", async () => {
    const { token, projectId } = await projectAndToken("scoped");
    await insertTask(token, projectId, "First");
    await insertTask(token, projectId, "Second");

    const other = await request(server).post("/projects").set(authed(token)).send({ name: "Second Project" });
    const row = await insertTask(token, other.body.id as string, "Other");
    expect(row.sort_order).toBe(0);
  });

  it("honours an explicit sort_order", async () => {
    const { token, projectId } = await projectAndToken("explicit");
    const row = await insertTask(token, projectId, "Explicit", { sort_order: 42 });
    expect(row.sort_order).toBe(42);
  });

  it("round-trips a full reorder the way the LeftPanel sends it", async () => {
    const { token, projectId } = await projectAndToken("reorder");
    const ids = await Promise.all(["A", "B", "C"].map((n) => insertTask(token, projectId, n)));

    // LeftPanel hands back the whole reordered array and each task is written
    // with its new index, because the executor matches on the columns present
    // in `data` and has no `.eq()` support.
    for (const [index, row] of [...ids].reverse().entries()) {
      const res = await query(token)({
        table: "tasks",
        operation: "update",
        data: { id: row.id, sort_order: index },
      });
      expect(res.status).toBe(200);
    }

    const rows = await listTasks(token, projectId);
    expect(rows.map((t) => t.name)).toEqual(["C", "B", "A"]);
  });
});