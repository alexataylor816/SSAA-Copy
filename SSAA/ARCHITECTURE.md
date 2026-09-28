# SSAA — Project Architecture

**SSAA** ("Schedule Someone, Anytime, Anywhere") is a construction scheduling platform
that connects General Contractors (GCs) and Subcontractors (Subs). GCs book
subcontractor personnel; subcontractors approve, edit, or reject those requests.

This document maps every folder and file in the project to its purpose, and
separates the **frontend** (app running in the browser) from the **backend**
(hosted Supabase Postgres + edge functions).

Originally generated from the Lovable `vite_react_shadcn_ts` template. The app is
now self-hosted and no longer depends on Lovable to run or develop.

---

## 1. Overview

```
┌────────────────────────────────────────────────────────────────────┐
│ LOCAL HOST  – Python 3 + Flask                                     │
│   app.py  builds ./dist (via npm) and serves it on localhost:8080  │
├────────────────────────────────────────────────────────────────────┤
│ FRONTEND  – React 18 + TypeScript SPA (Vite)                       │
│   src/  (app code)        public/ (static: favicon, sw.js)         │
│   index.html (Vite entry)                                          │
├────────────────────────────────────────────────────────────────────┤
│ BACKEND   – Supabase project  fuivjjhzrewwkkmyjafy (hosted)        │
│   supabase/migrations/  (DB schema, RLS, triggers, RPCs)           │
│   supabase/functions/   (31 Deno edge functions)                  │
│   supabase/config.toml  (function JWT settings)                    │
├────────────────────────────────────────────────────────────────────┤
│ CONFIG    – package.json, package-lock.json, vite.config.ts,       │
│             tsconfig*, tailwind.config.ts, components.json,        │
│             eslint.config.js, .env, requirements.txt                │
└────────────────────────────────────────────────────────────────────┘
```

The app talks to Supabase via `@supabase/supabase-js`:
- **Data**: PostgREST queries with Row-Level Security.
- **Realtime**: `postgres_changes` subscriptions (schedule requests, availability,
  messages, profile/roles refreshes).
- **Edge functions**: `supabase.functions.invoke(...)` for email, push, Stripe,
  SMS, CSV/Excel parsing, user provisioning.

Auth (Supabase email/password + Google via Lovable OAuth) is global state in
`src/contexts/AuthContext.tsx`.

---

## 2. Directory tree (current)

```
SSAA/
├── app.py                       Flask local host: builds + serves ./dist
├── requirements.txt             Python dependency (Flask)
├── index.html                   Vite entry point
├── package.json                 deps + scripts
├── package-lock.json            npm lockfile (npm is the package manager)
├── vite.config.ts               dev server, @ alias → ./src
├── tsconfig*.json               TS configs (app/node)
├── tailwind.config.ts           Tailwind theme
├── postcss.config.js            PostCSS (tailwind + autoprefixer)
├── components.json              shadcn/ui config
├── eslint.config.js             ESLint flat config
├── .env                         Supabase URL + publishable key (public, not secret)
├── public/                      static assets served as-is
│   ├── sw.js                    service worker for Web Push
│   ├── favicon.ico  robots.txt placeholder.svg
├── supabase/                    BACKEND — see section 6
│   ├── config.toml              function JWT verification flags + project_id
│   ├── migrations/             137 SQL migrations (schema/RLS/triggers/RPCs)
│   └── functions/              31 Deno edge functions
└── src/                         FRONTEND app code
    ├── main.tsx                 React root bootstrap
    ├── App.tsx                  Provider stack + route table
    ├── index.css                Tailwind directives + global styles
    ├── vite-env.d.ts            Vite client types
    ├── assets/                  static imports (hero image, bulk-upload template)
    ├── pages/                   11 router-level pages (one per route)
    ├── features/                feature folders — the app's domain UI
    │   ├── scheduling/          main dashboard: calendar, matrix, management…
    │   │   ├── calendar/         calendar & request workflow components
    │   │   ├── matrix/           personnel resource matrix (roster board)
    │   │   ├── manage/           company/account/subscription modals
    │   │   ├── connect/          invites, connections, guest-GC flow
    │   │   ├── topbar/           dashboard header + notification bell
    │   │   └── correspondence/   email-template editor + helpers
    │   ├── messaging/            chat UI (DMs, project channels, groups)
    │   └── tours/                onboarding tour + tooltip system
    ├── components/
    │   └── ui/                   26 shadcn/ui primitives (all in use)
    ├── contexts/                 global React context providers
    ├── hooks/                    shared React hooks
    ├── lib/                      pure utility modules
    ├── i18n/                     EN/ES translation dictionary
    └── integrations/             Supabase client + Lovable auth bridge
```

