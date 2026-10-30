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
};

export const TRADE_FALLBACK_COLOR = "#0284c7";

/** Deterministic phrase matching. Specific phrases are checked before broad ones. */
export function classifyTaskTrade(name: string): TradeClassification {
  const value = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const rules: Array<[RegExp, TaskTrade]> = [
    [/\b(electrical|electric)\s+layout\b/, "Electrical"],
    [/\b(hvac|mechanical)\s+layout\b/, "HVAC"],
    [/\bplumbing\s+(rough in|roughin)\b/, "Plumbing"],
    [/\b(duct|ductwork)\s+(install|installation)\b/, "HVAC"],
    [/\bvav\s+(install|installation)\b/, "HVAC"],
    [/\b(sprinkler|sprinklers)\b/, "Fire Sprinkler"],
    [/\b(electrical|electric)\b/, "Electrical"],
    [/\b(hvac|mechanical|air conditioning|ventilation)\b/, "HVAC"],
    [/\bplumbing\b/, "Plumbing"],
    [/\b(framing|drywall|layout)\b/, "Drywall"],
    [/\bflooring\b/, "Flooring"],
    [/\bsecurity\b/, "Security"],
    [/\bmasonry\b/, "Masonry"],
    [/\b(structural steel|steel erection)\b/, "Structural Steel"],
    [/\bair balanc(e|ing)\b/, "Air Balancer"],
  ];
  if (/\bdemo(lition)?\b/.test(value) && !/\b(electrical|electric|hvac|mechanical|plumbing|sprinkler|drywall|flooring|masonry)\b/.test(value)) {
    return { trade: null, status: "ambiguous" };
  }
  const match = rules.find(([pattern]) => pattern.test(value));
  return match ? { trade: match[1], status: "classified" } : { trade: null, status: "unresolved" };
}

export function tradeColor(trade: string | null | undefined): string {
  return trade && trade in TRADE_COLORS ? TRADE_COLORS[trade as TaskTrade] : TRADE_FALLBACK_COLOR;
}

export function normalizeTrade(trade: string | null | undefined): string {
  const value = (trade ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (value === "sprinkler" || value === "sprinklers" || value === "fire sprinkler") return "fire sprinkler";
  return value;
}
