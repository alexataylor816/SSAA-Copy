# Moving the backend from SQLite to MySQL

The backend talks to the database through 78 queries in 11 files. They use
`better-sqlite3`, which returns results **immediately**. MySQL's driver
(`mysql2`) returns them **later** (you `await` them). So the job is:

1. Point every query at the new async helper `database` (works on SQLite *and* MySQL).
2. Fix the few SQL snippets that only SQLite understands.
3. Flip `DB_CLIENT=mysql`.

Because `database` works on SQLite too, the app and the 81 tests keep working
after every single file you convert. Teammates are never broken, since
`DB_CLIENT` stays `sqlite` until the very end.

---

## Step 0: One-time setup

```
cd backend
npm install mysql2
cp .env.example .env          # if you don't have backend/.env yet
mysql -u ssaa_dev -p ssaa < db/mysql/schema.sql
mysql -u ssaa_dev -p ssaa -e "SHOW TABLES;"     # should list 14 tables
npm test                      # baseline: everything should pass on SQLite
```

The files from this package go here:

| File | Status |
|---|---|
| `src/db.ts` | replaces the old 4-line file |
| `src/config.ts` | adds `dbClient` and `mysql` settings |
| `db/mysql/schema.sql` | new: all 14 tables for MySQL |
| `.env.example` | adds `DB_CLIENT` and `MYSQL_*` |

After copying them in, run `npm test` again. It should still pass, because
nothing uses the new helper yet and `db` is still the same SQLite handle.

---

## Step 1: The conversion pattern

| Old (SQLite only) | New (both databases) |
|---|---|
| `db.prepare(SQL).get(a, b)` | `await database.get<Row>(SQL, [a, b])` |
| `db.prepare(SQL).all(a)` | `await database.all<Row>(SQL, [a])` |
| `db.prepare(SQL).run(a, b)` | `await database.run(SQL, [a, b])` |
| `db.prepare(SQL).all(params.values)` (named `@x`) | `await database.all<Row>(SQL, params.values)` |
| `db.exec(SQL)` | `await database.exec(SQL)` |
| `const run = db.transaction(() => {...}); run();` | `await database.transaction(async () => {...})` |
| `datetime('now')` inside SQL | `?` with `database.now()` as the value |

Change the import from `import { db } from "../db.js"` to
`import { database } from "../db.js"`.

**Once a function uses `await`, it becomes `async`, and so does every function
that calls it.** That's the ripple effect, and it's why the order below goes
from the bottom (models) up to the top (routes). Example from `models/users.ts`:

```ts
// before
export function findUserById(id: string): User | undefined {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? mapRow(row) : undefined;
}

// after
export async function findUserById(id: string): Promise<User | undefined> {
  const row = await database.get<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
  return row ? mapRow(row) : undefined;
}
```

