# Operator dashboard: see and control everything

Status: brainstorm and plan, 2026-10-23. For Luke (SSAA operator) and whoever owns this feature.
Sources: Luke's Oct 23 walkthrough (0:00 and 46:15 in the recording), his original code in
`SSAA/src/features/scheduling/manage/` (ManageSSAAModal, ManageOperatorsModal, ManageCorrespondenceModal,
ManageSubscriptionsModal, ManageCancellationRequestsModal), and what our build has today.

## 1. What Luke asked for

> "When a customer calls with a problem, I need to quickly see exactly what they see. I can't log in as
> them because their passwords are protected."

- **View as** a company or a user, defaulting to the company's main account holder (there can be several,
  for example a CEO and a CTO). A "Viewing as: <name> (<company>)" badge shows in the top bar.
- **Manage SSAA:**
  - Subscriptions: plans, user subscriptions, discount codes, guest accounts, synced to Stripe. A
    Stripe-only fallback is acceptable for the MVP.
  - Cancellation requests.
  - Correspondence: Email, Push and Log tabs; every template editable without code.
  - Operators.
- **Operator levels** in his code:
  - Main Operator (full access)
  - Operator (view only)
  - OMO (the owner, Luke)

## 2. What we have today (built 2026-10-23)

| Area | Status |
| --- | --- |
| `/operator` with Luke's tabs: Manage SSAA, Users, Subcontractor, General Contractor | Built |
| View as any user or company (account holder), red "Viewing as" bar on every page, Exit | Built and tested |
| Safety during view-as: operator tools, password change and company deletion refused; can't view as another operator; 8-hour session; logged | Built |
| Cancellation requests (approve and delete / reject) | Built |
| Operators: grant or revoke by email | Built (single level only) |
| Correspondence: edit subject, body, channel, on/off with live preview | **Editable but not used:** the app sends hard-coded text. Fix first (P0). |
| Subscriptions, discount codes, guest GCs | Not built (Stripe fallback accepted) |

## 3. "See everything": ideas, most useful first

1. **Platform overview** (the operator's home):
   - Companies (GC/sub), users, active projects, and requests this week by status.
   - Join requests waiting, cancellation requests waiting, emails that failed today.
   - One glance tells Luke whether the platform is healthy.
2. **Company page:** one screen per company.
   - Account holders, members and levels, employees.
   - Projects and connections (which GCs and subs).
   - Request history, last activity, plan.
   - The **View as** button, plus "View as <another member>".
3. **User page:** company, level, last sign-in, assigned projects, devices with notifications on, recent
   notifications and emails sent to them.
4. **Schedule explorer:** every request on the platform, filterable by company, project, date, status and
   Edited. Answers "why didn't my guy show up Tuesday?" in one search.
5. **Correspondence log:** every email and in-app notification sent, with recipient, template, status and
   failure reason (Luke's Log tab). Built on a `notification_log` table written by the same code that sends.
6. **Audit log:** every operator action (view-as start/stop, permission changes, deletions, template
   edits) with who, when and what changed. Needed once more than one person operates the platform.
7. **System health:** database, email provider (Resend/SMTP verified domain), realtime connections, and
   the last error.

## 4. "Control everything": ideas

| Control | What it does | Guard |
| --- | --- | --- |
| Send password-reset link | The customer resets their own password (operators never see or set passwords) | Main operator |
| Change a user's email / name | Fix typos in sign-ups | Main operator, audited |
| Change permission level, transfer account holder | The "my admin left" call | Main operator, audited |
| Suspend / reactivate a user or company | Stop a bad actor or a non-payer without deleting data | Main operator, confirm dialog |
| Move a user between companies | Wrong company at sign-up | Main operator |
| Fix a stuck request | Cancel or re-open a request a customer can't change (for example a locked week) | Main operator, reason required |
| Regenerate a project's connection code | A code was shared too widely | Main operator |
| Edit any template + **send a test** to yourself | Change wording without code, check it before it goes out | Main operator |
| Turn features on per company | For example the AI recommender for beta customers | Main operator |
| Announcement banner | "Maintenance tonight 10 PM" shown to everyone or one company | Main operator |
| Trade lookup list (shared with the AI recommender) | Add "VAV install → HVAC" style rules everyone benefits from | Main operator |
| Plans and discount codes | Stripe for the MVP; screens later | OMO |

## 5. Safety rules (apply to all of the above)

- **Three operator levels**, as in Luke's code:
  - **OMO:** everything, including operators and billing.
  - **Main Operator:** all controls.
  - **Operator:** view only, and view-as only, with no changes.
  - Today we have one level; add a `operator_level` column on users.
- **View-as stays read-mostly by default.** Optionally add a "view only" view-as mode for support staff
  that blocks every write while impersonating.
- **Everything is audited** (who, what, before → after), and destructive actions need a typed confirmation.
- **Operators never see passwords**; they send reset links.

## 6. Build order

| # | Item | Size | Why first |
| --- | --- | --- | --- |
| P0 | Make templates actually drive notifications and emails (render `{placeholders}`, respect on/off) + add Luke's missing templates (Contractor Connection Declined, Connected Contractor Request / Invite, Employee Welcome, Invite GC, availability reminders, password reset) | M | Luke asked for this explicitly; today edits do nothing |
| P0 | Correspondence **Log** tab + `notification_log` table | S | Lets Luke answer "did they get the email?" |
| P1 | Platform overview home + company page + user page | M | The "see everything" core |
| P1 | Operator levels (OMO / Main / View-only) + audit log | M | Needed before anyone but Luke gets access |
| P1 | Password-reset link, change level, transfer account holder, suspend | M | The common support calls |
| P2 | Schedule explorer, system health | M | Faster support |
| P2 | Feature flags per company, announcement banner, trade lookup editor | S each | |
| P3 | Subscriptions and discount codes screens (Stripe-synced) | L | Stripe dashboard is the accepted fallback |
| P3 | Guest GCs | L | Needs the guest-company model first |

Owner: per the call, one teammate takes the operator dashboard. This doc plus `web/src/pages/Admin.tsx`,
`web/src/lib/viewAs.ts`, `backend/src/admin/routes.ts` and `backend/tests/operator.test.ts` are the starting points.
