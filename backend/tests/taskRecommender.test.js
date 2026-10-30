import { describe, expect, it } from "vitest";
import { classifyTaskTrade, normalizeTrade, tradeColor } from "../../web/src/lib/taskTrades.ts";
import { parseScheduleCsv } from "../../web/src/lib/scheduleCsv.ts";
import { assertRecommendationTradeMatch, buildScheduleRecommendations, recommendationWindow } from "../../web/src/lib/scheduleRecommendations.ts";

describe("schedule task trade classification", () => {
  it.each([
    ["Layout", "Drywall"],
    ["Electrical Layout", "Electrical"],
    ["HVAC Layout", "HVAC"],
    ["Framing", "Drywall"],
    ["Plumbing Rough-In", "Plumbing"],
    ["Duct Install", "HVAC"],
    ["VAV Install", "HVAC"],
    ["Electrical", "Electrical"],
    ["Sprinklers", "Fire Sprinkler"],
  ])("maps %s to %s", (name, trade) => {
    expect(classifyTaskTrade(name).trade).toBe(trade);
    expect(classifyTaskTrade(name).status).toBe("classified");
  });

  it("leaves Demo ambiguous and unknown activities unresolved", () => {
    expect(classifyTaskTrade("Demo")).toEqual({ trade: null, status: "ambiguous" });
    expect(classifyTaskTrade("Owner walk-through")).toEqual({ trade: null, status: "unresolved" });
  });

  it("uses stable trade colors and normalizes sprinkler aliases", () => {
    expect(normalizeTrade("Sprinkler")).toBe(normalizeTrade("Fire Sprinkler"));
    expect(tradeColor("Electrical")).toBe("#ca8a04");
    expect(tradeColor(null)).toBe("#0284c7");
  });
});

describe("schedule CSV review parser", () => {
  it("accepts common task/date headers and quoted commas", () => {
    expect(parseScheduleCsv('Task Name,Start Date,End Date\n"Level 1, east",11/03/2026,2026-11-04')).toEqual([
      { name: "Level 1, east", start_date: "2026-11-03", end_date: "2026-11-04" },
    ]);
  });

  it("rejects missing columns and invalid or reversed dates", () => {
    expect(() => parseScheduleCsv("Task,Start\nDemo,2026-11-01")).toThrow(/columns/i);
    expect(() => parseScheduleCsv("Task,Start Date,End Date\nDemo,2026-02-30,2026-03-01")).toThrow(/Row 2/);
    expect(() => parseScheduleCsv("Task,Start Date,End Date\nDemo,2026-11-03,2026-11-02")).toThrow(/Row 2/);
  });
});

const task = (name, trade, start = "2026-11-03", end = "2026-11-05") => ({
  id: name, project_id: "project-1", assigned_company_id: null, name, description: null,
  start_date: start, end_date: end, color: tradeColor(trade), trade, status: "pending", sort_order: 0,
});

