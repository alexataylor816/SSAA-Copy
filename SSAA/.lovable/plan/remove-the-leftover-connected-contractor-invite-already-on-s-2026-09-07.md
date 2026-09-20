# Remove the leftover "Connected Contractor Invite (Already on SSAA)" template

## What changes

Delete the unused duplicate invite template from Manage SSAA > Correspondence. It is the old backup copy of the not-on-SSAA invite, it never sends today, and its name/description contradict its content.

After this, the Connected Contractors tab has exactly two emails:

1. **Connected Contractor Connection Request (Already on SSAA)** — sent to the people you check after picking a company that already has an SSAA account and pressing Send Request (with push notification and People message).
2. **Connected Contractor Invite (Not On SSAA)** — sent to the addresses typed into "Invite a contractor to SSAA".

Unchanged: the decline notice, and the project Share Project > Send Invite email, which is a separate template.

## Deactivation must mean silence

Today the invite button falls back to old wording built into the code if no template is found, so turning a template off still sent an email. That is wrong. From now on:

- If the invite template is missing or set to inactive, no invite email is sent
- Same rule for the connection request and decline emails: inactive means nothing goes out on that channel.

## Technical notes

- `run_sql`: `DELETE FROM notification_templates WHERE event_type = 'contractor_invite' AND channel = 'email';`
- `supabase/functions/send-contractor-invite/index.ts`: drop the `contractor_invite` legacy lookup and the hardcoded HTML/subject fallback; if no active `contractor_invite_new` email template exists, skip sending and return a clear "template inactive" result instead of an error.
- `supabase/functions/send-connection-request-notice/index.ts`: already skips email when no active template is found — keep that, and return the skipped status so the UI can report it.
- Redeploy both functions.

## Verification

Confirm only two Connected Contractor invite/request templates remain in Correspondence, that an invite sends normally with the template active, and that deactivating it results in no email being sent.