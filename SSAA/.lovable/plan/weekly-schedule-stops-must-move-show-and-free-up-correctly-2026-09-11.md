# Weekly schedule: stops must move, show, and free up correctly

Four connected problems, all in the weekly board and its right-hand availability list.

## What's wrong today (confirmed in the code)

1. **Dragged stops disappear.** When a stop card is dropped on another project, the board only draws a card if that person's availability for that stop was saved against the *target* project (or marked "all projects"). CCA's Stop 2 was saved against Office Fit Out, so on Bridge Capital it had nothing to draw and vanished — even though the pending change was counted.
2. **A stop with no card also loses its label.** Same cause: when the card falls back to the plain version, the "Stop 2 · 7:30 AM – 10:00 AM" line is gone, which is why the card under Commercial Office shows only "Not assigned to project".
3. **The availability list on the right ignores stops.** That list never receives the information about which stops are already taken, and it does not collapse the same stop saved under several projects. So Stop 1 keeps showing as available after it is scheduled, and stops appear repeated.
4. **A person can end up on two projects at once.** Because Stop 1 still shows as available on the right, dragging it in creates a second placement while the original stays put — the same stop then sits on Office Fit Out and Bridge Capital. Separately, when one stop is dragged out of a cell, the whole person is currently pulled out of the source cell instead of just that stop.

## What changes

- Dropping a stop anywhere draws that exact stop, with its "Stop N · start – end" line, regardless of which project the availability was originally saved under. This applies to the pending/red "not assigned to project" state too.
- The availability list on the right hides stops that are already scheduled, requested, or part of an unsaved change, and shows one entry per stop instead of one per project the stop was saved against. Stops already placed appear in the "scheduled" grouping, not the available one.
- Freeing a stop (removing it, or reverting changes) puts that stop back in the available list.
- Moving one stop out of a cell leaves the person's other stops in that cell; the person only disappears from the cell when their last stop leaves.
- The same stop can never sit on two projects on the same day: placing it on a new project removes it from the old one.

## Technical notes

- `getEmployeeStopsForCell` in `ResourceMatrix.tsx`: when drafts pin explicit `stopId`s to a cell, resolve those availability rows by id from `availabilities` instead of filtering the project-scoped `blocks` list. Same for saved `employee_stops` entries on a request.
- `matrixData` step 2 (draft removals): only drop the employee from the source cell when the draft has no `stopId`, or when every remaining stop for that employee/cell has also moved away; otherwise keep them. `getEmployeeStopsForCell` for the source cell excludes stop ids that have a `move` draft pointing elsewhere.
- `MatrixSubSidebar` currently receives no stop-awareness. Pass `scheduledStopKeys.perStop` and `scheduledStopKeys.allStopsByEmpDate` (already computed in `ResourceMatrix`) plus the same dedupe key used by `MatrixSidebar`/`mobileRosterGroups` (`date::stop::<stop_number>`, falling back to `date::range::start::end`), and filter `availableStops` with them. Scheduled-stop rendering in the sidebar should list the stops actually recorded on the request (`employee_stops`) rather than all availability blocks.
- Sidebar drops (`sidebar::<empId>::<availId>`) should also cancel any existing placement of that same stop on another project/date for that day, so re-adding a stop moves it rather than duplicating it.

## Verification

As the candido, the actual user, viewing CCA on the week of Sep 14: drag Stop 2 and Stop 3 of Drywall Technician 1 to Bridge Capital — both cards appear with their stop labels, Stop 1 stays on Office Fit Out, and the right-hand list no longer offers Stop 1/2/3 as available. Drag Stop 1 to Commercial Office and confirm its stop and times show above the "not assigned to project" note, and that Stop 1 leaves Office Fit Out. Revert changes and confirm the list returns to its original state. Any test placements are reverted, not published.

## Also: duplicated Stop #1 / #2 / #3

Availability is stored as one row per project a stop was saved against, so a stop saved for two projects becomes two identical rows. Lists that show one entry per row therefore repeat the same stop — visible both in the GC "Available Personnel & Time Slots" list (Friday, Stop #1 listed twice) and on Bridge Capital Sep 18.

Fix: collapse duplicates before display everywhere stops are listed or placed — one entry per person, per date, per stop (keyed on stop number, falling back to the exact start/end times). Ticking or dragging that single entry behaves the same as today; nothing about how availability is saved changes. But ENSURE THAT THE STOPS THAT ARE SHOWN, ARE APPLICABLE TO THAT SPECIFIC PROJECT. SO ANYTHING HIDEN IS FOR A DIFFERENT PROJECT. 

Technically this is the same dedupe helper already used by `MatrixSidebar` and the mobile roster, applied to `ScheduleModal`'s per-employee stop list, `MatrixSubSidebar`, and the weekly cell renderer (`getEmployeeStopsForCell`).