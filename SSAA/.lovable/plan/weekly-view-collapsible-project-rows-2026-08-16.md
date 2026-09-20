# Weekly view: collapsible project rows

Applies to the weekly schedule only (desktop and mobile). Monthly view and master schedule are untouched.

## Behavior

- Each project row's name box gets a chevron on the right side of the name, inside the same box.
- Clicking the chevron collapses the row: the day cells for that project stay in place but their personnel chips and availability content are hidden, leaving a slim collapsed row that still shows the day columns and the project name.
- Clicking again expands it back with all personnel, chips, task overlay bars, and drop targets restored.
- Default state is expanded. Collapse state is per project and persists while the user stays on the weekly view (including when scrolling to new weeks).
- Selection safety: if personnel chips are currently selected (sidebar chips or in-grid chips), clicking a collapse/expand arrow never clears that selection. The user can select people, expand a collapsed project, then drag (desktop) or tap-to-place (mobile) them into that project's day cell.
- While a project is collapsed, its cells are not drop targets; expanding restores dropping/tap-to-place immediately.
- Mobile keeps the existing project chips filter; the chevron is the collapse control on each project row header, independent of the chip filter, and toggling it does not clear selected personnel.

## Technical notes

All in `src/components/dashboard/ResourceMatrix.tsx`:

- Add a `collapsedProjectIds` state (`Set<string>`) shared by both the desktop table branch and the mobile branch, with a `toggleProjectCollapse(id)` handler that only mutates that set — it must not touch `selectedChipIds`, `selectedDate`, or `selectedWeeklyDate`.
- Desktop: in the `<tbody>` project row, wrap the name cell content in a flex row with the name plus a `ChevronDown`/`ChevronRight` button (`stopPropagation` on click). When collapsed, render each day `<td>` without the `DroppableCell` chip content (keep the cell shell and weekend/today styling) so column widths stay aligned.
- Mobile: replace the current Accordion-driven expansion with the same `collapsedProjectIds` model so the arrow lives in the project name header and the chip filter remains a separate concern; the accordion's `onValueChange` currently rewrites `selectedMobileProjects`, which is why toggling can disturb state — that coupling is removed.
- The chevron button gets `aria-expanded` and an accessible label.

## Verification

On desktop and at a 390px mobile viewport: select two people in the roster, collapse a project, confirm the selection count is unchanged, expand it, and place the selected people into one of its day cells. Collapse a project with existing chips and confirm they disappear while the row and day columns stay aligned, then expand and confirm chips, times, and task overlay bars return. Any test assignments created are removed afterwards.
