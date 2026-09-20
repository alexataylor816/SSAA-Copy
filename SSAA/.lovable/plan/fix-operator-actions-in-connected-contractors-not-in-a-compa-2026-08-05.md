# Fix: operator actions in Connected Contractors ("Not in a company")

## What's wrong

When an operator views the app as another company, some Connected Contractors actions still look up the *operator's own* company instead of the company they are acting as. Operators have no company of their own, so those actions fail with "Not in a company".

Most actions in this tab were already updated to accept the acting company (project assign/unassign, role swap, project links, search). Three were missed:

- Send connection request ("Send request") — the error in the screenshot
- Accept / decline an incoming connection request
- Invite a contractor to SSAA by email

## The fix

Update these three so they use the company the operator is acting as (and behave exactly as before for regular users):

1. Send connection request — accept an acting-company argument, resolve it the same way the other connection functions do, and record the request as coming from that company with the operator as the acting user.
2. Accept / decline request — same acting-company resolution, including the "the initiating company cannot accept its own request" check being evaluated against the acting company.
3. Invite to SSAA — the invite backend falls back to the caller's profile company; allow an acting company to be passed when the caller is an operator.

Front end: pass the tab's existing acting-company value into those three calls.

No UI or layout changes.

## Technical notes

- Migration: recreate `create_contractor_connection_request(p_other_company_id uuid, p_proposed_role text, p_acting_company_id uuid DEFAULT NULL)` and `respond_contractor_connection_request(p_connection_id uuid, p_accept boolean, p_confirm_main_company_id uuid DEFAULT NULL, p_acting_company_id uuid DEFAULT NULL)`, using `public.resolve_acting_company(p_acting_company_id)` in place of `get_user_company_id()`. Drop the old signatures to avoid PostgREST overload ambiguity. `has_partial_or_higher()` already returns true for MOA, so authorization is unchanged.
- Edge function `send-contractor-invite`: accept optional `acting_company_id` in the body and use it for `inviting_company_id` only when the caller is an operator (verify via the `operators` table with the service client); otherwise keep the profile company.
- Frontend `ConnectedContractorsTab.tsx`: add `p_acting_company_id: effectiveCompanyId` to `create_contractor_connection_request` and `respond_contractor_connection_request`, and `acting_company_id: effectiveCompanyId` to the invite invoke.
- Verify: as an operator acting as a company, send a connection request to DMV Flooring Installation Specialists and confirm the pending row is created for the acting company, then clean up the test row.
