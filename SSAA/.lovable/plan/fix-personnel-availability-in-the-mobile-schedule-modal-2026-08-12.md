# Fix personnel availability in the mobile schedule modal

## Problem confirmed

For the account shown, CCA (Demo) has schedulable personnel with saved availability, but the monthly-calendar modal can still receive an empty `employees` list after project-assignment filtering. The modal then displays “No employees found” without reconciling that roster with the availability rows for the selected date.

## Implementation

- Build one authoritative roster for the schedule modal instead of allowing the mobile/monthly path to use an empty prefiltered list.
- For subcontractors, include eligible personnel from their own company who are assigned to the active project **or** have applicable availability for the selected date/project; preserve the existing company-isolation and permission rules.
- Preserve the existing main-subcontractor handling for personnel on shared projects, without exposing unrelated companies or projects.
- Use that same roster and the same selection handlers in mobile and desktop so mobile supports the complete existing workflow: view personnel, select/deselect people, edit times, use multiple stops, remove availability, and save availability.
- Keep project scoping, scheduled-person blocking, historical locks, basic-user restrictions, and timezone-safe date matching unchanged.

## Mobile presentation

- Keep the modal vertically scrollable and ensure the employee list and controls fit a phone viewport without hiding the action buttons.
- Do not create a separate simplified mobile workflow; mobile will render the same functional controls as desktop in a responsive layout.

## Verification

- Test at a mobile viewport as the affected subcontractor/user on a date with saved personnel availability and confirm names appear instead of the empty-state message.
- Exercise employee selection, multiple stops, time editing, removal, and saving from mobile.
- Repeat the same selected project/date on desktop and confirm the roster and actions match.
- Check a project/date with genuinely no eligible personnel still shows the correct empty state, and verify unrelated company personnel never appear.
- Do not create persistent test records; if a write is required to validate saving, remove the test data immediately afterward.
