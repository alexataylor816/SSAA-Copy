# Reliable schedule People messages, cancellation alerts, and request pushes

## Confirmed failure

Rob’s approval reached the notification function and resolved all four Akers personnel accounts. Their direct People conversations were created, but every message insert failed because `send-push` used message kind `text`; the database constraint only permits `user` (plus the existing system-message kinds). The delivery log contains the failed rows for Sprinkler Technicians 1–3 and Foreman 1 with the full project, address, dates, and hours.

## Changes

### 1. Fix approved-schedule messages for every employee

- Change the People-message insert in `send-push` to the valid user-message kind so the existing direct conversation receives the message.
- Keep the current employee-account resolution, personalized recipient name, project name, address, grouped dates, hours, subcontractor name, and server-validated sender attribution.
- Keep operator impersonation behavior: a valid operator/MOA override sends as the impersonated user; ordinary users send as themselves.
- Do not treat email success as message success. Return and log each recipient’s People-message, bell, and browser-push outcome so a failed message cannot be reported as successful. AND ENSUR THAT THE FUCKING MESSAGE IS SENT IN THE PEOPLE SECTION!!!!!! WITHOUT WASTING ANOTHER 30 CREDITS. USE THE CLEANEST AND MOST ELEGANT SOLUTION THAT IS BUILT FOR SCALE 

### 2. Notify scheduled personnel automatically when a schedule is cancelled

- On cancellation of a confirmed schedule, notify every employee listed on that schedule automatically; this is not dependent on project-manager recipient lists or optional notification preferences.
- Send each employee:
  - an email;
  - an in-app bell/browser push notification;
  - an individual People-section direct message.
- Include recipient name, project/job name, address, cancelled date(s), hours, cancelling company/person context, and cancellation reason when supplied.
- Attribute every People message to the actual cancelling user. If an operator is impersonating a user, use the impersonated user after server-side operator validation.
- Preserve the existing cancellation notification to the opposite company’s assigned users and the existing project-chat/system-message behavior.
- Await delivery and record per-recipient failures instead of firing the cancellation notification in the background after showing success.

### 3. GC/Guest schedule requests: project message plus a People message and push

- Keep the existing project-section schedule-request message exactly as it is.
- When the sender selects push/message, additionally deliver to each qualifying subcontractor user:
  - a bell/browser push notification; and
  - a People-section direct message containing the same schedule-request content that appeared in the project message.
- Recipients are subcontractor users who:
  - are assigned to that project;
  - have notifications enabled for that assignment; and
  - have Level 3 (`partial`), Level 4 (`full`), or main company account holder permission.
- The People message is attributed to the GC/Guest user who sent the request. If an operator is impersonating that user, the message still appears from the impersonated user, validated server-side.
- Keep the existing email selection and recipient rules unchanged.
- Apply the same recipient filter to monthly and weekly GC/Guest request creation paths, replacing any weekly path that currently selects every company profile.

### 4. Cover all relevant cancellation and approval paths

- Use shared helpers so monthly, weekly, bulk/multi-date, edited-request approval, and direct-assignment confirmations cannot diverge.
- Ensure personnel notification runs after the confirmed/cancelled database change succeeds and uses the employee IDs stored on the affected request(s).
- Keep project-chat messages and current email behavior intact except for adding the required personnel cancellation email.

## Technical details

- Update `supabase/functions/send-push/index.ts` to insert `kind: 'user'`, preserve validated sender overrides, support project-only push with `skip_message`, and return granular outcomes.
- Update `src/pages/Dashboard.tsx` cancellation handling to send employee IDs, employee emails, rich cancellation variables, `effectiveUserId`, and to await the result.
- Update request push call sites in `src/pages/Dashboard.tsx` and `src/components/dashboard/ResourceMatrix.tsx` to use the existing project-assignment recipient RPC, pass the sending user for attribution, and create the People message alongside the push.
- Add/update the active `schedule_cancelled` email and push templates with the required personnel details while retaining correspondence-template editability.
- No new test users, schedules, conversations, or notifications will be left in the database.

## Verification

1. Re-run the Akers-style approval with Rob as the approver: each scheduled technician gets one People DM from Rob containing project, address, dates, and hours, plus email and push/bell delivery.
2. Repeat while an operator impersonates Rob: the People message still shows Rob as sender.
3. Cancel a confirmed multi-person schedule: every scheduled employee receives email, push/bell, and a People DM from the cancelling person with complete cancellation details.
4. Send a GC and Guest request with push/message selected: only project-assigned Level 3, Level 4, and account-holder users receive it; the project message is unchanged, and each of those users also gets a People message with the same content from the sending user (including when an operator is impersonating them).
5. Verify monthly and weekly paths, inspect delivery logs for successful message creation, and remove all verification data created during testing.