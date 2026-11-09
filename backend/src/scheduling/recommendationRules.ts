import { normalizeTrade } from "./taskTrades.js";

// Pure, deterministic rules. A future classifier can supply task.trade without
// changing any of the availability, employer, or send-time safeguards below.
export interface RecommendationTask { id: string; project_id: string; name: string; trade: string | null; start_date: string; end_date: string; status?: string }
export interface RecommendationSub { id: string; name: string; trade: string | null }
export interface AvailabilitySlot { employeeId: string; date: string; startTime: string; endTime: string; projectId: string | null; allProjects: boolean }
export interface ExistingScheduleRequest { id?: string; taskId?: string | null; projectId?: string; date: string; employeeIds: string[]; status: string; startTime?: string | null; endTime?: string | null }
export interface RecommendationCandidate extends RecommendationSub { employeeIds: string[]; startTime: string; endTime: string; workload: number }
export interface ScheduleRecommendation {
  id: string; taskId: string; taskName: string; date: string; trade: string | null;
  candidates: RecommendationCandidate[]; subId: string; subName: string; headcount: number; availableCount: number;
  reason: string | null; explanation: string; startTime: string; endTime: string;
  existingStatus?: string; nextAvailability?: { date: string; count: number };
}
const isoLocal = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const addDays = (value: Date, count: number) => { const result = new Date(value); result.setDate(result.getDate() + count); return result; };
export function recommendationWindow(weeks: number[], now = new Date()) {
  const start = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 1);
  const days = new Set<string>();
  [...new Set(weeks)].filter((week) => Number.isInteger(week) && week >= 1 && week <= 3).sort().forEach((week) => {
    for (let i = (week - 1) * 7; i < week * 7; i++) days.add(isoLocal(addDays(start, i)));
  });
  return { start: isoLocal(start), end: isoLocal(addDays(start, 20)), selectedDays: days };
}
export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validTime(value: unknown): value is string { return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
export function overlaps(start: string | null | undefined, end: string | null | undefined, otherStart: string | null | undefined, otherEnd: string | null | undefined) {
  // Legacy requests without both times reserve the day conservatively.
  return !start || !end || !otherStart || !otherEnd || (start < otherEnd && otherStart < end);
}
export function activeRequest(request: ExistingScheduleRequest) { return ["pending", "confirmed"].includes(request.status); }
export function eligibleEmployees(args: { employeeIds: string[]; projectId: string; date: string; startTime: string; endTime: string; availability: AvailabilitySlot[]; requests: ExistingScheduleRequest[] }): string[] {
  if (!validTime(args.startTime) || !validTime(args.endTime) || args.startTime >= args.endTime) return [];
  return [...new Set(args.employeeIds)].sort().filter((id) => {
    if (args.requests.some((r) => r.date === args.date && activeRequest(r) && r.employeeIds.includes(id) && overlaps(args.startTime, args.endTime, r.startTime, r.endTime))) return false;
    const slots = args.availability.filter((s) => s.employeeId === id && s.date === args.date && (s.allProjects || s.projectId === args.projectId) && validTime(s.startTime) && validTime(s.endTime) && s.startTime < s.endTime).sort((a, b) => a.startTime.localeCompare(b.startTime));
    // Contiguous stops may cover a shift; a gap never counts as availability.
    let covered = args.startTime;
    for (const slot of slots) {
      if (slot.startTime > covered) break;
      if (slot.endTime > covered) covered = slot.endTime;
      if (covered >= args.endTime) return true;
    }
    return false;
  });
}
export function assertRecommendationTradeMatch(taskTrade: string | null, subcontractorTrade: string | null) {
  if (!taskTrade) throw new Error("Review the task trade before sending this recommendation.");
  if (!subcontractorTrade || normalizeTrade(taskTrade) !== normalizeTrade(subcontractorTrade)) throw new Error(`The subcontractor trade does not match the task trade (${taskTrade}). Choose a matching subcontractor.`);
}
export function recommendationReason(trade: string | null, candidates: RecommendationCandidate[], subId: string, headcount: number): string | null {
  if (!trade) return "Needs review: choose a trade for this task.";
  if (!candidates.length) return `No ${trade} subcontractor is selected for this project. Choose a connected company or use Invite Subcontractor.`;
  const chosen = candidates.find((c) => c.id === subId);
  if (!chosen) return "Choose a matching subcontractor.";
  if (!chosen.employeeIds.length) return `No ${trade} workers are available during this time.`;
  if (!Number.isInteger(headcount) || headcount < 1) return "Choose a whole crew size of at least 1.";
  if (headcount > chosen.employeeIds.length) return `${chosen.employeeIds.length} of ${headcount} requested workers are available. Request ${chosen.employeeIds.length}, choose another subcontractor, or choose another date.`;
  return null;
}
export function buildScheduleRecommendations(args: {
  tasks: RecommendationTask[]; subs: RecommendationSub[]; selectedSubs: Pick<RecommendationSub, "id">[]; weeks: number[];
  availability: AvailabilitySlot[]; requests: ExistingScheduleRequest[]; employeesByCompany?: Record<string, string[]>; now?: Date;
  headcount?: number; startTime?: string; endTime?: string; date?: string;
}): ScheduleRecommendation[] {
  const { selectedDays } = recommendationWindow(args.weeks, args.now);
  const selectedIds = new Set(args.selectedSubs.map((s) => s.id));
  const selected = args.subs.filter((sub) => selectedIds.has(sub.id)); // Never trust a stale/unconnected selection.
  const startTime = args.startTime ?? "08:00", endTime = args.endTime ?? "16:00", headcount = args.headcount ?? 3;
  const results: ScheduleRecommendation[] = [];
  for (const task of args.tasks.filter((t) => t.status !== "complete")) {
    const dates = [...selectedDays].filter((d) => d >= task.start_date && d <= task.end_date);
    const date = args.date ?? dates[0];
    if (!date || date < task.start_date || date > task.end_date) continue;
    const matching = task.trade ? selected.filter((s) => normalizeTrade(s.trade) === normalizeTrade(task.trade)) : [];
    const candidatesOn = (day: string) => matching.map((sub): RecommendationCandidate => {
      const ids = args.employeesByCompany?.[sub.id] ?? [];
      const employeeIds = eligibleEmployees({ employeeIds: ids, projectId: task.project_id, date: day, startTime, endTime, availability: args.availability, requests: args.requests });
      const workload = args.requests.filter((r) => r.date === day && activeRequest(r)).reduce((count, r) => count + r.employeeIds.filter((id) => ids.includes(id)).length, 0);
      return { ...sub, employeeIds, startTime, endTime, workload };
    }).sort((a, b) => Number(b.employeeIds.length >= headcount) - Number(a.employeeIds.length >= headcount) || b.employeeIds.length - a.employeeIds.length || a.workload - b.workload || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const candidates = candidatesOn(date), chosen = candidates[0];
    const existing = args.requests.find((r) => r.taskId === task.id && r.date === date && activeRequest(r));
    let reason = existing ? `Already ${existing.status}: this task has a schedule request for this date. Review it in schedule requests.` : recommendationReason(task.trade, candidates, chosen?.id ?? "", headcount);
    if (!existing && task.trade && !args.subs.some((s) => normalizeTrade(s.trade) === normalizeTrade(task.trade))) reason = `No ${task.trade} subcontractor is connected to this project. Use Invite Subcontractor to connect a company.`;
    const rec: ScheduleRecommendation = {
      id: `${task.id}:${date}`, taskId: task.id, taskName: task.name, date, trade: task.trade, candidates,
      subId: chosen?.id ?? "", subName: chosen?.name ?? "", headcount, availableCount: chosen?.employeeIds.length ?? 0, startTime, endTime, reason,
      explanation: chosen ? `${chosen.name} matches the ${task.trade} trade and has ${chosen.employeeIds.length} workers available for the full requested time with no overlapping pending or confirmed requests. Companies that can supply your crew are listed first, then available crew count and current bookings.` : "Review the trade and connected subcontractors to continue.",
      existingStatus: existing?.status,
    };
    if (task.trade && matching.length && !chosen?.employeeIds.length && !existing) {
      for (const day of dates.filter((d) => d > date)) {
        const next = candidatesOn(day)[0];
        if (next?.employeeIds.length) { rec.nextAvailability = { date: day, count: next.employeeIds.length }; break; }
      }
    }
    results.push(rec);
  }
  return results;
}
export function recommendationCandidatesForTrade(rec: ScheduleRecommendation, trade: string | null) {
  return rec.candidates.filter((candidate) => normalizeTrade(candidate.trade) === normalizeTrade(trade));
}
