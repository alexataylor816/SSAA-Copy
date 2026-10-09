/**
 * Compiles a PostgREST-shaped query description into parameterised SQL.
 *
 * The client facade (web/src/integrations/supabase) sends the same call shape
 * the Lovable components already use, so those components port over without
 * being rewritten. Column names are validated against the table registry and
 * every value is bound — no user input is ever concatenated into SQL.
 */
import { randomUUID } from "node:crypto";
import { database } from "../db.js";
import { BadRequestError, ForbiddenError } from "../rbac/errors.js";
import { TABLE_RULES, type Caller } from "./registry.js";

export type QueryOperation = "select" | "insert" | "update" | "delete" | "upsert";

export interface QueryFilter {
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "in" | "is" | "not";
  column: string;
  value: unknown;
}

export interface QueryOrder {
  column: string;
  ascending: boolean;
}

export interface QueryRequest {
  table: string;
  operation: QueryOperation;
  /** Columns to read; "*" for all registered columns. Defaults to "*". */
  select?: string;
  filters?: QueryFilter[];
  or?: string;
  order?: QueryOrder[];
  limit?: number;
  offset?: number;
  /** PostgREST semantics: error unless exactly one row comes back. */
  single?: boolean;
  /** PostgREST semantics: return null instead of erroring on zero rows. */
  maybeSingle?: boolean;
  data?: Record<string, unknown> | Record<string, unknown>[];
  /** For upsert: the columns that form the conflict target. */
  onConflict?: string;
}

const SQL_OP: Record<QueryFilter["op"], string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "LIKE",
  ilike: "LIKE",
  in: "IN",
  is: "IS",
  not: "NOT",
};

/**
 * Neither SQLite nor MySQL has ILIKE; emulate it the way Postgres does
 * (case-insensitive) by lowering both sides. buildWhere wraps the column.
 */
function normaliseOp(op: QueryFilter["op"]): { sql: string; transform?: (v: unknown) => unknown } {
  if (op === "ilike") {
    return { sql: "LIKE", transform: (v) => (typeof v === "string" ? v.toLowerCase() : v) };
  }
  return { sql: SQL_OP[op] };
}

class Params {
  readonly values: Record<string, unknown> = {};
  private n = 0;

  bind(value: unknown): string {
    const key = `p${this.n++}`;
    this.values[key] = value;
    return `@${key}`;
  }

  merge(other: Record<string, unknown>) {
    Object.assign(this.values, other);
  }
}

function assertColumn(rule: { columns: readonly string[] }, column: string) {
  if (!rule.columns.includes(column)) {
    throw new ForbiddenError(`Unknown column "${column}".`);
  }
}

/**
 * Parses the small subset of PostgREST's embedded-resource syntax the Lovable
 * components actually use: `id, name, companies(*)`, `*, tasks(*)`.
 */
function parseSelect(select: string): string[] {
  const columns: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of select) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      if (current.trim()) columns.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) columns.push(current.trim());
  return columns;
}

function buildWhere(
  params: Params,
  rule: { columns: readonly string[] },
  filters: QueryFilter[] | undefined,
  rawOr: string | undefined,
): string {
  const clauses: string[] = [];

  for (const filter of filters ?? []) {
    assertColumn(rule, filter.column);
    const { sql: op, transform } = normaliseOp(filter.op);
    const value = transform ? transform(filter.value) : filter.value;

    if (filter.op === "in") {
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        clauses.push("1 = 0");
        continue;
      }
      clauses.push(`${filter.column} IN (${filter.value.map((v) => params.bind(v)).join(", ")})`);
      continue;
    }
    if (filter.op === "is") {
      clauses.push(`${filter.column} IS ${filter.value === null ? "NULL" : "NOT NULL"}`);
      continue;
    }
    if (filter.op === "not") {
      // Supabase `.not(col, 'is', null)` means "is not null".
      clauses.push(`${filter.column} IS NOT NULL`);
      continue;
    }
    if (filter.op === "ilike") {
      clauses.push(`LOWER(${filter.column}) ${op} ${params.bind(value)}`);
      continue;
    }
    clauses.push(`${filter.column} ${op} ${params.bind(value)}`);
  }

  if (rawOr) {
    const parts = rawOr.split(",").map((s) => s.trim());
    const built = parts.map((part) => {
      const [rawColumn, ...rest] = part.split(".");
      let column = rawColumn;
      let negated = false;
      if (column.startsWith("not.")) {
        negated = true;
        column = column.slice(4);
      }
      assertColumn(rule, column);
      const operator = rest[0];
      const rawValue = rest.slice(1).join(".");
      if (operator === "is") {
        return `${column} IS ${rawValue === "null" ? "NULL" : "NOT NULL"}`;
      }
      if (!["eq", "neq"].includes(operator)) {
        throw new ForbiddenError(`Unsupported or() operator "${operator}".`);
      }
      const cmp = operator === "eq" ? "=" : "<>";
      return negated ? `NOT (${column} ${cmp} ${params.bind(rawValue)})` : `${column} ${cmp} ${params.bind(rawValue)}`;
    });
    clauses.push(`(${built.join(" OR ")})`);
  }

  return clauses.join(" AND ");
}

