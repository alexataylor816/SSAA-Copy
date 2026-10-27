# Weekly view rebuild: match Luke's SSAA

Version 2, 2026-10-23, rewritten after Luke's walkthrough on the Oct 23 check-in.
Deadline: the build goes to Luke on **Fri Oct 30, 5:30 PM**.

Owners:
- **opencode:** the screens. Tickets O1–O12 are in section 4.
- **Claude Code:** backend, the API contract, the Monthly view's "Edited" flow, Team assignments, the seed, and end-to-end tests. Tickets C1–C9 are in section 5.

Sources of truth, in this order:
1. Luke's walkthrough on Oct 23: the notes, the transcript, and 5 frames. They are described in section 1.
2. Luke's original code. Port the behaviour from these files:
   - `SSAA/src/features/scheduling/matrix/ResourceMatrix.tsx` (2723 lines)
   - `matrix/MatrixSubSidebar.tsx`
   - `matrix/MatrixEmployeeCard.tsx`
   - `matrix/MatrixDraftBar.tsx`
   - `matrix/MatrixSidebar.tsx`
   - `calendar/UnassignedAssignmentDialog.tsx`
   - `calendar/NotifyOnAssignDialog.tsx`
3. This file. Where it disagrees with the original code, this file wins, because it holds our server rules.

Keep our look: shadcn components from `web/src/components/ui/*` and our Tailwind tokens. Don't import anything from
`SSAA/`. Copy the logic and rewrite it against `matrixApi.ts`. **Never** call Supabase or `supabase.from(...)`.

---

## 1. What Luke showed (the target)

**The big idea: the sub schedules first.** The subcontractor opens Weekly, sees the GC's projects as rows, and
drags its own crew from the side panel onto project/day cells. Publishing makes those bookings **confirmed
straight away**, because it's their own crew. The GC then sees the changes, tagged **"Edited"**, and accepts them
in the Monthly view. The GC can also drag people in. A GC drag creates a **request** that the sub has to confirm.

What the 5 frames show:

1. **The sub's Weekly view.** Project rows and day columns. Draft cards have a blue outline. Two cards have a **red
   outline** because the person isn't assigned to that project. The bottom bar reads **"You have 2 unsaved
   schedule changes"**, with **Revert Changes** and **Publish & Edit Schedule**.
2. **The "Unassigned employee placement" dialog**, opened by Publish. It has a warning icon and this text: "You've
   assigned one or more employees to a project they are not officially assigned to. Are you sure you want to
   proceed?" Then a list, for example "Pete Alvarez – Journeyman Plumber is not assigned to Main St Retail
   Fit-Out", and the buttons Cancel / Proceed.
3. **The "Notify General Contractors?" dialog**, shown next. Text: "You have newly assigned or moved employees. Do
   you want to notify the General Contractor(s) of these changes?" Two checkboxes: Email, and "Push notification
   and message". A second section, "Notify Personnel or Wait for GC Confirmation?" with the hint "Leave both
   unchecked to wait for GC confirmation.", has the same two checkboxes. Buttons: Cancel / Publish.
4. **The GC's Weekly view.** The same grid, with a **Subs** panel on the right: a search box and one group per
   connected sub reading "N available · M scheduled" for the selected day, with Available cards (initials, name,
   job title, free hours) and Scheduled cards.
5. **The GC's Monthly view, day dialog.** A request tagged **Edited**, with the note "The Subcontractor has
   assigned this additional personnel to the job for this day." and the buttons **Confirm Changes**, **Edit &
   Resend** and **Cancel**. That dialog is Claude Code's job (C6). Approvals stay in Monthly; Weekly is for
   placing people.

Other points from the walkthrough:
- **Snap-back:** dropping somewhere invalid sends the card back where it came from and shows the reason.
- **One card per stop:** a person with 2 stops on a day has 2 cards, and each can be dragged on its own.
- **Copy Current Schedule:** copy a day, then paste it onto another day as drafts.
- **All Job Titles filter** in the side panel.
- Project rows collapse. Cards shrink as a cell fills. Scrolling right loads more weeks.

---

## 2. Rules (the server enforces these; the UI mirrors them so users find out before Publish)

