# Welcome popup + working guided tour for new users

## What's wrong today

The tour mount in the dashboard rebuilds its step list every render and filters out any step already marked seen. The tour marks each step seen the moment it is displayed, so showing step 1 immediately removes it from the list, which shifts the next step into the current slot, marks it seen too, and cascades until the list is empty. The result is that a brand-new user sees nothing at all.

There is also no welcome message: new accounts land straight on the dashboard with no greeting or entry point into the tour.

## Changes

1. **Welcome dialog.** On first login (no `guided_tour_done` / no tour steps seen yet), show a centered welcome dialog: "Welcome to SSAA (Schedule Someone Anytime Anywhere)" with a short line about what the tour covers, and two buttons — "Start Tour" and "Skip for now". Skipping shows the same "you can't return to the tour" confirmation, and any skipped steps still fire later as one-time first-click tooltips (existing behavior).

2. **Fix the tour so it actually runs.** Compute the step list once when the tour starts and freeze it for the duration, instead of recomputing on every flag change. Steps get marked seen as they are displayed, but that no longer mutates the running sequence.

3. **Next / Back / X.** The tour already has Back, Next/Done, and an X with the "you won't be able to restart this tour, are you sure?" confirmation. Keep those; ensure Back is enabled from step 2 onward and the last step reads "Done".

4. **Applies to all new accounts**, not just guest GCs — any main company account holder who signs up and logs in right after gets the welcome dialog and tour, driven by the per-user tooltip flags rather than the older guest-only trigger.

## Step order

Welcome dialog -> Monthly/Weekly toggle -> Projects dropdown -> Master Schedule -> Project Team Members -> Manage My Company Account -> Messages -> Done.

## Technical notes

- `src/pages/Dashboard.tsx` (`SpotlightTourMount`): hold the resolved steps in state, computed once when anchors are ready; render the welcome dialog before the tour and only start `SpotlightTour` after "Start Tour".
- New `src/components/onboarding/WelcomeDialog.tsx` using the existing `Dialog` primitives and design tokens.
- Marking seen continues through `TooltipFlagsProvider` (`tooltip_flags` on profiles); no schema change.
- No changes to the existing first-click fallback tooltips.
