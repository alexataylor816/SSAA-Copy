# Fix: a moved shift can vanish when it's dragged back

## What's happening

Drywall Technician 1's Stops 1, 2 and 3 were moved up to Commercial Office Fit Out, then all three were selected and dragged back to Office Fit Out. Stops 2 and 3 returned, Stop 1 did not — it went back to the available list, and the board still reported unsaved changes.

## Why

The same shift is saved once for every project it was made available to, so one real shift can exist as several near-identical records with different internal IDs. The weekly board collapses those duplicates and shows one card, but the card is labelled with whichever duplicate it happened to pick, while the pending move is remembered under a different duplicate.

When the card is dragged back, the board compares the two labels, sees them as different shifts, and so:
- it does not cancel the original move (the shift is still recorded as moved away), and
- it records a brand new move on top.

Whichever duplicate happens to be picked decides whether a shift survives the round trip, which is why Stops 2 and 3 came back and Stop 1 did not. The same mismatch can silently drop shifts when publishing, since the saved shift list on a request is matched against the same IDs.

## The fix

Give every real shift one canonical identity — the same shift, for the same person on the same day, always resolves to one ID no matter which duplicate record a card, a pending change, or a saved request refers to.

Apply that single identity consistently:
- Cards, drag handles, and pending changes all use the canonical shift.
- Dragging a shift back to where it came from cancels the pending move, whatever duplicate it came in as.
- Dragging one shift out leaves the person's other shifts untouched in the original cell.
- A shift that is booked, requested, or has a pending move stays out of the available list; cancelling or reverting puts it back exactly once.
- Publishing and reading saved requests resolve shifts the same way, so nothing is dropped or double-counted on save.
- Project scoping is unchanged: shifts that belong to a different project stay hidden for the selected project.

## Technical detail

- Add a shared helper in `src/components/dashboard/ResourceMatrix.tsx` that maps any availability row ID to a canonical stop ID for that (employee, date, stop) group — keyed on `stop_number`, falling back to the exact start/end range — plus the reverse expansion to all sibling row IDs.
- Normalise `stopId` to the canonical value when creating drafts in `applyChipDrop` and in the sidebar removal/re-add paths, and when comparing in the cancel-back-to-origin branch and the conflicting-draft filter.
- Normalise on read too: `getEmployeeStopsForCell`, `matrixData` source removal, and `scheduledStopKeys` compare canonical IDs instead of raw IDs (the sibling expansion added for blocking becomes redundant and is replaced by canonical comparison).
- Normalise saved `employee_stops` values from `schedule_requests` on load and canonicalise on publish (`ResourceMatrix.tsx` publish grouping around the moved/added stop sets), so saved rows and drafts always line up.
- Keep `MatrixSubSidebar` / `MatrixSidebar` fed with canonical keys so a returned shift disappears from available again.
- Run `npx tsgo --noEmit -p tsconfig.app.json`, then verify in the weekly board as CCA for the week of Sep 14: move Stops 1–3 to Commercial Office Fit Out, select all three, drag back to Office Fit Out, confirm all three return, the change counter reads zero, and the sidebar shows no leftover copies. Revert everything; publish nothing.