`components/` intentionally holds only the framework-agnostic shadcn/ui
primitives. **Every domain component lives under `features/`.**

The project is fully self-hosted: `app.py` serves the compiled frontend with
Flask, and npm is the only package manager. Lovable is not required for
running or developing the app.

---

## 3. Frontend — pages (`src/pages/`)

Each file maps 1:1 to a route declared in `App.tsx`.

| File | Route | Purpose |
|---|---|---|
| `Landing.tsx` | `/` | Marketing hero + login/sign-up (email or Google). Defers signup creds to sessionStorage so onboarding survives navigation. |
| `Dashboard.tsx` | `/dashboard` | The core app. One large container: loads all scheduling data, realtime subscriptions, impersonation-aware "effective viewer", request approval/edit/reject actions. |
| `Messages.tsx` | `/messages` | Messaging shell — resolves viewer identity/company visibility, then renders `MessagesView`. |
| `Onboarding.tsx` | `/onboarding` | Post-signup flow: create/join/guest company, free trial setup. |
| `OnboardingReset.tsx` | `/onboarding-reset` | Re-entry point after onboarding was skipped/abandoned. |
| `InviteAccept.tsx` | `/invite-accept` | Accept a project/contractor invite flow. |
| `ForgotPassword.tsx` | `/forgot-password` | Password reset request via reset code. |
| `ForgotUsername.tsx` | `/forgot-username` | Recover username (email). |
| `TermsOfService.tsx` | `/terms` | Static legal page. |
| `PrivacyPolicy.tsx` | `/privacy` | Static legal page. |
| `NotFound.tsx` | `*` | 404 catch-all. |

---

## 4. Frontend — feature components (`src/features/`)

### 4.1 `features/scheduling/calendar/` — calendar & request workflow

| File | Purpose |
|---|---|
| `CalendarPanel.tsx` | Main month calendar; renders tasks and availability; date selection feed into panels. |
| `LeftPanel.tsx` | Left sidebar: project selector, personnel roster & availability dots, task list (drag-reorder). |
| `RightPanel.tsx` | Right sidebar: details of the selected date(s) — requests, availability, actions; hosts `InviteGCWizard` and matrix cards. |
| `ScheduleModal.tsx` | **4226-line request composer**: GC picks subs/personnel/dates/stops, verifies availability, creates `schedule_requests`, sends notifications. |
| `CreateTaskModal.tsx` | Create a project task/timeline bar. |
| `EditTaskModal.tsx` | Edit/delete a task (name, dates, status, color). |
| `UploadScheduleModal.tsx` | Upload an Excel schedule via `parse-schedule` edge function (bulk request creation). |
| `SubOverlayPanel.tsx` | Toggle overlay of subcontractor availability layers on the calendar. |
| `ScheduleImageGallery.tsx` | Lightbox for schedule request image attachments. |
| `EditReasonDialog.tsx` | Prompt for the required reason when a request is edited. |
| `RejectRequestDialog.tsx` | Prompt for reason when rejecting a request (and notify requesters). |
| `NotifyOnAssignDialog.tsx` | Choose email vs push/SMS notification when assigning unassigned personnel. |
| `UnassignedAssignmentDialog.tsx` | Assign employee shifts previously left unassigned by a sub. |

