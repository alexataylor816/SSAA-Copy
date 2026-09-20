# Fix: user lands in another person's account after login

## What is happening

Sam Gurowitz and Mike Grimm are two separate, correctly configured accounts in the database (Sam → Korth Construction (Demo), Mike → Interior Office Logistics (Demo)). Nothing is wrong with Sam's profile or company link.

The problem is the operator "view as user" (impersonation) state. It is saved in the browser tab's session storage and:

1. It is **not cleared on sign-out**, and
2. It is **not tied to the signed-in user** — every screen (dashboard, messages, manage company) blindly prefers the stored impersonated company/user over the real logged-in profile, without checking that the current user is even an operator.

So if that browser tab was previously used by an operator who viewed Mike Grimm's account, and then someone signs out and Sam signs in on the same tab, Sam's dashboard is rendered as Mike Grimm's company. The auth log shows exactly this pattern: repeated logout/login cycles from the same browser session.

## The fix

1. **Clear impersonation on sign-out.** Signing out wipes both stored impersonation keys.
2. **Bind impersonation to the operator who started it.** Store the operator's user id alongside the impersonation state; on load, if the stored operator id doesn't match the currently signed-in user, discard the state immediately.
3. **Only honour impersonation for operators.** A non-operator account never resolves an impersonated company/user, even if stale data somehow exists in storage — the real profile always wins.

This means a normal user can never be shown someone else's account, no matter what the browser had cached.

## Technical details

- `src/contexts/ImpersonationContext.tsx`
  - Persist `{ ownerUserId, value }` under `ssaa_impersonated_user` / `ssaa_impersonated_company`.
  - Read the current auth user (`useAuth`) and drop stored state when `ownerUserId !== user.id` or when the user is not an operator (`isMOA`).
  - Expose `null` for `impersonatedUser` / `impersonatedCompany` whenever the current user is not an operator, so consumers need no change.
  - Clear state on `user.id` change (including sign-out to `null`).
- `src/contexts/AuthContext.tsx` — `signOut()` also removes both session-storage keys (defensive, so the wipe happens even before the provider re-renders).
- Consumers (`Dashboard.tsx`, `Messages.tsx`, `ManageCompanyModal.tsx`, `DashboardHeader.tsx`) keep their existing `impersonatedUser?.company_id || profile?.company_id` fallbacks and need no edits, because the context now returns `null` for non-operators.

## Verification

Sign in as Sam in a browser session that previously impersonated another user and confirm the dashboard shows Korth Construction (Demo), then confirm operator impersonation still works and still clears on sign-out.
