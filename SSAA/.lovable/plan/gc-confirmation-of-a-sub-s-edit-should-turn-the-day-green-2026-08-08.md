# GC confirmation of a sub's edit should turn the day green

## What's happening now

On the CCA / Korth "Office Fit Out (Demo)" project, several requests sit in `pending` with no edit flag left on them — the signature of a sub editing a request and the GC then clicking "Confirm Changes".

The GC's "Confirm Changes" action only clears the edit markers (`edited`, original employees/times, last editor). It never changes the request status, so the request stays `pending` and the GC calendar keeps painting the day yellow/orange instead of green.

## What to change

When the GC confirms a sub's edit, treat it as final agreement:

- Clear the edit markers (as today) **and** set the request status to `confirmed`.
- Update the local state the same way so the calendar recolors immediately without a refresh.
- Keep the sub's side consistent: the request shows as confirmed for both companies, since the sub already proposed those exact changes.
- this should trigger the notifications to the subcontractors personnel as well 

No change to the reverse direction: when the GC edits and resends, the sub still has to approve.

## Technical details

- `handleAcknowledgeEdit` in `src/pages/Dashboard.tsx` (around line 2174): add `status: 'confirmed'` to the `schedule_requests` update and to the optimistic `setScheduleRequests` mapping. Adjust the toast to say the schedule is confirmed.
- Day coloring in `src/components/dashboard/CalendarPanel.tsx` already derives green from `confirmedCount` vs `totalRequestedSubs`, so no color-logic change is needed once the status is right.
- The existing confirmation guard trigger only blocks the in-between main subcontractor, so a GC confirming a direct request is unaffected.
- Optional data cleanup: the already-acknowledged rows on Office Fit Out (Demo) (e.g. 2026-08-04 and 2026-08-05) remain `pending` from the old behavior; they can be flipped to `confirmed` so the demo project reads correctly.

## Question

The cleanup of those existing demo rows is included as a final step; say the word if you would rather leave historical rows untouched.