### 4.2 `features/scheduling/matrix/` — personnel resource matrix

| File | Purpose |
|---|---|
| `ResourceMatrix.tsx` | **2723-line roster board**: weekly/monthly grid of employees across projects; drag-and-drop scheduling, cross-GC booking privacy filtering. |
| `MatrixSidebar.tsx` | Left column of the matrix: company/project grouping + drop zones. |
| `MatrixSubSidebar.tsx` | Subcontractor chips sidebar, grouping selected personnel. |
| `MatrixDraftBar.tsx` | Bottom bar listing pending draft changes with revert/publish actions. |
| `MatrixEmployeeCard.tsx` | Draggable employee card (used by resource matrix + right panel). |

### 4.3 `features/scheduling/manage/` — company & account management

| File | Purpose |
|---|---|
| `ProfilesModal.tsx` | **2275-line user directory**: list/search users, manage roles & permission levels, invites, remove users. |
| `ManageCompanyModal.tsx` | Company settings (name/address/trade), Members, Billing tabs, delete company. |
| `ManageSSAAModal.tsx` | The big "hub" modal linking to correspondence, subscriptions, operators, and cancellation requests. |
| `ManageOperatorsModal.tsx` | Create/promote SSAA operators (MOA support staff). |
| `ManageProfileModal.tsx` | Current user's account settings; links to password, SMS consent modals; sign out. |
| `ManageSubscriptionsModal.tsx` | Subscription plans/pricing, Stripe checkout, upgrade/downgrade. |
| `ManageCancellationRequestsModal.tsx` | Review company deletion requests (operator-only). |
| `ManageCorrespondenceModal.tsx` | Manage email/SMS correspondence templates for schedule notifications. |
| `ConnectedContractorsTab.tsx` | Tab listing a Sub's connected GC contractors + connection codes. |
| `EmailConnectionCodeDialog.tsx` | Email a connection code to a contractor. |
| `ChangePasswordModal.tsx` | Generic password change. |
| `ForcePasswordChangeModal.tsx` | One-time forced password reset (operator-triggered). |
| `ImmediatePasswordChangeModal.tsx` | Immediate pw change for password-mismatch recovery. |
| `SmsConsentDialog.tsx` | Obtain/record SMS consent (phone number). |
| `PlanLimitDialog.tsx` | "Plan limit reached" upgrade prompt (projects/users). |

### 4.4 `features/scheduling/connect/` — invites, connections, guest GC

| File | Purpose |
|---|---|
| `InviteGCWizard.tsx` | Sub invites a GC company to connect (creates `contractor_invites`). |
| `JoinExistingCompanyDialog.tsx` | Join an existing company (requests admin approval). |
| `ConnectedContractorsViewerModal.tsx` | View a GC's connected contractors and shared projects. |
| `GuestGCTour.tsx` | First-run guided tour shown to newly invited guest GCs. |

### 4.5 `features/scheduling/topbar/` — header chrome

| File | Purpose |
|---|---|
| `DashboardHeader.tsx` | Top header: company switcher, impersonation indicator, menus, notification bell. |
| `NotificationBell.tsx` | In-app notification bell with unread count + dropdown (realtime events). |

### 4.6 `features/scheduling/correspondence/` — email template editor

| File | Purpose |
|---|---|
| `RichEmailEditor.tsx` | TipTap-based rich-text editor for email templates. |
| `TemplatePreview.tsx` | Preview pane rendering a template with placeholder substitution. |
| `BlockTemplates.ts` | Prebuilt block/template snippets for the editor. |
| `StyleAttributes.ts` | Shared style-attribute helpers (inline CSS). |
| `StyledDiv.ts` | `StyledDiv` component applying inline styles. |
| `PlaceholderToken.ts` | Placeholder token parsing/substitution for templates. |

### 4.7 `features/messaging/` — chat

