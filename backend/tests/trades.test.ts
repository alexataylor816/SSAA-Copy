import { describe, expect, it } from "vitest";
import { colorForTrade, matchTaskToTrade, tradeFromCompanyText } from "../src/ai/trades.js";

describe("task → trade lookup (Luke's examples from the Oct 23 call)", () => {
  it.each([
    ["Plumbing Rough-In", "Plumbing"],
    ["Duct Install", "HVAC"],
    ["VAV Install", "HVAC"],
    ["Framing", "Drywall"],
    ["Electrical Rough-In", "Electrical"],
    ["Sprinkler Install", "Fire Protection"],
    ["Wall close in drywall", "Drywall"],
    ["Electrical Layout", "Electrical"],
    ["Pour slab on grade", "Concrete"],
  ])("%s → %s", (task, trade) => {
    const m = matchTaskToTrade(task);
    expect(m.trade).toBe(trade);
    expect(m.confidence).toBe("lookup");
  });

  it("flags the genuinely ambiguous ones instead of guessing silently", () => {
    expect(matchTaskToTrade("Demo")).toMatchObject({ confidence: "ambiguous", alternatives: ["Demolition", "Drywall"] });
    expect(matchTaskToTrade("Layout")).toMatchObject({ confidence: "ambiguous", trade: "Drywall" });
    expect(matchTaskToTrade("Punch list")).toMatchObject({ confidence: "none", trade: null });
    expect(matchTaskToTrade("Owner walkthrough")).toMatchObject({ confidence: "none", trade: null });
  });

  it("a GC's earlier answer wins and is reported as learned", () => {
    const learned = new Map([["demo", "Demolition"]]);
    expect(matchTaskToTrade("Demo", learned)).toMatchObject({ trade: "Demolition", confidence: "learned" });
  });

  it("maps company trade text and keeps one colour per trade", () => {
    expect(tradeFromCompanyText("Mechanical")).toBe("HVAC");
    expect(tradeFromCompanyText("Fire Sprinkler")).toBe("Fire Protection");
    expect(tradeFromCompanyText("Underwater basket weaving")).toBeNull();
    expect(colorForTrade("Plumbing")).toBe(colorForTrade("plumber"));
  });
});
