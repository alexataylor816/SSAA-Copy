# Only ask "Explain This Edit" when an actual edit was made

Right now the explanation popup also appears when someone simply confirms the other side's changes without touching anything. That should stop.

## Behavior

- Accepting the other side's changes (the orange "Confirm Changes" button on a request marked as edited, with no edit mode opened) saves straight away — no popup.
- Clicking Edit or Edit & Resend, changing people/times, then pressing the blue "Confirm Changes" (or "Confirm Changes For All Selected Days") still shows the popup, for GC, Guest and subcontractor, on desktop and mobile.

## Technical details

- `src/components/dashboard/ScheduleModal.tsx` line ~1869: the acknowledge button currently calls `askEditReason('single', ...)`. Change it to call `onAcknowledgeEdit(req.id)` directly.
- Leave the other `askEditReason` call sites unchanged (~1826, 1845, 2632, 2649, 3107, 3115, 3206, 3214) — those are the real edit-save paths.
- No database or API change; `edit_reason` stays optional and `handleAcknowledgeEdit` in `src/pages/Dashboard.tsx` keeps its optional reason parameter.
