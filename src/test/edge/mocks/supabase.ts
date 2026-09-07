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
  /**
   * Per-SELECT overrides, matched on the column list the code passed to
   * `.select(...)`. The first entry whose `includes` string appears in that
   * column list wins; anything unmatched falls through to `rows` / `error`.
   *
   * Needed because a scenario keys results by TABLE NAME alone, and several
   * money paths read the SAME table twice for different reasons — notably
   * `profiles`, which `getHelperFeePercent` reads for
   * `subscription_tier, subscription_expires_at` while the payout code reads
   * it for `stripe_account_id, onboarding_fee_paid`. Failing the whole table
   * cannot distinguish "the tier read failed" (the fee-fallback path under
   * test) from "the helper has no Connect account" (a different branch that
   * aborts before the fee is ever committed).
   *
   * Additive: a scenario that does not set this behaves exactly as before.
   */
  selectOverrides?: Array<{ includes: string; result: TableResult }>;
  /**
   * The exact row count PostgREST reports for `.select(cols, { count: "exact" })`.
   *
   * OPT-IN ON PURPOSE. Real PostgREST answers the count from a `COUNT(*)` that
   * is NOT subject to `db-max-rows`, which is why `_shared/paginate.ts` uses it
   * as its independent proof that a paged read saw everything: the header on a
   * capped read literally reads `0-999/1619`. Leaving it unset makes the mock
   * return `count: null`, which is how every pre-existing scenario behaved and
   * is what `scanAll` reads as "the server withheld a count" — so those tests
   * are untouched.
   *
   * Set it ABOVE `rows.length` to simulate the truncation this project's cap
   * actually produces: the store hands back the seeded rows while the server
   * insists more exist, which is precisely the shape of a silently short read.
   */
  count?: number;
}

/**
 * Per-test scenario config. `tables` maps a table name to the result its
 * reads resolve to. `updates`/`inserts` capture writes for assertions.
 */
export interface SupabaseScenario {
  authUser?: { id: string; email?: string } | null;
  authError?: { message: string } | null;
  /**
   * auth.admin.getUserById(id) lookups, keyed by user id. Absent id → returns
   * a confirmed user (the common prod case) so callers that only care about
   * email confirmation get the happy path by default; set `email_confirmed_at`
   * to null to simulate an unconfirmed account.
   */
  adminUsers?: Record<string, { email?: string; email_confirmed_at?: string | null } | { error: { message: string } }>;
  /** table name -> read result */
  reads: Record<string, TableResult>;
  /** rpc name -> resolved data */
  rpc: Record<string, unknown>;
  /** rpc name -> error to return instead of data. Fail-closed paths need it. */
  rpcErrors?: Record<string, { message: string; code?: string }>;
  /** Every rpc() call, in order — lets a test assert an RPC was NOT made. */
  rpcCalls?: Array<{ name: string; args: unknown; client?: number }>;
  /**
   * Every createClient(url, key, options) call, in order, WITH the options.
   *
   * The third argument used to be dropped on the floor here, and that blind
   * spot let a real outage ship on 2026-09-05: create-pro-checkout called an
   * `authenticated`-only RPC on a client built from the anon key with no
   * Authorization header, so it ran as `anon`, hit 42501, failed closed, and
   * killed every membership purchase. No source grep could see it and no edge
   * test could either, because the mock could not tell the two clients apart.
   *
   * Recording the options is what makes "which identity did this call run as"
   * an assertable property rather than a code-review hope.
   */
  clients?: Array<{ url: string; key: string; options?: Record<string, unknown> }>;
  /**
   * Captured writes, in order. `filters` records the `eq`/`neq`/`in` calls that
   * were chained onto the write — the filters themselves are no-ops for
   * matching (the scenario decides the result), but a conditional write's
   * predicate IS the behaviour under test in the money paths, so it has to be
   * assertable.
   */
  writes: Array<{
    table: string;
    op: "insert" | "update" | "delete";
    payload: unknown;
    filters: Array<{ op: "eq" | "neq" | "in"; column: string; value: unknown }>;
    /**
     * The column list passed to the write's trailing `.select(...)`, or null
     * when the write did not end in one.
     *
     * Recorded because the store resolves a result by TABLE NAME and hands back
     * the seeded rows regardless of projection — so a `.select("id")` on a table
     * whose primary key is NOT `id` passes every behavioural assertion here and
     * 400s in production. `stripe_webhook_events` is exactly that table
     * (`event_id TEXT PRIMARY KEY`, no `id` column; verified against prod:
     * `?select=id` → 400, `?select=event_id` → 200), so the projection itself
     * has to be assertable, not just the row count it produces.
     */
    selectCols: string | null;
  }>;
  /** Optional override: table name -> error to return on write. */
  writeErrors: Record<string, { message: string; code?: string }>;
  /**
   * Optional override: rows returned from a write that ends in .select().
   *
   * Keyed by table name, or by `"<table>:<op>"` (e.g. `"tips:delete"`) when one
   * table is both written and deleted in the same run and only one of them is
   * under test — auto-tip-charge INSERTs the `tips` claim with `.select("id")`
   * and then DELETEs it with `.select("id")`, so a bare `tips` key that forced
   * zero rows would fail the claim insert and the delete would never be
   * reached. The more specific key wins.
   */
  writeSelectRows: Record<string, Row[]>;
}

