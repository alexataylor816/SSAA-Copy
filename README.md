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

`web/` is the app we are building — a real website built with the same
shadcn/Tailwind components copied from the Lovable `SSAA/` source, matched to
it visually and functionally. It talks to `backend/` directly — there is no
Supabase, and no Lovable cloud dependency.

### How the port works

The Lovable components were written against `supabase-js`. Rather than rewrite
them, `web/src/lib/supabase.ts` provides a small drop-in replacement that
translates the PostgREST builder into `POST /query` on our backend:

```ts
supabase.from("projects").select("*").eq("company_id", id)
```

The backend's query layer re-implements the row-level security that Postgres
had as RLS policies. Every table is registered in `backend/src/query/registry.ts`
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

On macOS/Linux, `bash scripts/start-dev.sh` starts both.

## Run on GitHub Codespaces (shareable link)

1. On GitHub: **Code → Codespaces → Create codespace on `main`**. Setup installs
   everything and starts the app; the website opens on port 8082.
2. To share it: **Ports** tab → right-click port **8082** → **Port Visibility →
   Public**, then copy the link. (Port 8000 doesn't need sharing; the website
   reaches it internally.)
3. The link only works while the codespace is running (it stops after ~30 min
   idle). Restart it from github.com/codespaces; run `bash scripts/start-dev.sh`
   if the app isn't already running.

The codespace starts with an **empty database**, so sign up fresh there. Setup
writes `backend/.env` with random secrets and turns off on-screen reset codes,
because a public link would let anyone use them; add `SMTP_USER`/`SMTP_PASS` to
that file to make password resets work by email.

## Checks

```powershell
cd backend;  npm test            # 81 tests
cd backend;  npx tsc --noEmit
cd web;      npm run typecheck   # tsc -b --force (plain `tsc --noEmit` checks nothing here)
cd web;      npm run build
cd frontend; npm run lint        # only while the Expo port is active
```

## Status

Working end to end: signup → company → project → share connection code → sub
joins → employees → availability → schedule request → sub confirms → both
sides read it back live (realtime wired client-side, not just emitting into
a void).

Known gaps, in rough priority order:

- **Tasks/Gantt** has a table + registry rule on the backend, and a working
  UI — but currently only in `frontend/` (Expo), built there during a
  direction mix-up before `web/` was reconfirmed primary. Porting it into
  `web/` is the next priority.
- **Resource matrix** is read-only for other people's rows. The API only
  writes availability for the employee record linked to the caller
  (`setAvailability` in `backend/src/scheduling/service.ts`). Letting account
  holders edit a crew's hours is a backend change first.
- **Multi-stop scheduling** (`availability.stop_number`, `employee_stops`),
  project aliases, guest-GC companies, and sub-of-sub routing are not ported.
- **Chat, notifications, billing** are not started.
- **Realtime** covers availability, schedule requests, join requests, and
  project connections. Other tables have no live updates yet.
- The remaining shadcn components in `web/src/components/ui/` are copied from
  `SSAA/` and unused; prune as needed.
