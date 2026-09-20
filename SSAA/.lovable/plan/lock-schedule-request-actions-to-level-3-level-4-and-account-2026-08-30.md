# Lock schedule-request actions to Level 3, Level 4, and account holders

Subcontractor personnel below Level 3 can currently approve, edit, reject, and dismiss schedule requests. They should be able to view requests only — no actions — including when an operator is impersonating them.

## Current state (verified)

- `Dashboard.tsx` passes `readOnly={effectiveIsBasicUser || (!effectiveHasLevel1OrHigher && !effectiveIsMOA)}` to the schedule modal. That means Level 2 (`level_1`) users are NOT read-only, so they see Approve, Edit & Resend, Reject, Accept & Dismiss, and sub-assign controls.
- Approve / Edit & Resend / Reject buttons in `ScheduleModal.tsx` are gated only by `!readOnly`; the acknowledge ("Accept & Dismiss") blocks are gated only by `!readOnly` too.
- The database `Update schedule requests` policy allows any user in the owning/sub/intermediary company to update a request, with no permission-level condition — so a Level 2 user can still act via direct API calls.

## What will change

1. Introduce a single "can act on schedule requests" flag in `Dashboard.tsx`, true only for `partial` (Level 3), `full` (Level 4), and `account_holder` — computed from the effective (impersonated) identity, so an operator impersonating a Level 1/2/basic user gets the same restriction. An operator viewing a company without a specific user keeps account-holder-level access.
2. Pass that flag into `ScheduleModal` and use it to hide/disable: Approve, Edit & Resend, Reject / Remove & Cancel, Notify Personnel, Accept & Dismiss (rejection/cancellation acknowledgement), edit-confirmed-request controls, and sub-assign. Viewing request details, personnel lists, and times stays unchanged.
3. Keep availability actions unchanged for users who have them today — only schedule-request actions are restricted.
4. Weekly view (`ResourceMatrix.tsx`) becomes strictly view-only for anyone below Level 3: no drag/tap placement, no chip selection or moving, no remove, no copy/paste, no quick-add, no draft bar, no publish, no exception dialogs — all action controls hidden, not just disabled.
5. Weekly view content is also narrowed for those users: they see only the projects they are assigned to, only the days on which they themselves are scheduled, and within those cells only the crew scheduled alongside them. Other projects, empty days, and unrelated personnel are not rendered, and the personnel roster/sidebar (available-personnel list) is hidden entirely since they cannot assign anyone. Example: Sprinkler Technician 1 at Akers sees only their own scheduled days on their assigned project, with the co-scheduled crew listed.
6. The same narrowing and view-only behavior applies on mobile weekly and when an operator impersonates that user.
7. Guard the handlers in `Dashboard.tsx` (`handleApproveRequest`, `handleRejectRequest`, edit/acknowledge/assign handlers) with an early return plus a clear "You don't have permission" toast, so nothing slips through UI edge cases.
8. Database migration: tighten the `schedule_requests` UPDATE policy to additionally require `public.has_partial_or_higher()` (operators still allowed via `is_moa()`), so the restriction is enforced server-side and not just in the UI.


## Technical notes

- Files: `src/pages/Dashboard.tsx`, `src/components/dashboard/ScheduleModal.tsx`, `src/components/dashboard/ResourceMatrix.tsx`, plus one migration on `public.schedule_requests`.
- `has_partial_or_higher()` already exists and returns true for `partial`, `full`, `account_holder`, and MOA.
- No test data will be created; verification is done by reading the effective flags and confirming the policy definition.
