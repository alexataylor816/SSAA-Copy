# Fix: subcontractor search returns "No matches"

## What's wrong

The search runs a database function that filters out the searcher's own company. It does this with a comparison that silently discards **every** result when the signed-in account has no company of its own — which is exactly the case for an operator viewing the app as another user (the screenshot shows the Operator Dashboard impersonating Mike Grimm). "DMV Flooring Installation Specialists" does exist in the database as a subcontractor company, so the data is fine; the filter is what hides it.

Confirmed by inspection:
- The company record exists, type `sub`.
- The search function excludes `c.id <> get_user_company_id()`, and `get_user_company_id()` is null for an operator account, which makes the whole condition null and returns zero rows.
- The search also ignores the company the operator is currently acting as, so even after the null fix it would exclude the wrong company.

## The fix

1. Update the search function so it:
   - uses a null-safe exclusion (`IS DISTINCT FROM`) so a missing company no longer wipes out all results;
   - accepts an optional acting-company parameter and resolves it the same way other connected-contractor functions do (operators acting as a company exclude that company; regular users still exclude their own).
2. Pass the tab's `effectiveCompanyId` into the search call in `ConnectedContractorsTab.tsx`.

No UI or layout changes.

## Technical notes

- Migration: `CREATE OR REPLACE FUNCTION public.search_sub_companies_for_connection(p_query text DEFAULT '', p_acting_company_id uuid DEFAULT NULL)`; resolve the exclusion id via the existing acting-company/own-company logic (without raising when neither exists), and change the filter to `c.id IS DISTINCT FROM v_exclude_id`.
- Frontend: `supabase.rpc('search_sub_companies_for_connection', { p_query: searchQ, p_acting_company_id: effectiveCompanyId })`.
- Verify afterward by searching "DMV" both as a normal subcontractor account and while impersonating.
