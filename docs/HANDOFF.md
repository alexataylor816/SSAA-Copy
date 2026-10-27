# SSAA handoff: where everything stands (Oct 24, 2026)

Read this first if you're picking up the project. It covers what the app is, how to run it, how the code is laid out, what works, what's half-built, and what to do next. Everything else in `docs/` goes deeper on one area.

---

## 1. The project in one minute

**SSAA ("Schedule Someone, Anytime, Anywhere")** lets general contractors (GCs) request crew from subcontractors (subs) day by day, and lets subs post availability and confirm.

- **Client:** Luke (ssaainc.com, GitHub `@lukepaaron`). His original app was built on Lovable and Supabase; that source is kept read-only in `SSAA/` for reference.
- **This repo is the self-hosted rebuild:**
  - Express + TypeScript backend on **:8000**, using MySQL, or SQLite for tests;
  - a Vite + React web app on **:8082**.
  - We match Luke's Lovable screens and wording wherever we can.
- **Next deadline:** a build to Luke by **Fri Oct 30, 5:30 PM**.

| Folder | What it is | Status |
| --- | --- | --- |
| `backend/` | The API (Express, TypeScript, Socket.IO for live updates) | **Primary** |
| `web/` | The web app (React, Vite, shadcn/ui, Tailwind) | **Primary** |
| `SSAA/` | Luke's original Lovable app, for reference only | Don't edit |
| `frontend/` | An Expo mobile client | **Paused.** It has uncommitted local changes; leave them out of commits. |
| `database/` | MySQL demo dump, export tool, backups (`exports/` is git-ignored) | Supporting |
| `docs/` | Design notes and plans | Read as needed |

---

## 2. Run it locally

**You need:** Node 22, and MySQL 8 if you want the live-like database (SQLite works without it).

1. `backend/.env`: copy `backend/.env.example`.
   - For MySQL, set `DB_CLIENT=mysql` and the `MYSQL_*` login, with `MYSQL_DATABASE=ssaa`.
   - Leave `RESEND_API_KEY`, `SMTP_*` and `ANTHROPIC_API_KEY` empty unless you have them. The app works without them.
2. Run `npm install` in `backend/` and in `web/`.
3. Load the demo data, from `backend/`:
   - **empty database:** `npm run db:seed-showcase`
   - **database that already has users:** back it up first (see §6), then `npx tsx scripts/seed-showcase.ts --wipe`
   - add `--small` to skip the bulk data (3 GCs, 12 projects, 12 subs, about 100 crew).
4. Start both servers from the repo root with `.\dev.ps1` (Windows), or `bash scripts/start-dev.sh` (Mac/Linux).
5. Open http://localhost:8082. Every demo account uses the password **`Test1234!`**:

| Account | Email | Use it for |
| --- | --- | --- |
| GC Greg | `bnguye26@umd.edu` | The GC's view (Terrapin Builders). Also the **owner operator**: the header has "Operator Dashboard". |
| Subcontractor Steve | `baotn.it@gmail.com` | The sub's view (Bao Plumbing): Weekly view drag and drop, confirming requests |
| SSAA Operator | `operator@example.com` | The operator dashboard as a main operator with no company |
| Everyone else | `*@example.com` | Other GCs, subs and crew from the bulk data |

Greg and Steve are real inboxes, so emails sent to them actually arrive.

---

## 3. Checks before you push

```powershell
cd backend; npx vitest run          # 25 test files, all passing
cd backend; npx tsc --noEmit
cd web;     npx tsc -b --force       # plain `tsc --noEmit` checks nothing in web/
cd web;     npm run build
cd web;     npx eslint <files you changed>
```

- Lint has a few old `any` errors in `LeftPanel.tsx`, `RightPanel.tsx`, `lib/planLimits.ts` and `lib/supabase.ts`. They're not new; don't let them hide new ones.
- **Tests never touch the live `ssaa` database.** They use in-memory SQLite, or `npm run test:mysql`, which only works against a database whose name ends in `_test`.
- Two slow test files (the recommender and company search) have a 20-second limit set inside the file. `backend/vitest.config.ts` has an *uncommitted* global 20-second limit in Bao's working copy that was deliberately left out. Don't commit a global one.

---

## 4. How the code is laid out

### Backend (`backend/src/`)

