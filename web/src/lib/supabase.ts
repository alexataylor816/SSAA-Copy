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
    throw new Error(payload.error ?? `Request failed with ${res.status}.`);
  }
  return payload as T;
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
    this.dataValue = values;
    return this;
  }

  update(values: unknown): this {
    this.dataValue = values;
    return this;
  }

  upsert(values: unknown, options?: { onConflict?: string }): this {
    this.dataValue = values;
    this.onConflictValue = options?.onConflict;
    return this;
  }

  delete(): this {
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

  single(): Promise<unknown> {
    this.result = "single";
    return this.execute();
  }

  maybeSingle(): Promise<unknown> {
    this.result = "maybeSingle";
    return this.execute();
  }

  private async execute(): Promise<unknown> {
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
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export interface SupabaseLike {
  from(table: string): PostgrestBuilder;
  rpc(name: string, args?: Record<string, unknown>): Promise<unknown>;
  auth: {
    getToken(): string | null;
    setToken(token: string | null): void;
    onChange(listener: (token: string | null) => void): () => void;
  };
  channel(name: string): RealtimeChannel;
  storage: { unsupported: typeof unsupported };
  functions: { unsupported: typeof unsupported };
}

export const supabase: SupabaseLike = {
  from: (table: string) => new PostgrestBuilder(table, "select"),
  rpc: (name: string, args: Record<string, unknown> = {}) => post(`/rpc/${name}`, args),
  auth: {
    getToken,
    setToken,
    onChange: onAuthChange,
  },
  channel: (name: string) => new RealtimeChannel(name),
  storage: { unsupported },
  functions: { unsupported },
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

  on(event: string, handler: Handler): this {
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