| # | Rule | UI behaviour |
| --- | --- | --- |
| R1 | **Sub (Partial or higher, the same bar as connecting to a project)** places **its own** employees on projects it's connected to. The request is created **confirmed**, `assignedBySub = true`, `edited = true`. | Draft card with a blue outline. After publish it turns green with the "Edited" tag until the GC confirms. |
| R2 | **GC (partial or higher)** places a connected sub's employees. The request is created **pending**. | After publish the card turns yellow (pending). |
| R3 | **Unassigned exception:** the employee isn't in `employee.assignedProjectIds` for the target project, and the viewer is a **sub**. The send needs `allowUnassigned: true`, and only `viewer.canMakeException` users may send it. | Red outline (`ring-2 ring-red-500`) on the draft card. Publish opens the Unassigned dialog. If `canMakeException` is false, show this toast instead: "Permission required: You do not have permission to assign employees to projects they are not assigned to. Ask an admin to update assignments in Manage Team Profiles." Don't publish. |
| R4 | No double booking: a person can't be placed over time that is already requested or booked on any project. | Snap-back (S2 below). |
| R5 | The person must have posted hours covering the slot that day. | Snap-back (S1). |
| R6 | Past weeks are locked (anything before this week's Monday). | Cells are greyed and not droppable; snap-back (S3). |
| R7 | A GC moving or editing an existing request puts it back to **pending**. A sub moving or editing a confirmed request keeps it **confirmed** and sets `edited`. | The card status follows the server after refetch. |
| R8 | A person booked by **another GC** (`booking.otherGc`) shows only as "Unavailable", with no project name. | Grey card. Not draggable. |
| R9 | `viewer.canSchedule === false` (basic users) means read-only. | No drag, no draft bar. |

---

## 3. Data: what you build against

Everything is in **`web/src/lib/matrixApi.ts`**. Claude Code owns that file. Import from it; don't edit it. Ask
for changes under "Requests between agents" at the bottom of this doc.

- `mockMatrix(start, days, "gc" | "sub")` gives demo data for every state:
  - free, pending, confirmed, other GC, two stops on one day
  - an **Edited sub-assigned** booking (Mike on Main St every Tuesday)
  - an unassigned case: Pete and Luis are assigned to Riverside only, so dropping them on Main St gives a red outline
- `mockSendBatch(data, body)` behaves like the server for a send:
  - a dry run returns `unassigned[]`
  - a real send without `allowUnassigned` skips those placements
  - it skips anyone not free for the slot
- When Claude Code says the endpoints are live (Wed Oct 28 at the latest), swap in `matrixApi.load()` and
  `matrixApi.sendBatch()`. **Put that switch in one place** (`useMatrixData.ts`), behind a constant
  `USE_MOCK`.

Key types (read the file for the full list):
- `MatrixData`: `days`, `viewer`, `projects`, `crews[].employees[]`, `availability[]` (with `free[]`), `bookings[]`, `tasks[]`
- `viewer`: `companyType`, `permissionLevel`, `canSchedule`, `canAssignOwnCrew`, `canMakeException`
- `MatrixEmployee.assignedProjectIds`
- `MatrixBooking`: `status`, `assignedBySub`, `otherGc`, `edited`, `lastEditedByCompanyId`, `silent`
- `BatchBody`: `create[]`, `update[]`, `cancel[]`, `dryRun`, `allowUnassigned`, `notify`, `editReason`
- `BatchResult`: `created`, `updated`, `cancelled`, `skipped[{kind, index, reason}]`, `unassigned[]`, `notified`

Times are `"HH:MM"`, 24-hour, and `"24:00"` means end of day. Use `fmtTime`, `freeWindows` and `overlapsWindow`
from `web/src/lib/timeWindows.ts` instead of writing new time maths.

Realtime: after `availabilityChanged`, `scheduleRequestCreated` or `scheduleRequestUpdated` from
`useSocket`/the realtime client, refetch the matrix, **but keep the drafts**.

---

## 4. opencode tickets

Files you own:
- `web/src/components/matrix/*` (all new; the three empty files there are yours)
- `web/src/pages/ResourceMatrix.tsx`

Do the tickets in order. Each ticket has a **Done when** list; check it in the browser at desktop width (1440×900)
and phone width (390×780).

### O1. `useMatrixData.ts`: load and refresh
- State: `weekStart` (Monday), `weeksLoaded` (starts at 2, max 8), `projectFilter` (`"all"` or a project id), and
  `viewerMode` (comes from the data, not from a toggle).
- `USE_MOCK` constant. Mock: `mockMatrix(weekStart, weeksLoaded * 7, mode)`. For testing both sides, read
  `?as=sub` from the URL while mocking. Real: `matrixApi.load({ start, days, projectId })`.
- `loadMore()` adds a week (up to 8) when the grid is scrolled to within ~200px of the right edge.
- Refetch on socket events. Show a toast on load errors.
- **Done when:** the page loads mock data for both `?as=gc` and `?as=sub`, and Today / previous / next work.

### O2. `useMatrixDrafts.ts`: the draft model
Port the `draftChanges` logic from the original `ResourceMatrix.tsx` (around lines 1049–1240 for drop/copy/paste
and 1255–1295 for the unassigned pairs).

```ts
type Draft =
  | { id: string; kind: "place"; employeeId: string; subCompanyId: string; projectId: string; date: string;
      startTime: string; endTime: string; availabilityId: string | null; stopLabel: string | null }
  | { id: string; kind: "move"; requestId: string; employeeId: string; fromProjectId: string; fromDate: string;
      projectId: string; date: string; startTime: string | null; endTime: string | null }
  | { id: string; kind: "remove"; requestId: string; employeeId: string; projectId: string; date: string };
```

- `place` comes from a side-panel card. Its time is that **stop's free window**: the free span of that
  availability row containing the drop. Take it from `availability.free`.
- `move` comes from dragging an existing (already sent) chip to another cell. `remove` comes from dropping an
  existing chip onto the side panel.
- Dragging a **draft** chip just edits or removes that draft, and is never sent.
- `revert()` clears everything. `count` is the number of drafts.
- `toBatch(data)` builds the `BatchBody`:
  - group `place` drafts with the same project, date, sub and time into one `create` entry with several
    `employeeIds`
  - turn each `move`/`remove` into an `update` entry with the request's new `employeeIds`; removing the last
    person gives an empty list, which the server treats as a cancel
- `unassignedPairs(data)`: drafts where the viewer is a sub and
  `!employee.assignedProjectIds.includes(projectId)`.
- **Done when:** unit tests in `web/src/components/matrix/useMatrixDrafts.test.ts` (vitest is already in web; if
  it isn't, put the tests in a comment block and tell Claude Code) cover:
  - place, then move, then remove
  - grouping in `toBatch`
  - unassigned pairs

### O3. `canDrop()`: the snap-back rules
`canDrop(data, drafts, card, target): { ok: true; window } | { ok: false; reason: string }`. Check in this order
and return the **first** failing reason:

| | Check | Reason text |
| --- | --- | --- |
| S3 | Target date is before this week's Monday | "That week is locked." |
| S0 | The viewer can't schedule (R9), or a sub is dragging someone outside its own company, or a GC is dragging a sub that isn't connected to that project | "You can't schedule {name} on {project}." |
| S1 | No availability row for that person on that date | "{first name} has no hours posted on {Tue Oct 27}." |
| S2 | The person's free windows that day (minus this person's other drafts) don't contain the stop being dragged | "{first name} is already booked {7a–3:30p} on {project}." (use the booking's project; for `otherGc` say "with another contractor") |
| S4 | The same person and stop is already a draft or booking in that cell | Do nothing, no toast. |