| Area | Files | What it does |
| --- | --- | --- |
| App setup | `app.ts`, `server.ts`, `config.ts`, `db.ts` | Express app, Socket.IO, env, and one database layer for SQLite and MySQL (`database.get/all/run`) |
| Schema | `models/index.ts`, `db/mysql/schema.sql` | SQLite creates tables in code; MySQL runs `schema.sql` at startup. Both only **add** what's missing, so they're safe to rerun. **A new column needs adding in both places.** |
| Auth | `routes/auth.ts`, `middleware/requireAuth.ts`, `services/tokens.ts` | JWT sessions, Google sign-in, password reset codes, suspended accounts |
| Companies and roles | `rbac/` | Companies, join requests, permission levels (`basic` < `level_1` < `partial` < `full` < `account_holder`), company deletion |
| Scheduling | `scheduling/` | Projects, availability, schedule requests, the historical lock (past weeks can't be edited), the double-booking guard |
| Weekly view API | `scheduling/matrix.ts` | `GET /matrix` (a sliding date range) and `POST /schedule-requests/batch` (create / update / cancel in one go, with a dry run, an "unassigned" exception and notify choices) |
| Messages | `messaging/` | Project chats, direct messages, group chats |
| Notifications | `notifications/service.ts` | Who hears about what. A project's notifications go to the people assigned to that project on the Team page, or to all its schedulers if nobody is. |
| Correspondence | `notifications/templates.ts`, `notifications/correspondence.ts`, `services/email.ts` | Every bell notification, email and automatic chat message is rendered from an editable template (`{placeholder}` style, as in Lovable) and recorded in `notification_log`. |
| Operator tools | `admin/routes.ts`, `admin/operators.ts` | The operator dashboard API, operator levels, the audit log, "view as" |
| Schedule recommender | `ai/` | Matches task names to trades, sizes crews, and suggests requests. An AI model step is optional (`ANTHROPIC_API_KEY`). |

### Web (`web/src/`)

| Area | Files |
| --- | --- |
| Pages | `pages/Dashboard.tsx` (Monthly), `pages/ResourceMatrix.tsx` (Weekly, at `/matrix`), `pages/Messages.tsx`, `pages/CompanySettings.tsx`, `pages/Admin.tsx` (operator dashboard, at `/operator`) |
| Monthly view | `components/dashboard/*` (calendar, day dialog, panels, mobile tab bar) |
| Weekly view | `components/matrix/*`. Drag and drop uses dnd-kit; drafts live in `useMatrixDrafts.ts`; drop rules in `canDrop.ts`; API types in `lib/matrixApi.ts`. |
| Operator dashboard | `components/operator/*`, `lib/operatorApi.ts`, `lib/viewAs.ts`, `components/ViewAsBanner.tsx` |
| API calls | `lib/api.ts` always calls `/api/...`. Vite (and Caddy in production) forwards `/api`, `/socket.io` and `/uploads` to the backend. |

Long-form notes:

- `docs/WEEKLY_VIEW_REBUILD.md`: the Weekly view rules, from Luke's Oct 23 walkthrough.
- `docs/OPERATOR_DASHBOARD_PLAN.md`: the operator dashboard plan.
- `docs/AI_SCHEDULE_RECOMMENDER.md`: how the recommender works.
- `docs/DEPLOYMENT.md`: shipping a build to Luke, and hosting.

---

## 5. What works, and what doesn't yet

| Feature | Status | Notes |
| --- | --- | --- |
| Sign up / in, Google sign-in, password reset, invite links, joining a company | Working | |
| Monthly view: requests, confirm / decline / cancel, availability, Edited requests (Confirm Changes / Edit & Resend) | Working | |
| Weekly view | Working | Matches Luke's walkthrough: drag, snap-back with a reason, sliding weeks, unassigned warning, notify dialog, draft bar, tap-to-place on phones |
| Projects, connection codes, team members, permission levels, project assignments | Working | |
| Messages and the notification bell | Working | |
| Phone layout | Working | Every screen was reviewed at 390 px wide |
| Operator dashboard | **In progress** | Built and tested, but still being refined. It has: Overview; user and company pages; support actions (view as, reset code, change level, suspend, transfer account holder); Correspondence (Email / Push / Log); operator levels (owner / main / view only); audit log. |
| AI schedule recommender | **In progress** | Rules only today. The AI model step and "Upload Schedule" need an API key and real-schedule testing (#57, #58). |
| Email delivery | Partly working | Uses Resend's test key, which only reaches the Resend account owner. Everyone else's emails show as Failed in the Correspondence Log until ssaainc.com is verified (#60). |
| Billing / subscriptions | Not started | #40 |
| Deployment | Not started | Plan in `docs/DEPLOYMENT.md`; #60 |

---

## 6. Things that will bite you

- **Back up the live MySQL `ssaa` database before any wipe or reseed:**
  ```
  "C:\Program Files\MySQL\MySQL Server 9.3\bin\mysqldump.exe" --no-tablespaces -u <user> -p ssaa > database\exports\backup-<date>.sql
  ```
  `--no-tablespaces` avoids a privilege error. `database/exports/` is git-ignored.
- **Never commit `.env` files.** Check `git diff --cached --name-only` before every commit.
- **Leave `frontend/` out of commits:** it has unrelated, paused work in it. The same goes for `backend/vitest.config.ts`.
- **Git Bash on Windows rewrites arguments that start with `/`** into Windows paths, e.g. `/matrix` becomes `C:/Program Files/Git/matrix`. Leave the slash off, or set `MSYS_NO_PATHCONV=1`.
- **Operators can't "view as" another operator.** Since GC Greg is an operator, open his company by signing in as him.
- **View-only operators get read-only "view as" sessions.** The server refuses every change, and the banner says "read only".
- **Templates are seeded at startup.** Defaults that nobody has edited get updated automatically; an operator's edits are never overwritten.
- **Schema changes:** add the column in the SQLite `ensure…Tables` code *and* in `db/mysql/schema.sql`, using the `information_schema` guard pattern at the bottom of that file.

---

## 7. Git, releases and repos

- **Branches:** day-to-day work happens on your own branch, then merges into `main`. `main` and `bao` are both at the latest work.
- **Commit messages:** a short summary line, then a plain body explaining what and why. No co-author trailers.
- **Repos:**
  - **UMD** (`UMDMSISCapstone/F2026-501-4-SSAA`, private, remote `umd`) is the team repo, with the issues and project board (project 24).
  - `alexataylor816/SSAA-Copy` (remote `origin`) is an old copy; don't push there.
  - `bbbnt/SSAA` (private, remote `personal`) is a copy on Bao's account.
- **Planned:** a private repo for Luke in the GitHub org **SSAA-Schedule-Someone-Anytime-Anywhere**, named `ssaa-platform`, with **@lukepaaron** invited read-only. Not created yet. Once it exists, Luke's previews get released there.
- **Previews for Luke:** tag the commit `luke-preview-YYYY-MM-DD`, zip it with `git archive`, and publish a GitHub pre-release. The steps are in `docs/DEPLOYMENT.md` §1. The latest is `luke-preview-2026-10-24` (on UMD and on `bbbnt/SSAA`).

---

## 8. What to do next

**Before Oct 30:**

1. **#51:** walk Luke through the Weekly view and fix what he flags. It's the feature he cares most about.
2. **Create the `ssaa-platform` repo** in the org, invite @lukepaaron, and publish the Oct 30 preview there (see §7).
3. **#33:** fix the dashboard at 1024–1399 px wide, the last layout gap after the phone pass.
4. **#46:** write transition notes for Luke. `docs/DEPLOYMENT.md` covers most of the hosting side.
5. **Clean up the board.** #43, #44, #48 and #50 are done. #49 and #52–#56 are built and in review as part of the operator dashboard. #47 needs a real title.

**After Luke's feedback:**

| Priority | Issue | Notes |
| --- | --- | --- |
| High | #60 Deploy to app.ssaainc.com | Follow `docs/DEPLOYMENT.md`. Needs Luke's hosting account, DNS access, and a verified Resend domain. |
| Medium | Operator dashboard polish | Luke decides which tools matter first, and which emails and push messages are on by default |
| Medium | #59 Monthly: schedule several dates at once; #64 phone Weekly extras | From the walkthrough |
| Medium | #61 Move the browser test scripts into `e2e/` | So anyone can rerun the screen checks |
| Low | #63 npm audit, #42 Google sign-in polish, #40 billing, #38 Spanish | Billing and Spanish need Luke's decision |

---

## 9. Who to ask

- **Luke** (client): product decisions, his Lovable app's behaviour, hosting and domain access.
- **Bao** (`bnguye26@umd.edu`, GitHub `bbbnt`): everything in this document.
