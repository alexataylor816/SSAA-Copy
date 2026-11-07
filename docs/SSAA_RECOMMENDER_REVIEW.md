# SSAA Schedule Recommender review

Prepared November 6, 2026. Work remains uncommitted on `yafet`; nothing was pushed, merged, or submitted as a PR.

## 1. What Luke's New Requirements Changed

The attached request establishes that recommendations must help a GC staff real schedule tasks, explain the choice, and remain drafts until Send. The actual employer must approve its workers. Availability and conflicts must be checked again on the server when sending.

The named `SSAA Details.docx`, Berkel `.mpp`, Korth PNG, and example Project schedule were not found under the project folder or available attachment directories. Consequently, this review uses the pasted requirements and its 23 task examples; it does not claim to have verified Luke's original written details or parsed his real schedule. Layout/Framing → Drywall remain reviewable defaults from the provided examples and existing logic, pending Luke's confirmation.

Baseline: checkout `yafet` at `ad01ad3`. Local `main` (`e0075ac`) is an older reference-only tree. The locally available `origin/main` (`12ed3c7`) is the meaningful web/backend comparison; no remote fetch was performed.

## 2. What Was Already Working

Before edits, `origin/main` supplied the dashboard layout, task/calendar editing, project connections, employee rosters, availability, and the normal pending → confirmed/rejected/cancelled request workflow. Employer-only approval and historical locks already existed. Notification and realtime hooks were already called by the normal scheduling routes.

`yafet` added stored task trades, deterministic phrase matching, editable trade choices, trade colors, CSV review, trade-filtered subcontractor candidates, availability-derived draft crews, draft editing, and browser-side Send checks. Those useful additions were retained and strengthened.

## 3. What Was Missing

Pre-edit audit (reported in chat before code changes):

- **Trade classification — PARTIAL on yafet; MISSING on origin/main.** Task trade storage, known phrases, unresolved Demo, manual correction, and colors existed on yafet. Painting, millwork, low voltage, light fixtures, inspections, and mixed-trade phrases needed coverage. Colors could be overridden inconsistently.
- **Matching — PARTIAL.** Connected project companies and matching trades were available. Multiple candidates existed on yafet, but selection used the first available company rather than a clear ranking. A stale selected company could enter the pure helper through a fallback. Downstream routing was **MISSING** end to end. Employer ownership and approval checks were **PASS** in the normal request service.
- **Availability — PARTIAL / CONFLICTING.** Dates and identical posted time windows were considered. Generation filtered request history to the current project and continued after request-history errors. Existing requests blocked the entire day rather than overlapping times. The API itself allowed conflicting bookings. Full-shift coverage across compatible availability stops was missing.
- **Crew — PARTIAL / CONFLICTING.** Available counts and editing existed, but edited counts were silently capped. No explicit requested-versus-available explanation existed.
- **Draft/send — PARTIAL.** Generation remained a draft and did not send automatically. Browser checks existed, but the API did not enforce task/trade/availability rules. The parent callback discarded the Send promise, preventing reliable error handling and button state.
- **Existing requests — PARTIAL / MISSING.** Pending/confirmed employees were partially considered. Requests had no task link, so a refreshed draft could not reliably identify an already-requested task. Duplicate requests were not atomically prevented.
- **Import — PARTIAL.** Yafet parsed CSV task names/start/finish with review; origin/main had no working upload modal. Duration and predecessors were not retained. Excel exists only in the legacy read-only app, not the active web client. Direct `.mpp` parsing was **MISSING**.
- **First-use guidance — MISSING.** There was no task-selection/review sequence, clear partial-crew action, or next-observed availability.
- **Statuses — PASS** for pending/confirmed/rejected/cancelled; **MISSING** for edited/counter-proposals. The “AI” label was **CONFLICTING** with deterministic implementation.

## 4. What You Implemented

