# Downloadable bulk import template

Add a "Download template" link in Manage Team → Employee Profiles → Bulk Import from File, next to the Excel / CSV button, so any user with access to that section can grab the spreadsheet and fill it in.

## What the user sees

- Under "Bulk Import from File", a small "Download template (Excel)" button/link beside the Excel / CSV and Image (OCR) buttons.
- Clicking it downloads `SSAA_Bulk_Import_Template.xlsx` — the uploaded file, with columns: Employee Name, Title, Email, Phone Number, Employee ID.
- Helper text updated to mention downloading the template first.

## Technical details

- Host the uploaded workbook as a Lovable asset (`lovable-assets create` from the upload) and import the pointer JSON in `src/components/dashboard/ProfilesModal.tsx`; no binary added to the repo.
- Render an anchor styled as an outline button with the `download` attribute pointing at the asset URL, placed in the Bulk Import section (around lines 1692-1741).
- Header parsing already matches this template's column names (`name`, `title`, `email`, `phone`, `employee id`), so no parser changes are needed.
- No backend, permissions, or database changes — the button appears wherever the bulk import section already renders.
