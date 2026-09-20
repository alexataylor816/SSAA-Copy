# Contacts: automatic cross-company contacts + reworked Contacts popup

## What changes for you

1. **Contacts popup layout**
   - "Add new contact" stays at the top; directly under it sits a **"Search SSAA database"** button.
   - Clicking it opens its own popup, styled exactly like the "Add new contact" popup, with search fields (name / email / phone), a results list, and one-click "Add to contacts".
   - The "Add new contact" popup becomes purely manual entry (name, job title, company, phone, email, Save) — the embedded search button moves out of it.
   - The contacts list below shows **every** saved contact, searchable by name, job title, company, or email.

2. **Automatic contacts when projects connect**
   - When a subcontractor connects to a GC/Guest project, contacts are created **both ways**:
     - GC/Guest side gets every person on the connected subcontractor's team assigned to that project whose permission is **Foreman (Level 2) or higher** (Foreman, Admin/Partial, Admin/Full, Account Holder). People below Foreman (Level 1 / basic) are not auto-added.
     - Subcontractor side gets everyone on the project from the GC/Guest company (same permission rule).

   - Same-company auto-contacts keep working as they do today.
   - **New people added later** to a connected project (or promoted to Foreman or above) are auto-added to the matching contact lists.
   - **Contacts are permanent**: disconnecting a project, or removing a project, never deletes contacts that were already created.

3. **Manual contacts for everyone**
   - GC, Guest and Subcontractor users can all add a contact manually whether or not that person has an SSAA account, and can search the SSAA database to link one.

## Technical notes

- UI: split `AddContactModal.tsx` into manual-entry only; new `SearchDirectoryModal.tsx` (same dialog shell/styling) using the existing `search_ssaa_users` RPC and inserting with `source = 'ssaa_link'`. `ContactsModal.tsx` gains the second button, widened search filter, and uses the effective (impersonated) user id passed from `MessagesView` instead of the auth user.
- DB: new security-definer function `sync_project_cross_company_contacts(p_project_id)` that pairs users of the project-owner company with users of each connected sub company (via `project_connections`, `guest_project_connections`, and `contractor_connection_project_assignments`), inserting reciprocal rows into `contacts` with `source = 'auto_project'` and the existing `ON CONFLICT ... DO NOTHING`.
- Permission filter: Foreman (Level 2) and above — `user_roles.permission_level` in (`level_1`, `partial`, `full`, `account_holder`); exclude `basic` (Level 1).
- Triggers to call it: insert on `project_connections`, `guest_project_connections`, `contractor_connection_project_assignments`, `user_project_assignments`, plus profile insert/company change and `user_roles` permission upgrade.
- Removal safety: the existing `tg_profile_company_contacts` / `tg_employee_contacts_cleanup` delete paths are narrowed so contacts survive project disconnection and project deletion (only a deleted user account removes its rows).
- Backfill: one-time run of the new function across all currently connected projects so existing accounts (e.g. Korth Construction seeing Foreman 1, Sprinkler Technician 1-3) are populated immediately.