async function applyScope(params: Params, caller: Caller, table: string, rule: (typeof TABLE_RULES)[string]): Promise<string> {
  const scoped = await rule.scope?.(caller);
  if (!scoped) return "";
  params.merge(scoped.params);
  return scoped.sql;
}

function rowsFrom(data: QueryRequest["data"]): Record<string, unknown>[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") return [data];
  throw new ForbiddenError("A data payload is required for this operation.");
}

/**
 * Recover the target row's id from the request's own filters.
 *
 * PostgREST addresses the affected row with a filter rather than with an id
 * inside the body, so `.update({ status: "done" }).eq("id", rowId)` is the
 * idiomatic shape -- and it is the shape every component ported from the
 * reference app writes. Requiring the id to be inlined into the payload as well
 * meant those calls threw "Each updated row must include its id" even though the
 * caller had unambiguously named the row.
 *
 * Only a single-valued `id` filter is accepted. `.eq("id", a).eq("id", b)` and
 * `.in("id", [a, b])` each name several rows, so there is no single row for the
 * payload to belong to and the call is refused rather than guessed at.
 */
function rowIdFromFilters(rule: { columns: readonly string[] }, req: QueryRequest): string | null {
  if (!rule.columns.includes("id")) return null;

  const values: unknown[] = [];
  for (const filter of req.filters ?? []) {
    if (filter.column !== "id") continue;
    if (filter.op === "eq") {
      values.push(filter.value);
      continue;
    }
    if (filter.op === "in" && Array.isArray(filter.value)) {
      values.push(...filter.value);
      continue;
    }
    return null;
  }

  if (values.length !== 1) return null;
  return typeof values[0] === "string" && values[0] !== "" ? values[0] : null;
}

/** Matches the format the rest of the schema stores timestamps in. */
function nowTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Reject, loudly, any attempt to write a server-owned column. `id` is exempt
 * because it selects the row rather than describing a new value.
 */
function assertWritableColumns(rule: { readonlyColumns?: readonly string[] }, row: Record<string, unknown>) {
  for (const column of rule.readonlyColumns ?? []) {
    if (column !== "id" && column in row) {
      throw new ForbiddenError(`"${column}" is managed by the server and cannot be written.`);
    }
  }
}

/** A non-negative whole number for LIMIT/OFFSET, which can't be bound as parameters. */
function wholeNumber(name: string, value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new BadRequestError(`${name} must be a non-negative whole number.`);
  return n;
}

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function readRows(
  table: string,
  columns: string[],
  where: string,
  order: QueryOrder[],
  params: Params,
  limit?: number,
  offset?: number,
) {
  // ORDER BY names and LIMIT/OFFSET can't be bound as parameters and are
  // spliced into the SQL text, so they must be plain identifiers and integers.
  for (const o of order) {
    if (typeof o.column !== "string" || !IDENTIFIER_RE.test(o.column)) {
      throw new BadRequestError(`Unsupported order column "${String(o.column)}".`);
    }
  }
  const orderSql = order.map((o) => `${o.column} ${o.ascending ? "ASC" : "DESC"}`).join(", ");
  const sql = `SELECT ${columns.join(", ")} FROM ${table}${where ? ` WHERE ${where}` : ""}${
    orderSql ? ` ORDER BY ${orderSql}` : ""
  }${limit != null ? ` LIMIT ${wholeNumber("limit", limit)}` : ""}${offset != null ? ` OFFSET ${wholeNumber("offset", offset)}` : ""}`;
  const rows = await database.all<Record<string, unknown>>(sql, params.values);
  return rows.map(denormaliseRow);
}

