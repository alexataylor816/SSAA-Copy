# Mobile weekly: readable bottom bar + scheduled people must stay visible

Mobile only for the bottom bar. The visibility fix affects the weekly grid logic for subcontractor views (desktop benefits too, since it is the same data path).

## 1. The unsaved-changes bar runs off the screen

The bar is a fixed pill with fixed padding and no width limit, so on a phone the text ("You have 3 unsaved schedule changes") wraps into a tall column and the buttons push past the right edge.

Change on mobile only:

- Anchor the bar to the screen edges with a small margin instead of centering a fixed-width pill, so it can never overflow horizontally.
- Smaller text and tighter padding on phones; full-size styling unchanged on desktop.
- Compact wording on phones ("3 unsaved changes") with Revert and Publish sitting side by side on one row underneath, both tappable and fully visible.
- Keep clear of the bottom of the screen and never cover the last project row.

## 2. Personnel disappear from the weekly view after publishing

Confirmed from the data: the publish at 2:18 PM did save. It merged the three assignments into the existing GC request for Bridge Capital Partners Office Build out on Aug 10, and that request stayed in `pending` status. The weekly grid, when viewed as a subcontractor, only renders requests that are `confirmed` or `cancelled` — so the moment the drafts were published the chips vanished even though the assignments exist.

Two corrections:

- When a subcontractor publishes their **own** personnel into an existing pending request, that request becomes confirmed and marked sub-assigned, exactly like the path that creates a brand-new row. Personnel belonging to another (sub-of-sub) company keep the existing pending-request behavior — the owner still has to approve.
- The subcontractor weekly grid also renders `pending` rows that involve their own personnel, using the existing pending chip styling, so nothing scheduled is ever invisible while awaiting approval.

## 3. Monthly and weekly parity after scheduling

- After publishing, confirm the same people show as scheduled chips on the weekly grid and that the monthly calendar day reflects the scheduled/green state and lists those people when the day is opened.
- Verify for both a subcontractor account and an operator impersonating one (the case in the screenshots, CCA (Demo)).

## Technical notes

- `src/components/dashboard/MatrixDraftBar.tsx`: responsive layout via `useIsMobile` / responsive classes; no behavior change to publish or the notify dialog.
- `src/components/dashboard/ResourceMatrix.tsx`:
  - `doPublish` sub path: in the "merge into existing request" branch, when `isOwn`, set `status: 'confirmed'`, `sub_assigned: true`, and honor `silent_assignment` the same way the insert branch does.
  - `matrixData`: in non-GC mode include `pending` requests whose `sub_company_id` is the viewer's company; `getCardStatus` already resolves those to the pending style.
  - No schema or backend changes.

## Verification

At phone viewport, as CCA (Demo): select personnel, place them on a project day, publish, and confirm the chips remain on the weekly grid and the bar was fully readable before publishing. Then open the monthly view for the same date and confirm those people appear. Any assignment created during testing is reverted afterwards.
