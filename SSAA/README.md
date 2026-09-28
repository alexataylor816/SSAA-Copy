# SSAA

**Schedule Someone, Anytime, Anywhere** — a construction scheduling platform that
connects General Contractors (GCs) and Subcontractors (Subs). GCs book subcontractor
personnel; subcontractors approve, edit, or reject those requests.

Built with Vite + React 18 + TypeScript + Tailwind + shadcn/ui, backed by Supabase.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for a map of every file and the
frontend/backend split.

---

## Run it locally

This project runs entirely on your own machine. You do not need Lovable.

Requirements: **Python 3** and **Node.js 18+** (Node builds the frontend bundle).

```sh
# one-time setup
pip3 install -r requirements.txt

# every time you want to run it
python3 app.py
```

`app.py` builds the app if needed, serves it with Flask, and opens your browser at
<http://localhost:8080/dashboard>. Press `Ctrl+C` to stop.

On the very first run it also installs npm dependencies and produces the build,
which takes a minute. After that it starts immediately.

### Options

| Command | What it does |
|---|---|
| `python3 app.py` | Serve the build and open the browser |
| `python3 app.py --build` | Rebuild `dist/` first, to pick up source changes |
| `python3 app.py --dev` | Vite dev server with hot reload on <http://localhost:8080> |
| `python3 app.py --port 3000` | Use a specific port (falls back automatically if busy) |
| `python3 app.py --host 0.0.0.0` | Expose on your local network (phone/tablet testing) |
| `python3 app.py --no-browser` | Don't open a browser automatically |

### If you prefer npm

```sh
npm install       # first time only
npm run dev       # dev server with hot reload
npm run build     # production build into dist/
npm run preview   # preview the build
npm run lint
```

### Installing Node.js

If `app.py` reports that Node.js is missing:

```sh
brew install node
```

Or download the LTS installer from <https://nodejs.org>. Verify with `node -v`.

---

## How the local host works

`app.py` serves the compiled frontend from `dist/` using Flask. Because the app is a
single-page application, any route that isn't a real file (`/dashboard`, `/messages`,
`/onboarding`, …) returns `index.html` so client-side routing works on refresh.
Hashed files under `assets/` are served with long-lived cache headers; `index.html`
is always revalidated so you never get a stale app after a rebuild.

It also handles the Node side for you: it locates Node (including a user-local
install in `~/.local/node/bin`), runs `npm install` and `npm run build` when the
build is missing or `--build` is passed, and picks the next free port if the one you
asked for is taken.

---

## Configuration

`.env` holds the Supabase connection details and is already populated:

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public anon key (safe to ship in the browser) |

Never put the Supabase **service-role** key in `.env` — anything prefixed with
`VITE_` is bundled into the browser. Server-side secrets belong in Supabase Edge
Function environment variables, configured in `supabase/config.toml`.

---

## Backend

The Supabase backend is **not** run from this repo — it is hosted and already
connected. `supabase/` contains its definition:

- `supabase/migrations/` — 137 SQL migrations: tables, RLS policies, triggers, RPCs
- `supabase/functions/` — 31 Deno edge functions (email via Resend, Web Push,
  SMS via Twilio, Stripe billing, Excel parsing, user provisioning)
- `supabase/config.toml` — per-function JWT verification flags

To manage it, install the [Supabase CLI](https://supabase.com/docs/guides/cli) and
run commands such as `supabase functions list` or `supabase db push` from this
directory.

---

## Project layout

```
SSAA/
├── app.py               local host: builds and serves the app with Flask
├── requirements.txt     Python dependency (Flask)
├── index.html           Vite entry point
├── supabase/            backend definition (migrations + edge functions)
├── public/              static files, including the push service worker
└── src/
    ├── pages/           11 router-level pages
    ├── features/        domain UI: scheduling, messaging, tours
    │   ├── scheduling/    calendar, matrix, manage, connect, topbar,
    │   │                  correspondence
    │   ├── messaging/     chat UI
    │   └── tours/         onboarding tour + tooltips
    ├── components/ui/   26 in-use shadcn/ui primitives
    ├── contexts/        auth, language, impersonation
    ├── hooks/           shared React hooks
    ├── lib/             pure utilities
    ├── i18n/            EN/ES translations
    └── integrations/    Supabase client + OAuth bridge
```

---

## Notes

- Push notifications and `localStorage` session storage work over `localhost`.
- The production bundle is a single ~2.2 MB JS chunk. Code splitting would speed
  up first load; `vite.config.ts` is where to add `manualChunks`.
- npm is the package manager (`package-lock.json`). The old Bun lockfiles have
  been removed.
- Unused code has been pruned: dead components, 23 unused shadcn/ui primitives
  (re-addable with `npx shadcn@latest add <name>`), and Lovable's `.lovable/`
  agent state. See [ARCHITECTURE.md](./ARCHITECTURE.md) §8 for the full list.
- `npm run lint` reports pre-existing problems, mostly in
  `supabase/functions/**` (Deno functions linted with the browser config).
- The project was originally generated by [Lovable](https://lovable.dev); it is no
  longer required to run or develop the app.