async function resolveEmbedded(
  table: string,
  column: string,
  baseRows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  // `companies(*)` style embedding: resolve once per distinct id, then fan out.
  const [targetTable, targetColumn] = column.split(":");
  const rule = TABLE_RULES[targetTable];
  if (!rule) return baseRows;

  const ids = [...new Set(baseRows.map((r) => r[targetColumn]).filter((v): v is string => typeof v === "string"))];
  if (ids.length === 0) {
    return baseRows.map((r) => ({ ...r, [targetTable]: [] }));
  }
  const params = new Params();
  const placeholders = ids.map((id) => params.bind(id)).join(", ");
  const related = await database.all<Record<string, unknown>>(
    `SELECT * FROM ${targetTable} WHERE id IN (${placeholders})`,
    params.values,
  );
  const byId = new Map(related.map((r) => [r.id as string, denormaliseRow(r)]));

  return baseRows.map((r) => ({ ...r, [targetTable]: byId.get(r[targetColumn] as string) ?? null }));
}

function projectColumns(raw: string | undefined, rule: (typeof TABLE_RULES)[string]): string[] {
  const requested = raw && raw.trim() !== "" ? parseSelect(raw) : ["*"];
  const out: string[] = [];
  for (const item of requested) {
    if (item === "*") {
      out.push(...rule.columns);
      continue;
    }
    const embed = item.match(/^(\w+)\((.+)\)$/);
    if (embed) {
      // Embedded resource: pull in the FK column so the client can join it up.
      const [, targetTable] = embed;
      const targetRule = TABLE_RULES[targetTable];
      if (!targetRule) continue;
      if (!rule.columns.includes(targetTable + "_id") && !rule.columns.includes("id")) continue;
      const fk = rule.columns.find((c) => c === `${targetTable}_id`) ?? "id";
      if (!out.includes(fk)) out.push(fk);
      out.push(item);
      continue;
    }
    assertColumn(rule, item);
    if (!out.includes(item)) out.push(item);
  }
  return out.length > 0 ? out : ["id"];
}

