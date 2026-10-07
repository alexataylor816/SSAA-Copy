# SSAA migration & build plan

Written by Claude Code, for opencode to execute against. Companion to `OPENCODE_HANDOFF.md` (current-state snapshot, re-verify before trusting) — this file is the forward-looking roadmap: what to build, in what order, and how to know each piece is actually done. Read the handoff doc first for exact file paths, line numbers, and what's already true on disk; this file won't repeat all of that.

## Ground rules (settled, don't re-decide these)

- **`web/` (Vite/React/shadcn, port 8082) is the only UI target.** `frontend/` (Expo, 8081) is frozen — don't add features there, don't treat it as a porting destination. If something useful got built in `frontend/` while it was briefly (and mistakenly) treated as primary, port it into `web/`; don't keep developing it in place.
- **SQLite only** (`backend/ssaa.db`, better-sqlite3). No Postgres, no MySQL.
- **Billing/Stripe is explicitly out of scope.** Don't build it, don't stub it beyond what's already there.
- **No operator/impersonation/MOA super-admin tier.** `isAdmin` is the only platform-level flag; don't resurrect the original's multi-tier operator system.
- `SSAA/` is the read-only Lovable reference for visual/behavioral parity — copy its component structure and Tailwind classes when porting a page, but never edit it except its own dev-server port.
- Two git remotes now exist: `origin` (`alexataylor816/SSAA-Copy`) and `umd` (`UMDMSISCapstone/F2026-501-4-SSAA`), both carrying full history as of 2026-10-05. Until the user says otherwise, treat `origin`/branch `bao` as where active PR work lands (PR #14 is open there) — don't assume `umd` is where new commits should go without asking.

## Definition of "done" for this migration

The app is functionally equivalent to `SSAA/` for the core workflows a GC or sub actually uses day-to-day: sign up/in, create or join a company via connection code, see and edit the dashboard (projects, calendar, team), schedule and confirm work through Resource Matrix, see changes propagate live to other logged-in users. Chat, notifications, and billing are explicitly lower priority or out of scope — don't block on them.

## Phase A — Facade correctness (do this first, blocks everything else)

Nothing built on top of the Supabase-compatible facade can be trusted until these are fixed, because new pages will keep hitting the same two bugs.

1. **Fix the `update().eq("id", id)` rejection** in `backend/src/query/executor.ts`'s `update` case (~line 353). Today every row in `req.data` must carry its own `id`; `.eq("id", x)` filters are never merged in. Fix: when building each row to update, if `id` is missing from the row but the request's `.eq()` filters pin a single `id` value, use that. Keep the existing safety check (reject if no id is resolvable from either source) — don't loosen it to "update everything visible."
   - **Acceptance:** a test calling `supabase.from(table).update({ field: x }).eq("id", knownId)` (the natural idiom, no `id` inside the update payload) succeeds and updates only that row.
2. **Decide and implement cross-employee availability writes.** Add a permission-checked path (new RPC or extended `canWrite` rule on the `availability` table) that lets an `account_holder` (and only an account_holder, same company) set/edit availability for any employee in their company — not just the row linked to their own user id. Keep the existing self-only path for non-account-holders.
   - **Acceptance:** an account-holder test user can PATCH another employee's availability row and it persists; a non-account-holder attempting the same gets a 403; the historical-lock rule (can't edit past dates) still applies to both paths.
3. Re-run `cd backend && npm test` after both fixes — should stay green, plus new tests for the two behaviors above.

## Phase B — Onboarding & auth flow completeness

