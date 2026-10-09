/**
 * Confirms db/mysql/schema.sql has every table and column the SQLite schema
 * setup creates, with the same NOT NULL and has-a-default behaviour.
 *
 *   npx tsx db/mysql/check-schema.ts            compare against schema.sql (no MySQL needed)
 *   npx tsx db/mysql/check-schema.ts --mysql    compare against the live MYSQL_DATABASE
 *                                               (load schema.sql into it first)
 *
 * The SQLite side is built by running the app's own ensureSchema() on an
 * in-memory database, so it includes every ALTER TABLE ... ADD COLUMN.
 * Exits 1 on any mismatch.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface Column {
  notNull: boolean;
  hasDefault: boolean;
}
type Schema = Map<string, Map<string, Column>>;

const here = path.dirname(fileURLToPath(import.meta.url));

/** MySQL-only columns standing in for something SQLite has implicitly. */
const MYSQL_ONLY_COLUMNS = new Set([
  "messages.seq", // SQLite's rowid: insertion order for messages
]);
const useLiveMysql = process.argv.includes("--mysql");

// Must be set before db.ts / config.ts load; dotenv never overrides these.
process.env.DB_CLIENT = "sqlite";
process.env.DATABASE_PATH = ":memory:";

async function sqliteSchema(): Promise<Schema> {
  const { database } = await import("../../src/db.js");
  const { ensureSchema } = await import("../../src/models/index.js");
  await ensureSchema();

  const schema: Schema = new Map();
  const tables = await database.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  for (const { name } of tables) {
    const cols = await database.all<{ name: string; notnull: number; dflt_value: string | null; pk: number }>(
      `PRAGMA table_info(${name})`,
    );
    schema.set(
      name,
      new Map(
        // SQLite reports TEXT PRIMARY KEY as nullable; MySQL primary keys never are.
        cols.map((c) => [c.name, { notNull: c.notnull === 1 || c.pk > 0, hasDefault: c.dflt_value !== null }]),
      ),
    );
  }
  return schema;
}

function parseColumn(definition: string): Column {
  return {
    notNull: /\bNOT NULL\b|\bPRIMARY KEY\b/i.test(definition),
    hasDefault: /\bDEFAULT\b/i.test(definition),
  };
}

function schemaFileSchema(): Schema {
  const sql = fs
    .readFileSync(path.join(here, "schema.sql"), "utf8")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

  const schema: Schema = new Map();
  for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\)\s*ENGINE/g)) {
    const cols = new Map<string, Column>();
    const compositePk = /PRIMARY KEY \(([^)]+)\)/.exec(m[2]);
    const pkCols = new Set(compositePk ? compositePk[1].split(",").map((c) => c.trim()) : []);
    for (const raw of m[2].split("\n")) {
      const line = raw.trim().replace(/,$/, "");
      if (!line || /^(PRIMARY KEY|UNIQUE|INDEX|KEY|CONSTRAINT)\b/i.test(line)) continue;
      const [, name, rest] = /^(\w+)\s+(.*)$/.exec(line) ?? [];
      if (!name) continue;
      const col = parseColumn(rest);
      if (pkCols.has(name)) col.notNull = true;
      cols.set(name, col);
    }
    schema.set(m[1], cols);
  }
  for (const m of sql.matchAll(/'ALTER TABLE (\w+) ADD COLUMN (\w+) (.*?)', 'DO 0'\)/g)) {
    schema.get(m[1])?.set(m[2], parseColumn(m[3]));
  }
  return schema;
}

async function liveMysqlSchema(): Promise<Schema> {
  const { config } = await import("../../src/config.js");
  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
  });
  const [rows] = await conn.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS dflt
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`,
  );
  await conn.end();
  const schema: Schema = new Map();
  for (const r of rows as { t: string; c: string; nullable: string; dflt: string | null }[]) {
    if (!schema.has(r.t)) schema.set(r.t, new Map());
    schema.get(r.t)!.set(r.c, { notNull: r.nullable === "NO", hasDefault: r.dflt !== null });
  }
  return schema;
}

const sqlite = await sqliteSchema();
const mysqlSide = useLiveMysql ? await liveMysqlSchema() : schemaFileSchema();
const source = useLiveMysql ? `MySQL database (information_schema)` : "schema.sql";

const problems: string[] = [];
let columnCount = 0;
for (const [table, cols] of sqlite) {
  const other = mysqlSide.get(table);
  if (!other) {
    problems.push(`missing table: ${table}`);
    continue;
  }
  for (const [name, col] of cols) {
    columnCount++;
    const match = other.get(name);
    if (!match) {
      problems.push(`missing column: ${table}.${name}`);
      continue;
    }
    if (match.notNull !== col.notNull) {
      problems.push(`${table}.${name}: SQLite ${col.notNull ? "NOT NULL" : "NULL"}, MySQL ${match.notNull ? "NOT NULL" : "NULL"}`);
    }
    if (match.hasDefault !== col.hasDefault) {
      problems.push(`${table}.${name}: SQLite ${col.hasDefault ? "has" : "no"} default, MySQL ${match.hasDefault ? "has" : "no"} default`);
    }
  }
  for (const name of other.keys()) {
    if (!cols.has(name) && !MYSQL_ONLY_COLUMNS.has(`${table}.${name}`)) {
      problems.push(`extra MySQL column (not in SQLite): ${table}.${name}`);
    }
  }
}
for (const table of mysqlSide.keys()) {
  if (!sqlite.has(table)) problems.push(`extra MySQL table (not in SQLite): ${table}`);
}

if (problems.length) {
  console.error(`${problems.length} mismatch(es) between SQLite and ${source}:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`OK: all ${sqlite.size} tables and ${columnCount} columns match ${source}.`);
