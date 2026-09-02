/**
 * Unit tests for `supabase/functions/_shared/paginate.ts` — the module every
 * cron scan in this lane now reads through.
 *
 * WHY THESE TESTS DRIVE A FAKE SERVER INSTEAD OF THE SUPABASE MOCK
 *
 * The bug being fixed is a property of the SERVER, not of the client: PostgREST
 * enforces `db-max-rows = 1000` on this project, applies it AFTER the ORDER BY,
 * and silently ignores any larger `.limit()`. Measured against prod on
 * 2026-09-01 with the service-role key, on a `notifications` table holding
 * 1,619 rows:
 *
 *   ?select=id                 → content-range: 0-999/*     (1000 rows)
 *   ?select=id&limit=5000      → content-range: 0-999/*     (1000 rows)
 *   Range: 0-4999              → content-range: 0-999/*     (1000 rows)
 *   Range: 1000-1999           → content-range: 1000-1618/*  (619 rows)
 *
 * `CappedTable` below reproduces exactly that: it honours a `.range()` window,
 * truncates any window wider than the cap, and reports the true total through
 * `{ count: "exact" }` the way PostgREST does. So these are not tests of a
 * loop — they are tests that this module reads a table the real server would
 * have truncated, and NOTICES when it cannot.
 */
import { describe, it, expect } from "vitest";

interface Row {
  id: number;
}

interface ScanResult<T> {
  rows: T[];
  total: number | null;
  complete: boolean;
  shortfall: string | null;
  pages: number;
  error: { message: string } | null;
}
type PageQuery = {
  range(from: number, to: number): PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
    count?: number | null;
  }>;
};
type CountOption = { count: "exact" } | undefined;

interface PaginateModule {
  PAGE_SIZE: number;
  MAX_PAGES: number;
  scanAll<T>(
    label: string,
    build: (c: CountOption) => PageQuery,
    opts?: { pageSize?: number; maxPages?: number },
  ): Promise<ScanResult<T>>;
  scanAllIn<T>(
    label: string,
    ids: readonly string[],
    build: (chunk: string[], c: CountOption) => PageQuery,
    opts?: { pageSize?: number; maxPages?: number; chunkSize?: number },
  ): Promise<ScanResult<T>>;
  scanDefect(label: string, res: ScanResult<unknown>): string | null;
}

/**
 * Loaded through a NON-LITERAL specifier on purpose.
 *
 * `tsconfig.app.json` enumerates the handful of `supabase/functions/_shared/*`
 * modules the app compiles, and `paginate.ts` is not among them — a static
 * import here fails with TS6307 rather than resolving. The edge harness dodges
 * this by emitting `.gen.ts` files, which that tsconfig excludes; a direct
 * unit test has no such escape hatch, so the specifier is hidden from the type
 * resolver and the module's real shape is restated above. (The module IS
 * typechecked, by `npm run typecheck:edge`, which is the check that owns
 * `supabase/functions/**`. Adding it to the app tsconfig's include list would
 * let this be a plain import — worth doing, but that file is not this lane's.)
 */
const PAGINATE_PATH = "../../../supabase/functions/_shared/paginate.ts";
const { scanAll, scanAllIn, scanDefect, PAGE_SIZE, MAX_PAGES } = (await import(
  /* @vite-ignore */ PAGINATE_PATH
)) as PaginateModule;

/**
 * A PostgREST stand-in with a hard row cap.
 *
 * @param total  Rows the table holds.
 * @param cap    Server-side `db-max-rows`. 1000 in this project.
 */
class CappedTable {
  /** Every `.range()` the module asked for, in order. */
  readonly windows: Array<{ from: number; to: number }> = [];
  /** True on any request that carried `{ count: "exact" }`. */
  readonly countedRequests: boolean[] = [];

  constructor(
    private readonly total: number,
    private readonly cap = 1000,
    /** Report a total at all? PostgREST always does; a proxy might not. */
    private readonly reportsCount = true,
  ) {}

  query(countOpt: { count: "exact" } | undefined) {
    this.countedRequests.push(countOpt !== undefined);
    return {
      // Arrow, so `this` is the fake table lexically — no alias to smuggle it in.
      range: (from: number, to: number) => {
        this.windows.push({ from, to });
        const requested = Math.max(0, to - from + 1);
        // THE CAP. The server hands back at most `cap` rows no matter how wide
        // the window is — this single line is the entire production bug.
        const width = Math.min(requested, this.cap);
        const rows: Row[] = [];
        for (let i = from; i < Math.min(from + width, this.total); i++) {
          rows.push({ id: i });
        }
        return Promise.resolve({
          data: rows,
          error: null,
          // The exact count is NOT subject to the cap — that asymmetry is what
          // makes it usable as proof, and it is real: the header on a capped
          // read reads `0-999/1619`.
          count: countOpt && this.reportsCount ? this.total : null,
        });
      },
    };
  }
}