describe("schedule recommendations", () => {
  const now = new Date(2026, 10, 2);
  const subs = [
    { id: "sub-elec", name: "Electrical Co", trade: "Electrical" },
    { id: "sub-drywall", name: "Drywall Co", trade: "Drywall" },
  ];
  const availability = [
    { employeeId: "e1", companyId: "sub-elec", date: "2026-11-03", startTime: "08:00", endTime: "16:00", projectId: null, allProjects: true },
    { employeeId: "e2", companyId: "sub-elec", date: "2026-11-03", startTime: "08:00", endTime: "16:00", projectId: "project-1", allProjects: false },
    { employeeId: "e3", companyId: "sub-elec", date: "2026-11-03", startTime: "07:00", endTime: "15:00", projectId: "project-1", allProjects: false },
    { employeeId: "d1", companyId: "sub-drywall", date: "2026-11-03", startTime: "08:00", endTime: "16:00", projectId: "project-1", allProjects: false },
  ];

  it.each([
    ["Drywall", "sub-drywall", "sub-elec"],
    ["HVAC", "sub-hvac", "sub-drywall"],
    ["Electrical", "sub-elec", "sub-drywall"],
  ])("only considers %s subcontractors even when a different trade has availability", (trade, matchingId, otherId) => {
    const choices = [
      { id: "sub-drywall", name: "Drywall Co", trade: "Drywall" },
      { id: "sub-hvac", name: "HVAC Co", trade: "HVAC" },
      { id: "sub-elec", name: "Electrical Co", trade: "Electrical" },
    ];
    const result = buildScheduleRecommendations({
      tasks: [task(`${trade} task`, trade)], subs: choices, selectedSubs: choices, weeks: [1],
      employeesByCompany: { "sub-drywall": ["d1"], "sub-hvac": ["h1"], "sub-elec": ["e1"] },
      availability: ["d1", "h1", "e1"].map((employeeId) => ({ employeeId, date: "2026-11-03", startTime: "08:00", endTime: "16:00", projectId: "project-1", allProjects: false })),
      requests: [], now,
    })[0];
    expect(result.subId).toBe(matchingId);
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([matchingId]);
    expect(result.candidates.map((candidate) => candidate.id)).not.toContain(otherId);
  });

  it("offers available headcount for selected trades in selected week", () => {
    const result = buildScheduleRecommendations({
      tasks: [task("Electrical Layout", "Electrical")], subs, selectedSubs: subs, weeks: [1],
      employeesByCompany: { "sub-elec": ["e1", "e2", "e3"], "sub-drywall": ["d1"] },
      availability, requests: [], now,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ date: "2026-11-03", trade: "Electrical", subId: "sub-elec", headcount: 2, startTime: "08:00", endTime: "16:00", reason: null });
  });

  it("reports missing trade, unmatched subcontractor, and no availability instead of guessing", () => {
    const result = buildScheduleRecommendations({
      tasks: [task("Demo", null), task("Electrical", "Electrical")], subs,
      selectedSubs: [subs[1]], weeks: [1], employeesByCompany: { "sub-drywall": ["d1"] },
      availability, requests: [], now,
    });
    expect(result[0].reason).toMatch(/choose a trade/i);
    expect(result[1].reason).toMatch(/no matching subcontractor/i);
    const none = buildScheduleRecommendations({
      tasks: [task("Electrical", "Electrical")], subs, selectedSubs: [subs[0]], weeks: [1],
      employeesByCompany: { "sub-elec": ["e1", "e2"] }, availability: [], requests: [], now,
    });
    expect(none[0].headcount).toBe(0);
    expect(none[0].reason).toMatch(/no availability/i);
  });

  it("blocks Send when the task trade and selected subcontractor trade differ", () => {
    expect(() => assertRecommendationTradeMatch("Electrical", "Drywall")).toThrow(/does not match the task trade/i);
    expect(() => assertRecommendationTradeMatch("HVAC", null)).toThrow(/does not match the task trade/i);
  });

  it("allows Send validation for a matching trade and keeps a valid draft", () => {
    expect(() => assertRecommendationTradeMatch("Electrical", "Electrical")).not.toThrow();
    const result = buildScheduleRecommendations({
      tasks: [task("Electrical Layout", "Electrical")], subs, selectedSubs: subs, weeks: [1],
      employeesByCompany: { "sub-elec": ["e1", "e2", "e3"], "sub-drywall": ["d1"] },
      availability, requests: [], now,
    })[0];
    expect(result).toMatchObject({ trade: "Electrical", subId: "sub-elec", headcount: 2, reason: null });
  });

  it("excludes already requested crew and bounds week selection to 21 days", () => {
    const window = recommendationWindow([1, 3], now);
    expect(window.selectedDays.size).toBe(14);
    const result = buildScheduleRecommendations({
      tasks: [task("Electrical", "Electrical")], subs, selectedSubs: [subs[0]], weeks: [1],
      employeesByCompany: { "sub-elec": ["e1", "e2", "e3"] }, availability,
      requests: [{ date: "2026-11-03", employeeIds: ["e1", "e2", "e3"], status: "pending" }], now,
    });
    expect(result[0].headcount).toBe(0);
  });
});
