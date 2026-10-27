/**
 * The AI schedule recommender (docs/AI_SCHEDULE_RECOMMENDER.md). Deterministic first: everything with a right
 * answer (who is on the project, who is free, what's already requested, what crew sizes this GC uses) comes
 * from data. Only task names nothing else can place go to Claude, and anything still unsure becomes a
 * question for the GC, whose answer is remembered.
 *
 * It only proposes. Sending goes through POST /schedule-requests/batch with every normal rule.
 */
import crypto from "node:crypto";
import { database } from "../db.js";
import { findCompanyById, listCompanyEmployees } from "../rbac/models.js";
import type { Employee } from "../rbac/types.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../rbac/errors.js";
import { findUserRole } from "../rbac/models.js";
import { hasAtLeast } from "../rbac/permissions.js";
import { findProjectById, listActiveRequestsLiteBetween, listAvailabilityForCompany, listProjectConnections } from "../scheduling/models.js";
import { requireUserWithCompany } from "../scheduling/service.js";
import { addDays, dayLabel, spanOf, subtract, type Span } from "../scheduling/matrix.js";
import { isDateLocked } from "../scheduling/historicalLock.js";
import { TRADES, matchTaskToTrade, normaliseTaskName, tradeFromCompanyText } from "./trades.js";
import { classifyTasks, claudeConfigured } from "./claude.js";