| File | Purpose |
|---|---|
| `MessagesView.tsx` | Chat shell: conversation list + thread, project filters, identity-aware. |
| `ConversationThread.tsx` | Message thread for a single conversation (realtime updates). |
| `NewMessageModal.tsx` | Compose a new message/conversation. |
| `ContactsModal.tsx` | Contacts list (personal directory). |
| `AddContactModal.tsx` | Add a contact. |
| `SearchDirectoryModal.tsx` | Search app users to start a conversation. |
| `GroupAddParticipantModal.tsx` | Add participants to a group chat. |
| `SendChannelPromptDialog.tsx` | Prompt to choose/create a project channel when messaging. |
| `SystemMessageCard.tsx` | Renderer for system/notification messages (join/leave/approval events). |

### 4.8 `features/tours/` — onboarding tour & tooltips

| File | Purpose |
|---|---|
| `SpotlightTour.tsx` | Full-screen spotlight step-through tour (dashboard first run). |
| `WelcomeDialog.tsx` | Welcome dialog before the tour. |
| `TooltipFlagsProvider.tsx` | Context storing per-user `tooltip_flags` (which tips already shown). |
| `AnchoredFirstClickTip.tsx` | One-shot tooltip anchored to a target element. |
| `FirstClickTooltip.tsx` | Tooltip that dismisses on first user click. |
| `useFirstClickTooltip.ts` | Hook wiring the first-click tooltip behavior. |
| `tourSteps.ts` | Tour/tooltip copy + step definitions. |
| `ManageCompanyIntroDialog.tsx` | Guided intro when first creating a company. |

---

## 5. Frontend — shared layers

### `src/contexts/` (global React providers)

| File | Purpose |
|---|---|
| `AuthContext.tsx` | Supabase auth + session, loads `profiles`/`user_roles`/`operators`, live refreshes, permission helpers (`isMOA`, `isAccountHolder`, `hasPartialOrHigher`, …). |
| `ImpersonationContext.tsx` | MOA (operator) impersonation of a user or company; sessionStorage-backed, owner-scoped. |
| `LanguageContext.tsx` | Current language + `t(key, vars)` translation function. |

### `src/hooks/`

| File | Purpose |
|---|---|
| `useMessaging.ts` | Conversations/messages/unread counts with realtime (`useConversations`, `markRead`). |
| `useNotification.ts` | `sendNotification()` — invokes `send-notification` (email, Resend) and `send-push` edge functions; logs failures to `notification_log`. |
| `usePushNotifications.ts` | Browser Web Push subscribe via `/sw.js` + VAPID; upserts `push_subscriptions`. |
| `usePendingCancellationCount.ts` | Badge count of pending company-deletion requests (operator only). |
| `use-toast.ts` | shadcn toast hook — the single implementation, imported app-wide (30+ files). |
| `use-mobile.tsx` | `useIsMobile()` viewport hook (calendar, matrix, messages, company settings). |

### `src/lib/` (pure utilities)

| File | Purpose |
|---|---|
| `utils.ts` | `cn()` class combiner + `getHistoricalLockDate()` (past-Monday lock boundary). |
| `time.ts` | 12-hour time formatting, UTC variants, ranges. |
| `trades.ts` | Static list of construction trades. |
| `planLimits.ts` | `fetchCompanyUsage()` via RPC + plan-limit helpers (`isAtProjectLimit`, …). |
| `projectDisplay.ts` | Per-company project name/address aliasing (`applyAliasesToProjects`, …). |

### `src/i18n/`

| File | Purpose |
|---|---|
| `translations.ts` | `{key → {en, es}}` dictionary (~840 lines) + `getTranslation()`. |

### `src/integrations/`

| File | Purpose |
|---|---|
| `supabase/client.ts` | Typed Supabase client (auto-generated) with brokered preview storage. |
| `supabase/types.ts` | Auto-generated `Database` type from the live schema. |
| `supabase/previewAuthStorage.ts` | Lovable preview auth-storage broker (postMessage to editor) — auto-generated. |
| `lovable/index.ts` | Lovable OAuth bridge (Google/Apple sign-in) — auto-generated. |

