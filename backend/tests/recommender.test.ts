import { describe, expect, it } from "vitest";
import request from "supertest";
import { startTestServer } from "./helpers/server.js";

// The deterministic path (no Claude): what the recommender does on any server.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const server = await startTestServer();
let n = 0;
const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const inDays = (k: number) => {
  const d = new Date();
  d.setDate(d.getDate() + k);
  return iso(d);
};

async function signUp(tag: string) {
  const res = await request(server)
    .post("/auth/signup")
    .send({ email: `rec-${tag}-${Date.now()}-${n++}@example.com`, password: "hunter22", fullName: `Pat ${tag}` });
  return res.body.token as string;
}

/** A sub of the given trade with `crew` employees, all free 7:00–15:30 for the next two weeks, on the project. */
async function subWithCrew(trade: string, crew: number, project: { connectionCode: string }) {
  const owner = await signUp(trade);
  const companyId = (await request(server).post("/companies").set(authed(owner)).send({ name: `${trade} Co ${n}`, companyType: "sub", trade })).body
    .company.id as string;
  for (let i = 0; i < crew; i++) {
    await request(server)
      .post("/query")
      .set(authed(owner))
      .send({ table: "employees", operation: "insert", data: { company_id: companyId, name: `${trade} Tech ${i + 1}`, job_title: `${trade} Technician` } });
  }
  await request(server).post("/projects/connect").set(authed(owner)).send({ code: project.connectionCode });
  const employees = (await request(server).get(`/companies/${companyId}/employees`).set(authed(owner))).body.employees as { id: string; name: string }[];
  for (const e of employees) {
    for (let k = 1; k <= 14; k++) {
      await request(server).post("/availability").set(authed(owner)).send({ date: inDays(k), startTime: "07:00", endTime: "15:30", allProjects: true, employeeId: e.id });
    }
  }
  return { owner, companyId, employees };
}

async function setup() {
  const gc = await signUp("gc");
  await request(server).post("/companies").set(authed(gc)).send({ name: `Rec GC ${n}`, companyType: "gc" });
  const project = (await request(server).post("/projects").set(authed(gc)).send({ name: "Library Fit-Out" })).body;
  const plumbing = await subWithCrew("Plumbing", 3, project);
  const drywall = await subWithCrew("Drywall", 6, project);
  const task = (name: string, from: number, to: number) =>
    request(server)
      .post("/query")
      .set(authed(gc))
      .send({ table: "tasks", operation: "insert", data: { project_id: project.id, name, start_date: inDays(from), end_date: inDays(to), color: "#888" } });
  await task("Plumbing Rough-In", 1, 9);
  await task("Framing", 1, 9);
  await task("Demo", 1, 9); // ambiguous: Demolition or Drywall; only Drywall is on this job
  await task("Owner walkthrough", 2, 2); // no trade does this
  await task("Duct Install", 1, 9); // HVAC, but no HVAC sub here
  const recommend = (weeks = 1, token = gc) => request(server).post("/ai/recommendations").set(authed(token)).send({ projectId: project.id, weeks });
  return { gc, project, plumbing, drywall, recommend, task };
}