export async function runQuery(caller: Caller, req: QueryRequest): Promise<unknown> {
  const rule = TABLE_RULES[req.table];
  if (!rule) {
    throw new ForbiddenError(`Table "${req.table}" is not available through the query API.`);
  }
  // password_resets is registered only to deny it explicitly.
  if (rule.columns.length === 0) {
    throw new ForbiddenError(`Table "${req.table}" is not readable.`);
  }

  const params = new Params();

  switch (req.operation) {
    case "select": {
      const where = [
        buildWhere(params, rule, req.filters, req.or),
        await applyScope(params, caller, req.table, rule),
      ]
        .filter(Boolean)
        .join(" AND ");
      const columns = projectColumns(req.select, rule);
      let rows = await readRows(req.table, columns, where, req.order ?? [], params, req.limit, req.offset);

      const embedded = (req.select ?? "*").match(/\w+\(.+\)/g) ?? [];
      for (const column of embedded) {
        rows = await resolveEmbedded(req.table, column, rows);
      }

      if (req.single) {
        if (rows.length !== 1) throw new ForbiddenError("Expected exactly one row.");
        return rows[0];
      }
      if (req.maybeSingle) return rows[0] ?? null;
      return rows;
    }

    case "insert": {
      const rows = rowsFrom(req.data);
      await rule.canWrite?.(caller, rows);

      const inserted: Record<string, unknown>[] = [];
      for (const row of rows) {
        // The server owns ids and timestamps. Clients never supply them, and
        // SQLite would happily store NULL into an unconstrained TEXT primary
        // key, which produced unaddressable rows before this was fixed.
        const managed = new Set(rule.readonlyColumns ?? []);
        const clean: Record<string, unknown> = {};
        for (const [column, value] of Object.entries(row)) {
          if (managed.has(column)) continue;
          assertColumn(rule, column);
          clean[column] = value;
        }
        // `rule.columns` is an array of names, so membership needs includes():
        // `in` would test array indices and silently answer false.
        if (rule.columns.includes("id")) clean.id = randomUUID();
        if (rule.columns.includes("created_at")) clean.created_at = nowTimestamp();
        if (rule.columns.includes("updated_at")) clean.updated_at = nowTimestamp();
        // Tasks are ordered by sort_order and every row defaults to 0, so an
        // explicit sort_order from the client is honoured but an omitted one
        // appends to the end of the project instead of tying with every sibling.
        if (req.table === "tasks" && clean.sort_order == null) {
          const maxRow = await database.get<{ max: number | null }>(
            `SELECT MAX(sort_order) AS max FROM tasks WHERE project_id = @projectId`,
            { projectId: clean.project_id },
          );
          clean.sort_order = (maxRow?.max ?? -1) + 1;
        }

        const columns = Object.keys(clean);
        const placeholders = columns.map((c) => params.bind(normaliseValue(clean[c]))).join(", ");
        await database.run(`INSERT INTO ${req.table} (${columns.join(", ")}) VALUES (${placeholders})`, params.values);
        inserted.push(clean);
      }

      const ids = inserted.map((r) => r.id).filter(Boolean) as string[];
      if (!ids.length) return inserted;
      return readBackInOrder(req.table, ids, params);
    }

    case "update": {
      // Merge a single-valued `id` filter into the payload before the row is
      // validated or handed to canWrite: both of those need the id to be on the
      // row already, so it has to be resolved first rather than at write time.
      const filterId = rowIdFromFilters(rule, req);
      const rows = rowsFrom(req.data).map((row) => (row.id == null && filterId != null ? { ...row, id: filterId } : row));
      await rule.canWrite?.(caller, rows);

      const touched: string[] = [];
      for (const row of rows) {
        if (row.id == null) {
          // Without an id this becomes "update every row I can see".
          throw new ForbiddenError(
            'Each updated row must include its id: put it in the data payload, or name the row with .eq("id", rowId).',
          );
        }
        assertWritableColumns(rule, row);
        const setColumns = Object.keys(row).filter((c) => {
          assertColumn(rule, c);
          // `id` picks the row; it is never a value we write.
          return c !== "id";
        });
        if (setColumns.length === 0) continue;
        const setSql = setColumns.map((c) => `${c} = ${params.bind(normaliseValue(row[c]))}`).join(", ");
        const where = buildWhere(params, rule, req.filters, req.or);
        const scopeSql = await applyScope(params, caller, req.table, rule);
        const fullWhere = [where, scopeSql, `id = ${params.bind(row.id)}`].filter(Boolean).join(" AND ");
        await database.run(`UPDATE ${req.table} SET ${setSql} WHERE ${fullWhere}`, params.values);
        touched.push(String(row.id));
      }
      if (!touched.length) return [];
      return readBackInOrder(req.table, touched, params);
    }

    case "delete": {
      // The scope clause is never proof of intent -- it is present on every call.
      // Require the caller to name the rows themselves, so a missing filter
      // cannot turn into "delete everything I can see".
      const hasCallerFilter = (req.filters?.length ?? 0) > 0 || Boolean(req.or?.trim());
      if (!hasCallerFilter) {
        throw new ForbiddenError("Refusing to delete every row: pass a filter naming the rows to delete.");
      }
      const where = buildWhere(params, rule, req.filters, req.or);
      const scopeSql = await applyScope(params, caller, req.table, rule);
      const fullWhere = [where, scopeSql].filter(Boolean).join(" AND ");
      if (rule.canWrite) {
        // Deletes used to skip canWrite entirely: anything the scope let you
        // *see* you could also *remove*, so a basic member could delete a
        // coworker's availability row that REST would have refused with 403.
        // Load exactly the rows the DELETE below would touch and run the same
        // per-row guard insert/update/upsert get. Same WHERE, same bindings.
        const doomed = await database.all<Record<string, unknown>>(`SELECT * FROM ${req.table} WHERE ${fullWhere}`, params.values);
        await rule.canWrite(caller, doomed.map(denormaliseRow));
      }
      const { changes } = await database.run(`DELETE FROM ${req.table} WHERE ${fullWhere}`, params.values);
      // The response has always been better-sqlite3's RunResult. lastInsertRowid
      // means nothing for a DELETE, but it stays for the same shape: SQLite's
      // connection-wide value as before, 0 on MySQL (UUID keys, no row ids).
      const lastInsertRowid =
        database.dialect === "sqlite"
          ? (await database.get<{ id: number }>("SELECT last_insert_rowid() AS id"))!.id
          : 0;
      return { changes, lastInsertRowid };
    }

    case "upsert": {
      const rows = rowsFrom(req.data);
      await rule.canWrite?.(caller, rows);

      if (!req.onConflict) throw new ForbiddenError("upsert requires onConflict.");
      const conflictColumns = req.onConflict.split(",").map((c) => c.trim());
      conflictColumns.forEach((c) => assertColumn(rule, c));

      const results: (Record<string, unknown> | null)[] = [];
      for (const row of rows) {
        const clean: Record<string, unknown> = {};
        for (const [column, value] of Object.entries(row)) {
          if (column === "id" || (rule.readonlyColumns ?? []).includes(column)) continue;
          assertColumn(rule, column);
          clean[column] = value;
        }
        if (rule.columns.includes("id") && !("id" in clean)) clean.id = randomUUID();
        if (rule.columns.includes("created_at")) clean.created_at = nowTimestamp();
        if (rule.columns.includes("updated_at")) clean.updated_at = nowTimestamp();

        const columns = Object.keys(clean);
        const placeholders = columns.map((c) => params.bind(normaliseValue(clean[c]))).join(", ");
        const updates = columns.filter((c) => !conflictColumns.includes(c));
        let conflictSql: string;
        if (database.dialect === "mysql") {
          // MySQL matches on whichever unique key collides; "do nothing" is a no-op assignment.
          conflictSql = updates.length
            ? `AS new_row ON DUPLICATE KEY UPDATE ${updates.map((c) => `${c} = new_row.${c}`).join(", ")}`
            : `ON DUPLICATE KEY UPDATE ${conflictColumns[0]} = ${conflictColumns[0]}`;
        } else {
          conflictSql = `ON CONFLICT(${conflictColumns.join(", ")}) ${
            updates.length ? `DO UPDATE SET ${updates.map((c) => `${c} = excluded.${c}`).join(", ")}` : "DO NOTHING"
          }`;
        }
        await database.run(
          `INSERT INTO ${req.table} (${columns.join(", ")}) VALUES (${placeholders}) ${conflictSql}`,
          params.values,
        );

        const where = conflictColumns.map((c) => `${c} = ${params.bind(normaliseValue(clean[c]))}`).join(" AND ");
        const found = await database.get<Record<string, unknown>>(`SELECT * FROM ${req.table} WHERE ${where}`, params.values);
        results.push(found ? denormaliseRow(found) : null);
      }
      return results;
    }
  }
}