export function freshScenario(): SupabaseScenario {
  return {
    authUser: undefined,
    authError: null,
    reads: {},
    rpc: {},
    rpcErrors: {},
    rpcCalls: [],
    clients: [],
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
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: unknown;
  private endsWithSelect = false;
  /** Column list passed to `.select(...)` on a read — see `selectOverrides`. */
  private cols = "";
  /** Column list passed to a WRITE's trailing `.select(...)`. */
  private writeSelectCols: string | null = null;
  private filters: Array<{ op: "eq" | "neq" | "in"; column: string; value: unknown }> = [];
  /** Set by `.select(cols, { count: "exact" })`. */
  private wantsCount = false;
  /** Set by `.select(cols, { head: true })` — a count with no rows. */
  private headOnly = false;
  /** Set by `.range(from, to)`. Null means "no window requested". */
  private window: { from: number; to: number } | null = null;

  constructor(private table: string) {}

  select(_cols?: string, _opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) {
    if (this.op === "select") {
      // Remembered so `selectOverrides` can tell two reads of the same table
      // apart by the columns they asked for.
      this.cols = _cols ?? "";
      // `{ count: "exact" }` asks PostgREST for the true total alongside the
      // (possibly capped) page. `head: true` asks for the count and NO rows.
      if (_opts?.count) this.wantsCount = true;
      if (_opts?.head) this.headOnly = true;
    } else {
      this.endsWithSelect = true;
      // Remembered so a test can assert the PROJECTION, not merely that some
      // rows came back — see `writes[].selectCols`.
      this.writeSelectCols = _cols ?? "";
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
  /**
   * Recorded as an insert. Every ledger path in the codebase upserts on the
   * Stripe object id (`onConflict: "stripe_refund_id"`) so a replayed refund
   * updates one row instead of duplicating it; for assertion purposes the
   * distinction doesn't matter — what a test cares about is the payload that
   * reached the table. The `onConflict` options object is accepted and ignored.
   */
  upsert(payload: unknown, _opts?: unknown) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(column?: string, value?: unknown) {
    this.filters.push({ op: "eq", column: column ?? "", value });
    return this;
  }
  neq(column?: string, value?: unknown) {
    this.filters.push({ op: "neq", column: column ?? "", value });
    return this;
  }
  in(column?: string, value?: unknown) {
    this.filters.push({ op: "in", column: column ?? "", value });
    return this;
  }
  or() {
    return this;
  }
  is() {
    return this;
  }
  /**
   * `.ilike(column, pattern)` — case-insensitive LIKE. Chainable no-op like its
   * siblings; the scenario decides the result.
   *
   * It was MISSING, and the omission was not inert — it is the same trap
   * `.not()` was. `review-nag-cron`'s duplicate-nag guard is
   * `.eq().eq().ilike("link", "%job=…%").gte()`, so the chain threw
   * `TypeError: … .ilike is not a function` inside the function's own
   * try/catch and the whole run took the error path. The function simply could
   * not be loaded by this harness at all.
   */
  ilike(column?: string, value?: unknown) {
    this.filters.push({ op: "eq", column: column ?? "", value });
    return this;
  }
  /**
   * `.not(column, operator, value)` — PostgREST's negation. Chainable no-op
   * like its siblings; the scenario decides the result.
   *
   * It was MISSING, and the omission was not inert: any function whose query
   * chain contains `.not(...)` threw `TypeError: … .not is not a function`
   * inside its own try/catch, so the whole run took the error path and the test
   * saw a plausible-looking failure envelope instead of the behaviour it meant
   * to assert. `expire-subscriptions` opens with two `.not()` calls.
   */
  not(column?: string, _operator?: string, value?: unknown) {
    this.filters.push({ op: "neq", column: column ?? "", value });
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
  /**
   * `.range(from, to)` — PostgREST's inclusive row window, and the ONLY way to
   * read past `db-max-rows`. Implemented as a real slice rather than a
   * chainable no-op: `_shared/paginate.ts` decides it has reached the end of a
   * table when a page comes back SHORTER than it asked for, so a no-op `range`
   * would hand every page the full seeded set and spin the loop to its page
   * ceiling. Slicing makes a paged read terminate here the same way it does
   * against the real server.
   */
  range(from: number, to: number) {
    this.window = { from, to };
    return this;
  }

  private resolveValue(): { data: unknown; error: unknown; count?: number | null } {
    if (this.op === "select") {
      const base = scenario.reads[this.table] ?? {};
      const override = base.selectOverrides?.find((o) => this.cols.includes(o.includes));
      const t = override ? override.result : base;
      if (t.error) return { data: null, error: t.error, count: null };
      const all = t.rows ?? [];
      // Two different count behaviours, and the split is deliberate.
      //
      // A `head: true` count returns no rows, and several already-tested
      // functions (`auto-release-payment`, `review-nag-cron`) branch on it. Its
      // count stays strictly OPT-IN — unset means null, exactly how this mock
      // has always behaved — so those tests are untouched.
      //
      // A PAGED read (`.select(cols, {count:"exact"})` + `.range()`) is
      // different: real PostgREST ALWAYS answers such a request with a total,
      // and `_shared/paginate.ts` now treats a MISSING total as unverifiable
      // rather than complete. Defaulting to the seeded row count models the
      // real server; a test simulating truncation sets `count` ABOVE
      // `rows.length` to say "more exist than I handed you".
      const count = this.wantsCount
        ? (t.count ?? (this.headOnly ? null : all.length))
        : undefined;
      if (this.headOnly) return { data: null, error: null, count };
      const rows = this.window ? all.slice(this.window.from, this.window.to + 1) : all;
      return { data: rows, error: null, count };
    }
    // write
    scenario.writes.push({
      table: this.table,
      op: this.op,
      payload: this.payload,
      filters: this.filters,
      selectCols: this.writeSelectCols,
    });
    const writeErr = scenario.writeErrors[this.table];
    if (writeErr) return { data: null, error: writeErr };
    if (this.endsWithSelect) {
      // Default to "the write matched a row" unless a test explicitly opts
      // into the zero-row case via `scenario.writeSelectRows[table] = []`
      // (see execute-dispute-split.test.ts / stripe-webhook.test.ts) — most
      // scenarios set up `scenario.reads[table]` to assert the row exists and
      // never think about the write-time `.select()` at all, so an empty
      // default here would make every such test spuriously hit the "matched
      // 0 rows" failure path the source code now checks for.
      // `"<table>:<op>"` wins over the bare table name so one table can be
      // written twice in a run with only one of the writes forced to zero rows.
      const override =
        scenario.writeSelectRows[`${this.table}:${this.op}`] ??
        scenario.writeSelectRows[this.table];
      return { data: override ?? [{ id: "mock-matched-row" }], error: null };
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
  auth: {
    getUser: ReturnType<typeof vi.fn>;
    admin: { getUserById: ReturnType<typeof vi.fn> };
  };
  rpc: ReturnType<typeof vi.fn>;
}

/** The constructor the function code calls as `createClient(url, key, options)`. */
export function createClient(
  _url: string,
  _key: string,
  _options?: Record<string, unknown>,
): SupabaseClientMock {
  // Recorded so a test can assert WHICH client an RPC ran on — see `clients`.
  (scenario.clients ??= []).push({ url: _url, key: _key, options: _options });
  const clientIndex = (scenario.clients?.length ?? 1) - 1;
  return {
    from: (table: string) => new QueryBuilder(table),
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: scenario.authUser ?? null },
        error: scenario.authError,
      })),
      admin: {
        getUserById: vi.fn(async (id: string) => {
          const entry = scenario.adminUsers?.[id];
          if (entry && "error" in entry) {
            return { data: { user: null }, error: entry.error };
          }
          // Default (unconfigured id): a confirmed user — the common prod case.
          const user = entry ?? { email_confirmed_at: new Date().toISOString() };
          return { data: { user }, error: null };
        }),
      },
    },
    rpc: vi.fn(async (name: string, args?: unknown) => {
      // `client` is the index into scenario.clients — i.e. WHICH client this
      // RPC ran on. Without it, "the RPC was called" and "the RPC was called as
      // the right identity" are the same assertion, and they are not.
      scenario.rpcCalls?.push({ name, args, client: clientIndex });
      const err = scenario.rpcErrors?.[name];
      if (err) return { data: null, error: err };
      // A function value is called with the arguments, so one scenario can
      // answer the SAME rpc differently per call — `restore_pif_credit_for_job`
      // is asked to value a gift (p_dry_run: true) and then to mint it
      // (p_dry_run: false), and a single frozen value cannot be both.
      const configured = scenario.rpc[name];
      const data = typeof configured === "function"
        ? (configured as (a?: unknown) => unknown)(args)
        : configured;
      return { data, error: null };
    }),
  };
}
