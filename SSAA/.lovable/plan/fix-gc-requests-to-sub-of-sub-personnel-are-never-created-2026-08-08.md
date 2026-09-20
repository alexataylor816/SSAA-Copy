# Fix: GC requests to sub-of-sub personnel are never created

## What is actually happening

Korth's request was never saved. A database check shows zero schedule requests involving Interior Office Logistics or DMV Flooring — the newest request in the system is from Aug 4 (Korth to CCA). So the days are uncolored because there is no request to color; the day-coloring logic itself is fine.

Cause: after the recent change that hides sub-of-subs from "Select Subcontractors", the GC now checks only the main subcontractor (Interior Office Logistics), while the personnel they pick belong to DMV Flooring. When the request is submitted, the code looks for the selected people *inside the checked company only*, finds none, and silently skips creating any request (it only shows a "No availability" toast).

## The fix

1. On submit, build the list of companies to create requests for from the **owning company of each selected person**, not from the checkbox list. Selecting Interior Office Logistics and picking DMV personnel creates a request against DMV.
2. Each such request keeps the main subcontractor as the intermediary (Interior Office Logistics), so the existing rules stand: the main sub can edit/cancel, only DMV can approve.
3. Personnel belonging directly to the checked main sub continue to produce a normal request as they do today.
4. Replace the silent skip with a clear error toast when a selection produces no request at all, so this can never fail invisibly again.

Once created, the request appears on Korth's calendar with normal pending (and later confirmed) day coloring, since GC coloring already counts every request the GC initiated on the selected project.

ENSURE THAT ALL OTHER DAY COLORINGS ARE APPLICABLE AS WELL. LIKE CANCELED, OR EDITED,ETC

## Verification

Send a Korth request on Office Fit Out to DMV personnel through Interior Office Logistics, confirm the row is stored with the correct sub/intermediary, confirm the days color on Korth's calendar, then remove the test request.

## Technical details

- `src/pages/Dashboard.tsx` → `handleScheduleGC`: derive target company ids by grouping `data.employeeIds` by `employees[].company_id` (falling back to `data.subCompanyIds` for companies with no selected personnel); set `intermediary_company_id` from `intermediaryByCompanyId[owningCompanyId]` when it differs from the requesting company. Notification/email grouping follows the same per-owning-company loop.