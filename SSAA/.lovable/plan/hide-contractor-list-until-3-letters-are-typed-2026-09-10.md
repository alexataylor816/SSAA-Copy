# Hide contractor list until 3 letters are typed

In Manage My Company Account > Connected Contractors > Search SSAA, the company list currently loads and shows every match as soon as the box opens. It should stay empty until the user types at least 3 characters, matching the onboarding search behavior.

## Changes

- Do not run the company search while the typed text is under 3 characters; clear any previous results.
- Show a short prompt instead of the list: "Type in the company name to search."
- Once 3 or more characters are typed, run the search and show matching companies (with the existing loading spinner and "No matches." message).
- Everything else stays the same: already-connected companies stay disabled, declined ones remain selectable, and the role/recipient steps are untouched.

## Technical notes

Single file: `src/components/dashboard/ConnectedContractorsTab.tsx`. Guard the search `useEffect` (around line 160) on `searchQ.trim().length >= 3`, resetting `searchResults` and `searching` otherwise, and add the prompt branch in the results container (around line 611).