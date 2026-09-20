# Fix false "No request sent" when personnel are available

## What's happening

When a GC (or an operator impersonating one) picks personnel and time slots in the Schedule Subcontractor modal, the request is only created for dates where the browser's cached data can confirm availability. That check runs entirely against local state:

- The owning company of each selected person is looked up in the locally cached employee list. If a selected person isn't in that cached list, the code falls back to the checked subcontractor and then finds zero matching personnel for it.
- Availability is matched against the cached availability array, which is loaded in a rolling date window and can be stale relative to what the modal just displayed.

If either lookup comes up empty, no rows are inserted and the red "No request sent — none of the selected personnel had availability on the selected dates" toast fires, even though the modal clearly listed and accepted those time slots.

## The fix

Make request creation trust the user's actual selection and verify against the database instead of only cached state:

1. Resolve each selected person's owning company from the cached roster; for anyone not found there, read the owner directly from the database before grouping requests by company.
2. Build the availability check from three sources, in order: the time slots the user explicitly checked in the modal (authoritative — they came from real availability rows), the cached availability, and finally a direct database read for exactly the selected people and selected dates.
3. Only skip a date when none of those sources show availability, so the "No request sent" message can only appear when there genuinely is none.

Behavior for GC, Guest GC, sub-of-sub (intermediary) routing, notifications, and operator impersonation stays exactly as it is today.

## Technical notes

- File: `src/pages/Dashboard.tsx`, `handleScheduleGC` (target-company resolution and the per-date availability filter before the `schedule_requests` insert).
- Replace `employees.find(...)` owner resolution with a map plus a `supabase.from('employees').select('id, company_id').in('id', missing)` fallback.
- Replace the per-date `availabilities.some(...)` scan with a `Set` of `employeeId::yyyy-MM-dd` keys seeded from `data.selectedStops`, then cached `availabilities`, then a scoped `availability` query bounded by the selected date range (UTC day boundaries, matching the existing `getUTC*` date convention).
- No schema, RLS, or modal changes; no change to which personnel a user can see or select.

## Verification

Reproduce the reported flow in the live preview as the operator impersonating the GC: select two dates, choose the subcontractor, check the listed time slots, send the request, and confirm pending `schedule_requests` rows are created for both dates and the success toast appears. Remove any test rows created during verification.
