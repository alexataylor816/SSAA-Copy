/**
 * Fills the app's own database (DB_CLIENT / MYSQL_* from backend/.env) with a
 * small, realistic data set for live demos, built through the real API so
 * every permission rule applies.
 *
 *   npx tsx scripts/seed-showcase.ts           # refuses if the database has users
 *   npx tsx scripts/seed-showcase.ts --wipe    # empties it first (back it up!)
 *
 * Two real inboxes carry the two points of view; everyone else is @example.com.
 * Password for every account: Test1234!
 */
const PASSWORD = "Test1234!";
const wipe = process.argv.includes("--wipe");

process.env.RESEND_API_KEY = "";
process.env.SMTP_USER = "";
process.env.SMTP_PASS = "";

const { createApp } = await import("../src/app.js");
const { database } = await import("../src/db.js");
const { default: request } = await import("supertest");
const { app } = await createApp();

type Json = Record<string, any>;

// --- Start from an empty database -------------------------------------------
const existing = (await database.get<{ n: number }>("SELECT COUNT(*) AS n FROM users"))!.n;
if (Number(existing) > 0) {
  if (!wipe) {
    console.error(`The database already has ${existing} user(s). Back it up, then rerun with --wipe.`);
    process.exit(1);
  }
  const tables = (
    database.dialect === "mysql"
      ? await database.all<{ name: string }>(
          "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
        )
      : await database.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
  ).filter((t) => t.name !== "notification_templates"); // the app's built-in wording, not anyone's data
  await database.execScript(
    database.dialect === "mysql"
      ? ["SET FOREIGN_KEY_CHECKS=0;", ...tables.map((t) => `TRUNCATE TABLE \`${t.name}\`;`), "SET FOREIGN_KEY_CHECKS=1;"].join("\n")
      : tables.map((t) => `DELETE FROM "${t.name}";`).join("\n"),
  );
  console.log(`Emptied ${tables.length} tables.`);
}

