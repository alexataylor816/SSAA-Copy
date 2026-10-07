# SSAA Architecture

Monorepo: `backend/` (Express + TypeScript + SQLite + Socket.IO) serves two
frontends. `web/` (Vite + React 18 + shadcn) is the **primary app**.
`frontend/` (Expo) is **frozen** — no new features until mobile resumes.
`SSAA/` is the original Lovable app, kept as a **read-only reference/spec**.
Do not edit it; port from it.

## Ports

| Service | URL (local) |
|---|---|
| Web client | http://localhost:8082 |
| Backend API (`/api/*` via vite proxy) + health | http://localhost:8000 (`/health`) |
| Lovable reference (dev only) | http://localhost:8083 |

## Backend (`backend/src`)

Domain modules own their tables, service logic, and routes:

| Directory | Owns |
|---|---|
| `routes/` | Cross-cutting endpoints: `auth` (signup/signin/Google/password-reset/username-reminder/change-password/me), `profile` (self profile edit), `uploads` (image upload + serve), `health` |
| `rbac/` | Companies, roles, join requests, holder transfer, member removal, company-deletion requests, permission helpers |
| `scheduling/` | Projects, connections, availability, schedule requests, historical lock |
| `contractors/` | Standing company-pair connections (request/respond/role-swap/project links) |
| `messaging/` | Conversations, DMs, participants, read receipts |
| `notifications/` | In-app notifications + notification templates (admin CRUD) |
| `admin/` | Admin-gated surface: companies overview, operators, deletion queue, templates |
| `query/` | Supabase-compatible facade: `POST /query` (table registry with column allowlists, scopes, `canWrite`), `POST /rpc/:name`, `GET /capabilities` |
| `realtime/` | Socket.IO rooms + event names; `roomsFor()` auto-joins on connect |
| `services/` | Email (Gmail SMTP → Resend fallback → dev log), passwords (scrypt), storage (disk), tokens (JWT) |
| `models/` | `users`, `passwordResets`, schema bootstrap (`ensureSchema`) |
| `middleware/` | `requireAuth` (Bearer JWT → `req.userId`) |

Cross-domain reads go through model functions, never raw SQL from another
module (one exception, documented at the call site: project deletion clears
`contractor_connection_projects` and message rows by SQL because those
modules expose no per-project delete helper).

## Web client (`web/src`)

| Area | Contents |
|---|---|
| `pages/` | One file per route (see `App.tsx` — routes are `React.lazy` code-split) |
| `components/dashboard/` | Dashboard panels + task modals (LeftPanel, CalendarPanel, RightPanel, task modals, header, bell, wizards) |
| `components/` (top level) | Shared/dialog components used by multiple pages (team, companies, timesheets, reason dialogs, auth layout, Google button, photo gallery) |
| `components/ui/` | shadcn/Radix primitives — presentational only, do not add business logic |
| `components/onboarding/` | First-click tour tips (flags in localStorage) |
| `contexts/` | `AuthContext` (session, roles, permission flags), `LanguageContext` (en/es) |
| `hooks/` | `useMessaging`, `usePushNotifications`, `use-toast`, `use-mobile` |
| `lib/` | `api` (REST + `authApi`), `supabase` (facade client), `realtime` (event names), `tasks`, `projectDisplay` (aliases), `planLimits`, `trades`, `utils` |
| `i18n/` | `translations.ts` en/es dictionary consumed via `useLanguage().t(key)` |

## Conventions that must not be broken

1. **Supabase facade speaks snake_case; the app speaks camelCase.** Converters
   live next to each consumer (`toSessionUser`, row mappers). The facade
   resolves `{ data, error }` and **never rejects** — every caller must check
   `error` (silent-success bugs have bitten us before).
2. **Builder verbs set the operation.** `supabase.from(t)` always starts as a
   `select`; `.insert()/.update()/.upsert()/.delete()` set the real operation.
3. **Additive DB migrations only.** New columns go through `PRAGMA table_info`
   checks in the module's `ensure*` function (`CREATE TABLE IF NOT EXISTS` +
   `ALTER TABLE ... ADD COLUMN`). Never edit an existing migration, never
   assume foreign keys are enforced (SQLite FKs are off — delete children
   explicitly in a transaction).
4. **Permission model** (`rbac/permissions.ts`): `basic < level_1 < partial <
   full < account_holder`, plus `isAdmin` (platform operator). UI gates must
   mirror a server-side check on the same rule — never gate on one level in
   the UI and enforce another in the API.
5. **Realtime:** mutating routes emit to the affected rooms; pages subscribe
   with `.on(EVENT.x, refetch)` **before** `.subscribe()`.
6. **No secrets in repo.** `.env` files are gitignored; see `.env.example`.
   Test accounts/seed data stay out of committed files.
7. **Reference parity is functional, not pixel.** Match what SSAA *does*;
   layout deviations that fix real overflow bugs are documented in code
   comments and kept. Deliberate non-ports: Stripe/billing, SMS, MOA
   impersonation, group chats/contacts/attachments (messaging lane), guest-GC
   depth, full tour system.
