# Personnel messages on approval, edits, and assignments

Scheduled personnel should reliably get a push notification plus a People-section message from the person who approved or assigned them, with the full job details.

## What's happening today

- Approval does fire a push + People message (confirmed in the notification log), but the message is one thin line: "SSAA: You are scheduled on {project} {date} {start}-{end}." with no address, no company, no greeting, and the notification title shows only "SSAA".
- The greeting says "there" whenever more than one person is scheduled, because one shared body is built for the whole group.
- When an operator is impersonating (e.g. acting as Rob), the message is posted from the operator's account, not from Rob.
- Multi-date approvals send one separate message per date instead of one message listing the dates.
- Personnel with no linked login receive THE MESSASGE THEY MUST STILL GET THE FUCKING MESSAGE.  — they must still get the message waiting for them.

## Changes

### 1. Richer, personalized message

- Rewrite the `schedule_confirmed_personnel` push template so it has a real title and a body containing: recipient name, job/project name, project address, date(s), start and end time, and the company that scheduled them.
- Resolve `{recipient_name}` per recipient inside the send-push function from the recipient's profile, so each person is greeted by name instead of "there".
- Pass project address, sub company name, and a combined date list as variables from the app.

### 2. Correct sender attribution

- Allow the send-push function to accept an explicit sender when the caller is an operator impersonating a user, verified server-side. The message and the People conversation are then created as coming from the impersonated approver (Rob), not the operator.
- Non-impersonated calls keep using the signed-in caller as sender — unchanged.

### 3. Every approval path notifies personnel

Audit and wire the personnel notification into all transitions that put a request into a confirmed state:

- Sub approving a request (already wired).
- Sub/GC confirming an edited request (already wired).
- Bulk confirm of edits across multiple selected dates.
- Draft approval.
- Sub self-assignment from the monthly modal and from the weekly publish flow (already wired, gated on the user's chosen channels — kept as is).

Approvals covering several dates or several requests for the same person are grouped into a single message per person listing all dates, instead of one message per date.

### 4. Guaranteed People message for every scheduled person

The project-chat message stays as it is. On top of that, each individual scheduled person must get their own People (direct) message from the approver/editor/assigner whenever that person selected the push/message option. The sender is always the subcontractor-side person who acted — whoever approved it, or whoever edited it and sent it back to the GC/Guest.

- Trace and fix the drop-off for scheduled personnel who currently receive nothing (the Akers sprinkler technician case): confirm at each step whether the employee resolved to a user, whether the direct conversation was created, and whether the message row was inserted, then fix whichever step drops them.
- Personnel messages are sent per person, never collapsed into the project chat only, and never limited to company account holders or the notification-preference list — the scheduled people themselves are always the recipients.
- Covers all triggers uniformly: sub approves; sub, GC, or Guest edits and the edit is later approved by the sub; and direct assignment from the weekly or monthly schedule.
- Each People conversation is between the acting person (e.g. Rob at Akers) and the scheduled person, so the message shows up under People attributed to Rob.

### 5. Every employee has an account, so every employee gets the message

Every employee has a login account created when the employee record was created — they simply may not have signed in and changed their password yet. That is not a reason to skip them: the message lands in their account's People section and is waiting at first sign-in.

- Make email required everywhere an employee is added or edited IN THE MANAGE MY COMPNAY ACCOUNT, MANAGE TEAM SECTION (single add, edit, and bulk import), since the account depends on it.
- Backfill the employees that are currently missing a linked account: match to an existing user by email, and create the account for the rest exactly the way employee creation does, so every roster entry has a real account.
- Delivery then always resolves to a user, and the outcome for each recipient is recorded in the notification log.

## Technical notes

Files touched: `supabase/functions/send-push/index.ts` (per-recipient name resolution, operator sender override, grouped message body), `src/pages/Dashboard.tsx` (`notifyScheduledPersonnel` variables, grouping, sender passthrough, missing confirm paths), `src/components/dashboard/ResourceMatrix.tsx` (pass sender context), `src/hooks/useNotification.ts` (optional sender field). Template text for `schedule_confirmed_personnel` (push channel) updated via a data update; the Correspondence tab stays the editable source of truth afterwards.

## Verification

Approve a request as a subcontractor for two dates with two personnel, then confirm: two People conversations from the approver, one message each listing both dates with address and hours, matching bell entries, and no stray test rows left behind.