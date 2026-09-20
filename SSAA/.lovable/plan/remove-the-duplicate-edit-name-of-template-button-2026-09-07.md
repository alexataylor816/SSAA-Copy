# Remove the duplicate "Edit Name of Template" button

The email template editor is showing the rename button twice. The push and text editors each show it once, which is correct.

Fix: delete the extra button in the email editor so only one "Edit Name of Template" sits to the left of Cancel, matching the other tabs.

## Technical notes

- `ManageCorrespondenceModal.tsx`: the email editor's action row (around lines 331-336) renders `<RenameButton />` twice; remove the second one and its stray wrapper so the row is Rename + Cancel only.
