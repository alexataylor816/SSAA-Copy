# GCs schedule through the main subcontractor, not the sub-of-sub

## Behavior

1. **Select Subcontractors list (monthly day modal)**
   - Companies that are a sub of another listed subcontractor (DMV Flooring under Interior Office Logistics) no longer appear as their own checkbox. Only main subcontractors are selectable.
   - Selecting the main subcontractor (Interior Office Logistics) makes its own personnel *and* its sub-of-sub personnel appear in "Available Personnel & Time Slots", each row keeping the owning company name (DMV Flooring Installation Specialists) as it does today.
   - The main sub's row is no longer greyed out as "No availability" when the availability actually comes from its sub-of-sub.
   - Quick Selection lists the main subcontractor and counts sub-of-sub personnel under it, so headcount auto-pick still works.

2. **Requests still go to the right company**
   - Picking sub-of-sub personnel creates a request targeted at that sub-of-sub, with the main subcontractor recorded in between — unchanged from the current approval rules (only the sub-of-sub approves; the main sub can edit, reject, cancel).

3. **Weekly view**
   - DMV Flooring appears nested inside the Interior Office Logistics dropdown instead of as a separate top-level company. Today the nesting is skipped whenever the sub-of-sub also has its own direct connection to the project, which is why it shows separately in the screenshot.

## Technical notes

- `src/pages/Dashboard.tsx`
  - `weeklyCompanyGroups` (GC branch): when a company from `getConnectedSubCompanies` is also the `sub_company_id` of a shared `contractor_connection_project_assignments` row whose `main_company_id` is in the list, set `parentCompanyId` on the existing entry instead of skipping it. `MatrixSubSidebar` already renders nested groups from `parentCompanyId`.
  - Pass the existing `intermediaryByCompanyId` map into `ScheduleModal` as a new prop (e.g. `subParentByCompanyId`).
- `src/components/dashboard/ScheduleModal.tsx`
  - Derive `childrenByMain` from the new prop; filter the `connectedSubCompanies` checkbox list to companies that are not a child of another listed company.
  - Add `effectiveSelectedSubIds = selectedSubCompanies ∪ children(selectedSubCompanies)` and use it in `availableEmployeesForGC` (line ~1359) and in the Quick Selection employee grouping (`emp.company_id === quickSelectSub` becomes "quickSelectSub or one of its children").
  - `subHasAvailability(subId)` also considers employees of that sub's children.
  - No change to the personnel row rendering — it already prints the employee's company name.
- Request creation paths keep using the employee's own `company_id` for `sub_company_id` and stamp `intermediary_company_id`, as implemented previously.

## Verification

As Korth (Office Fit Out demo): open a day, confirm DMV is absent from Select Subcontractors, select Interior Office Logistics, confirm DMV personnel are listed with their company label, and check the weekly view shows DMV nested under Interior Office Logistics. Any test rows created are removed afterward.
