export const TASK_TRADES = [
  "Drywall",
  "Electrical",
  "HVAC",
  "Plumbing",
  "Fire Sprinkler",
  "Flooring",
  "Security",
  "Masonry",
  "Structural Steel",
  "Air Balancer",
  "Painting",
  "Millworkers",
  "Low Voltage Telecommunication Services",
  "Carpentry",
  "Roofing",
  "Concrete",
  "Glass & Glazing",
  "Insulation",
  "Building Automation & Controls",
  "Other",
] as const;

export type TaskTrade = (typeof TASK_TRADES)[number];
export type TradeClassification = {
  trade: TaskTrade | null;
  status: "classified" | "ambiguous" | "unresolved";
};

export const TRADE_COLORS: Record<TaskTrade, string> = {
  Drywall: "#0284c7",
  Electrical: "#ca8a04",
  HVAC: "#0891b2",
  Plumbing: "#2563eb",
  "Fire Sprinkler": "#dc2626",
  Flooring: "#16a34a",
  Security: "#9333ea",
  Masonry: "#64748b",
  "Structural Steel": "#ea580c",
  "Air Balancer": "#d946ef",
  Painting: "#e11d48",
  Millworkers: "#92400e",
  "Low Voltage Telecommunication Services": "#7c3aed",
  Carpentry: "#a16207",
  Roofing: "#475569",
  Concrete: "#78716c",
  "Glass & Glazing": "#0e7490",
  Insulation: "#b45309",
  "Building Automation & Controls": "#4f46e5",
  Other: "#64748b",
};

export const TRADE_FALLBACK_COLOR = "#0284c7";

/** Deterministic phrase matching. Specific phrases are checked before broad ones. */
export function classifyTaskTrade(name: string): TradeClassification {
  const value = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // Inspections require an authority/responsibility decision; multi-trade work
  // must not be classified by whichever word happens to appear first.
  if (/\b(inspections?|demo|demolition)\b/.test(value)) return { trade: null, status: "ambiguous" };
  const rules: Array<[RegExp, TaskTrade]> = [
    [/\b(electrical|electric|light fixtures?)\b/, "Electrical"],
    [/\b(hvac|mechanical|duct|ductwork|vavs?|air conditioning|ventilation)\b/, "HVAC"],
    [/\bplumbing\b/, "Plumbing"],
    [/\b(sprinklers?|fire protection)\b/, "Fire Sprinkler"],
    [/\b(drywall|framing)\b/, "Drywall"],
    [/\bflooring\b/, "Flooring"],
    [/\b(paint|painting)\b/, "Painting"],
    [/\b(millwork|millworkers?)\b/, "Millworkers"],
    [/\blow voltage\b/, "Low Voltage Telecommunication Services"],
    [/\bsecurity\b/, "Security"],
    [/\bmasonry\b/, "Masonry"],
    [/\b(structural steel|steel erection)\b/, "Structural Steel"],
    [/\bair balanc(e|ing|er)\b/, "Air Balancer"],
    [/\bcarpentry\b/, "Carpentry"],
    [/\broofing\b/, "Roofing"],
    [/\bconcrete\b/, "Concrete"],
    [/\b(glazing|glass)\b/, "Glass & Glazing"],
    [/\binsulation\b/, "Insulation"],
    [/\b(building automation|controls)\b/, "Building Automation & Controls"],
  ];
  const matches = [...new Set(rules.filter(([pattern]) => pattern.test(value)).map(([, trade]) => trade))];
  if (matches.length > 1) return { trade: null, status: "ambiguous" };
  if (matches.length === 1) return { trade: matches[0], status: "classified" };
  // The supplied recommendation example uses Layout with Drywall. Other
  // unqualified layout phrases stay open for review; the GC can override it.
  if (value === "layout") return { trade: "Drywall", status: "classified" };
  return { trade: null, status: "unresolved" };
}

export function tradeColor(trade: string | null | undefined): string {
  return trade && trade in TRADE_COLORS ? TRADE_COLORS[trade as TaskTrade] : TRADE_FALLBACK_COLOR;
}

export function normalizeTrade(trade: string | null | undefined): string {
  const value = (trade ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const aliases: Record<string, string> = {
    sprinkler: "fire sprinkler", sprinklers: "fire sprinkler", "fire protection": "fire sprinkler",
    "duct installation": "hvac", millwork: "millworkers", "low voltage": "low voltage telecommunication services",
  };
  return aliases[value] ?? value;
}