- Pure shared deterministic trade and staffing rules, used by the browser and API.
- All 23 supplied task examples covered by automated classification tests. Inspections, Demo, mixed trades, and unknown work remain unresolved.
- Server-backed preview using current project connections, employer rosters, published availability, and pending/confirmed requests across projects. Other-project names/details are not returned.
- Clear ranking: ability to meet the requested crew, eligible worker count, then current booking count; stable name/ID tie breaks. No numeric score.
- Full-shift coverage checks, contiguous availability-stop coverage, time-overlap conflicts, and distinct employee counts.
- Explicit partial-crew messages and an intentional “Request N workers” action; no silent cap.
- Next-observed availability within the selected weeks and task dates when the selected day has no eligible workers.
- Task links on normal schedule requests; pending/confirmed task detection after refresh.
- Transactional send validation and booking-conflict protection. SQLite scheduling writes serialize in-process; MySQL uses project/employer row locks. MySQL execution remains unverified here.
- Fresh employer/conflict checks on approval, plus availability revalidation for task-linked requests.
- Schedule-request query-facade writes now direct callers to the normal workflow, closing a path around validation/approval authority.
- Existing dialog/card layout retained, with task selection, trade review, subcontractor choice, shift/crew inputs, Edit, and Send Request.
- Send promises/errors propagate correctly, and sending disables repeat clicks.
- CSV import retains duration/predecessor text and supports common Project export dates. Missing trades can be saved as Needs review instead of forcing a guess. The UI explains CSV export for Project/Excel; direct `.mpp`/Excel parsing is not advertised.
- Trade colors stay consistent when tasks are edited or displayed on the dashboard calendar.

No new AI provider, independent notification system, or Weekly Schedule redesign was added.

## 5. How The Recommender Works Now

Choose a project and schedule tasks. Review their trades. Select connected companies, a starting crew size, and a shift. Generate drafts. Each draft explains which company can supply workers for that date/time. Edit the draft or explicitly accept a smaller available crew. Send creates a normal pending request only after the server checks the data again. The employer responds through the normal schedule workflow.

A draft currently covers one selected day within the task's date range; it does not automatically staff every day of a multi-day task. Unsaved drafts are browser state and disappear on refresh. Sent requests persist.

## 6. What Happens When The System Is Unsure

Demo, Wall Close In Inspection, Ceiling Close In Inspection, and Final Inspections are Needs review. Unknown and mixed-trade names also require review. No workers can be requested from an unresolved task recommendation. The GC can choose a trade explicitly and save it.

The remaining supplied examples map to Drywall, Electrical, Plumbing, HVAC, Fire Sprinkler, Low Voltage Telecommunication Services, Painting, Flooring, or Millworkers. These are editable rule-based suggestions, not AI confidence judgments.

## 7. How A Subcontractor Is Chosen

Only actual subcontractor companies connected to the selected project qualify. Their normalized trade must match the task. Workers must belong to that company. Among the GC's selections, companies able to supply the whole requested crew rank first; then more available workers, then fewer active worker bookings on the date. Names/IDs break ties consistently. Edit allows choosing another matching connected company.

A standing contractor relationship without a project connection does not grant staffing authority. Downstream companies must be directly connected to the project for this implementation; intermediary approval of another employer's roster is not introduced.

## 8. How Crew Size Is Chosen

The GC enters the desired crew (initial input 3) and shift (initial input 08:00–16:00). These are editable starting values, not a productivity/duration calculation. The available count includes distinct employer-owned workers whose project-specific or all-project availability covers the full shift and who have no overlapping pending/confirmed requests anywhere.

Partial-hour workers do not count as full-shift workers. Separate non-overlapping bookings can coexist. Adjacent compatible availability stops may cover the shift; gaps cannot. A legacy request without times conservatively reserves the day. Rejected/cancelled requests release their reservation. If only 3 of 5 workers qualify, 5 stays the requested amount until the GC chooses 3, another company, or another time/date.

## 9. Testing Results

Automated result: **252 PASS across 21 files**, including 53 pure classification/import/staffing tests and 16 new API workflow tests. Backend TypeScript, web TypeScript, and production web build: **PASS**.

The original workspace had Node 24 versus a Node 22 SQLite binary and unavailable iCloud dependency placeholders. Verification used the installed Node 22 runtime with an isolated `/tmp` source copy and the same lockfiles. Test databases were in memory, email providers disabled, and uploads temporary. No production/client data was used.

Scenario checklist:

