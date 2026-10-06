/**
 * A tiny stand-in for the `supabase-js` surface that the Lovable app uses.
 *
 * The point is that the original components keep their shape:
 *
 *   supabase.from("projects").select("*").eq("company_id", id)
 *
 * Instead of talking to Postgres we translate that into the Express query
 * endpoint, which re-implements the row-level security Postgres had as RLS
 * policies. Anything we have not migrated yet fails loudly instead of silently
 * returning the wrong rows.
 */

import { useEffect, useReducer, useRef } from "react";

/** The wire format accepted by `/query`. `is`/`not`/`in` are emitted by the
 * dedicated helpers below, so `.filter()` accepts only the comparison ops. */
export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "is"
  | "not"
  | "in";

export type ComparisonOperator = Exclude<FilterOperator, "is" | "not" | "in">;

export interface QueryFilter {
  op: FilterOperator;
  column: string;
  value: unknown;
}

export interface QueryRequest {
  table: string;
  operation: "select" | "insert" | "update" | "delete" | "upsert";
  columns?: string;
  filters?: QueryFilter[];
  /** PostgREST `or=(a.eq.1,b.eq.2)` arrives as a comma separated string. */
  or?: string;
  data?: unknown;
  onConflict?: string;
  order?: { column: string; ascending: boolean }[];
  limit?: number;
  offset?: number;
  count?: string;
}

const TOKEN_KEY = "ssaa.token";

let authToken: string | null = null;
try {
  authToken = window.localStorage.getItem(TOKEN_KEY);
} catch {
  authToken = null;
}

const authListeners = new Set<(token: string | null) => void>();

export function getToken(): string | null {
  return authToken;
}

export function setToken(token: string | null): void {
  authToken = token;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private browsing: keep the token in memory only */
  }
  authListeners.forEach((listener) => listener(token));
}

export function onAuthChange(listener: (token: string | null) => void): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

/** Not implemented yet; the Supabase storage API had ten call sites. */
export function unsupported(feature: string): never {
  throw new Error(`[supabase-facade] "${feature}" has not been migrated to the Express backend yet.`);
}

/**
 * Mirrors the `supabase-js` result shape: a successful call resolves with
 * `{ data }`, a failure resolves with `{ data: null, error }` and never rejects.
 * Components ported from the Lovable app destructure `{ data, error }` and check
 * `if (error)`, so this has to match or every ported component needs editing.
 */
export interface QueryError {
  message: string;
  status?: number;
}

export interface QueryResult<T> {
  data: T;
  error: QueryError | null;
  count?: number;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message = payload.error ?? `Request failed with ${res.status}.`;
    const error = new Error(message) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return payload as T;
}

