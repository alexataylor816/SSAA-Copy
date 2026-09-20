# Main subcontractor request access + endless weekly scrolling

## 1. Main subcontractor can see and act on the request

Access rules in the database already allow the in-between main subcontractor to read and update these requests, and the request card already hides Approve for them. The gap is in the dashboard: the subcontractor-side day filter only keeps requests where the viewer is the personnel-owning company, so a request routed through the main subcontractor never appears in their day view at all.

Change:
- Day/modal request lists on the subcontractor side include requests where the viewer is the in-between main subcontractor, not just the personnel owner.
- Those requests show Edit & Resend, Reject, and Cancel for the main subcontractor; Approve stays hidden (only the personnel-owning company can approve, as today).
- Bulk edit/cancel across multiple selected dates also matches requests where the viewer is the in-between company, so editing one day applies consistently.
- The request card labels the personnel-owning company so the main subcontractor knows whose people are being scheduled.

## 2. Weekly view keeps loading as you scroll

The weekly grid stops after a hard cap of 8 weeks (~2 months). Change it to endless loading:
- Remove the fixed cap; each time the user reaches the end (right edge on mobile, bottom on desktop) another block of weeks appends.
- Load in chunks of 4 weeks with a sentinel-triggered fetch, so scrolling far ahead stays smooth instead of rendering everything up front.
- Keep a safety ceiling far out (about 2 years) so a runaway scroll can't grow the DOM without bound, and stop the sentinel when reached.

## Technical details

- `src/pages/Dashboard.tsx`
  - `getRequestsForDate` sub branch (~2661): `req.sub_company_id === activeCompanyId || req.intermediary_company_id === activeCompanyId`.
  - `handleUpdateRequest`/edit-and-resend matching (~2307) and confirmed-request edit matching (~1875): same predicate instead of `sub_company_id === companyId`.
- `src/components/dashboard/ScheduleModal.tsx`: no permission change needed — `viewerIsIntermediary` already suppresses Approve; add the owning-company name on the pending request header when `sub_company_id !== requestingCompanyId`.
- `src/components/dashboard/ResourceMatrix.tsx` (~130-236): replace `MAX_WEEKS = 8` with `WEEK_CHUNK = 4` and `MAX_WEEKS = 104`; both IntersectionObservers advance by the chunk size; row-height tiering keeps its current values beyond 4 weeks.

## Verification

As Interior Office Logistics (main sub) on Office Fit Out, open a day with a Korth-to-DMV request: confirm the request is visible with Edit/Reject/Cancel and no Approve, and that DMV still sees Approve. In weekly view, scroll to the end repeatedly and confirm new weeks keep appending past two months.
