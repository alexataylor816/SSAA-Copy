---
name: New-employee onboarding magic link
description: Welcome email contains a deep link that auto-signs in with the temp password and lands on the password-choose page
type: feature
---
When `create-employee-user` provisions a new account with a temporary password, the welcome email contains a "Set Up Your Account" button linking to `/onboarding-reset?email=<encoded>&temp=<encoded-temp-password>`.

The `OnboardingReset` page (public route in `App.tsx`):
1. Reads `email` and `temp` from URL params.
2. Calls `supabase.auth.signInWithPassword` with those values.
3. On success, renders an inline name + new-password form (no modal).
4. Submitting calls `supabase.auth.updateUser({ password })` and clears `force_password_change` on the profile, then navigates to `/dashboard`.

Old workflow preserved: users who ignore the button can still log in manually with the temp password shown in the same email — the existing `ForcePasswordChangeModal` will pop on first sign-in.

Security: the temp password in the URL is single-use (replaced before redirect). Same trust boundary as the existing plaintext-temp-password email.