export async function ensureAiTables(): Promise<void> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS ai_trade_answers (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      task_name TEXT NOT NULL,
      trade TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (company_id, task_name)
    )
  `);
}

// --- crew size: what a task usually needs when there's no history to go on ---
const CREW_HINTS: [RegExp, number][] = [
  [/framing|hang|board|drywall/, 4],
  [/concrete|pour|slab|footing|foundation/, 4],
  [/tape|finish|paint|prime/, 3],
  [/demo|demolition/, 3],
  [/electrical rough|wire|conduit/, 3],
  [/duct|sprinkler|rtu|rooftop/, 3],
  [/layout|vav|fixtures|trim|plumbing|flooring|tile|insulation|ceiling/, 2],
];
const defaultCrew = (taskName: string) => CREW_HINTS.find(([re]) => re.test(taskName.toLowerCase()))?.[1] ?? 2;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

export interface Suggestion {
  key: string;
  taskId: string;
  taskName: string;
  trade: string;
  /** How the trade was decided, and how the headcount was chosen: shown to the GC. */
  tradeReason: string;
  crewReason: string;
  projectId: string;
  subCompanyId: string;
  subName: string;
  date: string;
  startTime: string;
  endTime: string;
  suggestedCount: number;
  employees: { id: string; name: string; jobTitle: string | null; assigned: boolean }[];
  /** Other people free that day, for the GC's "+" button (same window). */
  alternates: { id: string; name: string; jobTitle: string | null; assigned: boolean }[];
}

export interface Question {
  taskName: string;
  /** Trades worth offering first (the project's subs), then the rest. */
  options: string[];
  suggested: string | null;
  why: string;
}

export interface Recommendation {
  window: { start: string; end: string };
  suggestions: Suggestion[];
  questions: Question[];
  notes: string[];
  claude: { configured: boolean; used: boolean };
}

async function requireGcScheduler(userId: string, projectId: string) {
  const user = await requireUserWithCompany(userId);
  const project = await findProjectById(projectId);
  if (!project || (project.companyId !== user.companyId && !user.isAdmin)) throw new NotFoundError("Project not found.");
  const role = await findUserRole(user.id, user.companyId!);
  if (!user.isAdmin && !(role && hasAtLeast(role.permissionLevel, "partial"))) {
    throw new ForbiddenError("You need Partial-level access or higher to schedule subcontractors.");
  }
  return { user, project };
}

async function learnedAnswers(companyId: string): Promise<Map<string, string>> {
  const rows = await database.all<{ task_name: string; trade: string }>("SELECT task_name, trade FROM ai_trade_answers WHERE company_id = ?", [companyId]);
  return new Map(rows.map((r) => [r.task_name, r.trade]));
}

/** Save the GC's answers to "which trade does this task?" so the next run (and every project) knows. */
export async function saveTradeAnswers(userId: string, projectId: string, answers: unknown) {
  const { user, project } = await requireGcScheduler(userId, projectId);
  if (!Array.isArray(answers)) throw new BadRequestError("answers must be a list.");
  const valid = new Set(TRADES.map((t) => t.trade));
  for (const a of answers as { taskName?: unknown; trade?: unknown }[]) {
    if (typeof a?.taskName !== "string" || typeof a.trade !== "string" || !valid.has(a.trade)) {
      throw new BadRequestError("Each answer needs a taskName and one of the listed trades.");
    }
    const name = normaliseTaskName(a.taskName);
    await database.run("DELETE FROM ai_trade_answers WHERE company_id = ? AND task_name = ?", [project.companyId, name]);
    await database.run("INSERT INTO ai_trade_answers (id, company_id, task_name, trade, created_by) VALUES (?, ?, ?, ?, ?)", [
      crypto.randomUUID(),
      project.companyId,
      name,
      a.trade,
      user.id,
    ]);
  }
  return { saved: (answers as unknown[]).length };
}

export async function recommend(userId: string, params: { projectId?: unknown; weeks?: unknown; today?: string }): Promise<Recommendation> {
  if (typeof params.projectId !== "string") throw new BadRequestError("projectId is required.");
  const weeks = Number(params.weeks ?? 1);
  if (![1, 2, 3].includes(weeks)) throw new BadRequestError("weeks must be 1, 2 or 3.");
  const { project } = await requireGcScheduler(userId, params.projectId);

  const today = params.today ?? new Date().toISOString().slice(0, 10);
  const start = addDays(today, 1);
  const end = addDays(start, weeks * 7 - 1);
  const notes: string[] = [];

  // 1. Subcontractors on the project, by trade.
  const subs: { id: string; name: string; trade: string | null; employees: Employee[] }[] = [];
  for (const conn of await listProjectConnections(project.id)) {
    const company = await findCompanyById(conn.subCompanyId);
    if (!company) continue;
    subs.push({ id: company.id, name: company.name, trade: tradeFromCompanyText(company.trade), employees: await listCompanyEmployees(company.id) });
  }
  const projectTrades = [...new Set(subs.map((s) => s.trade).filter((t): t is string => !!t))];
  if (!subs.length) notes.push("No subcontractors are connected to this project yet. Share its code so they can join.");

  // 2. The project's tasks in the window.
  const tasks = await database.all<{ id: string; name: string; start_date: string; end_date: string }>(
    "SELECT id, name, start_date, end_date FROM tasks WHERE project_id = ? AND start_date <= ? AND end_date >= ? ORDER BY start_date",
    [project.id, end, start],
  );
  if (!tasks.length) notes.push(`No schedule tasks fall between ${dayLabel(start)} and ${dayLabel(end)}. Add tasks or upload the schedule first.`);

  // 3. Task → trade: learned answers, the lookup list, the project's own trades, then Claude, then ask.
  const learned = await learnedAnswers(project.companyId);
  const decided = new Map<string, { trade: string; reason: string }>();
  const unsure = new Map<string, { suggested: string | null; why: string }>();
  for (const name of [...new Set(tasks.map((t) => t.name))]) {
    const m = matchTaskToTrade(name, learned);
    if (m.confidence === "learned") decided.set(name, { trade: m.trade!, reason: "You told us this trade before." });
    else if (m.confidence === "lookup") decided.set(name, { trade: m.trade!, reason: `"${m.matched}" is ${m.trade} work.` });
    else if (m.confidence === "ambiguous") {
      const onJob = m.alternatives.filter((t) => projectTrades.includes(t));
      if (onJob.length === 1) decided.set(name, { trade: onJob[0], reason: `"${name}" can be ${m.alternatives.join(" or ")}; ${onJob[0]} is the one on this project.` });
      else unsure.set(name, { suggested: onJob[0] ?? m.trade, why: `"${name}" can be ${m.alternatives.join(" or ")} work.` });
    } else unsure.set(name, { suggested: null, why: `"${name}" isn't on the lookup list.` });
  }
  let usedClaude = false;
  if (unsure.size && claudeConfigured()) {
    try {
      const answers = await classifyTasks([...unsure.keys()], projectTrades);
      usedClaude = answers.size > 0;
      for (const [name, a] of answers) {
        if (!unsure.has(name)) continue;
        if (a.trade && a.confident) {
          decided.set(name, { trade: a.trade, reason: `AI: ${a.reason}` });
          unsure.delete(name);
        } else unsure.set(name, { suggested: a.trade ?? unsure.get(name)!.suggested, why: a.trade ? `AI thinks ${a.trade} but isn't sure: ${a.reason}` : `AI couldn't place it: ${a.reason}` });
      }
    } catch (err) {
      console.error("Claude classification failed; asking the GC instead:", err);
      notes.push("The AI helper didn't respond, so unclear tasks are listed as questions.");
    }
  }
  const allTrades = TRADES.map((t) => t.trade);
  const questions: Question[] = [...unsure.entries()].map(([taskName, u]) => ({
    taskName,
    options: [...projectTrades, ...allTrades.filter((t) => !projectTrades.includes(t))],
    suggested: u.suggested,
    why: u.why,
  }));

  // 4. Free time: posted hours minus everything already requested or booked (any GC).
  const holds = new Map<string, Span[]>();
  const existing = await listActiveRequestsLiteBetween(start, end);
  for (const r of existing) {
    for (const id of r.employeeIds) holds.set(`${id}|${r.date}`, [...(holds.get(`${id}|${r.date}`) ?? []), spanOf(r.startTime, r.endTime)]);
  }
  const alreadyAsked = new Set(existing.filter((r) => r.projectId === project.id).map((r) => `${r.subCompanyId}|${r.date}`));
  const hours = new Map<string, Span[]>();
  for (const s of subs) {
    for (const a of await listAvailabilityForCompany(s.id, start, end)) {
      if (!a.allProjects && a.projectId && a.projectId !== project.id) continue;
      hours.set(`${a.employeeId}|${a.date}`, [...(hours.get(`${a.employeeId}|${a.date}`) ?? []), spanOf(a.startTime, a.endTime)]);
    }
  }
  const freeOf = (employeeId: string, date: string) =>
    (hours.get(`${employeeId}|${date}`) ?? []).flatMap((w) => subtract(w, holds.get(`${employeeId}|${date}`) ?? [])).filter((w) => w.start < w.end);

  // 5. Crew size history: what this GC asked each sub for on this project (and per trade) lately.
  const history = await database.all<{ sub_company_id: string; employee_ids: string }>(
    `SELECT sub_company_id, employee_ids FROM schedule_requests
      WHERE project_id = ? AND requesting_company_id = ? AND status IN ('pending', 'confirmed') AND date >= ?`,
    [project.id, project.companyId, addDays(today, -90)],
  );
  const sizesBySub = new Map<string, number[]>();
  for (const h of history) sizesBySub.set(h.sub_company_id, [...(sizesBySub.get(h.sub_company_id) ?? []), (JSON.parse(h.employee_ids) as string[]).length]);
  const assigned = new Set(
    (await database.all<{ employee_id: string }>("SELECT employee_id FROM employee_project_assignments WHERE project_id = ?", [project.id])).map((r) => r.employee_id),
  );

  // 6. Suggestions: one per task, day and matching sub.
  const suggestions: Suggestion[] = [];
  const missingTrade = new Set<string>();
  const nobodyFree: string[] = [];
  let skippedAsked = 0;
  for (const task of tasks) {
    const d = decided.get(task.name);
    if (!d) continue;
    const candidates = subs.filter((s) => s.trade === d.trade);
    if (!candidates.length) {
      missingTrade.add(`${d.trade} (${task.name})`);
      continue;
    }
    // Prefer the sub this GC already uses here, then the one with the most free people in the task's window.
    const freeCount = (s: (typeof subs)[number]) => s.employees.filter((e) => tasksDays(task, start, end).some((date) => freeOf(e.id, date).length)).length;
    const sub = [...candidates].sort((a, b) => (sizesBySub.has(b.id) ? 1 : 0) - (sizesBySub.has(a.id) ? 1 : 0) || freeCount(b) - freeCount(a))[0];
    const historic = median(sizesBySub.get(sub.id) ?? []);
    const wanted = historic ?? defaultCrew(task.name);
    const crewReason = historic ? `You usually request ${historic} from ${sub.name} here.` : `A typical ${task.name} crew is about ${wanted}.`;

    for (const date of tasksDays(task, start, end)) {
      if (isDateLocked(date)) continue;
      if (alreadyAsked.has(`${sub.id}|${date}`)) {
        skippedAsked++;
        continue;
      }
      const free = sub.employees
        .map((e) => {
          const windows = freeOf(e.id, date).sort((a, b) => minutes(b) - minutes(a));
          return { e, best: windows[0] };
        })
        .filter((x): x is { e: (typeof sub.employees)[number]; best: Span } => !!x.best && minutes(x.best) >= 120)
        .sort((a, b) => Number(assigned.has(b.e.id)) - Number(assigned.has(a.e.id)) || minutes(b.best) - minutes(a.best));
      if (!free.length) {
        nobodyFree.push(`${sub.name} on ${dayLabel(date)} (${task.name})`);
        continue;
      }
      // Everyone on one request shares the times: take the lead's window, keep the people it fits.
      const lead = free[0].best;
      const fitting = free.filter((x) => freeOf(x.e.id, date).some((w) => w.start <= lead.start && lead.end <= w.end));
      const count = Math.min(wanted, fitting.length);
      const picked = fitting.slice(0, count);
      const person = (x: (typeof fitting)[number]) => ({ id: x.e.id, name: x.e.name, jobTitle: x.e.jobTitle, assigned: assigned.has(x.e.id) });
      suggestions.push({
        key: `${task.id}|${sub.id}|${date}`,
        taskId: task.id,
        taskName: task.name,
        trade: d.trade,
        tradeReason: d.reason,
        crewReason: count < wanted ? `${crewReason} Only ${count} free that day.` : crewReason,
        projectId: project.id,
        subCompanyId: sub.id,
        subName: sub.name,
        date,
        startTime: lead.start,
        endTime: lead.end,
        suggestedCount: count,
        employees: picked.map(person),
        alternates: fitting.slice(count).map(person),
      });
      // Later tasks in this run can't use the same people at the same time.
      for (const x of picked) holds.set(`${x.e.id}|${date}`, [...(holds.get(`${x.e.id}|${date}`) ?? []), lead]);
    }
  }
  if (missingTrade.size) notes.push(`No subcontractor on this project for: ${[...missingTrade].join(", ")}. Invite one to include that work.`);
  if (nobodyFree.length) notes.push(`Nobody free (with at least 2 hours): ${nobodyFree.slice(0, 6).join("; ")}${nobodyFree.length > 6 ? ` and ${nobodyFree.length - 6} more` : ""}.`);
  if (skippedAsked) notes.push(`Skipped ${skippedAsked} day${skippedAsked === 1 ? "" : "s"} you've already requested.`);

  suggestions.sort((a, b) => a.date.localeCompare(b.date) || a.taskName.localeCompare(b.taskName));
  return { window: { start, end }, suggestions, questions, notes, claude: { configured: claudeConfigured(), used: usedClaude } };
}

const minutes = (w: Span) => {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return m(w.end) - m(w.start);
};

/** Weekdays of a task that fall in the window. */
function tasksDays(task: { start_date: string; end_date: string }, start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = task.start_date > start ? task.start_date : start; d <= task.end_date && d <= end; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00`).getDay();
    if (wd !== 0 && wd !== 6) out.push(d);
  }
  return out;
}