1. **PASS** — known task classification.
2. **PASS** — ambiguous task stays unresolved.
3. **PASS** — unknown task stays unresolved.
4. **PASS** — manual trade correction persists (API).
5. **PASS** — trade color rules and saved correction.
6. **PASS** — correct connected subcontractor.
7. **PASS** — wrong-trade company excluded.
8. **PASS** — multiple same-trade companies and ranking.
9. **PASS** — no matching subcontractor message.
10. **PASS** — no availability and next observed date.
11. **PASS** — partial availability preserves requested count.
12. **PASS** — employee already booked excluded.
13. **PASS** — another GC's cross-project conflict excluded without disclosing its project.
14. **PASS** — requested crew above eligible count blocked.
15. **PASS** — generation creates no request.
16. **PASS** — browser draft editing changes crew/shift, refreshes eligibility, and sends nothing.
17. **PASS** — Send revalidates withdrawn availability, changed task/trade/dates, ownership, connection, deletion, and completion.
18. **PASS** — wrong-trade Send blocked.
19. **PASS** — valid Send creates normal pending request; actual employer confirms.
20. **PASS** — simultaneous duplicate sends yield one creation and one conflict.
21. **PASS** — pending task request recognized.
22. **PASS** — confirmed task request recognized; duplicate blocked.
23. **PARTIAL** — edited/countered status is unsupported; existing reject/cancel/replacement flows pass.
24. **PASS** — regenerated preview sees persisted pending/confirmed state; unsent draft persistence is not provided.
25. **PARTIAL** — CSV parser/metadata persistence pass; real client import, direct Excel and `.mpp` parsing not tested/supported.
26. **PARTIAL** — classification/review states pass; browser import review verification pending.
27. **PASS** — all 23 supplied task examples tested; actual missing client files **NOT TESTED**.

MySQL migrations/locking: **NOT TESTED**. Actual outbound email delivery: **NOT TESTED** (intentionally disabled). Existing notification suite: **PASS**. Browser results: **13/13 PASS** on November 6, 2026, using headless Chrome against the isolated local app. Verified task selection, unresolved trade review, manual correction, draft generation, matching connected companies, cross-project booking reduction, partial crews, editing, valid Send/Pending, duplicate/overlap blocking, withdrawn-availability revalidation, and refresh behavior. No browser page errors or flow blockers appeared. No application code changes were needed during this final QA pass. Browser CSV upload itself remains outside that 13-flow pass.

## 10. What Still Needs Work

**Must fix before client demo**

- Obtain Luke's original written details and actual schedule/export, reconcile assumptions, and rehearse the import using that file.
- If the demo uses MySQL, apply the additive schema script to a local QA database and validate migrations, concurrent sends, and rollback there first.
- Do not present counter-proposals, downstream routing, direct `.mpp` parsing, or persistent unsent drafts as completed features.

**Should improve**

- Add the normal edited/counter-proposal workflow with agreed status meanings, employer authority, and request revision history.
- Add explicit downstream project connection/visibility/routing support if Luke requires indirect companies.
- Provide atomic, retry-safe bulk import. The existing importer writes rows one at a time; partial network failure may leave some imported tasks saved.
- Decide whether a task may have multiple crews/stops/requests on the same date. Current task-linked duplicate protection allows one active request per task/date.
- Recheck assignment policy when availability is edited after confirmation; current protection checks Send/approval rather than redesigning Weekly Schedule.
- Unify remaining legacy “AI” translations/tour copy outside this recommender and show retained dependency metadata in more schedule views.

**Nice to have**

- Persist unsent drafts per GC/project and add multi-day staffing review.
- Wider availability search, workday/holiday calendars, labor estimates based on task quantities/productivity, direct Excel import, and genuine `.mpp` ingestion through a vetted parser or conversion service.

## 11. Future AI Opportunity

A future AI task-understanding component could suggest HVAC for “Install branch ductwork and VAVs on level 2,” including phrasing absent from these rules. Its output should be a proposed trade plus a review requirement. Connection checks, employer ownership, worker eligibility, conflicts, crew limits, statuses, duplicate prevention, and Send must stay deterministic server rules. No external AI API was added.

## 12. Luke Demo Flow