/** Wraps a throwing call in the Supabase `{ data, error }` envelope. */
async function toResult<T = any>(run: () => Promise<T>): Promise<QueryResult<T>> {
  try {
    return { data: await run(), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed.";
    const status = (err as { status?: number }).status;
    return { data: null as T, error: { message, ...(status ? { status } : {}) } };
  }
}

/** Accumulates filters/ordering exactly like the PostgREST builder does. */
class PostgrestBuilder {
  private operation: QueryRequest["operation"];
  private table: string;
  private filters: QueryFilter[] = [];
  private orClause: string | undefined;
  private dataValue: unknown;
  private orderBy: { column: string; ascending: boolean }[] = [];
  private limitCount: number | undefined;
  private offsetCount: number | undefined;
  private onConflictValue: string | undefined;
  private wantsCount = false;
  private result: "array" | "single" | "maybeSingle" = "array";

  constructor(table: string, operation: QueryRequest["operation"]) {
    this.table = table;
    this.operation = operation;
  }

  select(_columns = "*", options?: { count?: string }): this {
    this.wantsCount = options?.count === "exact";
    return this;
  }

  insert(values: unknown): this {
    // `from()` always starts as "select": the verb methods must set the real
    // operation, or every write silently executes as a read (the backend
    // ignores `data` on selects, and toResult never rejects, so nothing
    // complained — writes just never happened).
    this.operation = "insert";
    this.dataValue = values;
    return this;
  }

  update(values: unknown): this {
    this.operation = "update";
    this.dataValue = values;
    return this;
  }

  upsert(values: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.operation = "upsert";
    this.dataValue = values;
    this.onConflictValue = options?.onConflict;
    return this;
  }

  delete(): this {
    this.operation = "delete";
    return this;
  }

  filter(column: string, operator: ComparisonOperator, value: unknown): this {
    this.filters.push({ op: operator, column, value });
    return this;
  }

  private addOp(op: ComparisonOperator, column: string, value: unknown): this {
    this.filters.push({ op, column, value });
    return this;
  }

  eq(column: string, value: unknown): this {
    return this.addOp("eq", column, value);
  }
  neq(column: string, value: unknown): this {
    return this.addOp("neq", column, value);
  }
  gt(column: string, value: unknown): this {
    return this.addOp("gt", column, value);
  }
  gte(column: string, value: unknown): this {
    return this.addOp("gte", column, value);
  }
  lt(column: string, value: unknown): this {
    return this.addOp("lt", column, value);
  }
  lte(column: string, value: unknown): this {
    return this.addOp("lte", column, value);
  }
  like(column: string, value: unknown): this {
    return this.addOp("like", column, value);
  }
  ilike(column: string, value: unknown): this {
    return this.addOp("ilike", column, value);
  }

  /** `is` for null checks; `not` mirrors `.not(col, "is", null)`. */
  is(column: string, value: unknown): this {
    this.filters.push({ op: "is", column, value });
    return this;
  }
  not(column: string, _operator: string, _value?: unknown): this {
    this.filters.push({ op: "not", column, value: null });
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    this.filters.push({ op: "in", column, value: values });
    return this;
  }

  or(clause: string): this {
    this.orClause = clause;
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderBy.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number): this {
    this.offsetCount = from;
    this.limitCount = to - from + 1;
    return this;
  }

  single(): Promise<QueryResult<any>> {
    this.result = "single";
    return this.execute();
  }

  maybeSingle(): Promise<QueryResult<any>> {
    this.result = "maybeSingle";
    return this.execute();
  }

  private async execute(): Promise<QueryResult<any>> {
    const request: QueryRequest = {
      table: this.table,
      operation: this.operation,
      filters: this.filters,
    };
    if (this.orderBy.length) request.order = this.orderBy;
    if (this.limitCount != null) request.limit = this.limitCount;
    if (this.offsetCount != null) request.offset = this.offsetCount;
    if (this.dataValue !== undefined) request.data = this.dataValue;
    if (this.onConflictValue) request.onConflict = this.onConflictValue;
    if (this.orClause) request.or = this.orClause;

    return toResult(async () => {
      const payload = await post<{ data: unknown; count?: number }>("/query", request);

      if (this.result === "single") {
        const row = Array.isArray(payload.data) ? payload.data[0] : payload.data;
        if (row == null) throw new Error("No rows returned.");
        return row;
      }
      if (this.result === "maybeSingle") {
        return Array.isArray(payload.data) ? (payload.data[0] ?? null) : (payload.data ?? null);
      }
      return payload.data;
    }).then((result) =>
      this.wantsCount && result.data !== null
        ? { ...result, count: Array.isArray(result.data) ? result.data.length : undefined }
        : result,
    );
  }

  then<TResult1 = QueryResult<any>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<any>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export interface SupabaseLike {
  from(table: string): PostgrestBuilder;
  rpc(name: string, args?: Record<string, unknown>): Promise<QueryResult<any>>;
  auth: {
    getToken(): string | null;
    setToken(token: string | null): void;
    onChange(listener: (token: string | null) => void): () => void;
  };
  channel(name: string): RealtimeChannel;

  removeChannel(channel?: unknown): void;
  storage: { unsupported: typeof unsupported };
  functions: {
    invoke(name: string, options?: { body?: unknown }): Promise<QueryResult<any>>;
  };
}

/**
 * Lovable calls Supabase Edge Functions for the project-invite email. The
 * Express backend has no equivalent endpoint yet (there is no invite token on
 * `project_connections`), so this reports a clean failure: the caller already
 * checks `if (error)` and shows a toast, which beats crashing the dashboard.
 */
async function invokeFunction(name: string): Promise<QueryResult<any>> {
  return {
    data: null,
    error: { message: `"${name}" has not been migrated to the Express backend yet.` },
  };
}

export const supabase: SupabaseLike = {
  from: (table: string) => new PostgrestBuilder(table, "select"),
  rpc: (name: string, args: Record<string, unknown> = {}) =>
    toResult(() => post<unknown>(`/rpc/${name}`, args)),
  auth: {
    getToken,
    setToken,
    onChange: onAuthChange,
  },
  channel: (name: string) => new RealtimeChannel(name),
  removeChannel,
  storage: { unsupported },
  functions: { invoke: invokeFunction },
};

/* ------------------------------------------------------------------ *
 * Realtime
 *
 * The Lovable app never used `supabase.channel`, so this is only here
 * to give the ported dashboard live updates. It joins the room over
 * Socket.IO, which the backend authenticates with the same JWT.
 * ------------------------------------------------------------------ */

type Handler = (payload: Record<string, unknown>) => void;

class RealtimeChannel {
  private handlers = new Map<string, Set<Handler>>();
  private socket: import("socket.io-client").Socket | null = null;

  constructor(private name: string) {}

  /**
   * `on('postgres_changes', { event, schema, table, filter }, handler)` is the
   * Postgres-flavoured form the Lovable app uses. The backend has no logical
   * replication to filter on, so the subscription is registered under the event
   * name from the filter and the filter itself is ignored â€” callers still get
   * every payload for that event, which is what the Socket.IO events deliver.
   */
  on(
    trigger: string,
    filterOrHandler: Record<string, unknown> | Handler,
    maybeHandler?: Handler,
  ): this {
    const event = maybeHandler
      ? String((filterOrHandler as Record<string, unknown>).event ?? "*")
      : trigger;
    const handler = maybeHandler ?? (filterOrHandler as Handler);
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return this;
  }

  subscribe(): this {
    void import("socket.io-client").then(({ io }) => {
      const token = getToken();
      if (!token) return;
      this.socket = io({ auth: { token }, path: "/socket.io" });
      this.socket.on("connect", () => this.socket?.emit("join", { room: this.name }));
      for (const event of this.handlers.keys()) {
        this.socket.on(event, (payload: Record<string, unknown>) => {
          this.handlers.get(event)?.forEach((handler) => handler(payload));
        });
      }
    });
    return this;
  }

  unsubscribe(): void {
    this.socket?.emit("leave", { room: this.name });
    this.socket?.disconnect();
    this.socket = null;
  }
}

/**
 * Supabase removes a channel by its handle. Ours carry their own socket and
 * expose `unsubscribe()`, so this just tolerates the argument and lets the
 * caller keep using the standard call shape.
 */
function removeChannel(_channel?: unknown): void {}

/** Re-renders a component whenever the signed-in token changes. */
export function useAuthToken(): string | null {
  const ref = useRef<string | null>(authToken);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    return onAuthChange((token) => {
      ref.current = token;
      bump();
    });
  }, []);
  return ref.current;
}