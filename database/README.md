# SSAA database — MySQL

The backend runs on **SQLite by default** and on **MySQL** with `DB_CLIENT=mysql`
(every query goes through one async helper, `backend/src/db.ts`; see
`backend/MYSQL_MIGRATION.md`). The MySQL tables are defined in
**`backend/db/mysql/schema.sql`** — the one schema the app runs on.

| File | What it is |
|---|---|
| `backend/db/mysql/schema.sql` | All 23 tables (loaded automatically when the app starts on MySQL). |
| `database/mysql/ssaa_demo.sql` | That schema **plus** a clean demo data set (below). Safe to share: only `@example.com` accounts. |
| `database/exports/` | Your own exports of a real database. **Git-ignored** — they contain password hashes. |

## Load the demo into MySQL

```bash
mysql -u root -p < database/mysql/ssaa_demo.sql      # creates/refreshes database `ssaa`
```

MySQL Workbench: **File → Open SQL Script** → `ssaa_demo.sql` → run (⚡). Check it:

```sql
USE ssaa;
SELECT table_name, table_rows FROM information_schema.tables WHERE table_schema = 'ssaa' ORDER BY table_name;
```

## Run the app on MySQL

One-time, as MySQL root:

```sql
CREATE USER IF NOT EXISTS 'ssaa_dev'@'localhost' IDENTIFIED BY 'devpassword';
CREATE DATABASE IF NOT EXISTS ssaa;
CREATE DATABASE IF NOT EXISTS ssaa_test;
GRANT ALL PRIVILEGES ON ssaa.* TO 'ssaa_dev'@'localhost';
GRANT ALL PRIVILEGES ON ssaa_test.* TO 'ssaa_dev'@'localhost';
```

Then from `backend/`: `npm run dev:mysql` (app) or `npm run test:mysql` (tests, in `ssaa_test`).
The MySQL login comes from `MYSQL_*` in `backend/.env` (defaults in `.env.example`).

## Demo data

Password for every account: `Demo1234!` (dates are relative to when the dump was generated).

| Email | Role |
|---|---|
| gina.torres@example.com | **Terrapin Builders** (GC) — account holder |
| paul.kim@example.com | Terrapin Builders — Project Manager (partial) |
| bao.plumbing@example.com | **Bao Plumbing** (sub) — account holder |
| mike.rivera@example.com | Bao Plumbing — Foreman (level_1), employee ID BP-102 |
| pete.alvarez@example.com | Bao Plumbing — Journeyman Plumber (basic), employee ID BP-117 |
| erin.walsh@example.com | **Capital Electric** (sub) — account holder |
| dev.patel@example.com | Capital Electric — Electrician (partial) |

Two projects, a week of availability (with a two-stop day), confirmed / pending /
declined schedule requests, tasks, a project chat, a DM and a group chat.

## Regenerate / export

From `backend/`:

```bash
npm run db:refresh-demo-dump   # rebuild the demo data, then database/mysql/ssaa_demo.sql
npm run db:export-mysql        # export YOUR local ssaa.db to database/exports/ssaa.sql
```

- `scripts/seed-demo.ts` builds the demo through the real API, so it obeys every app rule.
- `scripts/export-mysql.ts` turns a SQLite database into a dump for `schema.sql`:
  values are copied exactly as SQLite stores them (the schema keeps timestamps as
  text on purpose, because the app compares them as strings), and rows pointing at
  a deleted parent are left out and listed, since MySQL enforces foreign keys and
  SQLite here never did. Use it to move an existing team database onto MySQL.

## Differences on MySQL (from `backend/MYSQL_MIGRATION.md`)

1. Foreign keys are enforced: deleting a company really deletes its projects,
   employees and requests (`ON DELETE CASCADE`).
2. Text comparison ignores upper/lower case.
3. Timestamps are UTC text, same as on SQLite.
