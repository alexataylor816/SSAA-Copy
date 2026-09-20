# One password setup, not two

## What is happening

The welcome email link opens a standalone "Set Up Your Account" page (picture 1). The person sets their name and password there, and it is saved correctly. But the app's own copy of their profile in the browser was loaded a moment earlier, when the account was still flagged "must set a password". Nothing refreshes that copy, so the dashboard opens and immediately shows the same setup box again (picture 2) — and because that box blocks everything behind it, the screen looks frozen until the person fills it in a second time.

Confirmed in the data: the two people who went through the link now have the flag cleared, so the save itself works. The duplicate box is purely the stale in-app copy.

## The fix (keep one prompt, in one place)

Eliminate the first form. The email link becomes a pure hand-off:

1. The link signs the person in with their temporary password, exactly as today.
2. Instead of showing its own name/password form, it sends them straight to their dashboard.
3. The dashboard's existing setup box (picture 2) is the single place they choose their display name and password. It already refreshes the profile after saving, so it closes correctly and never reappears.

Why this direction rather than keeping form one: the dashboard box is the same box everyone who logs in manually with the temporary password already sees, so there is exactly one code path to maintain and one behavior to trust. Nothing new is introduced.

Additional safeguards:
- The dashboard's setup box refreshes the profile before it decides to appear, so a freshly cleared flag can never bring it back.
- While the link is signing the person in, they see a brief "Signing you in..." screen instead of a blank or frozen page.
- If the link fails (temporary password already used), they get a clear message and a button to the login page — unchanged from today.

## Technical notes

- `src/pages/OnboardingReset.tsx`: drop the name/password form and its submit handler. Keep the sign-in effect and the error state; on success `navigate('/dashboard', { replace: true })`. The route stays public and the URL shape is unchanged, so already-sent emails keep working.
- `src/contexts/AuthContext.tsx` / `src/pages/Dashboard.tsx`: ensure the profile used for the `force_password_change` gate is the freshly fetched one after a sign-in event (re-fetch on `SIGNED_IN`), so the gate reflects current database state.
- No change to `create-employee-user`, the welcome email, or the temporary-password mechanics.
- Verification: run the flow end to end for one throwaway employee — open the link, land on the dashboard, set name and password once, confirm the box closes, the page is interactive immediately, and a reload does not bring the box back. Delete the throwaway employee and its login afterward.
