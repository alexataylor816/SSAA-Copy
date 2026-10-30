import { normalizeTrade } from "./taskTrades";
import type { Task } from "./tasks";

export interface RecommendationSub { id: string; name: string; trade: string | null }
export interface AvailabilitySlot { employeeId: string; companyId?: string; date: string; startTime: string; endTime: string; projectId: string | null; allProjects: boolean }
export interface ExistingScheduleRequest { date: string; employeeIds: string[]; status: string; startTime?: string | null; endTime?: string | null }
export interface RecommendationCandidate extends RecommendationSub { employeeIds: string[]; startTime: string | null; endTime: string | null }
export interface ScheduleRecommendation {
  id: string; taskId: string; taskName: string; date: string; trade: string | null;
  candidates: RecommendationCandidate[]; subId: string; subName: string; headcount: number; reason: string | null;
  startTime: string | null; endTime: string | null;
}

const isoLocal = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const addDays = (value: Date, count: number) => { const result = new Date(value); result.setDate(result.getDate() + count); return result; };

export function recommendationWindow(weeks: number[], now = new Date()) {
  const start = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 1);
  const days = new Set<string>();
  weeks.forEach((week) => { for (let i = (week - 1) * 7; i < week * 7; i++) days.add(isoLocal(addDays(start, i))); });
  return { start: isoLocal(start), end: isoLocal(addDays(start, 20)), selectedDays: days };
}

export function assertRecommendationTradeMatch(taskTrade: string | null, subcontractorTrade: string | null): void {
  if (!taskTrade) throw new Error("Confirm the task trade before sending this recommendation.");
  if (!subcontractorTrade || normalizeTrade(taskTrade) !== normalizeTrade(subcontractorTrade)) {
    throw new Error(`The selected subcontractor's trade (${subcontractorTrade || "not set"}) does not match the task trade (${taskTrade}). Choose a matching subcontractor.`);
  }
}

export function buildScheduleRecommendations(args: {
  tasks: Task[]; subs: RecommendationSub[]; selectedSubs: RecommendationSub[]; weeks: number[];
  availability: AvailabilitySlot[]; requests: ExistingScheduleRequest[]; employeesByCompany?: Record<string, string[]>; now?: Date;
}): ScheduleRecommendation[] {
  const { start, selectedDays } = recommendationWindow(args.weeks, args.now);
  const subsById = new Map(args.subs.map((sub) => [sub.id, sub]));
  const selected = args.selectedSubs.map((sub) => subsById.get(sub.id) ?? sub);
  const results: ScheduleRecommendation[] = [];
  for (const task of args.tasks) {
    if (!task.trade) {
      const date = [...selectedDays].find((day) => day >= task.start_date && day <= task.end_date);
      if (date) results.push({ id: `${task.id}:${date}`, taskId: task.id, taskName: task.name, date, trade: null, candidates: [], subId: "", subName: "", headcount: 0, reason: "Choose a trade for this task before recommending a subcontractor.", startTime: null, endTime: null });
      continue;
    }
    const taskStart = task.start_date > start ? task.start_date : start;
    const date = [...selectedDays].find((day) => day >= taskStart && day <= task.end_date);
    if (!date) continue;
    const matchingSubs = selected.filter((sub) => normalizeTrade(sub.trade) === normalizeTrade(task.trade));
    const candidates = matchingSubs.map((sub): RecommendationCandidate => {
      const employeeIds = new Set(args.employeesByCompany?.[sub.id] ?? []);
      const daySlots = args.availability.filter((slot) => employeeIds.has(slot.employeeId) && slot.date === date && (slot.allProjects || slot.projectId === task.project_id));
      const requested = new Set(args.requests.filter((request) => request.date === date && ["pending", "confirmed"].includes(request.status)).flatMap((request) => request.employeeIds));
      const windows = new Map<string, { startTime: string; endTime: string; employeeIds: Set<string> }>();
      for (const slot of daySlots) {
        if (requested.has(slot.employeeId)) continue;
        const key = `${slot.startTime}-${slot.endTime}`;
        const window = windows.get(key) ?? { startTime: slot.startTime, endTime: slot.endTime, employeeIds: new Set<string>() };
        window.employeeIds.add(slot.employeeId);
        windows.set(key, window);
      }
      const best = [...windows.values()].sort((a, b) => b.employeeIds.size - a.employeeIds.size)[0];
      return { ...sub, employeeIds: [...(best?.employeeIds ?? [])], startTime: best?.startTime ?? null, endTime: best?.endTime ?? null };
    });
    const chosen = candidates.find((candidate) => candidate.employeeIds.length > 0);
    let reason: string | null = null;
    if (matchingSubs.length === 0) reason = `No matching subcontractor for ${task.trade}.`;
    else if (!chosen) reason = "No availability for matching subcontractors on this task date.";
    results.push({
      id: `${task.id}:${date}`, taskId: task.id, taskName: task.name, date, trade: task.trade,
      candidates, subId: chosen?.id ?? candidates[0]?.id ?? "", subName: chosen?.name ?? candidates[0]?.name ?? "", headcount: chosen?.employeeIds.length ?? 0, reason,
      startTime: chosen?.startTime ?? null, endTime: chosen?.endTime ?? null,
    });
  }
  return results;
}

export function recommendationCandidatesForTrade(rec: ScheduleRecommendation, trade: string | null) {
  return rec.candidates.filter((candidate) => normalizeTrade(candidate.trade) === normalizeTrade(trade));
}
