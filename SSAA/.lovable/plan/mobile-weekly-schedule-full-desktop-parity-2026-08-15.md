# Mobile weekly schedule: full desktop parity

Mobile only. Desktop weekly view is untouched.

## What's wrong today

On mobile the weekly view is a read-only strip: project chips, a day header, and per-project day cells. The employee dropdown only lists people already scheduled, employee cards are not draggable or selectable, and there is no available-personnel roster, no copy/paste of a day, no schedule-overlay toggle, and no way to assign or move anyone. Everything that makes the desktop weekly grid usable (the right-hand roster sidebar, drag-to-cell, chip multi-select, remove, publish drafts) is absent.

## What mobile will do after this change

Employees panel (top-right, dropdown):

- The "Employees" control stays a dropdown, anchored on the right of the toolbar above the grid. THIS SHOULD BE ON THE RIGHT SIDE LIKE IT IS ON DESKTOP
- It lists personnel for the selected day(s): the same roster the desktop sidebar shows — available personnel plus, grouped separately, who is already scheduled. GC/main-sub views group by subcontractor company exactly as the desktop sub-sidebar does; a sub sees their own roster.
- If no day is selected it shows the roster across the visible week; tapping a day header filters it to that day.
- Each person is tappable to select. Multiple people can be selected at once, and the count shows on the dropdown trigger.

Assigning and moving (tap-to-place, since drag does not work well on a phone):

- With people selected, the grid enters a "place" state: tap any project/day cell to assign everyone selected to that project and date. Selection clears after placing.
- Chips already in the grid are tappable too: select one or several, then tap another project/day cell to move them there. This is the mobile equivalent of desktop drag between cells, including multi-move.
- A slim action bar shows "N selected · Tap a day to place" with a Clear button.
- Same rules as desktop apply: cross-company assignments become requests to the personnel owner, main-sub intermediary routing is preserved, unassigned-to-project warnings and the confirmation dialog still fire, and cancelled chips still open the cancellation flow on tap.

Everything else from desktop:

- Remove a scheduled person (draft/confirmed/pending) from a cell.
- Copy a day's schedule and paste onto another day, with the existing override confirmation.
- Schedule Overlay (tasks) toggle available in the mobile toolbar.
- The draft bar with Revert/Publish, the notify-on-assign dialog, and the unassigned-assignment dialog all appear on mobile as they do on desktop.
- Endless week loading keeps working while scrolling right.

Presentation:

- Day columns and project rows stay horizontally scrollable with a sticky day header; chips render compactly with the same status colors and time/stop labels, no overlap or clipping.
- Selected chips get the same strong selection ring used on desktop.
- Tap targets sized for touch; the action bar and draft bar never cover the last row.

## Technical notes

- All work is in `src/components/dashboard/ResourceMatrix.tsx` inside the existing `if (isMobile)` branch, reusing the already-defined handlers (`handleDragEnd` logic extracted into a shared `assignToCell(projectId, dateStr, employeeIds)` path, `addRemovalDraft`, `handleCopySchedule`/`executePaste`, `getCardStatus`, `getEmployeeStopsForCell`, `toggleChipSelection`, `handlePublish`).
- Roster data comes from the same inputs the desktop sidebars use (`allEmployees`, `availabilities`, `scheduledEntries`, `crossGcBookings`, `employeeProjectAssignments`), so no new queries and no backend changes.
- Sidebar roster grouping logic is factored out of `MatrixSubSidebar`/`MatrixSidebar` into a shared helper so mobile and desktop render the same lists.
- Chip tap on mobile toggles selection instead of starting a drag; dnd-kit drag stays enabled for desktop only.

## Verification

In a mobile-sized session as both a GC and a subcontractor: open the weekly view, tap a day, confirm the dropdown lists available and scheduled personnel for that day, select one and several people, place them on a project/day cell, move an existing chip to another project, remove a chip, copy/paste a day, toggle the schedule overlay, then publish and confirm the draft bar and dialogs behave as on desktop. Any test assignments created are removed afterwards.