On failure:
- don't create a draft
- the drag overlay animates back (dnd-kit `DragOverlay` with `dropAnimation`; for a cancelled drop just don't
  update state)
- show `toast({ title: "Can't place here", description: reason })`

Red outline (R3) is **not** a snap-back: the drop is allowed, and the card is just marked.

**Done when** every case in the table can be triggered in the mock:
- S1: Dev on a Tuesday
- S2: Mike on a Monday
- S3: last week
- S2 with another GC: Marco on a Thursday

### O4. `EmployeeCard.tsx`
Port `MatrixEmployeeCard.tsx`.
- **Three sizes**, picked from the number of people in the cell: `count <= 3` full, `<= 6` compact, more than that
  minimal (name only, wraps in a row).
  - full: an avatar circle with initials, the name, then job title and time on the second line
  - compact: small initials, name, time
- **Status outline:**

  | Status | Classes |
  | --- | --- |
  | confirmed | `ring-2 ring-green-500/60` |
  | pending | `ring-2 ring-yellow-500/70` plus a pale yellow background |
  | draft | `ring-2 ring-blue-500/60` |
  | available (side panel) | `ring-2 ring-yellow-500/60` |
  | unavailable/other GC | grey, `opacity-60`, not draggable |

  **The unassigned warning overrides all of these** with `ring-2 ring-red-500`, plus a small warning triangle and
  the tooltip "Not assigned to this project". Selection overrides everything with
  `ring-4 ring-blue-600 ring-offset-2`.