// --- Helpers ---------------------------------------------------------------
async function call(method: "get" | "post" | "patch", url: string, token?: string, body?: Json): Promise<Json> {
  let req = request(app)[method](url);
  if (token) req = req.set("Authorization", `Bearer ${token}`);
  const res = await (body ? req.send(body) : req);
  if (res.status >= 400) throw new Error(`${method.toUpperCase()} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const query = (token: string, body: Json) => call("post", "/query", token, body);

async function person(email: string, fullName: string) {
  const res = await call("post", "/auth/signup", undefined, { email, password: PASSWORD, fullName });
  return { token: res.token as string, id: res.user.id as string, email, fullName };
}
type Person = Awaited<ReturnType<typeof person>>;

async function company(owner: Person, name: string, companyType: "gc" | "sub", address: string | null, trade?: string) {
  return (await call("post", "/companies", owner.token, { name, companyType, address, trade })).company.id as string;
}

async function join(owner: Person, companyId: string, member: Person, permissionLevel: string) {
  await call("post", `/companies/${companyId}/join-requests`, member.token);
  const { requests } = await call("get", `/companies/${companyId}/join-requests`, owner.token);
  const mine = requests.find((r: Json) => r.userEmail === member.email);
  await call("post", `/companies/${companyId}/join-requests/${mine.id}/approve`, owner.token, { permissionLevel });
}

async function roster(owner: Person, companyId: string) {
  return (await call("get", `/companies/${companyId}/employees`, owner.token)).employees as { id: string; name: string }[];
}
async function titles(owner: Person, companyId: string, byName: Record<string, string>) {
  for (const e of await roster(owner, companyId)) {
    if (byName[e.name]) {
      await query(owner.token, { table: "employees", operation: "update", data: { job_title: byName[e.name] }, filters: [{ op: "eq", column: "id", value: e.id }] });
    }
  }
}
const idOf = (list: { id: string; name: string }[], name: string) => list.find((e) => e.name === name)!.id;

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monday = (() => {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); // next Monday: always open for booking
  return d;
})();
const day = (offset: number) => {
  const d = new Date(monday);
  d.setDate(d.getDate() + offset);
  return iso(d);
};

// --- General contractor: your GC point of view ------------------------------
const gc = await person("bnguye26@umd.edu", "Testudo B");
const gcId = await company(gc, "Terrapin Builders", "gc", "7500 Baltimore Ave, College Park, MD");
const paul = await person("paul.kim@example.com", "Paul Kim");
await join(gc, gcId, paul, "partial");
await titles(gc, gcId, { "Testudo B": "Owner", "Paul Kim": "Project Manager" });

const riverside = await call("post", "/projects", gc.token, { name: "Riverside Office Build", address: "4100 River Rd, College Park, MD" });
const mainSt = await call("post", "/projects", gc.token, { name: "Main St Retail Fit-Out", address: "120 Main St, Hyattsville, MD" });
// Bao Plumbing is deliberately NOT on this one: it joins live in the demo with the invite link or code.
const elmSt = await call("post", "/projects", gc.token, { name: "Elm Street Clinic Renovation", address: "45 Elm St" });

// --- Plumbing sub: your subcontractor point of view -------------------------
const sub = await person("baotn.it@gmail.com", "Bao Nguyen");
const plumbingId = await company(sub, "Bao Plumbing", "sub", "2100 University Blvd, Hyattsville, MD", "Plumbing");
const mike = await person("mike.rivera@example.com", "Mike Rivera");
const pete = await person("pete.alvarez@example.com", "Pete Alvarez");
await join(sub, plumbingId, mike, "level_1");
await join(sub, plumbingId, pete, "basic");
await query(sub.token, { table: "employees", operation: "insert", data: { company_id: plumbingId, name: "Luis Ortega", job_title: "Apprentice Plumber" } });
await titles(sub, plumbingId, { "Bao Nguyen": "Owner", "Mike Rivera": "Foreman", "Pete Alvarez": "Journeyman Plumber" });
await call("patch", "/auth/profile", mike.token, { employeeNumber: "BP-102", phone: "301-555-0142" });
await call("patch", "/auth/profile", pete.token, { employeeNumber: "BP-117" });
await call("post", "/projects/connect", sub.token, { code: riverside.connectionCode });
await call("post", "/projects/connect", sub.token, { code: mainSt.connectionCode });

// --- Drywall sub --------------------------------------------------------------
const dana = await person("dana.brooks@example.com", "Dana Brooks");
const drywallId = await company(dana, "Capitol Drywall", "sub", null, "Drywall");
const marco = await person("marco.diaz@example.com", "Marco Diaz");
await join(dana, drywallId, marco, "basic");
await titles(dana, drywallId, { "Dana Brooks": "Owner", "Marco Diaz": "Drywall Hanger" });
await call("post", "/projects/connect", dana.token, { code: riverside.connectionCode });

// --- Electrical sub -----------------------------------------------------------
const erin = await person("erin.walsh@example.com", "Erin Walsh");
const electricId = await company(erin, "Volt Electric", "sub", null, "Electrical");
const dev = await person("dev.patel@example.com", "Dev Patel");
await join(erin, electricId, dev, "partial");
await titles(erin, electricId, { "Erin Walsh": "Owner", "Dev Patel": "Electrician" });
await call("post", "/projects/connect", erin.token, { code: riverside.connectionCode });
await call("post", "/projects/connect", erin.token, { code: mainSt.connectionCode });
await call("post", "/projects/connect", erin.token, { code: elmSt.connectionCode });

// --- Availability next week (Tuesday left open for a live booking) -----------
const plumbers = await roster(sub, plumbingId);
for (const offset of [0, 1, 2, 3, 4]) {
  for (const name of ["Mike Rivera", "Pete Alvarez", "Luis Ortega"]) {
    await call("post", "/availability", sub.token, { date: day(offset), startTime: "07:00", endTime: "15:30", allProjects: true, employeeId: idOf(plumbers, name) });
  }
}
// Mike at two sites on Saturday: Multiple Stops.
await call("post", "/availability", sub.token, { date: day(5), startTime: "06:00", endTime: "10:00", allProjects: true, employeeId: idOf(plumbers, "Mike Rivera"), stopNumber: 1 });
await call("post", "/availability", sub.token, { date: day(5), startTime: "13:00", endTime: "17:00", allProjects: true, employeeId: idOf(plumbers, "Mike Rivera"), stopNumber: 2 });

const drywall = await roster(dana, drywallId);
for (const offset of [1, 2, 3, 4]) {
  await call("post", "/availability", dana.token, { date: day(offset), startTime: "07:00", endTime: "15:00", allProjects: true, employeeId: idOf(drywall, "Marco Diaz") });
}
const electricians = await roster(erin, electricId);
for (const offset of [0, 2, 4]) {
  await call("post", "/availability", erin.token, { date: day(offset), startTime: "08:00", endTime: "16:00", allProjects: true, employeeId: idOf(electricians, "Dev Patel") });
}

// --- Schedule requests: one of each status -------------------------------------
const confirmed = await call("post", "/schedule-requests", gc.token, {
  projectId: riverside.id, subCompanyId: plumbingId, employeeIds: [idOf(plumbers, "Mike Rivera"), idOf(plumbers, "Pete Alvarez")],
  date: day(0), startTime: "07:00", endTime: "15:30", description: "Rough-in plumbing, level 2 restrooms",
});
await call("patch", `/schedule-requests/${confirmed.id}`, sub.token, { status: "confirmed" });
// Waiting on Bao Plumbing: confirm it live from the sub's point of view.
await call("post", "/schedule-requests", gc.token, {
  projectId: riverside.id, subCompanyId: plumbingId, employeeIds: [idOf(plumbers, "Luis Ortega")],
  date: day(2), startTime: "07:00", endTime: "12:00", description: "Pipe insulation, mechanical room",
});
const drywallJob = await call("post", "/schedule-requests", gc.token, {
  projectId: riverside.id, subCompanyId: drywallId, employeeIds: [idOf(drywall, "Marco Diaz")],
  date: day(3), startTime: "07:00", endTime: "15:00", description: "Hang board, 2nd floor corridor",
});
await call("patch", `/schedule-requests/${drywallJob.id}`, dana.token, { status: "confirmed" });
const declined = await call("post", "/schedule-requests", gc.token, {
  projectId: mainSt.id, subCompanyId: electricId, employeeIds: [idOf(electricians, "Dev Patel")],
  date: day(4), startTime: "08:00", endTime: "16:00", description: "Panel install, east wall",
});
await call("patch", `/schedule-requests/${declined.id}`, erin.token, { status: "rejected", statusReason: "Crew is on another job that day" });

// --- Tasks on Riverside ---------------------------------------------------------
for (const [name, start, end, color, status] of [
  ["Site prep & layout", day(-7), day(-3), "#64748b", "complete"],
  ["Plumbing rough-in", day(0), day(4), "#0ea5e9", "in_progress"],
  ["Electrical rough-in", day(2), day(9), "#f59e0b", "pending"],
  ["Drywall hang & finish", day(3), day(14), "#22c55e", "pending"],
] as const) {
  await query(gc.token, { table: "tasks", operation: "insert", data: { project_id: riverside.id, name, start_date: start, end_date: end, color, status } });
}

// --- Messages -------------------------------------------------------------------
const convs = (await call("get", "/conversations", gc.token)).conversations as Json[];
const channel = (projectId: string, subId: string) => convs.find((c) => c.projectId === projectId && c.subCompanyId === subId)!.id;
const riversidePlumbing = channel(riverside.id, plumbingId);
await call("post", `/conversations/${riversidePlumbing}/messages`, gc.token, { body: "Inspector is coming Wednesday at 10. Can your crew have the level 2 rough-in ready?" });
await call("post", `/conversations/${riversidePlumbing}/messages`, sub.token, { body: "Yes, Mike and Pete are on it Monday. I'll confirm Luis for Wednesday." });
await call("post", `/conversations/${channel(riverside.id, drywallId)}/messages`, dana.token, { body: "Board delivery is set for Wednesday afternoon." });
const dm = await call("post", "/conversations/dm", paul.token, { userId: mike.id });
await call("post", `/conversations/${dm.conversationId}/messages`, paul.token, { body: "Mike, can you send photos of the mechanical room when you're done?" });
const group = await call("post", "/conversations/group", gc.token, { title: "Riverside coordination", userIds: [paul.id, sub.id, dana.id, erin.id] });
await call("post", `/conversations/${group.conversationId ?? group.id}/messages`, gc.token, { body: "Weekly sync Friday 7am at the trailer." });

// --- One person waiting to join Bao Plumbing (approve it from the sub's view) ----
const sam = await person("sam.okafor@example.com", "Sam Okafor");
await call("post", `/companies/${plumbingId}/join-requests`, sam.token);

const everyone = [gc, paul, sub, mike, pete, dana, marco, erin, dev, sam];
console.log(`Demo data ready. Password for every account: ${PASSWORD}`);
console.log(`Elm Street Clinic Renovation (Bao Plumbing joins live): code ${elmSt.connectionCode}`);
console.log(`Dates: Monday ${day(0)}, Wednesday ${day(2)}, Saturday ${day(5)}`);
for (const p of everyone) console.log(`  ${p.email.padEnd(26)} ${p.fullName}`);
process.exit(0);
