# Main subcontractors scheduling sub-of-sub personnel

Main subcontractors can already *see* shared sub-of-sub personnel (weekly roster and monthly overlay), but every scheduling action still assumes the personnel belong to the acting company. This plan makes sub-of-sub personnel schedulable as **requests**, never as direct assignments, and keeps approval power with the sub-of-sub.

## Behavior

1. **Main sub selects/drags sub-of-sub personnel (weekly grid or monthly day modal)**
   - Instead of a silent self-assignment, the system creates a schedule request addressed to the sub-of-sub company: status `pending`, requester = main sub, target = sub-of-sub.
   - Personnel from different companies picked in one action are split into one request per company: own personnel keep today's silent self-assign behavior, sub-of-sub personnel become requests.
   - UI wording changes on those chips/actions from "Assign" to "Send request" so the difference is obvious before publishing.

2. **Only the sub-of-sub approves**
   - The sub-of-sub sees the request in its own dashboard and is the only party with an Approve/Confirm button.
   - The main sub sees the same request read-only for approval, but keeps Edit, Cancel, Reject and personnel-change actions.

3. **GC selects sub-of-sub personnel**
   - The request is targeted at the sub-of-sub (they approve), and the main sub is recorded as the in-between contractor so it appears on the main sub's dashboard too.
   - Main sub can edit (times, personnel, dates), reject, or cancel — Approve stays hidden for them.
   - Edits by the main sub reset the request to pending and re-notify the sub-of-sub, matching the existing edit-and-resend flow.

4. **Notifications** follow the existing schedule-request notification path, addressed to the approving company (sub-of-sub) and copied to the main sub on status changes.

## Technical notes

- **Schema**: add `intermediary_company_id uuid` to `schedule_requests` (FK to `companies`, nullable). Semantics: `sub_company_id` = company whose personnel are scheduled and the only company allowed to confirm; `requesting_company_id` = originator (GC or main sub); `intermediary_company_id` = main sub sitting between them.
- **RLS**: extend the existing SELECT/UPDATE/DELETE policies on `schedule_requests` with `intermediary_company_id = get_user_company_id()` so the main sub can read and edit but never becomes the approver. Confirmation gating is enforced in a trigger: a transition to `confirmed` is only allowed when the actor's company equals `sub_company_id` (or MOA).
- **Request creation**:
  - `ResourceMatrix.tsx` publish path (sub mode, `~1287-1299`): group draft changes by employee company. Rows for companies other than the acting company insert with `status: 'pending'`, `sub_assigned: false`, `silent_assignment: false`, `requesting_company_id` = acting company, `sub_company_id` = employee's company.
  - GC publish path (`~1111-1120`) and the GC modal insert in `Dashboard.tsx` (`~1032-1047`): when selected employees belong to a shared sub-of-sub, target that company and stamp `intermediary_company_id` with the main sub from `sharedContractorAssignments`.
  - `Dashboard.tsx` `handleSubAssign` (`~1303-1341`): same split — own company keeps `confirmed`/`sub_assigned`, other companies become pending requests.
- **Approve gating**: `ScheduleModal.tsx` (`~2647-2668`) currently derives `showApprove` from "not the last editor". Add a company check: hide Approve whenever the viewer's company is not `sub_company_id`; keep Edit/Reject/Cancel for the intermediary and requester.
- **Dashboard queries**: include `intermediary_company_id` in the `schedule_requests` selects and in the realtime-refresh filters so requests show for main subs viewing their own project schedules.
- **Company resolution** keeps using `activeCompanyId` (impersonation-aware) so operators acting as a company behave identically.

## Verification

Sign in (or impersonate) as the main sub, drag a shared sub-of-sub employee onto a weekly day, publish, and confirm a pending request row exists with the correct target/intermediary; then check as the sub-of-sub that Approve is present, and as the main sub that Approve is absent while Edit/Reject/Cancel work. Test data created during verification is removed afterward.