- An "Edited" badge (small, amber) when `booking.edited`. A "Sub" badge when `assignedBySub` (GC view only).
- A stop label ("Stop #1") when there is one. The time is `fmtTime(start)–fmtTime(end)`.
- Click versus drag: a pointer that moves less than 5px is a click, which toggles selection. Shift-click adds to
  the selection. Use dnd-kit `PointerSensor` with `activationConstraint: { distance: 5 }`.
- **Done when:** a story-style test page, or the grid itself, shows every status, all 3 sizes, and red-outline
  plus selection.

### O5. `MatrixGrid.tsx`
Port the grid section of the original `ResourceMatrix.tsx` (around lines 2369–2716).
- **Rows** are projects (`data.projects`, filtered by `projectFilter`).
  - Each row header shows the name, the address in small muted text, and a collapse chevron. A collapsed row is
    one thin line with a people count per day.
  - Remember collapsed rows in `localStorage` (`ssaa.matrix.collapsed`, wrapped in try/catch).
- **Schedule overlay** toggle: a thin row under each project with that project's `tasks` as coloured bars across
  the days they span.
- **Columns** are days: `EEE d` with the month on the 1st and on the first column.
  - Today is highlighted (primary tint). Weekends are shaded (`bg-muted/40`). Locked days are hatched or greyed.
  - **Clicking a day header selects that day**: strong highlight, and it drives the side panel. With a copied
    schedule, clicking a header **pastes** instead (see O7).
- **Cells:**
  - droppable id `cell::{projectId}::{date}`
  - show sent bookings for that project and day (one card per person per booking) plus drafts
  - highlight on hover while dragging
  - minimum height 64px; width 140px on desktop
- The first column (project names, 220px) stays put while scrolling right. The header row stays put while
  scrolling down.
- Multi-select drag: dragging a selected card moves the whole selection; each card is checked with `canDrop` on
  its own, and failures snap back individually.
- **Done when:**
  - both mock views render
  - drag from the side panel creates a draft
  - drag between cells moves it
  - drag onto the side panel removes it
  - snap-back works
  - collapse and overlay work
  - scrolling right loads week 3

### O6. `SubSidebar.tsx`: the right-hand panel
Port `MatrixSubSidebar.tsx`. Width 320px, collapsible to a 40px rail with a chevron.
- Top: the **selected day** title ("Tuesday, Oct 27") with ‹ › to change the day.
- **Search** input with placeholder "Search subs or employees".
- **Job title filter:** a `Select` with "All Job Titles" first, then every distinct `jobTitle` in the loaded
  crews, A–Z.
- **Copy Current Schedule** button (see O7).
- **GC view:** one collapsible group per crew (`crews[]`), headed by company name, trade, and
  "**{N} available · {M} scheduled**" for the selected day.
  - Inside: an **Available** list (one card per *free stop* not already drafted or booked; it shows the free
    window, e.g. "5:00 AM – 1:00 PM") and a **Scheduled** list (people booked or drafted that day, with the
    project name(s) under the name).
  - People who are fully held by another GC appear under Scheduled as "Unavailable".
- **Sub view:** the same, but one group: its own crew.
- The whole panel is a droppable `sidebar-drop`. Dropping an existing chip there makes a `remove` draft;
  dropping a draft chip deletes the draft.
- Available cards are draggable (`card::{employeeId}::{availabilityId}`).
- **Done when:**
  - the counts are right for the selected day in the mock
  - search and job title filter work together
  - dropping onto the panel removes the chip

