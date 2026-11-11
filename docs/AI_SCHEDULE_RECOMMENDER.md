# AI schedule recommender (and Upload Schedule)

Status: plan, 2026-10-23, now being built. Source: Luke's Oct 23 call (18:27 and 23:00 in the recording) and
the walkthrough notes.

## What Luke wants

> "It's supposed to reference that schedule item, see what contractor is supposed to do that work, and then
> go and schedule whatever number of people it thinks might be applicable."

The GC presses **Generate Schedule** and the recommender does this:
1. Checks how far ahead to schedule (one to three weeks).
2. Checks which subcontractors are on the project.
3. Reads the project's schedule tasks.
4. Matches each task to a trade: Plumbing Rough-In → plumber, Duct and VAV Install → HVAC, Framing and Layout →
   usually drywall.
5. Guesses a crew size and drafts a schedule request to each matching sub.
6. Lets the GC adjust the headcount on each suggestion ("four suggested, only two or three needed") before
   anything is sent.

Luke says it has never worked reliably for two reasons: **which trade does a task** (Demo can be a demo
contractor or the drywall crew; Layout is usually drywall but electrical or HVAC on big jobs) and **how many
people**.

## Why ours should work: deterministic first, AI only where it helps

The usual mistake is asking an LLM to "make a schedule": it invents people, times and trades. Here, everything
that has a right answer is computed from real data. Claude is used only for what is genuinely fuzzy, and the
GC is asked whenever nothing can be sure.

| Step | How | Why it's reliable |
| --- | --- | --- |
| Task → trade | 1. **Learned answers** this GC gave before. 2. **Lookup list** of phrases ("almost a RAG", `backend/src/ai/trades.ts`); the longest phrase wins, so "electrical layout" → Electrical. 3. **Project context**: an ambiguous name ("Demo") whose options include only one trade on the project resolves to that trade. 4. **Claude** classifies what's left, constrained to the project's trades + "unknown", with a one-line reason (structured output, so the answer is always valid JSON). 5. Still unsure → **ask the GC**: "Can you please identify what contractor or trade is associated with this specific task?" The answer is saved and reused next time. | Each step says how it decided ("lookup", "learned", "only drywall sub on this job", "Claude: …", "you told us"), so the GC can trust or correct it. |
| Which sub | Subs connected to the project whose trade matches. With several, prefer the one this GC has used on this project before, then the one with the most free people. | Never suggests a company that isn't on the job. |
| How many people | 1. **History**: the median headcount this GC requested from that sub (or that trade) on this project. 2. **Trade default** for the task type (framing 4, plumbing rough-in 2, …). 3. **Capped** by how many are actually free that day. | Learns each job's real crew size; never suggests more people than exist. |
| Which people and when | People with posted hours that day, minus time already requested or booked (the same free-time maths and double-booking guard as everywhere else). Prefer people assigned to the project; the time is the window the picked people share. | Every suggestion can be sent as-is without a clash. |
| Already covered | Skip days where this sub already has a request on this project. | Running it twice doesn't double-request. |
| Sending | The GC reviews every suggestion (headcount +/−, remove people, untick days), then Send. That goes through the normal batch endpoint: pending requests, the sub confirms, and the usual notify choice. | No new trust path: all existing rules apply. |

Without an Anthropic API key the recommender still works: steps 1–3 and 5 run, and Claude's step is skipped,
so more questions go to the GC.

## Upload Schedule

The GC uploads a photo, screenshot or PDF of the project schedule. Claude reads it (vision) and returns
`{ name, start, end }` tasks. Each task gets its trade from the same lookup and **the trade's fixed colour**,
so every trade always has the same colour, as Luke asked. Unknown trades are flagged in the preview. The GC
reviews and edits, then adds the tasks to the project. This needs an API key; without one the upload button
says so.

## API

| Endpoint | Does |
| --- | --- |
| `POST /ai/recommendations` `{ projectId, weeks: 1-3 }` | Returns `{ suggestions[], questions[], notes[], usedClaude }`. Writes nothing. |
| `POST /ai/trade-answers` `{ projectId, answers: [{ taskName, trade }] }` | Saves the GC's answers (learned lookup, per GC company). |
| `POST /ai/schedule-upload` (image or PDF) | Returns proposed tasks with trade and colour. Writes nothing; the GC adds them. |
| `GET /ai/status` | Whether Claude is configured, so the UI can say so. |

Sending reuses `POST /schedule-requests/batch`.

## Model and cost

- **Model:** Claude Opus 5.5 (`claude-opus-5-5`) with structured outputs.
- **Calls:** one call per Generate (only the unmatched task names, usually a handful) and one per upload.
- **Refusal fallback:** enabled (`fallbacks: "default"`).
- **Key:** `ANTHROPIC_API_KEY` in `backend/.env`. Never committed, and never sent to the browser.

## Tests

- **Lookup:** Luke's examples are covered in `backend/tests/trades.test.ts`.
- **Recommender** (no Claude key, deterministic):
  - suggests the right sub per task
  - never more people than are free
  - no clashes with existing bookings
  - skips days already requested
  - ambiguous tasks become questions
  - an answer is learned and used next run
  - history drives crew size
  - non-GC callers refused
- **Browser:** generate, review, adjust headcount, send; the sub sees the pending requests.
