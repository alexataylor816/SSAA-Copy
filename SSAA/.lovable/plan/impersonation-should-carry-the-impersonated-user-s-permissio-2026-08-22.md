# Impersonation should carry the impersonated user's permissions everywhere

## What's happening

The dashboard already computes an "effective" permission level that mirrors the user an operator is impersonating (`effectivePermissionLevel`), but most UI gates still read the operator's *own* permission values. Operators have no company permission level, so those values come back empty and the UI behaves as if the viewer were a restricted user — which is why publishing from the weekly grid shows "Permission required" even when the impersonated user is a Main Company Account Holder.

## What will change

1. One shared "effective viewer permission" set, derived once and used by every permission gate on the dashboard:
   - Impersonating a user → that user's permission level, account-holder flag, and derived tiers.
   - Operator viewing a company (no specific user) → treated as account-holder level for that company.
   - Nobody impersonated → unchanged, the signed-in user's own permissions.
2. Weekly view: the schedule grid receives the effective permission level, so the "assign to a project the person isn't assigned to" exception dialog opens and publish completes instead of erroring.
3. Monthly view: the same effective values drive the monthly calendar and its panels — availability/read-only gating, schedule and task actions, project management and sharing controls — so an impersonated account holder gets the full set of actions and an impersonated basic user stays appropriately limited.
4. Read-only operators stay read-only; normal users are unaffected.

## Technical notes

- `src/pages/Dashboard.tsx`: alongside the existing `effectivePermissionLevel` / `effectiveIsMOA` (lines ~320-324), derive `effectiveIsAccountHolder`, `effectiveHasPartialOrHigher`, `effectiveHasLevel1OrHigher`, `effectiveIsBasicUser` from the same source, with the operator-viewing-a-company fallback to `account_holder`.
- Replace the raw `permissionLevel` / `isAccountHolder` / `hasPartialOrHigher` / `hasLevel1OrHigher` / `isBasicUser` uses in the render tree with the effective equivalents: `<ResourceMatrix permissionLevel>` (~3370), `canManageShare` (~3333), `isBasicUser` / `hasLevel1OrHigher` / `isAdminOrHigher` on the monthly panel (~3450-3452), `readOnly` (~3481), `hasPartialOrHigher` (~3512), and the basic-user project filter at ~2618 (use `effectiveUserId`).
- `ResourceMatrix.tsx` needs no change; its `canMakeException` check already accepts `account_holder`, `full`, `partial`, `level_1`.
- Presentation/permission-gating only — no database, RLS, or edge function changes.