### `src/assets/`

| File | Purpose |
|---|---|
| `hero-construction.jpg` | Landing page hero background. |
| `bulk-import-template.xlsx.asset.json` | Schema/metadata for the bulk Excel upload template. |

### `src/components/ui/` — shadcn/ui

26 primitives, all of them imported by app code: accordion, alert-dialog, badge,
button, calendar, card, checkbox, collapsible, command, dialog, dropdown-menu,
input, input-otp, label, popover, scroll-area, select, separator, sonner, switch,
table, tabs, textarea, toast, toaster, tooltip.

Unused primitives (alert, aspect-ratio, avatar, breadcrumb, carousel, chart,
context-menu, drawer, form, hover-card, menubar, navigation-menu, pagination,
progress, radio-group, resizable, sheet, sidebar, skeleton, slider, toggle,
toggle-group) were removed. Re-add any of them with the shadcn CLI
(`npx shadcn@latest add <name>`) if needed later.

---

## 6. Backend — Supabase (`supabase/`)

### 6.1 `supabase/migrations/` — 137 snapshotted SQL files

Each `YYYYMMDD…sql` file captures a schema change as the product evolved
(roughly Dec 2025 → Sep 2026). Together they define:

- **Tables** (main ones): `companies`, `profiles`, `user_roles`, `operators`,
  `employees`, `availability`, `projects`, `project_aliases`,
  `project_connections`, `contractor_connections`,
  `contractor_connection_project_assignments`, `schedule_requests`, `tasks`,
  `conversations`, `conversation_participants`, `messages`, `message_reads`,
  `message_attachments`, `notification_templates`, `notification_preferences`,
  `notification_log`, `push_subscriptions`, `subscription_plans`,
  `company_subscriptions`, `discount_codes`, `guest_gc_links`,
  `gc_invite_prefills`, `guest_project_connections`, `contractor_invites`,
  `company_join_requests`, `company_deletion_requests`, `password_reset_codes`,
  `email_send_log`, `sms_inbound_log`, …
- **RLS policies** per table.
- **Triggers**: e.g. plan-limit rejection messages (`PROJECT_LIMIT_REACHED`,
  `EMPLOYEE_LIMIT_REACHED`), profile/operator refetch triggers.
- **RPCs** (callable from the client): `get_company_usage`,
  `get_project_by_connection_code`, `get_project_notification_recipients`,
  `get_project_notification_user_ids`, `get_employee_cross_gc_bookings`, … —
  many are `SECURITY DEFINER` to read across company boundaries.

> The client-side `Database` type (`src/integrations/supabase/types.ts`) is
> generated from this schema; some newer tables are used with `as any` casts
> because the generated types lag the live schema.

### 6.2 `supabase/functions/` — 31 Deno edge functions

| Function | Purpose |
|---|---|
| `send-notification` | Email dispatch via **Resend** using `notification_templates`; validates caller JWT. |
| `send-push` | **Web Push** (+ in-app bell + People chat message) to subscribed users. |
| `send-sms` / `sms-inbound-webhook` | (Legacy) SMS send + Twilio inbound (stop/reply keywords). |
| `create-checkout-session` | Stripe checkout for plan purchase. |
| `create-customer-portal` | Stripe Billing portal URL. |
| `stripe-webhook` | Stripe events → update `company_subscriptions`. |
| `update-stripe-subscription` / `sync-plan-subscribers` / `upsert-stripe-plan` / `archive-stripe-plan` | Plan/subscription sync with Stripe catalog. |
| `parse-schedule` / `parse-employee-roster` | Parse uploaded Excel schedule / employee roster (xlsx). |
| `create-employee-user` | Provision an auth user for an employee. |
| `create-operator` / `create-guest-gc-from-invite` | Provision SSAA operators / guest GC accounts from invites. |
| `delete-company` / `delete-auth-user` / `delete-own-account` | Account/company deletion flows. |
| `send-project-invite` / `send-contractor-invite` / `send-connection-request-notice` / `send-project-connection-code` | Invitations & connection-code emails. |
| `request-join-existing-company` / `notify-join-request` | Join-company request flow. |
| `request-password-reset` / `verify-reset-code` | Password reset via emailed code. |
| `process-profile-email-sync` | Drain `profile_email_sync_queue` (email change propagation). |
| `check-trial-reminders` / `check-guest-gc-outreach` | Scheduled cron reminders (trial expiring / unaccepted guest invites). |

