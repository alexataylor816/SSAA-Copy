&nbsp;

# Mobile weekly view: visible collapse chevron, no vanishing projects, pending people shown

Mobile only. Desktop weekly view untouched.

## What the screenshots show

- The project name row renders with no visible chevron. In the code the mobile project header is a fixed two-column-wide sticky box; on a 390px phone the name fills it and the chevron button sits at the far edge, effectively off-screen/clipped, so there is nothing tappable.
- After tapping in that area, the whole schedule went blank and the project chips at the top turned grey — the tap landed on the project filter chips, which deselect projects and empty the grid ("Select a project above..." path). Collapse and the project filter are being confused for each other.
- Cells show "—" even though CCA has pending schedule requests for Aug 17-19 on Bridge Capital: the mobile cell renderer skips any person whose card status resolves to `available`, and pending personnel are not surfacing as chips.

## What will change

Project row header (mobile):

- Rebuild the header as a full-width sticky bar: chevron on the left of the project name inside the same box, name truncating next to it, tap target at least 40px.
- The header no longer uses a fixed two-column width, so the chevron is always on screen regardless of horizontal scroll position.
- Tapping the chevron only toggles that project's collapsed state. It never changes the project filter, never clears selected personnel, and never blanks the grid.

Collapse behavior:

- Collapsed: the day cells for that project hide their chips/availability but the row and column alignment stay; the project name and chevron remain visible so it can be reopened.
- Expanded: chips, task bars, and tap-to-place targets return.
- Default expanded; state persists while on the weekly view.

Project filter chips:

- Keep the chips, but make it impossible to end up with an empty screen by accident: if the user deselects the last project, the view falls back to showing all projects instead of the blank "Select a project" state.
- Visually separate the filter chips from the collapse control so they are not mistaken for each other.

Pending / scheduled personnel visibility:

- Mobile cells will render every person in the cell whose status is confirmed, draft, pending, or cancelled — the same set the desktop grid renders — so CCA's pending Aug 17-19 people appear as pending chips.
- Confirm the same people appear in the "Employees" dropdown roster grouped under "Scheduled".

&nbsp;

ENSURE THAT IN THE EMPLOYEE DROP DOWN, that employees are visible as well! Currently they are not visible when the grip employee chevron is tapped 

## Technical notes

All in `src/components/dashboard/ResourceMatrix.tsx`, inside the `if (isMobile)` branch:

- Replace the `style={{ width: DAY_COL_WIDTH * 2 }}` sticky header with a `sticky left-0 w-screen max-w-full` flex row; chevron button first, then truncated name.
- Keep `toggleProjectCollapse` mutating only `collapsedProjectIds`.
- Guard the `selectedMobileProjects.length === 0` branch to fall back to `relevantProjects`.
- In the mobile cell chip loop, drop the `if (status === 'available') return null` early-return in favor of the same status filter the desktop branch uses, and verify `getCardStatus` returns `pending` for requests where the viewing company is the personnel owner.

## Verification

At a 390px viewport, impersonating CCA (Demo): confirm a chevron is visible on each project row, tapping it collapses/expands only that project while the other projects and the day header stay put, the project chips still filter independently, pending chips appear on Bridge Capital for Aug 17-19, and selecting people then expanding a collapsed project still allows tap-to-place. No test records left behind.