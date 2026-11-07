import { describe, expect, it } from "vitest";
import { classifyTaskTrade, normalizeTrade, tradeColor } from "../src/scheduling/taskTrades.ts";
import { parseScheduleCsv } from "../../web/src/lib/scheduleCsv.ts";
import { assertRecommendationTradeMatch, buildScheduleRecommendations, eligibleEmployees, recommendationWindow, validDate, validTime } from "../src/scheduling/recommendationRules.ts";

const examples = [
  ["Demo", null], ["Layout", "Drywall"], ["Framing", "Drywall"],
  ["Electrical Rough In", "Electrical"], ["Plumbing Rough In", "Plumbing"],
  ["Duct Install", "HVAC"], ["Drywall One Siding", "Drywall"], ["Wall Close In Inspection", null],
  ["Drywall Install", "Drywall"], ["VAV Install", "HVAC"], ["Sprinkler Install", "Fire Sprinkler"],
  ["Electrical Ceiling Rough In", "Electrical"], ["Low Voltage Install", "Low Voltage Telecommunication Services"],
  ["Drywall Finishing", "Drywall"], ["Light Fixture Install", "Electrical"], ["Ceiling Close In Inspection", null],
  ["Painting", "Painting"], ["Flooring Install", "Flooring"], ["Millwork Install", "Millworkers"],
  ["Plumbing Fixture Install", "Plumbing"], ["Electrical Trim Out", "Electrical"],
  ["Low Voltage Trim Out", "Low Voltage Telecommunication Services"], ["Final Inspections", null],
];
describe("rule-based task classification", () => {
  it.each(examples)("reviews client example %s", (name, trade) => {
    expect(classifyTaskTrade(name)).toEqual({ trade, status: trade ? "classified" : "ambiguous" });
  });
  it.each(["HVAC and Electrical Layout", "Electrical and Plumbing Rough In", "Drywall Demo"])("requires review for %s", (name) => {
    expect(classifyTaskTrade(name)).toEqual({ trade: null, status: "ambiguous" });
  });
  it("leaves unknown tasks unresolved", () => expect(classifyTaskTrade("Owner walk-through")).toEqual({ trade: null, status: "unresolved" }));
  it("normalizes company trade aliases and uses consistent colors", () => {
    expect(normalizeTrade("Sprinkler")).toBe(normalizeTrade("Fire Sprinkler"));
    expect(normalizeTrade("Duct Installation")).toBe(normalizeTrade("HVAC"));
    expect(tradeColor("Electrical")).toBe("#ca8a04");
    expect(tradeColor("Painting")).not.toBe(tradeColor("Drywall"));
  });
});
describe("schedule CSV review parser", () => {
  it("accepts common headers and quoted commas", () => expect(parseScheduleCsv('Task Name,Start Date,Finish\n"Level 1, east",11/10/2026,2026-11-11')).toEqual([{ name: "Level 1, east", start_date: "2026-11-10", end_date: "2026-11-11" }]));
  it("retains Project duration/predecessors and handles export dates", () => {
    expect(parseScheduleCsv('ID,Name,Duration,Start,Finish,Predecessors\n2,Demo,2 days,Tue 11/10/26,Wed 11/11/26,1FS')).toEqual([{ name: "Demo", start_date: "2026-11-10", end_date: "2026-11-11", duration: "2 days", predecessors: "1FS" }]);
  });
  it.each([
    "Task,Start\nDemo,2026-11-10",
    "Task,Start,Finish\nDemo,2026-02-30,2026-03-01",
    "Task,Start,Finish\nDemo,2026-11-11,2026-11-10",
    'Task,Start,Finish\n"Demo,2026-11-10,2026-11-11',
  ])("rejects malformed import %s", (csv) => expect(() => parseScheduleCsv(csv)).toThrow());
});
const now = new Date(2026, 10, 9);
const date = "2026-11-10";
const task = (trade = "Electrical") => ({ id: "task", project_id: "project", name: "Electrical Layout", trade, start_date: date, end_date: "2026-11-13" });
const subs = [{ id: "e", name: "Electrical Co", trade: "Electrical" }, { id: "d", name: "Drywall Co", trade: "Drywall" }, { id: "e2", name: "Other Electric", trade: "Electrical" }];
const slot = (employeeId, changes = {}) => ({ employeeId, date, startTime: "08:00", endTime: "16:00", projectId: "project", allProjects: false, ...changes });
const base = () => ({ tasks: [task()], subs, selectedSubs: subs, weeks: [1], now, headcount: 3, employeesByCompany: { e: ["a", "b", "c"], e2: ["x"], d: ["z"] }, availability: [slot("a"), slot("b"), slot("c"), slot("x"), slot("z")], requests: [] });
describe("recommendation rules", () => {
  it("matches connected trades, supports multiple companies, and explains its choice", () => {
    const rec = buildScheduleRecommendations(base())[0];
    expect(rec.candidates.map((c) => c.id)).toEqual(["e", "e2"]);
    expect(rec).toMatchObject({ subId: "e", headcount: 3, availableCount: 3, reason: null });
    expect(rec.explanation).toMatch(/matches the Electrical trade/);
  });
  it("never trusts an unconnected stale selection", () => {
    const args = base(); args.selectedSubs = [{ id: "outsider", trade: "Electrical" }];
    expect(buildScheduleRecommendations(args)[0].candidates).toEqual([]);
  });
  it("ranks ability to meet crew size then available count", () => {
    const args = base(); args.availability = [slot("a"), slot("x"), slot("y")]; args.employeesByCompany.e2.push("y"); args.headcount = 2;
    expect(buildScheduleRecommendations(args)[0].subId).toBe("e2");
  });
  it("requires review for unresolved trades and accepts manual correction", () => {
    const args = base(); args.tasks = [task(null)];
    expect(buildScheduleRecommendations(args)[0].reason).toMatch(/Needs review/);
    args.tasks[0].trade = "Electrical";
    expect(buildScheduleRecommendations(args)[0].reason).toBeNull();
  });
  it("distinguishes no connection from no selected company", () => {
    const args = base(); args.tasks = [task("HVAC")];
    expect(buildScheduleRecommendations(args)[0].reason).toMatch(/No HVAC subcontractor is connected/);
    args.tasks = [task()]; args.selectedSubs = [];
    expect(buildScheduleRecommendations(args)[0].reason).toMatch(/No Electrical subcontractor is selected/);
  });
  it("shows zero availability and the next observed date without moving the request", () => {
    const args = base(); args.availability = [slot("a", { date: "2026-11-11" })];
    expect(buildScheduleRecommendations(args)[0]).toMatchObject({ date, availableCount: 0, headcount: 3, nextAvailability: { date: "2026-11-11", count: 1 } });
  });
  it("preserves an excessive requested crew and explains partial availability", () => {
    const args = base(); args.headcount = 5;
    const rec = buildScheduleRecommendations(args)[0];
    expect(rec.headcount).toBe(5); expect(rec.reason).toMatch(/3 of 5 requested workers/);
  });
  it.each(["pending", "confirmed"])("recognizes an existing %s task request after refresh", (status) => {
    const args = base(); args.requests = [{ taskId: "task", date, employeeIds: ["a"], status }];
    expect(buildScheduleRecommendations(args)[0]).toMatchObject({ existingStatus: status });
    expect(buildScheduleRecommendations(args)[0].reason).toMatch(new RegExp(`Already ${status}`));
  });
  it("only produces drafts and leaves inputs unchanged", () => {
    const args = base(), before = JSON.stringify(args); buildScheduleRecommendations(args);
    expect(JSON.stringify(args)).toBe(before);
  });
  it("bounds weeks to the supported range", () => expect(recommendationWindow([0, 1, 1, 3, 4], now).selectedDays.size).toBe(14));
  it("blocks wrong-trade validation", () => {
    expect(() => assertRecommendationTradeMatch("Electrical", "Drywall")).toThrow(/does not match/);
    expect(() => assertRecommendationTradeMatch("HVAC", "Duct Installation")).not.toThrow();
  });
});
describe("employee eligibility", () => {
  const args = () => ({ employeeIds: ["a"], projectId: "project", date, startTime: "08:00", endTime: "16:00", availability: [slot("a")], requests: [] });
  it.each(["pending", "confirmed"])("blocks a cross-project %s overlapping booking", (status) => {
    const a = args(); a.requests = [{ date, projectId: "private-project", employeeIds: ["a"], status, startTime: "12:00", endTime: "17:00" }];
    expect(eligibleEmployees(a)).toEqual([]);
  });
  it("allows separate stops but never fills gaps in availability", () => {
    const a = args(); a.requests = [{ date, employeeIds: ["a"], status: "confirmed", startTime: "16:00", endTime: "18:00" }];
    expect(eligibleEmployees(a)).toEqual(["a"]);
    a.availability = [slot("a", { endTime: "12:00" }), slot("a", { startTime: "13:00" })];
    expect(eligibleEmployees(a)).toEqual([]);
    a.availability[1].startTime = "12:00"; expect(eligibleEmployees(a)).toEqual(["a"]);
  });
  it("does not count partial hours, another project's availability, or repeated rows twice", () => {
    const a = args(); a.availability = [slot("a", { endTime: "15:00" })]; expect(eligibleEmployees(a)).toEqual([]);
    a.availability = [slot("a", { projectId: "other" })]; expect(eligibleEmployees(a)).toEqual([]);
    a.availability = [slot("a", { allProjects: true }), slot("a")]; expect(eligibleEmployees(a)).toEqual(["a"]);
  });
  it.each(["rejected", "cancelled"])("releases %s bookings", (status) => {
    const a = args(); a.requests = [{ date, employeeIds: ["a"], status }]; expect(eligibleEmployees(a)).toEqual(["a"]);
  });
  it("validates real dates and clock times", () => {
    expect(validDate("2026-02-30")).toBe(false); expect(validTime("25:00")).toBe(false); expect(validTime("08:60")).toBe(false);
  });
});
