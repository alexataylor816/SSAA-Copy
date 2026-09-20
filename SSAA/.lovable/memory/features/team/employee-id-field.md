---
name: Optional Employee ID field
description: Optional employees.employee_id column for payroll/HR identifier shown only on profiles and timesheet exports
type: feature
---
The `employees.employee_id` column is an optional, nullable text field for an external payroll/HR identifier.

**Where it can be set:**
- Manage My Profile (writes to the user's linked employee row, if any)
- Manage Team Profiles → create/edit employee form
- Bulk import (Excel/CSV column headers: "Employee ID", "Emp ID", "ID", "Employee #", "Employee Number"; image OCR extraction in `parse-employee-roster`)

**Where it is displayed:**
- Manage My Profile
- Manage Team Profiles employee edit form
- Timesheet CSV export (first column: `Employee ID`)

**Never displayed in:** calendar chips, schedule modals, sidebar, employee rosters, drag overlays, or any scheduling UI.

Field is never required. Empty values are stored as NULL and exported as blank cells.
