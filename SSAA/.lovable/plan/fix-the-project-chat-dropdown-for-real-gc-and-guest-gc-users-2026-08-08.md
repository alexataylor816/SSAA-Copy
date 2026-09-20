# Fix the project-chat dropdown for real GC and Guest GC users

## Verified issue

- Sam Gurowitz is linked to Korth Construction (Demo), a GC company.
- Korth owns Office Fit Out (Demo), and six subcontractors are connected to that project.
- The project row only becomes expandable when `companyType === 'gc'` and the viewer company owns the project.
- Operator impersonation supplies the company type directly, so the dropdown appears there. A real user instead depends on a separate company lookup in `MessagesView`; its error is ignored and a missing result leaves the project rendered as a flat row.

## Changes

1. Resolve the effective viewer identity before rendering project chats
   - Load the effective company ID and company type together on the Messages page for both real users and impersonated users.
   - Keep the project list in a loading state until that identity is resolved, preventing a GC-owned project from being classified as a non-owner row during startup.

2. Make owner detection reliable
   - Pass the resolved effective company type into `MessagesView` for every viewer, not only impersonated viewers.
   - Determine the expandable GC/Guest GC row from the resolved company type plus exact project ownership.
   - Preserve the existing flat, single-chat behavior for subcontractors and sub-subcontractors.
   - Surface lookup failures instead of silently treating the viewer as a subcontractor.

3. Preserve existing messaging behavior
   - Keep the six connected subcontractors beneath Office Fit Out (Demo), each opening its isolated project chat.
   - Do not change per-user unread markers or operator read suppression.
   - No database schema or policy changes are needed.

## Verification

- Sign in as Sam directly and confirm Office Fit Out (Demo) has an expand/collapse arrow and lists its connected subcontractors.
- Verify the same behavior with a direct Guest GC login.
- Verify a subcontractor still sees only its own flat project-chat row.
- Verify operator impersonation continues to show the same rows as the impersonated GC/Guest GC.