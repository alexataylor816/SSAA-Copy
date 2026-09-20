# Fix: Operator "Select Company" dropdown glitches and won't scroll

## What's happening

The company picker in the Operator Dashboard header uses a dropdown whose long list is scrolled by Radix's hover-based scroll arrows (the small chevrons at the top and bottom of the list in your screenshot). With a list this long those arrows fight the pointer and the list jitters instead of scrolling smoothly to the bottom.

Two contributing conditions, both confirmed by inspection:

- The shared select component clips its list (`max-h-96`, `overflow-hidden`) and relies only on the chevron auto-scroll buttons — there is no normal wheel/trackpad/touch scrolling area.
- After a company was deleted, the picker can still hold a selected company id that no longer exists in the list. The dropdown then tries to scroll to an item that isn't there on every open, which produces the jump/glitch.

Note: the company list itself is healthy — no empty names and no duplicate ids (there are two companies both named "BUDT723", which is a display duplication, not the scroll bug).

## The fix

1. Make the dropdown list natively scrollable: give the list viewport a bounded height with real overflow scrolling so wheel, trackpad, and touch all work, and the chevron buttons become a supplement rather than the only way to scroll.
2. Guard against the deleted-company case: if the currently selected company id is not in the visible list, treat the picker as unselected (placeholder shown) instead of pointing at a missing item.
3. Disambiguate identically named companies in the list so the operator can tell the two "BUDT723" entries apart.

## Technical details

- `src/components/ui/select.tsx`: on `SelectContent`'s `Viewport`, add `max-h-[--radix-select-content-available-height] overflow-y-auto` (keeping the existing popper sizing classes) so the list scrolls natively. This is a shared component; the change is additive and safe for all other selects.
- `src/components/dashboard/DashboardHeader.tsx` (both the desktop select around line 468 and the mobile overflow-menu select around line 548): compute `const selectedCompanyId = filteredCompanies.some(c => c.id === impersonatedCompany?.id) ? impersonatedCompany!.id : ''` and pass that as `value` instead of `impersonatedCompany?.id || ''`.
- Same file: when rendering each `SelectItem`, append a short disambiguator (e.g. company type or a truncated id) when another company in the list shares the same name.

No backend, schema, or permission changes.