4. Build a real `/onboarding` route in `web/src/App.tsx` instead of folding company-creation into `SignUp.tsx`. Match the original's actual onboarding steps from `SSAA/` (check its router/onboarding components for the real flow — company type selection, name/address, then redirect to dashboard).
5. Re-verify the invite-link join flow end to end: a user clicking a real `?invite=` link should hit the join-request endpoint, not create a new company. (This was fixed once before — confirm it's still correct after the onboarding route changes land, since moving code around is exactly how this kind of regression creeps back in.)
6. `web/src/components/onboarding/{AnchoredFirstClickTip,TooltipFlagsProvider,tourSteps}` already exist as scaffolding for a product tour — wire them into the new onboarding route if the original Lovable app had a guided first-run tour; otherwise leave them unused rather than forcing it in.

## Phase C — Dashboard 1:1 fidelity

`web/src/pages/Dashboard.tsx` is ~430 lines against the original's ~3,900. The panel layout bug (grid vs. flex) is fixed; the remaining gap is missing modals and feature depth, not structure.

7. Port `ManageCompanyModal` and `ProfilesModal` from `SSAA/` — nothing in `web/` stands in for either yet. `ProfilesModal` in particular owns permission-level management (promote/demote between `basic`/`level_1`/`partial`/`full`/`account_holder`), which currently has no `web/` UI at all even though the backend RBAC supports it.
8. Compare `LeftPanel`/`CalendarPanel`/`RightPanel` feature-by-feature against the original's equivalents — these were ported structurally already but verify nothing was dropped (project list actions, calendar interactions, right-panel widgets).
9. Confirm `CompanySettings.tsx` (already ported, 298 lines) covers what `SSAA/`'s company-settings page does — this was modified recently per git status, check it's not mid-edit/broken.

## Phase D — Resource Matrix & scheduling fidelity

10. Port the supporting modals that currently have zero `web/` counterpart: `MatrixSubSidebar`, `MatrixDraftBar`, `UnassignedAssignmentDialog`. `CreateTaskModal`/`EditTaskModal`/`MatrixEmployeeCard`/`SubOverlayPanel` are already ported — verify they're wired into `ResourceMatrix.tsx`, not just present as dead files.
11. Once Phase A.2 (cross-employee availability) lands, remove the current workaround in `ResourceMatrix.tsx` that makes only the caller's own row editable — account holders should be able to edit any employee's row the same way the original app allows.
12. **Wire the realtime handlers.** `ResourceMatrix.tsx` already subscribes to a channel but — per the last verified state — registers no `.on()` handler, so the backend emits and nothing reacts. Add handlers for the scheduling-mutation events the backend already fires (check `backend/src/realtime/index.ts` for the exact `EVENT` names) so a second open browser session sees updates live, matching `web/src/lib/realtime.ts`'s existing `EVENT` constants.
    - **Acceptance:** open two browser sessions as two different users in the same project; a schedule-request confirm/reject/cancel in one appears in the other without a manual refresh.

## Phase E — Tasks/Gantt

13. `web/src/lib/tasks.ts` and `backend/tests/taskOrder.test.ts` exist already (added since the last handoff). Confirm `backend/src/query/projectTables.ts` has a real `tasks` table registry entry with correct column allowlist and scope rules — tasks currently have no dedicated REST route and rely entirely on the generic `/query` facade, so a missing or wrong registry entry fails silently as a 403, not a 404.
14. Wire the Tasks/Gantt UI into `Dashboard.tsx` or `ProjectSchedule.tsx` (wherever the original Lovable app surfaces it) if it isn't rendered anywhere yet — check before assuming it's just a backend-only feature.

## Phase F — i18n completeness

15. `web/src/i18n/translations.ts` and `web/src/contexts/LanguageContext.tsx` exist. Audit coverage against every user-facing string in the pages ported so far — don't assume existence of the file means completeness.

## Phase G — Chat & notifications (lower priority, build after C/D are solid)

16. Chat/messaging: not started. `web/src/hooks/useMessaging.ts` exists as a stub/hook shell — check what it actually does before assuming groundwork is laid.
17. Notifications: `web/src/hooks/usePushNotifications.ts` exists similarly as a stub — same caveat.
18. Don't start either until Phases C and D are at real parity; these are valuable but not part of the "core loop" definition of done above.

## Phase H — Long tail / cleanup (do last)

19. Uploads: `multer` is installed and a `Storage` class exists server-side, but zero routes call it. Wire at least one real upload path (e.g., project document attach) if any ported page needs it — otherwise leave unbuilt rather than building speculatively.
20. `/functions/:name` doesn't exist despite a stale comment claiming it does — either implement it or delete the comment, don't leave the two disagreeing.
21. 12 of the original 21 RPCs remain unported (`PENDING_RPCS` in the facade) — port on demand as pages that need them get built, not speculatively ahead of time.
22. Contractor-connection flows beyond the basic join-request, and the guest-GC flow, are unported — lowest priority, build only if a specific page needs them.
23. `web/`'s `npm audit` shows 12 vulnerabilities (3 moderate, 9 high), mostly from `xlsx` (prototype pollution + ReDoS, no fix available upstream). Decide whether `xlsx`/spreadsheet export is actually used by any ported page; if not, remove the dependency instead of carrying an unfixable audit flag.

## Working agreements while executing this

- Commit checkpoints often — don't let multi-file uncommitted work sit exposed to an accidental `reset --hard`/`clean -fd`. `git status` before anything destructive.
- Re-run `cd backend && npm test` and `cd web && npm run build` (or `typecheck`) after each phase, not just at the end.
- When a phase's acceptance criterion involves "matches the original," open `SSAA/` on port 8083 side by side rather than guessing from memory.
- If you hit a genuine architecture decision (not just a bug) — like Phase A.2 was — flag it and get a decision rather than quietly picking a workaround that papers over it, the same way the self-only availability workaround did last time.
