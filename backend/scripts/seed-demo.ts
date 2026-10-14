/**
 * Build a clean demo database through the real API (hashed passwords, every
 * permission rule applied), for demos, Codespaces, and the MySQL dump.
 *
 *   npx tsx scripts/seed-demo.ts --out demo.db
 *
 * Every account uses the password below and an @example.com address, so the
 * output is safe to commit and share. Dates are relative to the run date.
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const out = path.resolve(outIndex >= 0 ? args[outIndex + 1] : "demo.db");
const DEMO_PASSWORD = "Demo1234!";

// Must be set before the app (and its config) is imported.
for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(out + suffix, { force: true });
process.env.DATABASE_PATH = out;
process.env.RESEND_API_KEY = "";
process.env.SMTP_USER = "";
process.env.SMTP_PASS = "";

const { createApp } = await import("../src/app.js");
const { default: request } = await import("supertest");
const { app } = await createApp();

type Json = Record<string, any>;
async function call(method: "get" | "post" | "patch", url: string, token?: string, body?: Json): Promise<Json> {
  let req = request(app)[method](url);
  if (token) req = req.set("Authorization", `Bearer ${token}`);
  const res = await (body ? req.send(body) : req);
  if (res.status >= 400) throw new Error(`${method.toUpperCase()} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const query = (token: string, body: Json) => call("post", "/query", token, body);

async function person(email: string, fullName: string) {
  const res = await call("post", "/auth/signup", undefined, { email, password: DEMO_PASSWORD, fullName });
  return { token: res.token as string, id: res.user.id as string, email, fullName };
}
type Person = Awaited<ReturnType<typeof person>>;

async function company(owner: Person, name: string, companyType: "gc" | "sub", trade?: string) {
  const res = await call("post", "/companies", owner.token, { name, companyType, address: null, trade });
  return res.company.id as string;
}

async function join(owner: Person, companyId: string, member: Person, permissionLevel: string) {
  await call("post", `/companies/${companyId}/join-requests`, member.token);
  const { requests } = await call("get", `/companies/${companyId}/join-requests`, owner.token);
  const mine = requests.find((r: Json) => r.userEmail === member.email);
  await call("post", `/companies/${companyId}/join-requests/${mine.id}/approve`, owner.token, { permissionLevel });
}

async function roster(owner: Person, companyId: string) {
  const { employees } = await call("get", `/companies/${companyId}/employees`, owner.token);
  return employees as { id: string; name: string }[];
}

async function setTitle(owner: Person, employeeId: string, jobTitle: string) {
  await query(owner.token, { table: "employees", operation: "update", data: { job_title: jobTitle }, filters: [{ op: "eq", column: "id", value: employeeId }] });
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const nextMonday = (() => {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d;
})();
const day = (offset: number) => {
  const d = new Date(nextMonday);
  d.setDate(d.getDate() + offset);
  return iso(d);
};

// --- General contractor ---------------------------------------------------
const gina = await person("gina.torres@example.com", "Gina Torres");
const gcId = await company(gina, "Terrapin Builders", "gc");
const paul = await person("paul.kim@example.com", "Paul Kim");
await join(gina, gcId, paul, "partial");
for (const e of await roster(gina, gcId)) {
  await setTitle(gina, e.id, e.name === "Gina Torres" ? "Owner" : "Project Manager");
}

const riverside = await call("post", "/projects", gina.token, { name: "Riverside Office Build", address: "4100 River Rd, College Park, MD" });
const mainSt = await call("post", "/projects", gina.token, { name: "Main St Retail Fit-Out", address: "120 Main St, Hyattsville, MD" });

// --- Plumbing sub with a crew -----------------------------------------------
const bao = await person("bao.plumbing@example.com", "Bao Nguyen");
const plumbingId = await company(bao, "Bao Plumbing", "sub", "Plumbing");
const mike = await person("mike.rivera@example.com", "Mike Rivera");
const pete = await person("pete.alvarez@example.com", "Pete Alvarez");
await join(bao, plumbingId, mike, "level_1");
await join(bao, plumbingId, pete, "basic");
await query(bao.token, { table: "employees", operation: "insert", data: { company_id: plumbingId, name: "Luis Ortega", job_title: "Apprentice Plumber" } });
const plumbingTitles: Record<string, string> = { "Bao Nguyen": "Owner", "Mike Rivera": "Foreman", "Pete Alvarez": "Journeyman Plumber" };
for (const e of await roster(bao, plumbingId)) if (plumbingTitles[e.name]) await setTitle(bao, e.id, plumbingTitles[e.name]);
await call("patch", "/auth/profile", mike.token, { employeeNumber: "BP-102", phone: "301-555-0142" });
await call("patch", "/auth/profile", pete.token, { employeeNumber: "BP-117" });
await call("post", "/projects/connect", bao.token, { code: riverside.connectionCode });
await call("post", "/projects/connect", bao.token, { code: mainSt.connectionCode });

// --- Electrical sub ---------------------------------------------------------
const erin = await person("erin.walsh@example.com", "Erin Walsh");
const electricId = await company(erin, "Capital Electric", "sub", "Electrical");
const dev = await person("dev.patel@example.com", "Dev Patel");
await join(erin, electricId, dev, "partial");
for (const e of await roster(erin, electricId)) await setTitle(erin, e.id, e.name === "Erin Walsh" ? "Owner" : "Electrician");
await call("post", "/projects/connect", erin.token, { code: riverside.connectionCode });

// --- Availability for next week (incl. a two-stop day) ----------------------
const plumbers = await roster(bao, plumbingId);
const byName = (list: { id: string; name: string }[], name: string) => list.find((e) => e.name === name)!.id;
for (const offset of [0, 1, 2, 3, 4]) {
  for (const name of ["Mike Rivera", "Pete Alvarez", "Luis Ortega"]) {
    await call("post", "/availability", bao.token, { date: day(offset), startTime: "07:00", endTime: "15:30", allProjects: true, employeeId: byName(plumbers, name) });
  }
}
await call("post", "/availability", bao.token, { date: day(5), startTime: "06:00", endTime: "10:00", allProjects: true, employeeId: byName(plumbers, "Mike Rivera"), stopNumber: 1 });
await call("post", "/availability", bao.token, { date: day(5), startTime: "13:00", endTime: "17:00", allProjects: true, employeeId: byName(plumbers, "Mike Rivera"), stopNumber: 2 });
const electricians = await roster(erin, electricId);
for (const offset of [0, 2, 4]) {
  await call("post", "/availability", erin.token, { date: day(offset), startTime: "08:00", endTime: "16:00", allProjects: true, employeeId: byName(electricians, "Dev Patel") });
}

// --- Schedule requests: one confirmed, one pending, one declined -------------
const confirmed = await call("post", "/schedule-requests", gina.token, {
  projectId: riverside.id, subCompanyId: plumbingId, employeeIds: [byName(plumbers, "Mike Rivera"), byName(plumbers, "Pete Alvarez")],
  date: day(0), startTime: "07:00", endTime: "15:30", description: "Rough-in plumbing, level 2 restrooms",
});
await call("patch", `/schedule-requests/${confirmed.id}`, bao.token, { status: "confirmed" });
await call("post", "/schedule-requests", gina.token, {
  projectId: riverside.id, subCompanyId: plumbingId, employeeIds: [byName(plumbers, "Luis Ortega")],
  date: day(2), startTime: "07:00", endTime: "12:00", description: "Pipe insulation, mechanical room",
});
const declined = await call("post", "/schedule-requests", gina.token, {
  projectId: riverside.id, subCompanyId: electricId, employeeIds: [byName(electricians, "Dev Patel")],
  date: day(4), startTime: "08:00", endTime: "16:00", description: "Panel install, east wing",
});
await call("patch", `/schedule-requests/${declined.id}`, erin.token, { status: "rejected", statusReason: "Crew is on another job that day" });

// --- Tasks on the main project ----------------------------------------------
for (const [name, start, end, color, status] of [
  ["Site prep & layout", day(-7), day(-3), "#64748b", "complete"],
  ["Plumbing rough-in", day(0), day(4), "#0ea5e9", "in_progress"],
  ["Electrical rough-in", day(2), day(9), "#f59e0b", "pending"],
  ["Drywall", day(10), day(17), "#22c55e", "pending"],
] as const) {
  await query(gina.token, { table: "tasks", operation: "insert", data: { project_id: riverside.id, name, start_date: start, end_date: end, color, status } });
}

// --- Messages: project channel, a DM, and a group chat -----------------------
const ginaConvs = (await call("get", "/conversations", gina.token)).conversations as Json[];
const riversidePlumbing = ginaConvs.find((c) => c.projectId === riverside.id && c.subCompanyId === plumbingId)!;
await call("post", `/conversations/${riversidePlumbing.id}/messages`, gina.token, { body: "Inspector is coming Wednesday at 10. Can your crew have the level 2 rough-in ready?" });
await call("post", `/conversations/${riversidePlumbing.id}/messages`, bao.token, { body: "Yes, Mike and Pete are on it Monday and Tuesday." });
const dm = await call("post", "/conversations/dm", paul.token, { userId: mike.id });
await call("post", `/conversations/${dm.conversationId}/messages`, paul.token, { body: "Mike, can you send photos of the mechanical room when you're done?" });
await call("post", "/conversations/group", gina.token, { title: "Riverside coordination", userIds: [paul.id, bao.id, erin.id] });

const people = [gina, paul, bao, mike, pete, erin, dev];
console.log(`Demo database written to ${out}`);
console.log(`Password for every account: ${DEMO_PASSWORD}`);
for (const p of people) console.log(`  ${p.email.padEnd(28)} ${p.fullName}`);
process.exit(0);
