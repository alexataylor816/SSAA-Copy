/**
 * The bigger test world on top of the showcase scenario (seed-showcase.ts calls this unless --small):
 * more GCs and projects, a dozen trade subcontractors with real-sized crews, a month of availability
 * (with split "stops"), task schedules per project coloured by trade, and a spread of requests in every
 * state. Built through the real API where rules matter (requests), directly where they don't (bulk hours).
 *
 * Deterministic: a fixed random seed, so every reset produces the same data.
 * The showcase people (Greg, Steve, Mike, Pete, Luis, Marco, Dev…) are left alone so the scripted demo
 * keeps working; the generated crews are separate.
 */
import { createAvailabilityRow } from "../src/scheduling/models.js";
import { colorForTrade, matchTaskToTrade } from "../src/ai/trades.js";

type Json = Record<string, any>;
type Person = { token: string; id: string; email: string; fullName: string };

export interface BulkContext {
  call: (method: "get" | "post" | "patch" | "put", url: string, token?: string, body?: Json) => Promise<Json>;
  query: (token: string, body: Json) => Promise<Json>;
  person: (email: string, fullName: string) => Promise<Person>;
  company: (owner: Person, name: string, companyType: "gc" | "sub", address: string | null, trade?: string) => Promise<string>;
  join: (owner: Person, companyId: string, member: Person, permissionLevel: string) => Promise<void>;
  roster: (owner: Person, companyId: string) => Promise<{ id: string; name: string }[]>;
  day: (offset: number) => string;
  /** Terrapin Builders (GC Greg) and its showcase projects; Elm Street stays unjoined for the live demo. */
  gc: Person;
  gcProjects: Json[];
  elmStId: string;
  /** The showcase subs, which get extra generated crew. */
  showcaseSubs: { owner: Person; companyId: string; trade: string }[];
  /** People the scripted demo depends on: never scheduled by the generator. */
  reservedEmployeeIds: Set<string>;
}

// --- deterministic randomness -------------------------------------------------
let seed = 20261023;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
const chance = (p: number) => rand() < p;
const shuffle = <T>(list: T[]) => list.map((v) => [rand(), v] as const).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

const FIRST = ["Alex", "Jordan", "Carlos", "Miguel", "Tyrone", "Kevin", "Luis", "Andre", "Jose", "Brian", "Darnell", "Hector", "Sean", "Victor", "Omar", "Ray", "Eddie", "Marcus", "Nate", "Tony", "Javier", "Derek", "Chris", "Sam", "Ricky", "Felipe", "Trevor", "Mason", "Diego", "Kofi", "Ivan", "Paolo", "Wes", "Grant", "Hugo", "Isaac", "Lamar", "Owen", "Rafael", "Yusuf"];
const LAST = ["Santos", "Nguyen", "Johnson", "Martinez", "Brooks", "Reyes", "Coleman", "Walsh", "Okafor", "Patel", "Kim", "Romero", "Fischer", "Murphy", "Diaz", "Bennett", "Hayes", "Lopez", "Grant", "Ward", "Castillo", "Price", "Sullivan", "Morales", "Foster", "Rivera", "Chavez", "Powell", "Torres", "Hughes"];
let nameIx = 0;
const usedNames = new Set<string>();
function newName(): string {
  for (;;) {
    const n = `${FIRST[(nameIx * 7 + int(0, 39)) % FIRST.length]} ${LAST[(nameIx * 3 + int(0, 29)) % LAST.length]}`;
    nameIx++;
    if (!usedNames.has(n)) {
      usedNames.add(n);
      return n;
    }
  }
}

// The order work happens on a commercial fit-out, with a typical duration in working days.
const TASK_SEQUENCE: [string, number][] = [
  ["Demo", 3],
  ["Layout", 2],
  ["Framing", 6],
  ["Plumbing Rough-In", 5],
  ["Duct Install", 5],
  ["Electrical Rough-In", 6],
  ["VAV Install", 3],
  ["Sprinkler Install", 4],
  ["Insulation", 2],
  ["Hang Drywall", 5],
  ["Tape and Finish", 5],
  ["Ceiling Grid", 3],
  ["Prime and Paint", 4],
  ["Electrical Trim", 3],
  ["Plumbing Fixtures", 2],
  ["Flooring", 4],
  ["Punch List", 3],
];
const GROUND_UP: [string, number][] = [
  ["Site Prep", 3],
  ["Footings", 4],
  ["Underground Plumbing", 3],
  ["Pour Slab on Grade", 2],
  ["Framing", 8],
  ["Rooftop Unit Set", 2],
  ["Electrical Rough-In", 6],
  ["Plumbing Rough-In", 5],
  ["Ductwork", 6],
  ["Sprinkler Rough-In", 4],
  ["Hang Drywall", 6],
  ["Tape and Finish", 5],
  ["Paint", 5],
  ["Flooring", 4],
];