Every caller then changes from `findUserById(x)` to `await findUserById(x)`.
TypeScript helps here: a missing `await` usually shows up as a type error
(`Promise<User>` isn't a `User`), so run `npx tsc --noEmit` often.

**Route handlers:** this project uses Express 4, which does *not* catch errors
from async functions. Make each handler `async (req, res) => { try { ... } catch (err) { ... } }`
and keep every `await` *inside* the `try`. The existing handlers already have
`try/catch`, so usually you only add `async` and `await`.

---

## Step 2: Convert in this order (one commit per step, `npm test` after each)

| # | File(s) | Queries | Notes |
|---|---|---|---|
| 1 | `models/users.ts`, `models/passwordResets.ts` | 14 | Good warm-up. `findUserById`/`findUserByEmail` are also called from `routes/auth.ts`, `rbac/service.ts`, `scheduling/service.ts`, `scheduling/routes.ts`, `query/registry.ts`, `realtime/index.ts`; add `await` there too |
| 2 | `rbac/models.ts` | 20 | Two `datetime('now')` updates (lines ~159, ~211) |
| 3 | `rbac/service.ts`, `rbac/routes.ts` | 2 | Two `db.transaction` calls (lines ~67, ~161) |
| 4 | `scheduling/models.ts` | 18 | One `datetime('now')` update (line ~313) |
| 5 | `scheduling/service.ts`, `scheduling/routes.ts` | 0 | Only `await` ripple |
| 6 | `query/projectTables.ts`, `query/registry.ts` | 13 | |
| 7 | `query/executor.ts`, `query/rpc.ts`, `query/routes.ts` | 11 | SQLite-only SQL, see Step 3 |
| 8 | `realtime/index.ts`, `routes/health.ts` | 2 | |
| 9 | `models/index.ts`, `app.ts`, `server.ts` | 0 | Schema setup becomes async, see Step 4 |
| 10 | `tests/*.ts` | | `historicalLock.test.ts` uses `db` directly; health test expects `"sqlite ok"` |

Track progress with:

```
grep -rn "db\.\(prepare\|exec\|transaction\)" src tests | wc -l
```

It starts at 78 and is done at 0.

---

## Step 3: SQL that only SQLite understands

| Where | SQLite | MySQL-safe replacement |
|---|---|---|
| `rbac/models.ts` ~159, ~211; `scheduling/models.ts` ~313 | `updated_at = datetime('now')` | `updated_at = ?` and pass `database.now()` |
| `query/rpc.ts` ~75, ~91, ~144 | `name LIKE ? COLLATE NOCASE` | `LOWER(name) LIKE LOWER(?)` (works on both) |
| `query/executor.ts` ~410–417 (upsert) | `ON CONFLICT(cols) DO UPDATE SET c = excluded.c` / `DO NOTHING` | MySQL: `INSERT ... VALUES (...) AS new ON DUPLICATE KEY UPDATE c = new.c`; for "do nothing" use `ON DUPLICATE KEY UPDATE id = id`. Branch on `database.dialect`. |
| `models/users.ts` ~38–46, `query/projectTables.ts` ~76–84 | `PRAGMA table_info(...)` + `ALTER TABLE ADD COLUMN` | Only run these when `database.dialect === "sqlite"`. In MySQL, `schema.sql` already has the columns. |

---

## Step 4: Creating tables on startup

Today `createApp()` calls `ensureSchema()`, which runs SQLite `CREATE TABLE`s.
Make it async and pick the right source:

```ts
// models/index.ts
import fs from "node:fs";
import path from "node:path";
import { BASE_DIR } from "../config.js";
import { database } from "../db.js";

export async function ensureSchema() {
  if (database.dialect === "mysql") {
    await database.exec(fs.readFileSync(path.join(BASE_DIR, "db/mysql/schema.sql"), "utf8"));
    return;
  }
  await ensureUsersTable();
  await ensurePasswordResetsTable();
  await ensureRbacTables();
  await ensureSchedulingTables();
  await ensureProjectTables();
}
```

Then `createApp()` becomes `async`, `server.ts` does
`const { httpServer } = await createApp();`, and each test file does
`const { app } = await createApp();` (top-level `await` is fine in these ES modules).

---

## Step 5: Flip to MySQL

1. `grep -rn "db\." src tests` finds no old-style calls.
2. Delete the `db` export at the bottom of `src/db.ts`.
3. In `backend/.env`, set `DB_CLIENT=mysql`.
4. `npm run dev`, then open `http://127.0.0.1:8000/health`. It should say `"mysql ok"`.
5. Run the web app (`cd ../web && npm run dev`), sign up, create a company, a project, and availability.
6. Look at the data: `mysql -u ssaa_dev -p ssaa -e "SELECT id, email FROM users;"`

### Running the tests against MySQL

SQLite tests use a throwaway in-memory database. MySQL has no such thing, so
use a separate test database:

```sql
-- as root:  mysql -u root -p
CREATE DATABASE ssaa_test;
GRANT ALL PRIVILEGES ON ssaa_test.* TO 'ssaa_dev'@'localhost';
```

Run tests with `DB_CLIENT=mysql MYSQL_DATABASE=ssaa_test`, one file at a time
(`fileParallelism: false` in `vitest.config.ts`), and empty the tables at the
start of each test file so leftovers from one file don't affect the next.

---

## Behaviour that changes on MySQL (check these when testing)

1. **Foreign keys are enforced.** SQLite in this project never turned them on,
   so `ON DELETE CASCADE` never actually ran. In MySQL it does: deleting a
   company deletes its projects, employees, availability and requests. Also,
   inserting a row whose parent doesn't exist now fails instead of being allowed.
2. **Text comparisons ignore upper/lower case.** `WHERE name = 'acme'` matches
   `'ACME'`, and `ORDER BY name` sorts case-insensitively.
3. **`ON DUPLICATE KEY UPDATE` fires on any unique key** in the table, not only
   the columns the upsert named. Fine for these tables, but worth knowing.

---

## Prompt you can give Claude Code in VS Code

> Read `backend/MYSQL_MIGRATION.md`. Convert `backend/` from the old `db`
> (better-sqlite3) handle to the async `database` helper in `src/db.ts`, following
> the order in Step 2. After each step run `npx tsc --noEmit` and `npm test`, and
> stop if anything fails. Keep `DB_CLIENT=sqlite` until all steps pass. Apply the
> SQL fixes in Step 3 and the async schema setup in Step 4. Don't change table
> structure or API responses. Commit after each step with a clear message.
