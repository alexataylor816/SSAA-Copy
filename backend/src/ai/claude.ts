/**
 * The two places the recommender uses Claude (docs/AI_SCHEDULE_RECOMMENDER.md): classifying the task names
 * the lookup list couldn't place, and reading an uploaded schedule image or PDF into tasks. Everything else
 * is computed from data. Without an API key both return "not configured" and the rest still works.
 *
 * The key comes from ANTHROPIC_API_KEY in backend/.env and never reaches the browser.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { TRADES } from "./trades.js";

const MODEL = "claude-opus-5-5";
// If a request is declined by a safety classifier, the API retries it on a fallback model itself.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

let client: Anthropic | null = null;
export function claudeConfigured(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

const TRADE_NAMES = TRADES.map((t) => t.trade) as [string, ...string[]];

const TRADE_GUIDE = TRADES.map((t) => `- ${t.trade}: ${t.phrases.slice(0, 8).join(", ")}`).join("\n");

const Classification = z.object({
  tasks: z.array(
    z.object({
      task: z.string(),
      trade: z.enum(["unknown", ...TRADE_NAMES]),
      confident: z.boolean(),
      reason: z.string(),
    }),
  ),
});

export interface ClaudeTrade {
  trade: string | null;
  confident: boolean;
  reason: string;
}

/**
 * Which trade does each task? Constrained to our trade list (or "unknown"), with a one-line reason the GC
 * sees. `projectTrades` are the trades of the subs actually on the job: a plausible match among them is
 * preferred, which is how a GC would read "Demo" on a job with a drywall crew and no demo contractor.
 */
export async function classifyTasks(taskNames: string[], projectTrades: string[]): Promise<Map<string, ClaudeTrade>> {
  const out = new Map<string, ClaudeTrade>();
  if (!claudeConfigured() || taskNames.length === 0) return out;

  const response = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    ...FALLBACK,
    output_config: { effort: "low", format: betaZodOutputFormat(Classification) },
    system: `You classify tasks from US commercial construction schedules by the subcontractor trade that does the work, so a general contractor can request the right crew.

Trades and typical tasks:
${TRADE_GUIDE}

How to decide:
- Some names fit more than one trade. "Demo" can be a demolition contractor or the drywall crew; "Layout" is usually drywall, but electrical or HVAC on large jobs. When a plausible trade is among the subcontractors on this project, prefer it.
- Use "unknown" for things no trade crew does (inspections, owner walkthroughs, meetings, deliveries, general cleanup) and for names you can't place.
- Set confident to false when two trades are both plausible, so the GC is asked.
- Keep each reason to one short sentence a superintendent would accept.`,
    messages: [
      {
        role: "user",
        content: `Subcontractor trades on this project: ${projectTrades.length ? projectTrades.join(", ") : "none yet"}.

Classify each of these task names (return them in the same order, spelled exactly as given):
${taskNames.map((n) => `- ${n}`).join("\n")}`,
      },
    ],
  });

  if (response.stop_reason === "refusal" || !response.parsed_output) return out;
  for (const t of response.parsed_output.tasks) {
    out.set(t.task, { trade: t.trade === "unknown" ? null : t.trade, confident: t.confident, reason: t.reason });
  }
  return out;
}

const ScheduleRead = z.object({
  tasks: z.array(
    z.object({
      name: z.string(),
      start_date: z.string().describe("YYYY-MM-DD"),
      end_date: z.string().describe("YYYY-MM-DD"),
    }),
  ),
  notes: z.string().describe("Anything unclear, such as unreadable rows or a guessed year. Empty if none."),
});

export type ReadSchedule = z.infer<typeof ScheduleRead>;

/** Read a photo, screenshot or PDF of a project schedule (Gantt chart or task list) into dated tasks. */
export async function readScheduleFile(data: Buffer, mediaType: string, today: string): Promise<ReadSchedule | null> {
  const base64 = data.toString("base64");
  const file: Anthropic.Beta.BetaContentBlockParam =
    mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : {
          type: "image",
          source: { type: "base64", media_type: mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: base64 },
        };

  const response = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "high", format: betaZodOutputFormat(ScheduleRead) },
    system: `You read construction project schedules (Gantt charts, look-ahead schedules, task tables) and list the work tasks with their start and finish dates.

- One entry per task row, using the task's name as written (for example "Plumbing Rough-In", "Duct Install").
- Dates as YYYY-MM-DD. Today is ${today}; when a date has no year, use the year that puts it nearest to today.
- Skip header rows, summary/phase rows that only group other rows, and milestones with no duration unless they are the only entry for that work.
- Never invent tasks or dates. If a row is unreadable, leave it out and say so in notes.`,
    messages: [{ role: "user", content: [file, { type: "text", text: "List the tasks on this schedule." }] }],
  });

  if (response.stop_reason === "refusal" || !response.parsed_output) return null;
  return response.parsed_output;
}

/**
 * Translates one chat message between English and Spanish for the Translate button in Messages. Written
 * for job-site chat between US general contractors and (mostly Mexican) subcontractor crews: everyday
 * construction words the way crews say them, names and numbers untouched, same tone as the original.
 */
export async function translateChat(text: string, to: "en" | "es"): Promise<string> {
  if (!claudeConfigured()) throw new Error("Claude is not configured.");
  const target =
    to === "es"
      ? "Spanish as spoken by Mexican construction crews in the US (obra, cuadrilla, maestro de obra, tablaroca, concreto, colado). Use usted unless the original is clearly casual."
      : "plain American English as used on US construction job sites.";
  const response = await anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    ...FALLBACK,
    output_config: { effort: "low" },
    system:
      `You translate chat messages between a general contractor and a subcontractor in a construction scheduling app. ` +
      `Translate the user's message into ${target} Keep people's names, company names, project names, addresses, ` +
      `dates, times and numbers exactly as written. Keep the same tone and length. If the message is already in the ` +
      `target language, return it unchanged. Reply with the translation only: no quotes, notes or explanations.`,
    messages: [{ role: "user", content: text }],
  });
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => ("text" in b ? b.text : ""))
    .join("")
    .trim();
}
