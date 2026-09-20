# Fix operator impersonation in Messages + remove leftover Marketing AI company

## Problem

Impersonation ("view as user" / "select a company") is stored only inside the Dashboard page's local React state. The Messages screen is a separate route, so as soon as an operator navigates there the impersonation is gone:

- Messages loads the project list with the operator's own access, and operators can see every project — hence "they see all projects".
- Conversations are loaded for the operator's own account, and operators are not a participant in any project/DM chat — hence "they don't see the messages" after selecting a company.

The Marketing AI company row still exists in the database (no users, projects, employees, connections, or requests attached) — an orphan left over from an incomplete delete.

## What will change

1. Impersonation becomes app-wide and survives navigation
   - A shared impersonation context (operator's selected user and/or company) held above the routes and remembered for the session, so leaving the dashboard and coming back keeps the same "viewing as" state.
   - The Dashboard header keeps working exactly as it does now; it just reads/writes the shared state instead of its own local copy.
   - Clearing impersonation (exit / switch back to operator view) clears it everywhere.

2. Messages respects the impersonated identity
   - Project list is filtered to what the impersonated user's company can see: projects owned by that company plus projects it is connected to (same rule the dashboard already uses), instead of every project in the system.
   - Conversation list, unread counts, read receipts and the sub/company drill-down use the impersonated user's id and company id instead of the operator's.
   - Posting permission in a project chat is evaluated using the impersonated user's company type and permission level (a `basic` sub user stays read-only), rather than the operator's blanket allow.
   - When no impersonation is active, behaviour is unchanged for every normal user.

3. Delete the leftover Marketing AI company
   - Remove the orphan company record. Nothing else references it, so no other data is affected.

## Technical notes

- New `ImpersonationContext` (provider mounted in `App.tsx`, state mirrored to `sessionStorage`) exposing `impersonatedUser`, `impersonatedCompany`, and setters. `Dashboard.tsx` swaps its two `useState` calls for this context; all existing `impersonatedUser?.company_id || impersonatedCompany?.id || profile?.company_id` fallbacks stay as-is.
- `useMessaging.useConversations` takes an effective user id (defaults to `auth.user.id`); `markRead` takes the same. `Messages.tsx` computes the effective company id and queries `projects` plus `project_connections` / `guest_project_connections` to build the visible project set.
- `MessagesView` receives `effectiveUserId` / `effectiveCompanyId` and uses them for `myCompanyId`, participant-name resolution and `canPostInProject`; `isMOA` no longer forces `canPost` when impersonating.
- Reads still run under the operator's own database session (operators legitimately have broad read access), so this is a presentation-scoping change — no RLS or policy changes.
- Marketing AI cleanup: single delete of company `e675200a-4f8b-4c6f-ade9-376f1e3077f3`, verified to have zero dependent rows.
