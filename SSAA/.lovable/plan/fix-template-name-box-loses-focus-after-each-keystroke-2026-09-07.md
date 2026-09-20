# Fix: template name box loses focus after each keystroke

## Problem

When renaming an email or push template, the name field deselects after every character, so operators have to click back into it for each letter.

## Cause

The heading and the rename controls are built as small components created inside the modal. Every keystroke rebuilds them from scratch, so the text box is torn down and recreated and the cursor is lost.

## Fix

- Turn the heading/rename block and the "Edit Name of Template" button into plain inline markup (or components defined outside the modal) so the text box stays alive while typing.
- Keep the field focused when rename mode opens, allow Enter to save and Escape to cancel.
- No change to what renaming does: still display-only, saved names shown in the lists and editor headings, blank name reverts to the default.

## Technical notes

- `src/components/dashboard/ManageCorrespondenceModal.tsx`: remove the inner `TemplateHeading` and `RenameButton` component definitions; replace their three usages with inline JSX rendering the same content, so React reconciles the `Input` instead of remounting it.
