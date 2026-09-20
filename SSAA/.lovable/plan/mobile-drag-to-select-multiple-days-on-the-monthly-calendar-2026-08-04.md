# Mobile: drag to select multiple days on the monthly calendar

## Problem

In the monthly calendar, each day cell only listens for mouse events (`onMouseDown`, `onMouseEnter`, `onMouseUp`). On a touch screen the browser never fires "mouse enter" on the cells your finger passes over, so the drag only ever registers the first day tapped. That is why mobile users can select a single day but not a range. Desktop drag-select works because the mouse does fire those events.

## Fix (mobile only)

Add touch-based drag selection alongside the existing mouse behavior:

- Each day cell gets a date marker so the cell under the finger can be identified during a drag.
- On touch start, remember the starting day and time (same logic as today, so a quick tap still opens the day modal).
- On touch move, work out which day cell is currently under the finger and select or deselect it using the existing select/deselect drag mode, exactly like the desktop hover path. Passing back over days already covered does not toggle them off.
- Once the finger moves onto a second day, treat it as a drag: suppress the tap-to-open-modal behavior and stop the calendar from scrolling the page vertically while the drag is in progress, so the selection follows the finger smoothly.
- On touch end or cancel, finish the drag and leave the selected days highlighted, with the existing "N dates selected" confirm bar appearing as it already does for desktop multi-select.

Behavior that stays exactly the same:

- Single tap on a day still opens that day's modal.
- Locked/past days keep their current behavior.
- Desktop mouse drag-select is untouched.
- Wide-scroll mode (when the sub availability overlay is on) still scrolls horizontally; the drag lock only blocks scrolling while an actual multi-day drag is happening.

## Technical notes

- All changes are in `src/components/dashboard/CalendarPanel.tsx`, gated behind the existing `isMobile` flag.
- Day cells get a `data-day` attribute; `document.elementFromPoint` on each `touchmove` resolves the day under the finger and calls the same selection updater the mouse path uses.
- Touch move handling is attached with a non-passive listener so scrolling can be prevented during an active drag; `touch-action` is relaxed only while dragging.
- Verification: run the calendar in a mobile-sized browser session with touch emulation, drag across several days, and confirm multiple days highlight and the confirm bar shows the right count.
