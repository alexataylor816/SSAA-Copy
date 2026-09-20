# Multi-stop scheduling: pick, move, and notify by stop

Today a person's day can be split into stops (5:00–7:30, 7:30–10:00, 10:00–1:30), but a schedule request only records *who* was requested, never *which stops*. Everything downstream inherits that gap: the request editor can only check a person on or off, the weekly board drags all of a person's stops together, and confirmation sends one message for the whole day.

## What changes for users

**1. Editing a request (the "Edit Employee Selection" list)**

Each person is listed once, with their stops underneath as separate checkboxes:

```text
[ ] Drywall Technician 2 - Drywall Technician
      [x] Stop 1: 5:00 AM - 7:30 AM
      [ ] Stop 2: 7:30 AM - 10:00 AM
      [ ] Stop 3: 10:00 AM - 1:30 PM
```

- Checking the person name checks all their stops; unchecking clears them.
- A person with a single block (no stops) keeps today's single checkbox.
- If the person was requested for the whole day and stops were added to their availability afterwards, every stop comes in pre-checked.
- Saving keeps the person on the request with only the checked stops — no more "remove them and start over".

**2. Availability list (second screenshot)**

Repeated identical times collapse to one entry per stop, so a day reads
`Friday: 5:00 AM - 7:30 AM, 7:30 AM - 8:00 AM, 8:00 AM - 12:30 PM` instead of repeating each range once per project. The project names stay where they are now: on their own line directly under the person's name and job title.

**3. Weekly board (third screenshot)**

- Every card for a person with stops shows the stop on the card (`Stop 2 · 7:30 AM – 10:00 AM`), including after a move, so it's clear which stop went where.
- Dragging one stop card moves only that stop. The person's other stops stay on the original project/day.
- After publishing, the split is remembered: the person shows on both projects, each with its own stops.

**4. Messages on confirmation**

When a schedule is confirmed, each stop generates its own message/push to the assigned person, so someone with three stops receives three notices — one per location and time window. People with a single block keep getting one message, exactly as today.

## Technical notes

- Add a per-stop selection store on `schedule_requests`: a new `employee_stops jsonb` column shaped `{ "<employee_id>": ["<availability_id>", ...] }`, plus a matching backfill rule — a person present in `employee_ids` with no entry means "all stops", which keeps every existing row and every non-stop workflow behaving as it does now.
- `ScheduleModal.tsx`: build a per-employee stop tree from `availabilities` for the request's date (deduped by `stop_number`, falling back to start/end range), render nested checkboxes, and pass the stop map through `onSubEditAndResend` / `onSubEditAndResendForAllDates` / `onEditConfirmedRequest` into the update in `Dashboard.tsx`.
- Availability summary rendering in `ScheduleModal.tsx` (`getEmployeeStopsByDate`): dedupe stops by `stop_number` or `start_time|end_time` before display.
- `ResourceMatrix.tsx`: `getEmployeeStopsForCell` reads the request's `employee_stops` instead of falling back to all availability rows; drag drafts already carry `stopId`, so publish writes the resulting stop set per employee into `employee_stops` on both the source and target requests (source keeps the person when stops remain).
- `MatrixEmployeeCard` already accepts `stopLabel`/`timeLabel`; ensure the matrix passes them for confirmed and draft placements alike.
- Confirmation notification path (`Dashboard.tsx` confirm handler → `send-push` / `sendNotification`): iterate the person's confirmed stops and send one message per stop with that stop's time range, using a per-stop idempotency key so retries don't duplicate.