Use a local QA project, an Electrical subcontractor connected to it, and 3 invented workers available for an upcoming task date at 08:00–16:00.

1. Choose the project → Upload schedule → select a CSV containing Electrical Rough In and Demo → show Electrical as Trade identified and Demo as Needs review → Save tasks.
2. Generate Schedule → select Electrical Rough In and Demo → review trades; explain that Demo needs the GC's decision → choose the Electrical company, a week containing the task, crew 5, and 08:00–16:00 → Generate Recommendations.
3. Close the dialog → show “3 of 5 requested workers are available” and the blocked Send button → click Request 3 workers → show the refreshed eligible crew and explanation.
4. Edit → show date/time/company/crew controls and that saving still sends nothing → save the draft.
5. Send Request → expect one normal Pending request and no automatic confirmation.
6. Sign in as the employer → open the request through the calendar/requests list → Confirm → expect Confirmed on both sides.
7. Sign in as the GC and generate again → expect Already confirmed rather than a duplicate Send. An unsent draft vanishes after refresh; the sent request remains.

## 13. Questions For Luke

- Can we confirm Layout and Framing belong to Drywall for these schedules? Who owns Demo, inspections, millwork, and low-voltage work on each project?
- Does Pending reserve the workers across all projects, and how should expired unanswered requests release them?
- Can one task have several subcontractors/crews or multiple same-day stops, and should staffing repeat across every task date?
- What exactly may a subcontractor edit in a counter-proposal, and who must approve that revision?
- How should a downstream employer become project-visible, who receives the request, and which intermediaries need visibility?
- Should crew sizes come from GC judgment or task quantities/productivity standards? Are there minimum crew or shift rules?
- Which schedule export format, locale/date format, working calendar, timezone, and dependency identifiers should SSAA support first?

## 14. Files Changed

- `backend/src/scheduling/taskTrades.ts` (new): shared pure classifier, trade aliases, and colors.
- `backend/src/scheduling/recommendationRules.ts` (new): shared eligibility, overlap, ranking, partial-crew, and duplicate-display rules.
- `backend/src/scheduling/service.ts`: server previews, task-aware Send validation, transactions, cross-project conflicts, and approval rechecks.
- `backend/src/scheduling/routes.ts`: preview endpoint and task metadata through the normal Send endpoint.
- `backend/src/scheduling/models.ts`: additive SQLite request task link and mapping/persistence.
- `backend/src/scheduling/types.ts`: request task identity.
- `backend/src/query/projectTables.ts`: additive SQLite duration/predecessor columns.
- `backend/src/query/registry.ts`: task metadata access and mandatory normal request workflow for writes.
- `backend/db/mysql/schema.sql`: additive MySQL metadata migrations.
- `backend/tests/taskRecommender.test.js`: expanded rule/classification/import regression tests.
- `backend/tests/recommendationWorkflow.test.ts` (new): isolated API workflow and stale/concurrent-send tests.
- `web/src/lib/taskTrades.ts`: browser export of the shared pure trade rules.
- `web/src/lib/scheduleRecommendations.ts`: browser export of the shared pure staffing rules.
- `web/src/lib/scheduleCsv.ts`: duration/predecessors and Project-style date parsing.
- `web/src/lib/tasks.ts`: metadata persistence and consistent displayed trade colors.
- `web/src/components/dashboard/LeftPanel.tsx`: guided recommender, editable date/time/crew/company, partial actions, explanations, and async send/error state.
- `web/src/components/dashboard/EditTaskModal.tsx`: consistent trade colors and reversed-date blocking.
- `web/src/components/dashboard/UploadScheduleModal.tsx`: honest format guidance, retained metadata preview, and unresolved trade review.
- `web/src/pages/Dashboard.tsx`: server-backed preview/edit/send integration and metadata import.
- `web/vite.config.ts`: allow access to the pure shared scheduling modules in the sibling backend source directory.
- `docs/SSAA_RECOMMENDER_REVIEW.md` (new): this audit, verification, limits, demo, and review record.

No environment file, secret, client database, backup, generated build artifact, or dependency lockfile was intentionally modified for delivery. QA artifacts and installed QA dependencies live under `/tmp`.