### 6.3 `supabase/config.toml`

Records `project_id` and per-function `verify_jwt` flags. Most functions set
`verify_jwt = false` and authenticate the caller **inside** the handler
(`auth.getUser()`) so they can also be reached by cron/service contexts.

---

## 7. Root config / tooling files

| File | Purpose |
|---|---|
| `app.py` | Flask local host: builds `dist/` if missing, serves it with SPA fallback, opens the browser. `--dev` runs Vite instead. |
| `requirements.txt` | Python dependency: Flask. |
| `.venv/` | Python virtual environment (gitignored). Create with `python3 -m venv .venv`, then `source .venv/bin/activate`. |
| `vite.config.ts` | Dev server (port 8080), SWC React plugin, `@` → `./src` alias, Lovable component tagger (dev mode only). |
| `tsconfig.json` / `tsconfig.app.json` / `tsconfig.node.json` | TS project references. |
| `tailwind.config.ts` + `postcss.config.js` | Tailwind 3 styling. |
| `components.json` | shadcn/ui aliases (points at `components/ui`). |
| `eslint.config.js` | ESLint 9 flat config (React hooks/perf + TS). |
| `package.json` | Scripts: `dev`, `build`, `build:dev`, `lint`, `preview`. npm is the package manager. |
| `package-lock.json` | npm lockfile. |
| `index.html` | Vite HTML entry; loads `/src/main.tsx`. |
| `.env` | `VITE_SUPABASE_URL` + publishable (anon) key. These are **public** by design — do not add service-role or secret keys here. |
| `public/sw.js` | Service worker registered by `usePushNotifications` for Web Push. |

---

## 8. Generated files and removed code

### Auto-generated — do not hand-edit

| File | Generated by |
|---|---|
| `src/integrations/supabase/types.ts` | Supabase codegen (from the live schema) |
| `src/integrations/supabase/client.ts`, `previewAuthStorage.ts` | Lovable |
| `src/integrations/lovable/index.ts` | Lovable (Google/Apple OAuth bridge) |

The client-side `Database` type can lag the live schema, which is why some newer
tables are used with `as any` casts.

### Removed as dead code

Verified unreachable (no imports from anything reachable) before deletion:

- `src/App.css` — never imported
- `src/features/scheduling/topbar/NavLink.tsx` — no importers
- `src/features/scheduling/matrix/MatrixQuickAddModal.tsx` — no importers
- 23 unused shadcn/ui primitives + the `components/ui/use-toast.ts` re-export
  (superseded by `hooks/use-toast.ts`) — see section 5
- `.lovable/` — Lovable agent state (memory/ and plan/), unused by the app
- `bun.lock`, `bun.lockb` — duplicate Bun lockfiles, replaced by `package-lock.json`

`src/vite-env.d.ts` looks unreachable to an import graph but is required: Vite
generates it and TypeScript needs it for `import.meta.env`.

---

## 9. Verifying the project

Run these after changing structure or dependencies:

```sh
npm install        # if node_modules missing
npx tsc --noEmit   # typecheck
npm run build      # production build into dist/
python3 app.py     # serve it and open the browser
```

`npm run lint` currently reports pre-existing problems, almost all of them in
`supabase/functions/**` (Deno edge functions linted with the browser ESLint
config) plus `no-explicit-any` in `src/`. They predate the reorganization and
are unrelated to it.
