# SSAA — Sprint Scheduling Suite

Monorepo for the SSAA scheduling platform. Browser-first; the mobile client is
a paused port of the same backend.

## Layout

```
backend/    Express API + Socket.IO (TypeScript; SQLite locally, MySQL/RDS on prod)
web/        The web client (Vite + React 18 + react-router) — the primary app
frontend/   Expo + React Native client. Paused: no new features until mobile resumes.
SSAA/       Original Lovable app, kept as a read-only reference/spec
```

`web/` is the app we are building. It talks to `backend/` directly — there is no
Supabase, and no Lovable cloud dependency.

### How the port works

The Lovable components were written against `supabase-js`. Rather than rewrite
them, `web/src/lib/supabase.ts` provides a small drop-in replacement that
translates the PostgREST builder into `POST /query` on our backend:

```ts
supabase.from("projects").select("*").eq("company_id", id)
```

The backend's query layer re-implements the row-level security that Postgres had
as RLS policies. Every table is registered in `backend/src/query/registry.ts`
with an explicit column allowlist, a scoping predicate, and write rules. Unknown
tables, unknown columns, unscoped deletes, and writes to server-owned columns are
all rejected rather than silently ignored.

Anything not yet migrated fails loudly (`[supabase-facade] ... has not been
migrated`) instead of quietly returning wrong rows. `GET /capabilities` lists
which RPCs are available.

## Run locally

Requirements: Node 22.

```powershell
# Terminal 1 — backend (API + realtime)
cd backend
npm install                            # first time only
npm run dev                            # http://localhost:8000/health

# Terminal 2 — web client
cd web
npm install                            # first time only
npm run dev                            # http://localhost:8082
```

Or both from the repo root:

```powershell
.\dev.ps1                # backend + web
.\dev.ps1 -WithExpo      # also start the paused Expo client on 8081
```

Vite proxies `/api` and `/socket.io` to the backend, so the web client only ever
talks to its own origin.

## Checks

```powershell
cd backend;  npm test            # 79 tests
cd backend;  npx tsc --noEmit
cd web;      npm run typecheck   # tsc -b --force (plain `tsc --noEmit` checks nothing here)
cd web;      npm run build
cd frontend; npm run lint        # only while the Expo port is active
```

## Status

Working end to end: signup → company → project → share connection code → sub
joins → employees → availability → schedule request → sub confirms → both sides
read it back through `/query`.

Known gaps, in rough priority order:

- **Tasks/Gantt** — table and registry rule exist; no UI yet.
- **Resource matrix** is read-only for other people's rows. The API only writes
  availability for the employee record linked to the caller
  (`setAvailability` in `backend/src/scheduling/service.ts`). Letting account
  holders edit a crew's hours is a backend change first.
- **Multi-stop scheduling** (`availability.stop_number`, `employee_stops`),
  project aliases, guest-GC companies, and sub-of-sub routing are not ported.
- **Chat, notifications, billing** are not started.
- **Realtime** covers availability, schedule requests, and join requests. Other
  tables have no live updates yet.
- The remaining shadcn components in `web/src/components/ui/` are copied from
  `SSAA/` and unused; prune as needed.