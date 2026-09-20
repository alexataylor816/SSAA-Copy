# Fix: bulk-imported employees get no welcome email

## What actually happened

The Duct Installer employees were removed from the team list, but their **login accounts were never deleted**. The delete step failed every time with "MOA access required" — it only allows platform operators, not company admins.

So when you bulk-imported the same people again, the system saw "this login already exists", quietly re-linked it to the new employee row, and **skipped the whole welcome-email step**. No email, no error shown.

## The fix

**1. Deleting a person should really delete their login**

Allow a company's account holder / admin (and operators) to remove the login for someone in their own company, instead of only operators. Deleting an employee will then fully clean up, so re-adding them behaves like a brand-new person.

**2. Re-adding an existing login must still send the welcome email**

When an import hits an email that already has a login in the same company (or no company), the system will now:
- set the temporary password from the import,
- require a password change on first sign-in,
- send the same welcome email with credentials,

exactly as it does for a brand-new person. Emails that belong to a *different* company keep being rejected as today.

**3. Surface failures**

If the welcome email fails to send, the import result will say so instead of reporting success silently.

## Technical notes

- `supabase/functions/delete-auth-user/index.ts`: replace the MOA-only gate with: service role OR `profiles.role = 'moa'` OR caller has `user_roles.permission_level` in (`account_holder`, `full`) for the target user's company. The current profile lookup also uses `.single()` with no `user_id` filter — scope it to the caller.
- `supabase/functions/create-employee-user/index.ts`: in the `existingUser` same-company branch, when `password` is supplied, call `auth.admin.updateUserById` to set it, set `force_password_change: true`, and run the same welcome-email send block used in the new-user path. Extract that email block into one helper so both paths stay identical.
- Return `emailSent: boolean` from the function; `handleBulkCreate` in `ProfilesModal.tsx` counts created vs emailed and reports both in the toast.
- Deploy both edge functions after the change.
