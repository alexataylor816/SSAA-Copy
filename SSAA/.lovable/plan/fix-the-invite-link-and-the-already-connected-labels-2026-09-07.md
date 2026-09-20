# Fix the invite link and the "already connected" labels

## 1. "Get started here" link goes nowhere

In the invite email the link is broken: it shows the raw `{invite_link}` text and the link itself points at nothing. Two causes:

- The invite email never fills in `invite_link` (or `invitee_company_name`) when it is sent, so those words go out as-is.
- The saved template's link was mangled when it was edited in the editor, so the address of the link is malformed.

Fix: the invite email will fill in the link with the SSAA home page (https://ssaainc.com/) and the invited company's name, and the stored template's link will be repaired so "Get started here" is a clean link to the home page. The same malformed link is repaired in the connection-request email ("Review the request").

## 2. Companies that declined still show as "Already connected"

Akers and Duct Installers declined, but the search list still greys them out as already connected, because the list treats any past connection row — including declined ones — as a connection.

Fix: only live connections (pending or accepted) count. Declined companies appear normally in the search list and a fresh request can be sent to them again.

## 3. You can pick your own company in the search

The search already tries to exclude the searching company, but the exclusion can miss when an operator is acting as a company. Fix: always exclude both the acting company and the signed-in user's own company from results.

## Technical notes

- `supabase/functions/send-contractor-invite/index.ts`: also replace `{invite_link}` (→ `https://ssaainc.com/`) and `{invitee_company_name}` (→ invited name) in subject/body; redeploy.
- Data fix via `run_sql`: rewrite the anchor markup in `notification_templates.body_html` for `contractor_invite_new`/email and `contractor_connection_request`/email so `href` is `{invite_link}` / `{sign_in_url}` with plain link text (removes the `&lt;span data-placeholder=` corruption and the placeholder chip inside the href).
- `ConnectedContractorsTab.tsx`: `alreadyConnectedIds` built from `connections.filter(c => c.status !== 'declined')`.
- Migration: recreate `search_sub_companies_for_connection` to exclude both `p_acting_company_id` and `get_user_company_id()`.

## Verification

Send one invite to a test address and confirm "Get started here" opens ssaainc.com with no leftover placeholder text; confirm Akers and Duct Installers are selectable again; then delete the test invite rows.
