# Connected Contractor invites, connection requests, and declines

Three moments in the Connected Contractors tab, each with its own message:

1. **Invite a contractor to SSAA** — an email invitation to join SSAA and connect.
2. **Connection request to a company already on SSAA** — the people you choose get an email, a push notification, and a message in the People section of Messages, from the person who made the request.
3. **Request declined** — the person who sent the request gets an email, a push notification, and a People message from the person who declined.

Every push notification opens the related message in the app when tapped, the way notifications behave in any other app.

## 1. New email template: invite a company to join (connected contractors)

Event: `contractor_invite_new` (email), editable in Manage SSAA > Correspondence > Email.

Written for subcontractors: explains that {inviting_company_name} uses SSAA to share manpower availability with the general contractor on their projects, that they have invited {invited_company_name} to join and connect, what happens next (start a free trial account, add your crew, share availability), and to connect with {inviting_company_name} to get started.

Placeholders: `inviting_company_name`, `invited_company_name`, `sign_in_url`.

The existing generic `contractor_invite` template stays as fallback so nothing breaks.

## 2. New email template: invite an existing SSAA company to connect

Event: `contractor_connection_request` (email), also editable in the Email section.

Says {inviting_company_name} sent you a connection request on SSAA so you can share manpower availability with the GC, and you can accept it in the Connected Contractors tab.

Placeholders: `inviting_company_name`, `invited_company_name`, `sign_in_url`.

## 3. New push/message template: connection request

Event: `contractor_connection_request` (push), editable in the Push section, with a short title/body plus the longer body used for the People message.

Says {inviting_company_name} sent you a connection request so you can share manpower availability with the GC, and you can accept it in the Connected Contractors tab.

Placeholders: inviting_company_name, invited_company_name, sign_in_url.

## 4. New templates: Request Declined Connected Subcontractors 

Event: `contractor_connection_declined`, one email template and one push/message template, both editable in Manage SSAA > Correspondence.

Email says {declining_company_name} declined the connection request from {inviting_company_name}, with a line that they can be contacted or invited again later. The push/message version is the short form, delivered as a bell entry and a People message from the person who declined.

Placeholders: `inviting_company_name`, `declining_company_name`, `decliner_name`, `sign_in_url`.

Recipient: the user who created the request (the operator's impersonated user if it was sent that way).

## 5. Who gets it — you choose the recipients

Nobody is messaged automatically:

- **Invite a contractor to SSAA:** the email addresses typed into the Invite dialog.
- **Connection request:** after picking a company in Search Subcontractors, a recipient step appears listing that company's people (name, job title, email). The sender can search that list by name/email or scroll it, and check one or more people.
- **Decline:** only the requester.

Each selected recipient of a connection request gets the email, a push notification and bell entry, and a People message from the sender (the impersonated user when an operator is acting as a company).

## 6. Behavior in the tab

- **Send Request** stays disabled until a company is selected AND at least one person at that company is checked, so a request can never go out with no recipients.
- **Invite a contractor to SSAA** is its own button and always sends the join-invite email (`contractor_invite_new`) to the typed addresses. The search flow never falls back to it.
- Invite dialog copy notes that if the company is already on SSAA they should search for it instead.
- Declining a request from the incoming-requests list triggers the decline email + push + People message to the requester.

## Technical notes

- Data: insert five `notification_templates` rows via `run_sql`, skipping if present: `contractor_invite_new`/email, `contractor_connection_request`/email, `contractor_connection_request`/push, `contractor_connection_declined`/email, `contractor_connection_declined`/push.
- New SECURITY DEFINER function `list_company_contact_candidates(p_company_id uuid, p_acting_company_id uuid)` returning user_id, full name, job title, email for the target company's users — RLS blocks cross-company profile reads. Restricted to sub-company members and operators acting as one.
- `supabase/functions/send-contractor-invite/index.ts`: prefer `contractor_invite_new`, fall back to `contractor_invite`, then built-in HTML.
- New edge function `send-connection-request-notice` handling both `request` and `declined` modes: validates the caller and that recipients belong to the relevant company, sends email via Resend from the matching template, then invokes `send-push` with a `sender_user_id` override so the People DM and bell entry come from the acting person. Push payload carries the conversation id for deep linking.
- `ConnectedContractorsTab.tsx`: add the searchable recipient checkbox list after company selection; gate the Send Request button on company + ≥1 recipient; after `create_contractor_connection_request`, invoke the notice function with `acting_company_id: effectiveCompanyId` and selected user ids; after `respond_contractor_connection_request(..., accept=false)`, invoke it in `declined` mode.
- Push click-through: service worker `notificationclick` opens `/messages?conversation=<id>`; `MessagesView` selects the conversation from that param.
- `ManageCorrespondenceModal.tsx` needs no change — new template rows appear automatically by channel.

## Verification

Send one connection request with two selected recipients, decline it from the other side, and send one join-invite to a fictitious company that is 


|                                                   |
| ------------------------------------------------- |
| saaatest1+ (name of fictitious company)@gmail.com |


 ; confirm the emails, bell entries, and People messages land with correct sender attribution, then delete all test invite/connection/notification/message rows.