// Signs up many users (password hashing is slow on purpose); with every file running at once
// that can pass vitest's 5 s default without anything being wrong.
describe("AI schedule recommender (no Claude key)", { timeout: 20_000 }, () => {
  it("matches tasks to the right sub, sizes crews within who's free, and never double-books", async () => {
    const { recommend, plumbing, drywall } = await setup();
    const res = await recommend(1);
    expect(res.status).toBe(200);
    const s = res.body.suggestions as { taskName: string; subCompanyId: string; date: string; startTime: string; endTime: string; suggestedCount: number; employees: { id: string }[]; tradeReason: string }[];
    expect(s.length).toBeGreaterThan(0);
    expect(res.body.claude).toEqual({ configured: false, used: false });

    const plumbingSugs = s.filter((x) => x.taskName === "Plumbing Rough-In");
    expect(plumbingSugs.length).toBeGreaterThan(0);
    expect(plumbingSugs.every((x) => x.subCompanyId === plumbing.companyId && x.suggestedCount === 2)).toBe(true);

    const framing = s.filter((x) => x.taskName === "Framing");
    expect(framing.every((x) => x.subCompanyId === drywall.companyId && x.suggestedCount === 4)).toBe(true);

    // "Demo" goes to the drywall crew (the trade on this job); with 7 drywall people (6 crew + the owner) and 4 on framing, at most 3 are left.
    const demo = s.filter((x) => x.taskName === "Demo");
    expect(demo.length).toBeGreaterThan(0);
    expect(demo[0].tradeReason).toMatch(/Drywall is the one on this project/);
    expect(demo.every((x) => x.employees.length <= 3)).toBe(true);

    // Nobody is in two places at once on the same day.
    for (const date of new Set(s.map((x) => x.date))) {
      const ids = s.filter((x) => x.date === date).flatMap((x) => x.employees.map((e) => e.id));
      expect(new Set(ids).size).toBe(ids.length);
    }

    expect(res.body.questions.map((q: { taskName: string }) => q.taskName)).toEqual(["Owner walkthrough"]);
    expect(res.body.notes.join(" ")).toMatch(/No subcontractor on this project for: HVAC \(Duct Install\)/);
  });

  it("remembers the GC's answer and uses it next time", async () => {
    const { gc, project, recommend, task } = await setup();
    await task("Mystery scope", 2, 4);
    let res = await recommend(1);
    expect(res.body.questions.map((q: { taskName: string }) => q.taskName)).toContain("Mystery scope");

    const save = await request(server).post("/ai/trade-answers").set(authed(gc)).send({ projectId: project.id, answers: [{ taskName: "Mystery scope", trade: "Plumbing" }] });
    expect(save.body).toEqual({ saved: 1 });
    res = await recommend(1);
    expect(res.body.questions.map((q: { taskName: string }) => q.taskName)).not.toContain("Mystery scope");
    const mystery = res.body.suggestions.find((x: { taskName: string }) => x.taskName === "Mystery scope");
    expect(mystery?.tradeReason).toMatch(/You told us/);

    expect((await request(server).post("/ai/trade-answers").set(authed(gc)).send({ projectId: project.id, answers: [{ taskName: "x", trade: "Astronaut" }] })).status).toBe(400);
  });

  it("skips days already requested, and learns crew size from what the GC actually asks for", async () => {
    const { gc, project, plumbing, recommend } = await setup();
    const first = (await recommend(1)).body.suggestions.find((x: { taskName: string }) => x.taskName === "Plumbing Rough-In");
    // The GC sends just one person for that day.
    const sent = await request(server)
      .post("/schedule-requests/batch")
      .set(authed(gc))
      .send({ create: [{ projectId: project.id, subCompanyId: plumbing.companyId, employeeIds: [first.employees[0].id], date: first.date, startTime: first.startTime, endTime: first.endTime }], cancel: [] });
    expect(sent.body.created).toHaveLength(1);

    const again = await recommend(1);
    const plumbingDays = again.body.suggestions.filter((x: { taskName: string }) => x.taskName === "Plumbing Rough-In");
    expect(plumbingDays.some((x: { date: string }) => x.date === first.date)).toBe(false);
    expect(plumbingDays.every((x: { suggestedCount: number; crewReason: string }) => x.suggestedCount === 1 && /usually request 1/.test(x.crewReason))).toBe(true);
    expect(again.body.notes.join(" ")).toMatch(/Skipped 1 day you've already requested/);
  });

  it("is for the project's GC only, and validates input", async () => {
    const { recommend, plumbing, project, gc } = await setup();
    expect((await recommend(1, plumbing.owner)).status).toBe(404);
    expect((await request(server).post("/ai/recommendations").set(authed(gc)).send({ projectId: project.id, weeks: 5 })).status).toBe(400);
  });

  it("Upload Schedule explains when the AI helper isn't set up", async () => {
    const { gc } = await setup();
    const res = await request(server).post("/ai/schedule-upload").set(authed(gc)).attach("file", Buffer.from("x"), { filename: "s.png", contentType: "image/png" });
    expect(res.status).toBe(503);
    expect((await request(server).get("/ai/status").set(authed(gc))).body).toEqual({ claude: false });
  });
});
