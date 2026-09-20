# Duct Installation trade + editable template names

## 1. Add "Duct Installation" trade

Add `Duct Installation` to the shared trade list used by onboarding's Create Company step (and the operator Trade field in Manage My Company Account, which reads the same list). Placed alphabetically, with `Other` staying last.

## 2. Rename email and push templates

Right now a template's name is auto-generated from its internal event name, so "Contractor Invite New" can't be changed.

- When a template is opened for editing, a **Rename Template** button appears to the left of Cancel.
- Clicking it turns the heading into a text field with Save / Cancel.
- The saved name is what shows in the template list and at the top of the editor, in both the Email and Push sections.
- Templates that have never been renamed keep showing their current auto-generated name, so nothing looks different until an operator changes it.
- Renaming is display-only: it does not change when or to whom the message is sent.

## Technical notes

- `src/lib/trades.ts`: insert `'Duct Installation'`.
- Migration: add nullable `display_name text` to `public.notification_templates` (existing update policies already cover operator writes; verify the operator update policy before relying on it).
- `ManageCorrespondenceModal.tsx`: `formatEventType(...)` becomes `templateLabel(template)` = `template.display_name ?? formatEventType(template.event_type)`, used in the Email list, Push list, and both editor headings. Add rename state + inline input and an update call writing `display_name` (empty string clears back to the default). Log tabs keep using `formatEventType` since they only have an event type string.
- Regenerated Supabase types will include the new column.