/**
 * SQLite has no boolean type and no array type, but Postgres clients send
 * both. Our schema stores flags as INTEGER 0/1 and array columns
 * (schedule_requests.employee_ids) as JSON text, so translate on the way in
 * and back on the way out in `readRows`.
 */
const JSON_COLUMNS = new Set(["employee_ids"]);

function normaliseValue(value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value)) return JSON.stringify(value);
  return value;
}

/**
 * Rows re-read with `id IN (...)`, in the order the ids were written. SQLite
 * happened to return insertion order; MySQL returns primary-key order, and
 * with random UUID keys that shuffles a multi-row write's response.
 */
async function readBackInOrder(table: string, ids: string[], params: Params): Promise<Record<string, unknown>[]> {
  const readParams = ids.map((id) => params.bind(id)).join(", ");
  const rows = await database.all<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id IN (${readParams})`, params.values);
  const byId = new Map(rows.map((r) => [String(r.id), denormaliseRow(r)]));
  return ids.map((id) => byId.get(id)).filter((r): r is Record<string, unknown> => r !== undefined);
}

/** Undo normaliseValue for reads so the client sees what Postgres would return. */
function denormaliseRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (JSON_COLUMNS.has(key) && typeof value === "string") {
      try {
        out[key] = JSON.parse(value);
      } catch {
        out[key] = value;
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}