# Fix onboarding link, duplicate team-add error, and Connected Contractors visibility

## 1. "Set Up Your Account" email link is dead

The welcome email builds its link against a hard-coded address that isn't a real app URL (`s-a-a-a.lovable.app`), so the button lands on "No Lovable project found at this address."

Fix: point the link at the live site (`https://ssaainc.com`) in the employee-creation function that composes the email, so the button opens `/onboarding-reset?...` on the real app and signs the new employee in.

## 2. "Add Team Members to Project" fails with a duplicate-key error

The dialog decides who is "available to add" from the already-loaded project team list. When that list hasn't finished refreshing (the case where the people appeared a minute later), employees who are already assigned still show as addable, and inserting them collides with the uniqueness rule on employee + project.

Fix:

- Re-read the project's current assignments when the dialog opens, so the "available" list is accurate rather than derived from stale state.
- Make the add operation idempotent: insert while ignoring rows that already exist, so a duplicate never surfaces as an error.
- After a successful add, refresh the team list immediately (await the refresh) rather than relying on background timing — this removes the "wait a minute and they appear" delay.
- ENSURE THAT IF THE USER ASSIGNS THE PERSONNEL TO THE PROJECT IN MANGE TEAM, THEN GOES AND ADDS THEM TO THE PROJECT IN PROJECT TEAM, THAT THIS DOES NOT CREATE A DUPLICATE OR ERROR

## 3. Connected Contractors tab should only show for the Main Contractor

Today the header button appears for any subcontractor with any accepted connection, regardless of which side holds the main contract.

Fix: only show the button when the active company is recorded as the **main** company on at least one accepted connection. A company that is only the sub-of-a-sub on every connection never sees it; the same company still sees it on projects/connections where it does hold the main role. The count badge reflects only connections where they are the main.

## 4. Main Contractor cannot see the sub-of-sub roster or availability

The **Shared Project toggle remains required and stays in force**. No sub-of-sub personnel or availability will be exposed unless that connection is shared to the selected project.

The live data confirms that the Interior Office Logistics → DMV Flooring connection is accepted, its Bridge Capital project assignment has `shared = true`, DMV has five personnel assigned to that project, and those personnel have availability. The missing display is therefore caused by frontend filtering after the valid shared data is loaded:

- The Connected Contractors ribbon modal fetches the connected company's roster and availability, but access and display must be constrained to a `shared = true` assignment for the selected project. Fix the modal to list only shared connections for that project and load their assigned personnel plus availability.
- The weekly schedule passes only the main subcontractor's own personnel into the matrix. Fix it to include the sub-subcontractor personnel from `shared = true` assignments for the selected project. ENSURE THAT THE WEEKLY SCHEDULE NOTES THAT THOSE EMPLOYEES ARE PART OF A THAT SUBSUBS COMPANY. SO FOR MAINSUBCONTRACTOR VIEW ON WEEKLY, IT LISTS THEM, BUT IT WILL HAVE THE COMPANY NAME,DROP DOWN MENU, THAT LISTS THOSE EMPLOYEES, FROM MAIN GC VIEW, THE EMPLOYEES ARE UNDER THE MAIN SUBCONTRACTOR DROP DOWN, BUT THEN ARE IN ANOTHER DROP DOWN MENU WITH THAT SUBSUBCONTRACTORS NAME, UNDER THAT MAIN SUBCONTRACTOR
- The monthly day modal similarly starts by filtering personnel to the main subcontractor's own company, then filters again by project assignment. Fix it to include shared sub-subcontractor personnel assigned to the selected project, so clicking a date shows them when they have availability that day.

This will not change booking, sharing, or connection-role behavior; it only removes the incorrect company-only filters in these three views after the existing share authorization has passed.

## Technical notes

- `supabase/functions/create-employee-user/index.ts`: replace `baseUrl = "https://s-a-a-a.lovable.app"` with `https://ssaainc.com`; redeploy the function.
- `src/components/dashboard/RightPanel.tsx`: refetch `employee_project_assignments` for `selectedProject` on dialog open; switch the insert to `.upsert(rows, { onConflict: 'employee_id,project_id', ignoreDuplicates: true })`; await `onTeamRefresh?.()` before closing.
- `src/pages/Dashboard.tsx` (~line 334): change the connection-count query to `.eq('main_company_id', activeCompanyIdForConnections).eq('status','accepted')`.
- Preserve the existing RLS requirement that cross-company personnel and availability are readable only through a `contractor_connection_project_assignments` row with `shared = true`; do not broaden access to all accepted connections.
- `src/components/dashboard/ConnectedContractorsViewerModal.tsx`: constrain displayed connections by the selected project's shared assignments and load only personnel assigned to that selected project before matching their availability.
- `src/pages/Dashboard.tsx`: derive one shared-personnel set from `contractor_connection_project_assignments` where `main_company_id = activeCompanyId`, `project_id = selectedProject`, and `shared = true`; union those assigned personnel into both the `ResourceMatrix` employees prop and the `ScheduleModal` employees prop.

## Verification

Sign in (or impersonate) as Interior Office Logistics on Bridge Capital and confirm DMV Flooring personnel appear in all three shared locations: the Connected Contractors ribbon modal, weekly schedule, and monthly date modal on their available days. Turn sharing off and confirm they disappear from all three; turn it back on and confirm they return. Also confirm DMV Flooring (sub-of-sub only) does not see the ribbon tab. Re-run the Add Team Members flow on an already-fully-assigned project and confirm no error toast.