describe("_shared/paginate — reading past PostgREST's db-max-rows", () => {
  it("reads a table LARGER than the 1000-row cap in full, and says so", async () => {
    // 1,619 — the real `notifications` row count that proved the cap.
    const server = new CappedTable(1619);

    const res = await scanAll<Row>("notifications", (c) => server.query(c));

    expect(res.error).toBeNull();
    expect(res.rows).toHaveLength(1619);
    expect(res.total).toBe(1619);
    expect(res.complete).toBe(true);
    expect(res.shortfall).toBeNull();
    // Every row, exactly once, in order — a paged read that double-counts or
    // skips a page is not a read.
    expect(res.rows.map((r) => r.id)).toEqual(
      Array.from({ length: 1619 }, (_, i) => i),
    );
  });

  it("NEGATIVE CONTROL: a single unpaged request gets exactly 1000 of 1619", async () => {
    // This is the code that was in production: one request, no windowing. It
    // is asserted here so the fix has something to be a fix OF — if this ever
    // returns 1619, the cap is gone and the paging above is no longer
    // load-bearing.
    const server = new CappedTable(1619);
    const { data, count } = await server.query({ count: "exact" }).range(0, 4999);

    expect(data).toHaveLength(1000);
    expect(count).toBe(1619);
    expect(data.length).toBeLessThan(count!);
  });

  it("asks for the exact count ONCE, not on every page", async () => {
    const server = new CappedTable(1619);
    await scanAll<Row>("notifications", (c) => server.query(c));

    // A COUNT(*) per page would double the cost of every scan for an answer
    // that cannot change within a run.
    expect(server.countedRequests[0]).toBe(true);
    expect(server.countedRequests.slice(1).every((c) => c === false)).toBe(true);
  });

  it("never asks for a window wider than the cap can answer", async () => {
    const server = new CappedTable(1619);
    await scanAll<Row>("notifications", (c) => server.query(c));

    for (const w of server.windows) {
      expect(w.to - w.from + 1).toBe(PAGE_SIZE);
    }
    // A full page proves the SERVER did not end it, which is what makes a
    // short page mean "end of data" rather than "capped".
    expect(PAGE_SIZE).toBeLessThan(1000);
  });

  it("REPORTS a shortfall when the server caps below the page size", async () => {
    // The scenario the old `rows.length >= SCAN_LIMIT` alarm could never see:
    // a cap TIGHTER than the page. Every page comes back short, the loop stops
    // on the first one, and only the independent count reveals the truncation.
    const server = new CappedTable(1619, 200);

    const res = await scanAll<Row>("notifications", (c) => server.query(c));

    expect(res.error).toBeNull();
    expect(res.rows).toHaveLength(200);
    expect(res.total).toBe(1619);
    expect(res.complete).toBe(false);
    expect(res.shortfall).toContain("read 200 of 1619 rows");
    expect(scanDefect("notifications", res)).toContain("truncated");
  });

  it("treats an exactly-full final page as the end without an extra row", async () => {
    // total === 2 × PAGE_SIZE: the second page is full, so the loop must make a
    // third request to learn there is nothing left. Off-by-one here silently
    // drops the last page in production.
    const server = new CappedTable(PAGE_SIZE * 2);

    const res = await scanAll<Row>("t", (c) => server.query(c));

    expect(res.rows).toHaveLength(PAGE_SIZE * 2);
    expect(res.complete).toBe(true);
    expect(server.windows).toHaveLength(3);
  });

  it("an empty table is complete, not a defect", async () => {
    const server = new CappedTable(0);
    const res = await scanAll<Row>("t", (c) => server.query(c));

    expect(res.rows).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.complete).toBe(true);
    expect(scanDefect("t", res)).toBeNull();
  });

  it("a MISSING count is unverifiable, NOT complete", async () => {
    // Without a second opinion there is nothing corroborating the read, and
    // certifying it anyway would rebuild the exact failure this module
    // replaces. The realistic cause is a caller that forgot to thread
    // `countOpt` into its `.select()` — an omission nothing else can catch.
    const server = new CappedTable(37, 1000, /* reportsCount */ false);
    const res = await scanAll<Row>("t", (c) => server.query(c));

    expect(res.rows).toHaveLength(37);
    expect(res.total).toBeNull();
    expect(res.complete).toBe(false);
    expect(res.shortfall).toContain("no exact count");
    expect(scanDefect("t", res)).toContain("countOpt");
  });

  it("NEVER drops a read error — and on a FIRST-page failure there is nothing to keep", async () => {
    const res = await scanAll<Row>("t", () => ({
      range: () =>
        Promise.resolve({ data: null, error: { message: "permission denied" }, count: null }),
    }));

    expect(res.error).toEqual({ message: "permission denied" });
    // Empty here because page ONE failed, not because errors empty the array —
    // see the next test, which is the case that used to lose real rows.
    expect(res.rows).toEqual([]);
    expect(res.pages).toBe(0);
    expect(res.complete).toBe(false);
    expect(scanDefect("suppressed_emails", res)).toBe(
      "suppressed_emails read failed: permission denied",
    );
  });

  /**
   * THE REGRESSION THIS MODULE SHIPPED WITH.
   *
   * A fault on page 3 used to return `rows: []` — discarding pages 1 and 2,
   * which the server had already handed over intact. At
   * `charge-recurring-visits` that turned a two-thirds-good read into a run
   * that funded zero visits, so every helper on the ~1000 series it HAD read
   * turned up unpaid. The rows are kept now; `complete`/`error` are what a
   * caller inspects.
   */
  it("keeps the pages it already read when a LATER page fails", async () => {
    let call = 0;
    const res = await scanAll<Row>("recurring series", (countOpt) => ({
      range: (from: number, to: number) => {
        call++;
        if (call === 3) {
          return Promise.resolve({
            data: null,
            error: { message: "canceling statement due to statement timeout" },
            count: null,
          });
        }
        const rows: Row[] = [];
        for (let i = from; i <= to; i++) rows.push({ id: i });
        return Promise.resolve({ data: rows, error: null, count: countOpt ? 2500 : null });
      },
    }));

    // Pages 1 and 2 came back whole. They are still here.
    expect(res.pages).toBe(2);
    expect(res.rows).toHaveLength(2 * PAGE_SIZE);
    expect(res.rows[0]).toEqual({ id: 0 });
    expect(res.rows[res.rows.length - 1]).toEqual({ id: 2 * PAGE_SIZE - 1 });

    // And the read is still unambiguously reported as a failure.
    expect(res.error).toEqual({ message: "canceling statement due to statement timeout" });
    expect(res.complete).toBe(false);
    expect(res.total).toBe(2500);
    expect(res.shortfall).toContain("page 3 failed");
    expect(res.shortfall).toContain(`${2 * PAGE_SIZE} row(s) already read`);
    expect(scanDefect("recurring series", res)).toContain("read failed");
  });

  /**
   * The other half of the same change: a caller that MUST NOT act on a partial
   * set still refuses to. This is the `engagement-automations` suppression /
   * opt-out guard shape verbatim — abort on `error`, then abort again on
   * `!complete` — and it is the one that mails people who unsubscribed if it
   * ever stops working. Non-empty `rows` must not be enough to get past it.
   */
  it("an abort-on-incompleteness caller still aborts, now that rows survive", async () => {
    /** Returns the 503 body an aborting caller would send, or null to proceed. */
    const suppressionGuard = (res: ScanResult<Row>): string | null => {
      if (res.error) return "Suppression list unavailable — aborted before sending.";
      if (!res.complete) return "Suppression list incomplete — aborted before sending.";
      return null;
    };

    // (a) A late-page fault now carries 1000 real rows. It must STILL abort.
    let call = 0;
    const faulted = await scanAll<Row>("suppressed_emails", (countOpt) => ({
      range: (from: number, to: number) => {
        call++;
        if (call === 3) {
          return Promise.resolve({ data: null, error: { message: "504" }, count: null });
        }
        const rows: Row[] = [];
        for (let i = from; i <= to; i++) rows.push({ id: i });
        return Promise.resolve({ data: rows, error: null, count: countOpt ? 2500 : null });
      },
    }));
    expect(faulted.rows.length).toBeGreaterThan(0);
    expect(suppressionGuard(faulted)).toBe("Suppression list unavailable — aborted before sending.");

    // (b) A truncated-but-errorless read has always had rows, and must abort on
    //     the `!complete` branch alone — `if (res.error)` was never the guard.
    const truncated = await scanAll<Row>("suppressed_emails", (c) =>
      new CappedTable(1619, /* cap */ 400).query(c),
    );
    expect(truncated.error).toBeNull();
    expect(truncated.rows.length).toBeGreaterThan(0);
    expect(suppressionGuard(truncated)).toBe("Suppression list incomplete — aborted before sending.");

    // (c) Control: a clean, complete read is the ONLY thing that proceeds.
    const clean = await scanAll<Row>("suppressed_emails", (c) => new CappedTable(1619).query(c));
    expect(suppressionGuard(clean)).toBeNull();
  });

  it("stops at the page ceiling and reports it rather than spinning forever", async () => {
    // A server that answers a full page forever — a broken window, a view with
    // no stable order. The loop must be bounded AND must say it gave up.
    let calls = 0;
    const res = await scanAll<Row>("runaway", () => ({
      range: (from: number, to: number) => {
        calls++;
        const rows: Row[] = [];
        for (let i = from; i <= to; i++) rows.push({ id: i });
        return Promise.resolve({ data: rows, error: null, count: null });
      },
    }));

    expect(calls).toBe(MAX_PAGES);
    expect(res.complete).toBe(false);
    expect(res.shortfall).toContain("page ceiling");
  });
});

