# Sub-of-sub visibility: nested roster, gated tab, and Subcontractor Overlay

## 1. Nest the sub-of-sub under its main subcontractor (weekly sidebar)

Today the right-hand "Subs — <day>" list shows Interior Office Logistics and DMV Flooring Installation Specialists as two sibling groups (DMV is currently labeled with a "Main › Sub" name prefix).

Change it so DMV appears as a nested, collapsible group *inside* the Interior Office Logistics group: expanding the main subcontractor reveals its own personnel plus a child dropdown for each connected sub-of-sub whose availability is shared on this project. The child group keeps its own available/scheduled counts and personnel cards, indented one level. The "Main › Sub" name prefix is dropped since nesting now conveys the relationship. This nesting applies across the board to every main subcontractor and every shared sub-of-sub, not just this pair.

## 2. Connected Contractors ribbon tab — removed

The tab at the top of the ribbon is hidden for all subcontractor companies, in every case — main subcontractors, sub-of-subs, and operators viewing them, on any project or the Master Schedule.

This applies only to the top ribbon tab. The Connected Contractors tab inside Manage My Company Account stays exactly as it is.


## 3. New "Subcontractor Overlay" box (monthly view, main subcontractor)

On the monthly view, add a card in the right column directly **under Project Team**, styled and behaving like the GC "Sub Availability Overlay":

- Title: **Subcontractor Overlay**, with an on/off switch.
- When on, it lists each connected sub-of-sub company shared on this project, each with a checkbox and a count of days they have availability this month.
- Checked companies paint the monthly calendar with the same per-day availability chips GCs see (company name + number of available personnel).
- Card is hidden entirely when there are no shared sub-of-sub connections on the selected project.

## Technical notes

- `src/components/dashboard/MatrixSubSidebar.tsx`: extend the company group model with an optional `parentCompanyId`, build a parent → children tree before render, and render children indented inside the parent's expanded body (own collapse state per child). `src/pages/Dashboard.tsx` `weeklyCompanyGroups` supplies `parentCompanyId` from `sharedContractorAssignments.main_company_id` and stops prefixing names.
- `src/pages/Dashboard.tsx`: stop showing the ribbon's Connected Contractors tab for subcontractor views entirely — drop the `connectedContractorsCount` gate/query feeding `DashboardHeader` so the tab never renders for subs. The Manage My Company Account tab is untouched.
- `src/components/dashboard/RightPanel.tsx`: render the new overlay card for `isSubView` when `sharedSubSubCompanies.length > 0`, placed after the Project Team card. Reuse `SubOverlayPanel` with a title prop (`Subcontractor Overlay`) rather than duplicating it; add the string to `src/i18n/translations.ts` (EN/ES).
- `src/pages/Dashboard.tsx`: derive `sharedSubSubCompanies` from `sharedContractorAssignments` + `companies`, pass to `RightPanel`, and include those company ids in `getSubOverlayData()` so `CalendarPanel` receives the day chips. Sub-view currently short-circuits `getConnectedSubCompanies` to `[]`; the new list is separate and does not change GC behavior.
- No database or policy changes; sharing remains gated by the existing `shared` flag.
