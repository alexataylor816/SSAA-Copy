# Editable template descriptions

Operators can already rename a template. Add the same ability for the short description line under the title.

## What changes

- In the template editor, a second button labeled **Edit Description** sits between "Edit Name of Template" and "Cancel", on all three tabs (Email, Push, Text) where the editor appears.
- Clicking it turns the description line into a multi-line text box with Save and Cancel.
- Saving stores the new description; it shows in the editor and in the template list.
- Clearing the box and saving removes the description line.
- Editing the description is display-only: it does not change when or to whom anything is sent.

## Technical notes

- `notification_templates.description` already exists, so no migration is needed.
- `ManageCorrespondenceModal.tsx`: add `editingDesc` / `descDraft` state plus `saveTemplateDescription()` mirroring `saveTemplateName()` (update `description`, refresh local state and list).
- Add `renderDescriptionButton()` and extend the description paragraph render into a helper that swaps in a `Textarea` when editing; place the button next to the existing rename button in each of the three action rows.
