# Email the connection code to the connected subcontractor

## What gets added

In the Connected Contractors tab, inside the expanded "Share Project" panel (where the connection code is shown), add an **Email code** button next to the copy action.

Clicking it opens a dialog:

- Rows of **Name** + **Email address** for each person at the connected company who should receive the code.
- "Add another person" adds a row; each row can be removed.
- Optional short message field.
- **Send** emails the connection code to every listed person, greeting each by the name entered. Toast confirms how many were sent; failures show the reason.
- Send is disabled until at least one row has a valid email.

The email states who shared it, the project name, the connection code, and that entering the code in their Connected Contractors tab links the project.

## Correspondence template

Add a new editable email template in the operator dashboard under Manage SSAA -> Correspondence -> Emails, named "Project Connection Code Share". Operators can edit its subject and body there, and the send uses whatever is saved. Placeholders available: recipient name, sender company name, project name, connection code, and the optional custom message.

## Technical notes

Database migration: insert a `notification_templates` row with `event_type = 'project_connection_code_share'`, `channel = 'email'`, active, with `placeholder_variables` `{recipient_name, sender_company_name, project_name, connection_code, custom_message}`. It then appears automatically in the correspondence Emails tab, which is DB-driven.

New edge function `supabase/functions/send-project-connection-code/index.ts` (modeled on `send-contractor-invite` / `send-notification`):

- Bearer auth; body `{ connection_id, project_id, acting_company_id?, recipients: [{ name, email }], custom_message? }`, validated (valid emails, max ~20 recipients, length caps).
- Service-role client resolves the acting company: caller's `profiles.company_id`, or `acting_company_id` when the caller is an operator (same pattern as `send-contractor-invite`).
- Validates the `contractor_connections` row includes the acting company and is accepted; validates the project belongs to or is connected to the acting company.
- Loads the `project_connection_code_share` template, substitutes placeholders per recipient, sends with Resend, logs each send to `notification_log`.
- Registered in `supabase/config.toml`, deployed with `deploy_edge_functions`.

Frontend `src/components/dashboard/ConnectedContractorsTab.tsx`:

- New `EmailConnectionCodeDialog` component (in the same folder) holding the recipient rows and message.
- Tab opens it with the connection + project context and invokes `supabase.functions.invoke('send-project-connection-code', { body: { ..., acting_company_id: effectiveCompanyId } })`.

No schema changes beyond the template row.
