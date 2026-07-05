/**
 * Test double for `@supabase/supabase-js` used by the edge functions.
 *
 * Edge functions create up to two clients (anon + service-role). The harness
 * rewrites `npm:@supabase/supabase-js@2` to this module. `createClient()`
 * returns a chainable query builder backed by an in-memory table store, plus
 * an `auth.getUser()` and `rpc()` that tests configure per-scenario.
 *
 * The builder mimics the subset of the PostgREST chain the payment functions
 * actually use: from().select().eq().in().limit().single()/maybeSingle(),
 * from().update(...).eq()...select(), from().insert(...).select().
 */
import { vi } from "vitest";

type Row = Record<string, unknown>;

export interface TableResult {
  /** Rows to return for a read (.single / .maybeSingle / awaited select). */
  rows?: Row[];
  /** Error object to return instead of data. */
  error?: { message: string; code?: string } | null;
}

/**
 * Per-test scenario config. `tables` maps a table name to the result its
 * reads resolve to. `updates`/`inserts` capture writes for assertions.
 */
export interface SupabaseScenario {
  authUser?: { id: string; email?: string } | null;
  authError?: { message: string } | null;
  /** table name -> read result */
  reads: Record<string, TableResult>;
  /** rpc name -> resolved data */
  rpc: Record<string, unknown>;
  /** Captured writes, in order. */
  writes: Array<{ table: string; op: "insert" | "update"; payload: unknown }>;
  /** Optional override: table name -> error to return on write. */
  writeErrors: Record<string, { message: string; code?: string }>;
  /** Optional override: rows returned from a write that ends in .select(). */
  writeSelectRows: Record<string, Row[]>;
}

export function freshScenario(): SupabaseScenario {
  return {
    authUser: undefined,
    authError: null,
    reads: {},
    rpc: {},
    writes: [],
    writeErrors: {},
    writeSelectRows: {},
  };
}

/** The active scenario the harness-created clients consult. */
export let scenario: SupabaseScenario = freshScenario();

export function setScenario(s: SupabaseScenario) {
  scenario = s;
}

export function resetSupabaseMock() {
  scenario = freshScenario();
}

/**
 * Chainable query builder. Filter methods (`eq`, `in`, `neq`...) are no-ops
 * for matching purposes — the scenario decides the result by table name —
 * but they ARE chainable and thenable so the function code runs unchanged.
 */
class QueryBuilder implements PromiseLike<{ data: unknown; error: unknown }> {
  private op: "select" | "insert" | "update" = "select";
  private payload: unknown;
  private endsWithSelect = false;

  constructor(private table: string) {}

  select(_cols?: string) {
    if (this.op === "select") {
      // plain read
    } else {
      this.endsWithSelect = true;
    }
    return this;
  }
  insert(payload: unknown) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: unknown) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  eq() {
    return this;
  }
  neq() {
    return this;
  }
  in() {
    return this;
  }
  is() {
    return this;
  }
  lte() {
    return this;
  }
  gte() {
    return this;
  }
  lt() {
    return this;
  }
  gt() {
    return this;
  }
  limit() {
    return this;
  }
  order() {
    return this;
  }

  private resolveValue(): { data: unknown; error: unknown } {
    if (this.op === "select") {
      const t = scenario.reads[this.table] ?? {};
      if (t.error) return { data: null, error: t.error };
      return { data: t.rows ?? [], error: null };
    }
    // write
    scenario.writes.push({ table: this.table, op: this.op, payload: this.payload });
    const writeErr = scenario.writeErrors[this.table];
    if (writeErr) return { data: null, error: writeErr };
    if (this.endsWithSelect) {
      return { data: scenario.writeSelectRows[this.table] ?? [], error: null };
    }
    return { data: null, error: null };
  }

  single(): Promise<{ data: unknown; error: unknown }> {
    const v = this.resolveValue();
    if (v.error) return Promise.resolve({ data: null, error: v.error });
    const rows = Array.isArray(v.data) ? v.data : [];
    if (rows.length === 0) {
      return Promise.resolve({
        data: null,
        error: { message: "no rows", code: "PGRST116" },
      });
    }
    return Promise.resolve({ data: rows[0], error: null });
  }

  maybeSingle(): Promise<{ data: unknown; error: unknown }> {
    const v = this.resolveValue();
    if (v.error) return Promise.resolve({ data: null, error: v.error });
    const rows = Array.isArray(v.data) ? v.data : [];
    return Promise.resolve({ data: rows.length ? rows[0] : null, error: null });
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.resolveValue()).then(onfulfilled, onrejected);
  }
}

export interface SupabaseClientMock {
  from: (table: string) => QueryBuilder;
  auth: { getUser: ReturnType<typeof vi.fn> };
  rpc: ReturnType<typeof vi.fn>;
}

/** The constructor the function code calls as `createClient(url, key)`. */
export function createClient(_url: string, _key: string): SupabaseClientMock {
  return {
    from: (table: string) => new QueryBuilder(table),
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: scenario.authUser ?? null },
        error: scenario.authError,
      })),
    },
    rpc: vi.fn(async (name: string) => ({
      data: scenario.rpc[name],
      error: null,
    })),
  };
}