export async function seedBulk(ctx: BulkContext) {
  const { call, query, person, company, join, roster, day } = ctx;
  const summary = { gcs: 1, projects: ctx.gcProjects.length, subs: ctx.showcaseSubs.length, employees: 0, availability: 0, tasks: 0, requests: 0 };

  // ---------- GCs and projects ----------
  const gcs: { owner: Person; companyId: string | null; projects: Json[] }[] = [{ owner: ctx.gc, companyId: null, projects: [...ctx.gcProjects] }];
  for (const name of ["Hyattsville Library Expansion", "College Park Dental Office", "Route 1 Mixed-Use Tower"]) {
    gcs[0].projects.push(await call("post", "/projects", ctx.gc.token, { name, address: `${int(100, 9800)} Baltimore Ave, MD` }));
  }
  const otherGcs = [
    { owner: ["rachel.chen@example.com", "Rachel Chen"], pm: ["owen.price@example.com", "Owen Price"], company: "Chesapeake Construction Group", projects: ["Annapolis Harbor Offices", "Bowie Town Center Retail", "Laurel Senior Living"] },
    { owner: ["marcus.bell@example.com", "Marcus Bell"], pm: ["lena.hughes@example.com", "Lena Hughes"], company: "Beltway General Contracting", projects: ["Silver Spring Lab Fit-Out", "Greenbelt School Addition", "Rockville Medical Pavilion"] },
  ];
  for (const g of otherGcs) {
    const owner = await person(g.owner[0], g.owner[1]);
    const companyId = await company(owner, g.company, "gc", `${int(100, 900)} Commerce Dr, MD`);
    const pm = await person(g.pm[0], g.pm[1]);
    await join(owner, companyId, pm, "partial");
    const projects = [];
    for (const name of g.projects) projects.push(await call("post", "/projects", owner.token, { name, address: `${int(10, 990)} Main St, MD` }));
    gcs.push({ owner, companyId, projects });
    summary.gcs++;
  }
  const allProjects = gcs.flatMap((g) => g.projects.map((p) => ({ ...p, gc: g.owner })));
  summary.projects = allProjects.length;

  // ---------- trade subcontractors with crews ----------
  const subSpecs = [
    { owner: ["hannah.ortiz@example.com", "Hannah Ortiz"], name: "Arctic Air HVAC", trade: "HVAC", titles: ["HVAC Technician", "Sheet Metal Mechanic"], crew: 10 },
    { owner: ["greg.lyons@example.com", "Greg Lyons"], name: "Keystone Framing & Drywall", trade: "Drywall", titles: ["Drywall Technician", "Framer"], crew: 12 },
    { owner: ["nina.ford@example.com", "Nina Ford"], name: "Blue Line Fire Protection", trade: "Fire Protection", titles: ["Sprinkler Fitter"], crew: 7 },
    { owner: ["paulo.reyes@example.com", "Paulo Reyes"], name: "Precision Painting", trade: "Painting", titles: ["Painter"], crew: 8 },
    { owner: ["dwayne.carter@example.com", "Dwayne Carter"], name: "Summit Concrete", trade: "Concrete", titles: ["Concrete Finisher", "Laborer"], crew: 9 },
    { owner: ["irene.walsh@example.com", "Irene Walsh"], name: "Potomac Demolition", trade: "Demolition", titles: ["Demo Laborer"], crew: 7 },
    { owner: ["kwame.asante@example.com", "Kwame Asante"], name: "Bright Spark Electric", trade: "Electrical", titles: ["Electrician", "Apprentice Electrician"], crew: 11 },
    { owner: ["sofia.marino@example.com", "Sofia Marino"], name: "Capitol Flooring", trade: "Flooring", titles: ["Flooring Installer", "Tile Setter"], crew: 6 },
    { owner: ["ben.oneal@example.com", "Ben O'Neal"], name: "Liberty Mechanical", trade: "HVAC", titles: ["HVAC Technician", "Pipefitter"], crew: 8 },
  ];
  const subs: { owner: Person; companyId: string; trade: string; crew: { id: string; name: string }[]; projectIds: string[] }[] = [];

  const addCrew = async (owner: Person, companyId: string, trade: string, titles: string[], count: number) => {
    const counters = new Map<string, number>();
    for (let i = 0; i < count; i++) {
      const title = i === 0 ? "Foreman" : pick(titles);
      const n = (counters.get(title) ?? 0) + 1;
      counters.set(title, n);
      await query(owner.token, { table: "employees", operation: "insert", data: { company_id: companyId, name: newName(), job_title: title } });
    }
    summary.employees += count;
  };

  for (const s of subSpecs) {
    const owner = await person(s.owner[0], s.owner[1]);
    const companyId = await company(owner, s.name, "sub", `${int(100, 9900)} Industrial Pkwy, MD`, s.trade);
    await addCrew(owner, companyId, s.trade, s.titles, s.crew);
    subs.push({ owner, companyId, trade: s.trade, crew: [], projectIds: [] });
    summary.subs++;
  }
  // Bigger crews for the showcase subs too, so their side panels are realistic.
  const extra: Record<string, [string[], number]> = { Plumbing: [["Plumbing Technician", "Pipefitter"], 5], Drywall: [["Drywall Technician"], 8], Electrical: [["Electrician"], 6] };
  for (const s of ctx.showcaseSubs) {
    const [titles, count] = extra[s.trade] ?? [["Technician"], 4];
    for (let i = 0; i < count; i++) {
      await query(s.owner.token, { table: "employees", operation: "insert", data: { company_id: s.companyId, name: newName(), job_title: pick(titles) } });
    }
    summary.employees += count;
    subs.push({ owner: s.owner, companyId: s.companyId, trade: s.trade, crew: [], projectIds: [] });
  }

  // ---------- who works where ----------
  for (const s of subs) {
    const isShowcase = ctx.showcaseSubs.some((x) => x.companyId === s.companyId);
    // Showcase subs keep their scripted projects and pick up a couple at the other GCs.
    const candidates = allProjects.filter((p) => p.id !== ctx.elmStId && (!isShowcase || !ctx.gcProjects.some((g) => g.id === p.id)));
    for (const p of shuffle(candidates).slice(0, isShowcase ? 2 : int(3, 6))) {
      await call("post", "/projects/connect", s.owner.token, { code: p.connectionCode });
      s.projectIds.push(p.id);
    }
    if (isShowcase) {
      const mine = (await call("get", "/projects", s.owner.token)).projects as Json[];
      s.projectIds = [...new Set([...s.projectIds, ...mine.map((p) => p.id)])];
    }
    s.crew = (await roster(s.owner, s.companyId)).filter((e) => !ctx.reservedEmployeeIds.has(e.id) && e.name !== s.owner.fullName);
    // Each project gets most of the crew assigned; a few people float (they get the red outline elsewhere).
    for (const pid of s.projectIds) {
      const assigned = s.crew.filter(() => chance(0.65)).map((e) => e.id);
      const current = isShowcase ? ((await call("get", `/projects/${pid}/assignments`, s.owner.token)).employeeIds as string[]) : [];
      await call("put", `/projects/${pid}/assignments`, s.owner.token, { employeeIds: [...new Set([...current, ...assigned])] });
    }
  }

  // ---------- a month of availability (this week through three weeks after next) ----------
  type Window = { start: string; end: string; stop: number | null };
  const hours = new Map<string, Window[]>(); // `${employeeId}|${date}`
  const firstDay = -7;
  const lastDay = 20;
  for (const s of subs) {
    for (const e of s.crew) {
      const early = chance(0.4);
      for (let off = firstDay; off <= lastDay; off++) {
        const date = day(off);
        const weekday = new Date(`${date}T00:00:00`).getDay();
        let windows: Window[] = [];
        if (weekday >= 1 && weekday <= 5) {
          if (chance(0.08)) continue; // a day off
          if (chance(0.1)) {
            windows = [
              { start: early ? "05:00" : "06:00", end: "10:00", stop: 1 },
              { start: "11:00", end: early ? "14:00" : "15:30", stop: 2 },
            ];
          } else windows = [{ start: early ? "06:00" : "07:00", end: early ? "14:30" : "15:30", stop: null }];
        } else if (weekday === 6 && chance(0.2)) windows = [{ start: "07:00", end: "12:00", stop: null }];
        for (const w of windows) {
          await createAvailabilityRow({
            employeeId: e.id,
            projectId: null,
            date,
            startTime: w.start,
            endTime: w.end,
            allProjects: true,
            stopNumber: w.stop,
            stopLabel: w.stop ? `Stop #${w.stop}` : null,
          });
          summary.availability++;
        }
        if (windows.length) hours.set(`${e.id}|${date}`, windows);
      }
    }
  }

  // ---------- task schedules, coloured by trade ----------
  const tasksByProject = new Map<string, { name: string; start: string; end: string; trade: string | null }[]>();
  for (const p of allProjects) {
    const groundUp = /Tower|Pavilion|Living|Addition|School/.test(p.name);
    const template = groundUp ? GROUND_UP : TASK_SEQUENCE;
    let cursor = int(-12, 2); // projects are at different stages
    const list: { name: string; start: string; end: string; trade: string | null }[] = [];
    for (const [name, duration] of template) {
      if (!groundUp && chance(0.15)) continue; // not every job has every scope
      const start = cursor;
      const end = start + Math.max(1, duration + int(-1, 2)) - 1;
      const trade = matchTaskToTrade(name).trade;
      list.push({ name, start: day(start), end: day(end), trade });
      await query(p.gc.token, {
        table: "tasks",
        operation: "insert",
        data: {
          project_id: p.id,
          name,
          start_date: day(start),
          end_date: day(end),
          color: colorForTrade(trade),
          status: end < 0 ? "complete" : start <= 0 ? "in_progress" : "pending",
        },
      });
      summary.tasks++;
      cursor = start + Math.max(1, Math.round(duration * 0.6)); // trades overlap like real jobs
    }
    tasksByProject.set(p.id, list);
  }

  // ---------- requests: GCs ask the right trade for the work on the schedule ----------
  const taken = new Map<string, { start: string; end: string }[]>();
  const isFree = (emp: string, date: string, w: { start: string; end: string }) =>
    !(taken.get(`${emp}|${date}`) ?? []).some((t) => t.start < w.end && w.start < t.end);
  const hold = (emp: string, date: string, w: { start: string; end: string }) =>
    taken.set(`${emp}|${date}`, [...(taken.get(`${emp}|${date}`) ?? []), w]);

  const gcOf = new Map(allProjects.map((p) => [p.id, p.gc]));
  for (const p of allProjects) {
    const gcToken = gcOf.get(p.id)!.token;
    for (const task of tasksByProject.get(p.id) ?? []) {
      const trade = task.trade;
      const onSite = subs.filter((s) => s.projectIds.includes(p.id) && (s.trade === trade || (!trade && false)));
      if (!onSite.length) continue;
      const s = pick(onSite);
      for (let off = firstDay; off <= Math.min(lastDay, 13); off++) {
        const date = day(off);
        if (date < task.start || date > task.end) continue;
        if (!chance(0.7)) continue;
        const crew = shuffle(s.crew).filter((e) => (hours.get(`${e.id}|${date}`) ?? []).some((w) => isFree(e.id, date, w)));
        const people = crew.slice(0, int(1, 4));
        if (!people.length) continue;
        // Everyone on one request shares the times: use the first person's first free window.
        const w = (hours.get(`${people[0].id}|${date}`) ?? []).find((x) => isFree(people[0].id, date, x))!;
        const fits = people.filter((e) => (hours.get(`${e.id}|${date}`) ?? []).some((x) => x.start <= w.start && w.end <= x.end && isFree(e.id, date, w)));
        if (!fits.length) continue;
        const res = await call("post", "/schedule-requests/batch", gcToken, {
          create: [{ projectId: p.id, subCompanyId: s.companyId, employeeIds: fits.map((e) => e.id), date, startTime: w.start, endTime: w.end, description: task.name }],
          cancel: [],
          notify: { gcEmail: false, gcPush: false, personnelEmail: false, personnelPush: false },
        });
        if (!res.created?.length) continue;
        for (const e of fits) hold(e.id, date, w);
        summary.requests++;
        const id = res.created[0].requestId;
        // The sub answers most of them; the rest stay pending for the demo.
        const r = rand();
        if (r < 0.6) await call("patch", `/schedule-requests/${id}`, s.owner.token, { status: "confirmed" }).catch(() => undefined);
        else if (r < 0.68) await call("patch", `/schedule-requests/${id}`, s.owner.token, { status: "rejected", statusReason: "Crew is committed elsewhere" }).catch(() => undefined);
      }
    }
  }

  // ---------- subs sending idle crew without a request (shows as "Edited" to the GC) ----------
  for (const s of subs.filter(() => chance(0.7))) {
    for (let i = 0; i < 3; i++) {
      const off = int(0, 9);
      const date = day(off);
      const e = pick(s.crew);
      const w = (hours.get(`${e?.id}|${date}`) ?? []).find((x) => isFree(e.id, date, x));
      if (!e || !w || !s.projectIds.length) continue;
      const projectId = pick(s.projectIds);
      const res = await call("post", "/schedule-requests/batch", s.owner.token, {
        create: [{ projectId, subCompanyId: s.companyId, employeeIds: [e.id], date, startTime: w.start, endTime: w.end }],
        cancel: [],
        allowUnassigned: true,
      }).catch(() => null);
      if (res?.created?.length) {
        hold(e.id, date, w);
        summary.requests++;
      }
    }
  }

  return summary;
}
