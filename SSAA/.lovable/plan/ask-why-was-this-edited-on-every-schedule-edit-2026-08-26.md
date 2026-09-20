# Ask "why was this edited?" on every schedule edit

Today only cancellations ask for a reason. Edits go through silently, so the other side sees changed people/times with no explanation. This adds the same optional-reason popup to edits, and shows the explanation under the edits. So if it shows the new request and what was changed the context/explanation appears once, under the personnel changes. 

## Behavior

When a GC or a subcontractor edits a schedule request and presses **Confirm Changes** (or **Confirm Changes For All Selected Days**, or **Send Edit Request** from the weekly view):

- A popup appears, styled exactly like the cancellation popup: title "Explain This Edit", short description, a free-text box labeled "Reason for Edit (optional)", a primary **Save Changes** button and a **Go Back** button.
- Leaving the box blank is allowed — the edit still saves.
- Pressing Go Back returns to the edit without saving, so nothing is lost.
- The same popup is used on desktop, tablet and mobile (single shared component, so all views match).

Where the explanation shows up afterwards:

- On the request card in the schedule modal, under the crossed-out original assignment: "Reason for edit: …" (same treatment as the cancellation reason today).
- In the project chat "Schedule edited" system card.
- In the notification/message sent to the other party about the edit.
- Each new edit replaces the previous reason, so the note always describes the latest change.

## Technical details

- Migration: add `edit_reason text` to `public.schedule_requests` (nullable). No new table, so existing grants/policies apply unchanged.
- New shared component `src/components/dashboard/EditReasonDialog.tsx`, modeled on the existing cancellation `AlertDialog` in `ScheduleModal.tsx` (lines ~3846-3885) and on `RejectRequestDialog.tsx`. Props: `open`, `onOpenChange`, `onConfirm(reason?: string)`, optional `mode` for the "all selected days" wording.
- `ScheduleModal.tsx`: intercept the four Confirm Changes buttons (~1804, 1819, 1837, 2596, 2608, 3053, 3061, 3152, 3160) — stash the pending payload in state, open the dialog, then invoke the existing callback with the reason appended. Callback signatures gain an optional trailing `reason?: string`.
- `Dashboard.tsx`: thread `reason` into `handleEditConfirmedRequest`, `handleEditConfirmedRequestForAllDates`, the GC edit-and-resend path, and `handleAcknowledgeEdit`; write `edit_reason` in the `schedule_requests` update and in the optimistic `setScheduleRequests` mapping. Include the reason in the notification body passed to `useNotification`.
- `ResourceMatrix.tsx` / `MatrixDraftBar.tsx`: when the publish is an edit (`allEditsOnly` / drafts carrying `originalRequestId`), show the same dialog before publishing and pass the reason through to the `edited: true` updates.
- Display: render `edit_reason` in `ScheduleModal.tsx` request cards near the existing edited badge, and in `SystemMessageCard.tsx` alongside the existing `cancellation_reason` block.
- Add English/Spanish strings to `src/i18n/translations.ts` for the dialog title, description, label, placeholder and buttons.