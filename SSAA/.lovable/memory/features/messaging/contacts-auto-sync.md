---
name: Contacts auto-sync across connected companies
description: Two-way contact creation for connected projects, Foreman (level_1) and above, contacts never removed on disconnect
type: feature
---

- `sync_project_cross_company_contacts(project_id)` pairs the project owner company with every connected partner (`project_connections`, `guest_project_connections`, shared `contractor_connection_project_assignments`) and inserts reciprocal `contacts` rows with `source = 'auto_project'`.
- Eligibility: `contact_eligible_users(company_id)` = Foreman (Level 2 = enum `level_1`) and above (`level_1`, `partial`, `full`, `account_holder`), plus users with no `user_roles` row. `basic` (Level 1) is excluded.
- Triggers keep it current: inserts on `project_connections`, `guest_project_connections`, `contractor_connection_project_assignments`, `user_project_assignments`, profile insert/company change, and `user_roles` permission changes.
- Contacts are permanent: disconnecting or deleting a project never deletes contacts. Only deleting the user's profile removes their auto contacts (`tg_profile_company_contacts` DELETE branch). `tg_employee_contacts_cleanup` is now a no-op.
- Messages UI: Contacts popup has "Add new contact" (manual only) and "Search SSAA database" (separate popup, same styling, uses `search_ssaa_users`). Contact list is searchable by name/job title/company/email/phone and scoped to the effective (impersonated) user.
