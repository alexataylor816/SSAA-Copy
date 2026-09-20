# Millworkers trade, operator-only Trade field, and a full guided tour

## 1. Add "Millworkers" trade

Add `Millworkers` to the onboarding subcontractor trade list (kept alphabetically near Masonry, with `Other` staying last).

## 2. Trade field in Manage My Company Account (operator view only)

In the Company Info tab, directly under Company Name and Company Address, add a **Trade** dropdown (same trade list as onboarding, including Millworkers).

- Visible only when the viewer is an operator (MOA), including while impersonating a user.
- Only shown when the company is a subcontractor.
- Saves to the company's `trade` field with the existing Save action.

## 3. Guided tour — full walkthrough

Replace the current single-step tour with a multi-step spotlight tour in this order:

1. Monthly / Weekly schedule toggle
2. Projects dropdown (right panel)
3. Master Schedule (selecting it from the project dropdown)
4. Project team members panel
5. Manage My Company Account
6. Messages

Each step highlights the real element and shows a short explanation of what it does.

### Exiting the tour

- Clicking the "X" opens a confirmation: "You won't be able to restart this tour. Are you sure you want to exit?" with Keep Touring / Exit options.
- Exiting marks the tour as done so it never auto-starts again.

### Fallback contextual popups (the important part)

Every tour step is tracked individually, not as one all-or-nothing flag. If a user exits the tour early, the steps they never saw stay "unseen." The first time they click one of those elements later, that step's message appears as a one-time popup anchored to what they clicked, then marks itself seen.

Coverage (each with its own one-time message):

- Monthly / Weekly toggle
- Projects dropdown
- Master Schedule
- Project team members
- Manage My Company Account
- Messages
- Inside Projects: Connect to GC / Connect to Subcontractor (connection code + Send Invite)
- Every onboarding tip that already exists stays and keeps firing on first click of its element: overlays, upload schedule, sub availability overlay, connected contractors (dashboard + tab), subcontractor overlay, manage profile, team add button, guest billing / guest upgrade, Manage My Company intro dialog. They all move onto the same tracking so nothing double-fires.

If a user already saw a step during the tour, clicking that element later shows nothing.

### In-calendar scheduling onboarding (role-tailored)

When a user is actually inside the calendar and first interacts with it, a one-time message explains how scheduling works there. Separate copy for Monthly and Weekly, and separate copy per role:

- **GC / Guest GC** — Monthly: click a day (or drag across days) to request workers from a connected sub; day colors show pending vs. confirmed. Weekly: pick specific shifts from the sub's posted availability, set headcount, and publish; you'll be asked how to notify the sub.
- **Subcontractor** — Monthly: day colors show your available capacity and incoming requests; click a day to add or edit personnel availability. Weekly: assign named personnel to shifts, approve/edit incoming GC requests, and use Remove Availability to pull people off a day.
- **Main subcontractor with connected subs** — additional note that sub-of-sub personnel can be scheduled here, but only the owning sub can approve.

These fire on first click into the monthly grid and first click into the weekly grid respectively, and are tracked the same way as every other step.


## Technical notes

- `TooltipKey` gains per-step keys (`tour_calendar_toggle`, `tour_projects`, `tour_master_schedule`, `tour_team`, `tour_company_account`, `tour_messages`, `connect_gc_sub`, `calendar_monthly_scheduling`, `calendar_weekly_scheduling`); step copy moves into one shared registry so the tour and the click-fallback tooltips read from the same source. The calendar entries resolve copy by role (gc / guest / sub / main-sub).
- `SpotlightTour` marks each step seen as it is displayed, gets an exit-confirmation dialog, and calls `guided_tour_done` on finish/exit.
- Anchors: add `data-tour` attributes plus `AnchoredFirstClickTip` wrappers on the right panel project dropdown, team card, header Manage Company / Messages buttons, and the project connection controls.
- Persistence continues through `profiles.tooltip_flags` (no schema change).
- Trade field in `ManageCompanyModal` is gated on `isMOA && isSub`; the trade list is extracted to a shared constant used by both onboarding and the modal.
