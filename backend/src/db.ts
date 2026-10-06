/**
 * Database access for the whole backend.
 *
 * Two exports, during the SQLite -> MySQL migration:
 *
 *   database  NEW. Async helpers that work on BOTH SQLite and MySQL.
 *             Every file should end up using only this.
 *
 *   db        OLD. The raw better-sqlite3 handle the code used before.
 *             Only works while DB_CLIENT=sqlite. In MySQL mode it throws,
 *             so any file that hasn't been converted yet fails loudly
 *             instead of silently writing to the SQLite file.
 *
 * Conversion pattern (see MYSQL_MIGRATION.md for the full list):
 *   db.prepare(SQL).get(a, b)   ->  await database.get(SQL, [a, b])
 *   db.prepare(SQL).all(a)      ->  await database.all(SQL, [a])
 *   db.prepare(SQL).run(a, b)   ->  await database.run(SQL, [a, b])
 *   db.prepare(SQL).all(obj)    ->  await database.all(SQL, obj)   // @named params still work
 *   db.exec(SQL)                ->  await database.exec(SQL)
 *   db.transaction(fn)()        ->  await database.transaction(async () => { ... })
 *
 * When `grep -rn "db\." src` finds nothing, delete the `db` export and
 * set DB_CLIENT=mysql.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import Database from "better-sqlite3";
import mysql, { type PoolConnection, type ResultSetHeader } from "mysql2/promise";
import { config } from "./config.js";

export type Dialect = "sqlite" | "mysql";
export const dialect: Dialect = config.dbClient;

/** Positional values (`?`) or named values (`@name`). */
export type SqlParams = unknown[] | Record<string, unknown>;

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

const sqlite = dialect === "sqlite" ? new Database(config.databasePath) : null;

const pool =
  dialect === "mysql"
    ? mysql.createPool({
        host: config.mysql.host,
        port: config.mysql.port,
        user: config.mysql.user,
        password: config.mysql.password,
        database: config.mysql.database,
        connectionLimit: 10,
        timezone: "Z", // treat all times as UTC, same as SQLite's datetime('now')
        dateStrings: true, // return DATE/DATETIME as strings, like SQLite does
        multipleStatements: true, // needed to run schema.sql in one go
      })
    : null;

/** Holds the open MySQL connection while inside database.transaction(). */
const txConnection = new AsyncLocalStorage<PoolConnection>();
/** Marks that we're already inside a SQLite transaction (SQLite can't nest BEGIN). */
const inSqliteTx = new AsyncLocalStorage<true>();

// ---------------------------------------------------------------------------
// Named parameters
// ---------------------------------------------------------------------------

/**
 * The query layer writes `@name` placeholders with an object of values
 * (a better-sqlite3 feature). MySQL only understands `?`, so rewrite
 * `@name` -> `?` in order, skipping anything inside quotes.
 */
function toPositional(sql: string, params: SqlParams = []): { sql: string; values: unknown[] } {
  if (Array.isArray(params)) return { sql, values: params };

  const values: unknown[] = [];
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "@") {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i + 1));
      if (match) {
        const name = match[0];
        if (!(name in params)) throw new Error(`Missing value for SQL parameter @${name}`);
        values.push(params[name]);
        out += "?";
        i += name.length;
        continue;
      }
    }
    out += ch;
  }
  return { sql: out, values };
}

// ---------------------------------------------------------------------------
// The async API
// ---------------------------------------------------------------------------

async function mysqlQuery(sql: string, values: unknown[]) {
  const runner = txConnection.getStore() ?? pool!;
  const [result] = await runner.query(sql, values);
  return result;
}

export const database = {
  dialect,

  /** All matching rows. */
  async all<T = Record<string, unknown>>(sql: string, params?: SqlParams): Promise<T[]> {
    const q = toPositional(sql, params);
    if (sqlite) return sqlite.prepare(q.sql).all(...q.values) as T[];
    return (await mysqlQuery(q.sql, q.values)) as T[];
  },

  /** First matching row, or undefined. */
  async get<T = Record<string, unknown>>(sql: string, params?: SqlParams): Promise<T | undefined> {
    const q = toPositional(sql, params);
    if (sqlite) return sqlite.prepare(q.sql).get(...q.values) as T | undefined;
    const rows = (await mysqlQuery(q.sql, q.values)) as T[];
    return rows[0];
  },

  /** INSERT / UPDATE / DELETE. `changes` = number of rows affected. */
  async run(sql: string, params?: SqlParams): Promise<{ changes: number }> {
    const q = toPositional(sql, params);
    if (sqlite) return { changes: sqlite.prepare(q.sql).run(...q.values).changes };
    const result = (await mysqlQuery(q.sql, q.values)) as ResultSetHeader;
    return { changes: result.affectedRows };
  },

  /** Run raw SQL with no parameters (e.g. CREATE TABLE). */
  async exec(sql: string): Promise<void> {
    if (sqlite) {
      sqlite.exec(sql);
      return;
    }
    await mysqlQuery(sql, []);
  },

  /**
   * Run several statements all-or-nothing. If `fn` throws, everything it
   * wrote is undone. Every database.* call made inside `fn` (even in other
   * functions it calls) automatically joins the transaction.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (sqlite) {
      if (inSqliteTx.getStore()) return fn(); // already inside one: just join it
      // SQLite has one connection, so BEGIN/COMMIT around the async work.
      sqlite.exec("BEGIN");
      try {
        const result = await inSqliteTx.run(true, fn);
        sqlite.exec("COMMIT");
        return result;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    }

    if (txConnection.getStore()) return fn(); // already inside one: just join it

    const conn = await pool!.getConnection();
    try {
      await conn.beginTransaction();
      const result = await txConnection.run(conn, fn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  },

  /** Current UTC time as "YYYY-MM-DD HH:MM:SS", the format the app already stores. */
  now(): string {
    return new Date().toISOString().slice(0, 19).replace("T", " ");
  },

  /** Close connections (used by tests and graceful shutdown). */
  async close(): Promise<void> {
    if (sqlite) sqlite.close();
    if (pool) await pool.end();
  },
};

// ---------------------------------------------------------------------------
// Legacy handle (delete once nothing imports it)
// ---------------------------------------------------------------------------

export const db: Database.Database = sqlite
  ? sqlite
  : (new Proxy({} as Database.Database, {
      get(_target, prop) {
        throw new Error(
          `db.${String(prop)} was called while DB_CLIENT=mysql. ` +
            "This file hasn't been converted yet. Use `database` from db.ts instead.",
        );
      },
    }) as Database.Database);
