# Faster Set Availability + bigger, readable modal

## What's causing the delay

When the dashboard loads, it pulls entire tables with no filtering and mostly one after another:

- All availability rows ever created (currently 4,159 rows), fetched 1,000 at a time in sequential round trips, then followed by extra queries to merge shared-contractor availability.
- All employees in the system, then a second query for their permission levels.
- All employee/project assignment rows.

Until every one of those finishes, the Set Availability list is empty, which is why personnel show up only after a pause (and briefly read "No employees found").

## Fix the latency

- Fetch availability only for a rolling window around the calendar the user is viewing (a few months back/forward) instead of all history, and extend the window when the user navigates to other months.
- Scope employees, project assignments, and availability to the companies and projects the current viewer (or the impersonated user) can actually see, rather than fetching every row and filtering in the browser.
- Run the independent dashboard fetches concurrently instead of sequentially, and fold the follow-up permission-level lookup into the same pass so the roster isn't blocked on a second round trip.
- Keep a loading state in the Set Availability modal: while personnel are still loading, show a short loading indicator rather than "No employees found. Add employees in Manage Team." so the empty message never appears incorrectly.
- Cache the loaded roster between modal opens so reopening the dialog is instant.

## Modal sizing and button text

- Increase the Set Availability dialog width on desktop (from the current small width to a wider dialog) and give the personnel list more vertical room, keeping it scrollable and fully usable on mobile.
- Fix the action row so "Remove Availability" is never clipped: let the buttons size to their text with wrapping instead of forced equal halves, so Cancel / Remove Availability / Set Availability all read in full at every width.

## Scope

Applies to all users and account types (GC, subcontractor, guest, and operator impersonation); no change to who can see or edit which personnel.

## Technical notes

- `src/pages/Dashboard.tsx`: `fetchEmployees`, `fetchAvailabilities`, `fetchEmployeeProjectAssignments` — add company/project scoping and a date-range filter on `availability.start_time`; parallelize the mount-time fetch block; expose a `loading` flag for the schedule modal roster.
- `src/components/dashboard/ScheduleModal.tsx`: widen `DialogContent` (`sm:max-w-2xl`), raise the roster `max-h`, replace the empty-state text with a spinner while loading, and rework the sticky footer grid so button labels don't truncate.
