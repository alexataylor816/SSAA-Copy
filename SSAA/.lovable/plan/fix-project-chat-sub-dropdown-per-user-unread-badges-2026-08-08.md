# Fix project-chat sub dropdown + per-user unread badges

## What I verified

- Korth Construction (Demo) owns "Office Fit Out (Demo)", and that project has 6 connected subs (Akers, CCA, Circuit Electric, DMV Flooring, HVAC Precision, Interior Office Logistics). Sam Gurowitz's profile is correctly linked to Korth.
- Access policies let a project owner read those connection rows, so the data and permissions are fine.
- The Messages list only builds the sub dropdown from `project_connections`. Guest GC projects are linked through `guest_project_connections`, which is never queried — so guest GCs always get "No subcontractors connected yet".
- The sub dropdown only renders when the row is detected as "owned" (project's company id equals the viewer's company id). If the viewer's company id has not resolved yet (or the project row is a guest/linked project), the list falls back to the flat, no-dropdown row seen in the production screenshot.
- Read state is stored per user in `message_reads` (primary key conversation + user), so badges are already per-user by design. Operator views are already excluded from writing reads in two places, but the thread component still uses the operator's own id rather than the viewed user's, which is inconsistent.

## What will change

1. Sub dropdown appears for every GC and Guest GC
   - Build the connected-company list from both regular project connections and guest project connections, plus any company that already has a chat on the project.
   - Show the dropdown only when the viewer's company is a GC or Guest GC and owns the project. Subcontractors and sub-of-subs never get a dropdown, even if they created/own the project. Rows wait for the viewer's company type to resolve instead of collapsing to the flat variant, and the connection lookup is prefetched with the project list so there is no visible delay.
   - Keep the sub-side behaviour unchanged: a subcontractor still sees exactly one row for their own chat.

2. Unread badges are strictly per-user
   - Badge counts continue to come from the viewed user's own read marker, so once Sam opens a chat his badges clear while Greg's stay.
   - Opening a chat writes the read marker for the signed-in user only.

3. Operator view is read-only for notifications
   - While impersonating, badges show exactly what that user would see.
   - No read marker is written anywhere during impersonation — list clicks and the open thread both skip the write — so the user's unread counts survive an operator visit.

## Technical notes

- `src/components/messages/MessagesView.tsx`: extend the `connByProject` effect to also query `guest_project_connections` (both directions) and map partner companies onto the owner's projects; add a `companyResolved` guard so `projectNodes` doesn't render non-owned rows before `viewerCompanyId` is known.
- `src/components/messages/ConversationThread.tsx`: accept the effective viewer id and skip `markRead` whenever `suppressReads` is set (already passed as `impersonating`); write reads with the real signed-in user id only.
- No schema, policy, or edge function changes.

## Verification

Sign in as a GC (Korth) and a Guest GC, open Correspondence → Projects, confirm each owned project expands to its connected subs; open a chat and confirm its badge clears and stays cleared after reload; then impersonate the same user as an operator, confirm identical badges and that they remain after the operator opens the chats.
