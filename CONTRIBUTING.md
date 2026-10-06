# Contributing to SSAA

## First run (Windows PowerShell)

```powershell
# 1. Install dependencies (backend, web; frontend only if you need mobile)
cd backend; npm install; cd ../web; npm install; cd ..

# 2. Configure environment (both files are gitignored — never commit them)
Copy-Item backend\.env.example backend\.env
# web has no .env.example; only needed for Google sign-in:
# VITE_GOOGLE_CLIENT_ID=<oauth-client-id>   (plus matching GOOGLE_CLIENT_ID in backend/.env)

# 3. Start everything (backend :8000, web :8082)
.\dev.ps1
```

Health checks: `http://localhost:8000/health`, `http://localhost:8082/`.

## Everyday commands

| Task | Command |
|---|---|
| Backend tests | `cd backend; npm test` (vitest, `:memory:` SQLite — no local DB touched) |
| Backend typecheck | `cd backend; npx tsc --noEmit` |
| Web typecheck | `cd web; npm run typecheck` |
| Web lint | `cd web; npm run lint` (pre-existing `no-explicit-any` errors in ported files are tolerated; add none) |
| Web production build | `cd web; npm run build` (watch for the >500KB chunk warning) |

## Working rules (multiple people/agents share this tree)

1. **Read before you edit.** Check `git status` and the file's recent history; several areas have in-flight work. `OPENCODE_HANDOFF.md` at the root tracks who owns what — update it when you take or finish a workstream.
2. **Shared files are append-only.** `web/src/App.tsx`, `web/src/lib/api.ts`, `backend/src/app.ts`, `backend/src/models/index.ts`: add new imports/routes/calls next to existing ones, never reorder or rewrite neighboring blocks.
3. **New features go in new files + new tests.** Backend: `backend/tests/<domain>.test.ts` (see `companyDeletion.test.ts` for the pattern). Follow the module table in `docs/ARCHITECTURE.md`.
4. **Verify like a user, not just like a test runner.** After UI work, sign in as a seeded account in headless Chrome and screenshot the touched surfaces (scripts live outside the repo; keep them out of commits). Check the browser console for 4xx/5xx.
5. **Additive migrations only**, no secrets in commits, UI gates mirror server checks (see `docs/ARCHITECTURE.md` § Conventions).
6. **Do not commit unless asked.** Leave the tree in a clean, working state with the handoff doc current.
