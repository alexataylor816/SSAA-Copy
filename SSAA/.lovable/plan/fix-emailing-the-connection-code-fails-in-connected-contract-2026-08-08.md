# Fix: emailing the connection code fails in Connected Contractors

## What's happening

Sending the connection code email returns a generic "Edge Function returned a non-2xx status code" toast. The underlying response is a 400 with `{"error":"no company"}` — the send function could not work out which company the sender is acting as, so it stopped before sending anything.

The diagnosis of *why* the acting company came back empty is not yet confirmed (the function's request logs show only boot entries, no failed invocation). The fix therefore has two parts: make the failure visible, then make the resolution robust.

## Fix

1. **Robust acting-company resolution in the send function**
   - Use the same acting-company resolution the rest of the Connected Contractors features already use (the `resolve_acting_company` database helper) instead of the ad-hoc profile-then-operator lookup, so an operator viewing/impersonating a company always resolves correctly.
   - Fall back to deriving the company from the connection itself: if the caller can be verified as a member of one of the two companies on the connection, use that side.
   - Only reject when no company can be resolved at all, and return a clear message naming the reason.

2. **Better diagnostics**
   - Log the caller id, supplied acting company, operator status, and resolution outcome in the function so the next failure is traceable in the function logs.

3. **Show the real error to the user**
   - The dialog currently shows the generic invoke error. Read the function's JSON error body (via the error context) and show that text in the toast, so "no company" / "connection not accepted" / provider errors are visible instead of "non-2xx status code".
   - Keep the dialog open on failure so the entered recipients aren't lost.

4. **Verify**
   - After deploying, re-run the send as an operator viewing the company and confirm a 200 with `sent: 1`, plus a `notification_log` row.

## Files touched

- `supabase/functions/send-project-connection-code/index.ts` — acting-company resolution, logging, clearer errors; redeploy.
- `src/components/dashboard/EmailConnectionCodeDialog.tsx` — surface the real error body, keep dialog open on failure.

No database schema changes.
