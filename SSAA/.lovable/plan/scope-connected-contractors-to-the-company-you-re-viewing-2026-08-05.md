# Scope Connected Contractors to the company you're viewing

## What's wrong

The Connected Contractors tab loads every contractor connection row without filtering by the company being viewed. Regular users don't notice because access rules hide other companies' rows, but an operator (who can see everything) gets the full list — so while viewing DMV Flooring Installation Specialists, connections belonging to other companies show up as if they were DMV's.

The same applies to the project-assignment rows loaded alongside them.

## The fix

Filter both queries to the company currently being viewed:

- Connections: only rows where the viewed company is one of the two sides of the connection.
- Project assignments: only rows tied to the connections that survive that filter.

Result: an operator viewing DMV sees exactly the connections DMV would see, and nothing changes for regular users.

## Technical notes

In `src/components/dashboard/ConnectedContractorsTab.tsx`, inside `load()`:

- `supabase.from('contractor_connections').select('*')` becomes `.or(\`company_a_id.eq.${effectiveCompanyId},company_b_id.eq.${effectiveCompanyId}\`)`.
- Fetch `contractor_connection_project_assignments` after the connections resolve and constrain with `.in('connection_id', connIds)` (skip the query when there are none).

Frontend-only change; no database or policy changes.
