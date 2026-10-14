/**
 * Export a SQLite database (the app's ssaa.db) as a MySQL dump that loads into
 * the app's own MySQL schema, backend/db/mysql/schema.sql.
 *
 *   npx tsx scripts/export-mysql.ts --db ssaa.db --out ../database/exports/ssaa.sql
 *
 * The dump recreates every table from schema.sql, then inserts the rows exactly
 * as SQLite stores them: the schema keeps timestamps as text on purpose, because
 * the app compares them as strings. Rows whose parent row no longer exists
 * (SQLite here never enforced foreign keys; MySQL does) are left out and listed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dbPath = arg("--db") ?? "ssaa.db";
const outPath = arg("--out") ?? "../database/exports/ssaa.sql";
const schemaPath = arg("--schema") ?? path.join(here, "..", "db", "mysql", "schema.sql");
const dbName = arg("--database") ?? "ssaa";
const keepOrphans = args.includes("--keep-orphans");
if (!/^[A-Za-z0-9_]+$/.test(dbName)) throw new Error("--database must be letters, digits or underscores.");

const schemaSql = fs.readFileSync(schemaPath, "utf8");
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const q = (ident: string) => `\`${ident.replace(/`/g, "``")}\``;

/** Column types per table, read from schema.sql (`CREATE TABLE IF NOT EXISTS name ( col TYPE ... )`). */
function parseSchema(sql: string): Map<string, Map<string, string>> {
  const tables = new Map<string, Map<string, string>>();
  for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+`?(\w+)`?\s*\(([\s\S]*?)\n\)\s*ENGINE/gi)) {
    const cols = new Map<string, string>();
    for (const line of m[2].split("\n")) {
      const c = line.match(/^\s*`?(\w+)`?\s+([A-Z]+)/);
      if (c && !/^(PRIMARY|UNIQUE|INDEX|KEY|CONSTRAINT|FOREIGN|CHECK)$/i.test(c[1])) cols.set(c[1], c[2].toUpperCase());
    }
    tables.set(m[1], cols);
  }
  // Columns added later arrive as (conditional) ALTER TABLE ... ADD COLUMN statements.
  for (const m of sql.matchAll(/ALTER TABLE\s+`?(\w+)`?\s+ADD COLUMN\s+`?(\w+)`?\s+([A-Z]+)/gi)) {
    tables.get(m[1])?.set(m[2], m[3].toUpperCase());
  }
  return tables;
}
const mysqlTables = parseSchema(schemaSql);

const sqliteTables = (
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]
).map((t) => t.name);

const missing = sqliteTables.filter((t) => !mysqlTables.has(t));
if (missing.length) {
  throw new Error(`schema.sql has no table for: ${missing.join(", ")}. Update backend/db/mysql/schema.sql first (npx tsx db/mysql/check-schema.ts).`);
}

// Rows pointing at a parent that no longer exists, per table (by rowid).
const orphans = new Map<string, Set<number>>();
for (const v of db.prepare("PRAGMA foreign_key_check").all() as { table: string; rowid: number; parent: string }[]) {
  if (!orphans.has(v.table)) orphans.set(v.table, new Set());
  orphans.get(v.table)!.add(v.rowid);
}

const INTEGER_TYPES = new Set(["INT", "INTEGER", "BIGINT", "TINYINT", "SMALLINT"]);

function sqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\0/g, "\\0")}'`;
}

function literal(value: unknown, mysqlType: string, where: string): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return INTEGER_TYPES.has(mysqlType) ? String(Math.trunc(value)) : String(value);
  if (Buffer.isBuffer(value)) return `X'${value.toString("hex")}'`;
  const text = String(value);
  if (INTEGER_TYPES.has(mysqlType)) {
    // e.g. a whole number SQLite stored as text ("1.0"); MySQL's strict mode rejects that in an INT.
    const n = Number(text);
    if (!Number.isFinite(n)) throw new Error(`${where}: "${text}" is not a number.`);
    return String(Math.trunc(n));
  }
  if (mysqlType === "JSON") {
    try {
      JSON.parse(text);
    } catch {
      throw new Error(`${where}: not valid JSON: ${text.slice(0, 60)}`);
    }
  }
  return sqlString(text);
}

const out: string[] = [
  "-- SSAA MySQL dump",
  `-- Generated ${new Date().toISOString()} from ${path.basename(dbPath)} by backend/scripts/export-mysql.ts`,
  "-- Tables: backend/db/mysql/schema.sql (the schema the app runs on). Requires MySQL 8.0.13+.",
  "",
  "SET NAMES utf8mb4;",
  "SET FOREIGN_KEY_CHECKS = 0;",
  `CREATE DATABASE IF NOT EXISTS ${q(dbName)} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`,
  `USE ${q(dbName)};`,
  "",
  "-- Start clean so the inserts below don't collide with old rows.",
  ...[...mysqlTables.keys()].map((t) => `DROP TABLE IF EXISTS ${q(t)};`),
  "",
  schemaSql.trim(),
  "",
];

let rowTotal = 0;
const skipped: string[] = [];
for (const table of sqliteTables) {
  const types = mysqlTables.get(table)!;
  const cols = (db.prepare(`PRAGMA table_info(${q(table)})`).all() as { name: string }[]).map((c) => c.name);
  const unknown = cols.filter((c) => !types.has(c));
  if (unknown.length) throw new Error(`schema.sql's ${table} is missing column(s): ${unknown.join(", ")}.`);

  const bad = keepOrphans ? new Set<number>() : (orphans.get(table) ?? new Set<number>());
  const rows = (db.prepare(`SELECT rowid AS __rowid, * FROM ${q(table)} ORDER BY rowid`).all() as Record<string, unknown>[]).filter(
    (r) => !bad.has(Number(r.__rowid)),
  );
  if (bad.size) skipped.push(`${table}: ${bad.size}`);
  if (!rows.length) continue;

  out.push(`-- ${table}: ${rows.length} row${rows.length === 1 ? "" : "s"}`);
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    out.push(
      `INSERT INTO ${q(table)} (${cols.map(q).join(", ")}) VALUES\n${chunk
        .map((r) => `  (${cols.map((c) => literal(r[c], types.get(c)!, `${table}.${c}`)).join(", ")})`)
        .join(",\n")};`,
    );
  }
  out.push("");
  rowTotal += rows.length;
}

out.push("SET FOREIGN_KEY_CHECKS = 1;", "");
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, out.join("\n"));
console.log(`Wrote ${outPath}: ${sqliteTables.length} tables, ${rowTotal} rows.`);
if (skipped.length) console.log(`Left out rows whose parent row is gone (use --keep-orphans to keep them): ${skipped.join(", ")}`);