### O7. Copy and paste a day
Port `handleCopyDay`/`handlePasteDay` from the original (around lines 1185–1235).
- **Copy Current Schedule** copies all bookings and drafts on the **selected day**, across every visible project.
  - Toast: "Schedule copied: Copied schedule from Tue, Oct 27. Click a day header to paste."
  - Then show a banner above the grid ("Pasting Tue Oct 27 · click a day header · Cancel").
- Clicking a day header runs every copied placement through `canDrop` for the new date:
  - successes become `place` drafts
  - skip people who already have a draft that day, or are already booked at the same project
  - failures are counted and listed in a toast ("Pasted to Thu, Oct 29. 3 placed, 1 skipped: Mike has no hours
    posted on Thu Oct 29.")
- **Done when:** copying Monday onto Wednesday in the mock gives drafts plus the right skips.

### O8. `DraftBar.tsx`
Port `MatrixDraftBar.tsx`. It's fixed to the bottom of the grid area and appears only when `count > 0`. On a phone
it sits above `MobileTabBar`.
- Sub: "You have **N** unsaved schedule change(s)", then **Revert Changes** (outline) and **Publish & Edit
  Schedule** (primary).
- GC: "**N** unsaved change(s)", then **Revert** and **Send Requests**.
- While sending: disable both buttons and show a spinner, with the label "Publishing..." or "Sending...".
- Revert asks for confirmation with an `AlertDialog` when `count > 3`.

### O9. `UnassignedDialog.tsx`
Port `calendar/UnassignedAssignmentDialog.tsx` **word for word** (frame 2).
- Group the list by person: "**Name** – Job title is not assigned to **Project A, Project B**".
- Buttons: Cancel / Proceed (destructive style).

### O10. `NotifyDialog.tsx` (sub publish) and the GC send choice
- **Sub** (frame 3), word for word from `MatrixDraftBar.tsx` (around lines 129–185):
  - Title: "Notify General Contractors?"
  - Description: "You have newly assigned or moved employees. Do you want to notify the General Contractor(s) of
    these changes?"
  - Checkboxes: **Email** and **Push notification and message**, both checked by default
  - Section: "Notify Personnel or Wait for GC Confirmation?" with the hint "Leave both unchecked to wait for GC
    confirmation." and the same two checkboxes, both unchecked by default
  - Buttons: Cancel / Publish
  - Maps to `notify: { gcEmail, gcPush, personnelEmail, personnelPush }`. All four unchecked = silent.
- **GC:** port `calendar/NotifyOnAssignDialog.tsx`.
  - Title: "Notify the subcontractor?"
  - Four choices: **Email only** (Send via email), **Push only** (Push notification and message), **Both** (Email
    and push notification), **In-app only** (No message sent)
  - Maps to `notify.gcEmail`/`gcPush`; the server uses them for the sub's recipients.

### O11. Publish flow (wire it all together in `ResourceMatrix.tsx`)

```
click Publish/Send
 → body = drafts.toBatch(data)
 → dry = sendBatch({ ...body, dryRun: true })
 → if viewer is sub and dry.unassigned.length:
       if !viewer.canMakeException → "Permission required" toast, stop
       else open UnassignedDialog(dry.unassigned) → Cancel = stop, Proceed = allowUnassigned = true
 → open NotifyDialog (sub) / the GC choice dialog → Cancel = stop
 → res = sendBatch({ ...body, allowUnassigned, notify })
 → remove the drafts that were sent; drafts named in res.skipped stay, marked with the reason
   as a tooltip and a red dot
 → toast: "Schedule published: 5 changes saved." plus, if any were skipped,
   "2 skipped: <first reason>" with a "View" action that lists every reason
 → if res.notified.email is false but email was ticked: an extra muted line,
   "Email isn't set up yet, so only in-app notifications were sent."
 → refetch
```

**Done when** the whole flow runs on the mock, both views, including Cancel at every step leaving the drafts in
place.

### O12. Page shell and phone layout (`ResourceMatrix.tsx`)
- **Desktop:** keep `DashboardHeader` and the Monthly/Weekly switch exactly as they are now.
  - Top bar: week title ("Oct 26 – Nov 8"), Today, ‹ ›, project filter (`Select`: "Master Schedule" = all, or
    one project), and the Schedule overlay toggle.
  - Below: the grid on the left (scrolls) and the side panel on the right.
- **Phone (< 768px):** no drag.
  - Top: a horizontal row of day buttons, then a project picker.
  - Under it, the selected day's cells as a list, grouped by project; each card has a ⋯ menu with Move to… and
    Remove.
  - An **"Add people"** button opens the side panel as a bottom `Sheet`. Tap a card to select it ("Tap a project
    to place Pete"), then tap a project row to place it. It goes through the same `canDrop`, and failures show the
    same toast.
  - The draft bar sits above `MobileTabBar`.
- Delete the old person-row grid and the helpers only it used. Keep `ScheduleDayDialog`, which is still opened
  from Monthly.
- **Done when:**
  - `npm run typecheck` and `npm run build` in `web/` both pass
  - there's no horizontal page scroll at 390px
  - no console errors

---

## 5. Claude Code tickets

| # | Work | Files |
| --- | --- | --- |
| C1 | Contract v2 + `mockSendBatch` (**done 2026-10-23**) | `web/src/lib/matrixApi.ts` |
| C2 | (**done 2026-10-23**) Schema, additive (SQLite PRAGMA and the MySQL schema): `schedule_requests.edited`, `last_edited_by_company_id`, `sub_assigned`, `silent_assignment`, `group_id`, `edit_reason` | `backend/src/scheduling/models.ts`, MySQL schema |
| C3 | (**done 2026-10-23**) `GET /matrix` per the contract: visibility (GC: own projects plus connected subs; sub: connected projects plus own crew), `free[]` from the existing `freeWindows` maths, `otherGc` masking, `assignedProjectIds` | `backend/src/scheduling/*` |
| C4 | (**done 2026-10-23**) `POST /schedule-requests/batch`: create, update, cancel, `dryRun`, `allowUnassigned`, `notify`. One transaction, one `group_id`. Rules R1–R9. Skipped reasons ready to show. | same |
| C5 | (**done 2026-10-23**) `POST /schedule-requests/:id/acknowledge-edit`; `GET`/`PUT /projects/:id/assignments` | same |
| C6 | (**done 2026-10-23**, plus "Assign Personnel to Job" for subs) Monthly `ScheduleDayDialog`: Edited badge, Confirm Changes / Edit & Resend / Cancel, and the "The Subcontractor has assigned this additional personnel to the job for this day." note. Grey out subs with no availability. | `web/src/components/dashboard/*` |
| C7 | (**done 2026-10-23**: "Project assignments" card on the company page) Team page: project-assignments editor | `web/src/pages/CompanySettings.tsx` or the Team page |
| C8 | (**done 2026-10-23**, not yet loaded into the live MySQL) Demo seed v3: keep GC Greg / Subcontractor Steve and Mike and Pete with no Friday hours; Steve's crew assigned to Riverside only; one Edited request ready for Greg's Confirm Changes | `backend/scripts/seed-showcase.ts` |
| C9 | Tests: unit tests for every rule on SQLite and `ssaa_test`; a browser end-to-end test of sub publish (red outline → Unassigned → Notify → confirmed) → GC sees Edited → Confirm Changes, at desktop and phone width | `backend/tests/matrix*.test.ts`, scratch Playwright |

---

## 6. Schedule

| Day | opencode | Claude Code |
| --- | --- | --- |
| Sat Oct 24 | O1, O2, O3 | C2, C3 |
| Sun Oct 25 | O4, O5 | C4 |
| Mon Oct 26 | O6, O7 | C4 tests, C5 |
| Tue Oct 27 | O8, O9, O10, O11 | C6, C7 |
| Wed Oct 28 | O12; switch `USE_MOCK` off when C3 and C4 are announced here | C8; fix contract mismatches |
| Thu Oct 29 | Fixes from C9 | C9 end-to-end, both widths |
| Fri Oct 30 | Buffer | Buffer; the user sends Luke the build by 5:30 PM |

---

## 7. Rules for both agents

- **File ownership is strict.** opencode: `web/src/components/matrix/*` and `web/src/pages/ResourceMatrix.tsx`.
  Claude Code: everything else touched here. Ask under "Requests between agents".
- Read `CONTRIBUTING.md` and `docs/ARCHITECTURE.md` first. Database changes are additive only. UI gates mirror
  server rules; the server is the authority.
- **Don't commit or push.** The user commits. Don't touch `backend/.env`, `web/.env`, the live MySQL `ssaa`
  database, or `frontend/` (Expo, frozen).
- Test against mock data or a throwaway database (`DB_CLIENT=sqlite DATABASE_PATH=<scratch file>`), never the
  live MySQL.
- The servers are already running for the user on `localhost:8000` and `:8082` (Vite hot reload). Don't
  restart them unless they're down.
- Keep the double-booking guard, `ScheduleDayDialog`, Messages, and the invite/join pages working.

## 8. Defaults until Luke answers

- "Push" = an in-app notification plus a chat message. Email is sent only once a mail domain is verified;
  `notified.email` reports whether it went out. SMS isn't built.
- Leaving every Notify box unchecked = silent; the GC sees the change as Edited in the app only.
- Who can make the unassigned exception: level_1 and up, the same as his code.
- AI recommender and Upload Schedule: parked for phase 2.

## Requests between agents

**2026-10-23, late evening: Claude Code took over O1–O12 at the user's request.** opencode: stop editing the
matrix files and `ResourceMatrix.tsx`.

**Built (Claude Code, 2026-10-23): O1–O12 are done.**
- Files:
  - `web/src/pages/ResourceMatrix.tsx`
  - `web/src/components/matrix/`: `useMatrixDrafts.ts` (model, drafts, toBatch), `canDrop.ts` (drop rules and snap-back
    reasons), `EmployeeCard`, `MatrixGrid`, `SubSidebar`, `DraftBar`, `UnassignedDialog`, `NotifyDialog`,
    `GCNotifyDialog`, `helpers.ts`
- Verified by a browser run on a throwaway copy (sub, GC and phone). Everything below passes:
  - drag from the panel onto a cell
  - red outline
  - snap-back with a reason
  - two stretches in one day
  - Publish → Unassigned → Notify → confirmed
  - GC Edited/Sub tags
  - GC send → pending
  - move booked card
  - Revert
  - drag back to the panel
  - edge scroll
  - copy/paste a day
  - collapse
  - Schedule Overlay
  - phone tap-to-place
- Changes from the spec:
  - A move is "take off + place" (2 changes in the bar).
  - The whole side panel is a drop zone.
  - The grid's edge scroll is our own (dnd-kit's kept scrolling while the pointer was over the panel).
  - Cards can't select text while dragging (the browser scrolled the grid to follow the selection).
- `?mock=gc` or `?mock=sub` on `/matrix` shows demo data without a server.

**Claude Code → opencode (2026-10-23): the real API is live, ahead of schedule.**
- `GET /matrix`, `POST /schedule-requests/batch` (create, update, cancel, dryRun, allowUnassigned, notify),
  `POST /schedule-requests/:id/acknowledge-edit`, and `GET`/`PUT /projects/:id/assignments` all work on
  localhost:8000. They're covered by `backend/tests/matrix.test.ts` (12 tests, SQLite and MySQL).
- You can build O1 against the real API from the start (`USE_MOCK = false`). Keep the mock for states the
  demo data doesn't show yet. Sign in as `bnguye26@umd.edu` (GC Greg) or `baotn.it@gmail.com` (Subcontractor
  Steve), password `Test1234!`. This week (Oct 19–24) has data; next week fills in when seed v3 (C8) runs.
- How the server behaves, where it might surprise you:
  - A dry run lists would-be creates as `created: [{ requestId: "", index }]`.
  - `skipped[].reason` is ready to show, for example "Mike is already booked 7:00 AM–3:30 PM on Riverside
    Office Build on Mon, Oct 26."
  - `update` with `employeeIds: []` cancels; the id shows in `cancelled`.
  - If `notify` is left out: a GC send still sends the sub an in-app notification; a sub publish is silent.
  - In `notify`, `gcEmail`/`gcPush` mean "the other company" for both sides. On the GC's "Notify the
    subcontractor?" dialog, set those two fields.
- Seed v3 data you can rely on: Bao Plumbing's crew is assigned to **Riverside only**, so dropping any of
  them on Main St should give the red outline and the Unassigned dialog. Tuesday has Mike on Main St,
  confirmed with `assignedBySub` and `edited`. Dev (Volt Electric) is assigned to Riverside and Main St.
- Error codes: 400 = malformed body, 403 = permission, 409 = no company. Every rule violation comes back as a
  `skipped` entry, not an error.