describe("_shared/paginate — chunked IN lists", () => {
  it("chunks a long id list and pages each chunk", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `u-${i}`);
    const seen: string[][] = [];

    const res = await scanAllIn<{ user_id: string }>(
      "profiles",
      ids,
      (chunk, countOpt) => {
        seen.push(chunk);
        return {
          range: (from: number, to: number) =>
            Promise.resolve({
              data: chunk.slice(from, to + 1).map((u) => ({ user_id: u })),
              error: null,
              count: countOpt ? chunk.length : null,
            }),
        };
      },
      { chunkSize: 200 },
    );

    // 450 ids → 200 + 200 + 50. A single 450-id IN is fine today; a 3,000-id
    // one returns 1000 rows with no complaint, and a longer one exceeds the
    // URL length before that.
    expect(seen.map((c) => c.length)).toEqual([200, 200, 50]);
    expect(res.rows).toHaveLength(450);
    expect(res.complete).toBe(true);
    expect(res.total).toBe(450);
  });

  it("de-duplicates ids before chunking", async () => {
    const seen: string[][] = [];
    await scanAllIn<{ user_id: string }>(
      "profiles",
      ["a", "b", "a", "b", "c"],
      (chunk) => {
        seen.push(chunk);
        return {
          range: () => Promise.resolve({ data: [], error: null, count: 0 }),
        };
      },
    );
    expect(seen).toEqual([["a", "b", "c"]]);
  });

  it("one truncated chunk makes the WHOLE scan incomplete", async () => {
    // Partial completeness is not completeness: a caller that trusts a
    // half-read profile list reports "no tier drift" over helpers it never saw.
    const res = await scanAllIn<{ user_id: string }>(
      "profiles",
      ["a", "b"],
      (_chunk, countOpt) => ({
        range: () =>
          Promise.resolve({
            data: [{ user_id: "a" }],
            error: null,
            count: countOpt ? 2 : null,
          }),
      }),
    );

    expect(res.rows).toHaveLength(1);
    expect(res.complete).toBe(false);
    expect(res.shortfall).toContain("read 1 of 2 rows");
  });

  it("keeps the chunks it already read when a LATER chunk fails", async () => {
    // Same rule as `scanAll`: chunk 1 succeeding is a fact chunk 2 cannot undo.
    let chunk = 0;
    const res = await scanAllIn<{ user_id: string }>(
      "profiles",
      ["a", "b", "c", "d"],
      (ids, countOpt) => {
        chunk++;
        const mine = chunk;
        return {
          range: () =>
            mine === 2
              ? Promise.resolve({ data: null, error: { message: "504" }, count: null })
              : Promise.resolve({
                  data: ids.map((id) => ({ user_id: id })),
                  error: null,
                  count: countOpt ? ids.length : null,
                }),
        };
      },
      { chunkSize: 2 },
    );

    expect(res.rows).toEqual([{ user_id: "a" }, { user_id: "b" }]);
    expect(res.error).toEqual({ message: "504" });
    expect(res.complete).toBe(false);
    // `total` stays null rather than the 2 chunk 1 reported: a partial sum a
    // caller could compare `rows.length` against would read as "complete".
    expect(res.total).toBeNull();
    expect(res.shortfall).toContain("failed");
    expect(scanDefect("profiles", res)).toContain("read failed");
  });

  it("an empty id list makes no request at all", async () => {
    let calls = 0;
    const res = await scanAllIn<{ user_id: string }>("profiles", [], () => {
      calls++;
      return { range: () => Promise.resolve({ data: [], error: null, count: 0 }) };
    });
    expect(calls).toBe(0);
    expect(res.complete).toBe(true);
    expect(res.total).toBe(0);
  });
});
