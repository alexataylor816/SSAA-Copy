# Scope schedule personnel by account type

## Goal

Ensure subcontractors see only personnel belonging to the subcontractor company they are currently viewing, in both weekly and monthly schedule views. GC and Guest GC accounts will continue to see the full connected personnel roster.

## Changes

- Scope the weekly `ResourceMatrix` roster and rendered employee lookup to the active subcontractor company when the schedule is in sub mode.
- Remove connected/sub-of-sub personnel from the subcontractor’s own weekly sidebar, matrix cells, mobile roster, and scheduling employee sources.
- Scope the monthly schedule’s personnel/team panel and Set Availability roster to the active subcontractor company in sub mode, while retaining the existing basic-user restriction to the linked employee.
- Keep GC and Guest GC behavior unchanged so they can see connected subcontractor personnel.
- Preserve existing request/status visibility needed for a subcontractor’s own company, but prevent unrelated companies’ employee records from being displayed or selected.
- Add regression checks for a subcontractor view, a GC view, and a Guest GC view, including operator impersonation where applicable.

## Technical details

- Update the existing derived employee collections in `src/pages/Dashboard.tsx` rather than changing database policies or data.
- Pass already-filtered employee collections to `ResourceMatrix`, `RightPanel`, and the schedule modal; add a defensive company check inside `ResourceMatrix` so future callers cannot accidentally widen sub visibility.
- Keep `allEmployees` available for GC/Guest GC views only; do not use it to add connected-company employees to a sub roster.
- Validate the rendered weekly and monthly DOM at desktop and mobile-sized viewports and confirm no unrelated personnel names appear.
