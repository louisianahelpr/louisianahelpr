// paginate — read an ENTIRE PostgREST result set, and prove that you did.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE PROBLEM THIS EXISTS FOR
// ═══════════════════════════════════════════════════════════════════════════
//
// PostgREST enforces `db-max-rows = 1000` on this project. Measured against
// prod on 2026-09-01 with the service-role key:
//
//   GET /rest/v1/notifications?select=id                  → content-range: 0-999/*   (1000 rows)
//   GET /rest/v1/notifications?select=id&limit=5000       → content-range: 0-999/*   (1000 rows)
//   GET /rest/v1/notifications  Range: 0-4999             → content-range: 0-999/*   (1000 rows)
//   GET /rest/v1/notifications  Range: 1000-1999          → content-range: 1000-1618/* (619 rows)
//
// The table held 1,619 rows. Three things follow, and every one of them has
// already produced a live defect in this repository:
//
//   1. An explicit `.limit(N)` above the cap DOES NOT RAISE IT. `SCAN_LIMIT =
//      5000` and `.limit(5000)` are decoration; the server hands back 1000.
//   2. The cap applies AFTER the ORDER BY, and an unordered query has no
//      defined order at all — so an unbounded read silently degrades to "some
//      1000 rows", and every consumer believes it saw everything.
//   3. A client-side truncation alarm of the shape `rows.length >= SCAN_LIMIT`
//      CAN NEVER FIRE, because the server returns 1000 before the client's
//      5000 is ever approached. An alarm that cannot fire is worse than no
//      alarm: it certifies completeness.
//
// `.range(offset, offset + N - 1)` DOES page past the cap (row 4 above), so
// pagination is the fix — not a bigger limit.
//
// ═══════════════════════════════════════════════════════════════════════════
// HOW THIS PROVES COMPLETENESS
// ═══════════════════════════════════════════════════════════════════════════
//
// The page loop alone is not enough. If the cap were ever lowered below
// PAGE_SIZE, every page would come back short, the loop would stop on the
// first one, and we would be right back to a silent truncation — just with
// more code in front of it.
//
// So the first page is requested with `{ count: "exact" }`. PostgREST answers
// that from a real `COUNT(*)` over the SAME filters, and it is NOT subject to
// `db-max-rows` — the header on a capped read literally reads `0-999/1619`.
// That count is the independent second opinion:
//
//     complete  ⇔  rows.length >= total reported by the server
//
// A shortfall is therefore a measured fact ("read 1000 of 1619"), not an
// inference from a limit the platform is free to override. Callers must treat
// `complete === false` as a DEFECT — dropped work — and, on any send path, as
// a reason to abort before mailing anyone.
//
// AND A MISSING COUNT IS ALSO INCOMPLETE. If no count comes back there is no
// second opinion, and certifying the read anyway would rebuild the exact thing
// this module replaces: a completeness claim resting on nothing. That happens
// for one realistic reason — a caller forgetting to thread `countOpt` into its
// `.select()`, which nothing else can enforce — and treating it as "verified"
// would make the omission invisible. Real PostgREST always answers a
// `count: "exact"` request (measured on all six of this lane's live query
// shapes: `0-4/5`, `0-30/31`, `0-1/2`, `*/0`, …), so this costs nothing in
// production and catches the one way a caller can silently opt out.
//
// PAGE_SIZE is deliberately BELOW the observed cap. At 500 a full page proves
// the server was not the thing that ended the page, which keeps "short page"
// meaning "end of data" under the cap we actually have; and if the cap is ever
// lowered under 500 the count check still catches it. `daily-match-digest`
// chunks its drain at 500 for the same reason — same number, same rationale.
//
// CONSISTENCY NOTE: this is OFFSET paging, so rows inserted or deleted between
// pages can shift the window. Every caller here scans a table it does not
// write, in a cron with no concurrent writer of consequence, and the count
// check catches gross drift. Do not reach for this on a queue you are draining.

/** Rows per page. Below the observed `db-max-rows = 1000` on purpose. */
export const PAGE_SIZE = 500;

/**
 * Hard stop, so a pathological table (or a server that answers a full page
 * forever) cannot spin a cron until its wall clock runs out. 400 × 500 =
 * 200,000 rows — orders of magnitude above anything these scans touch, and
 * hitting it is reported as a shortfall rather than silently accepted.
 */
export const MAX_PAGES = 400;

/** Ids per `?col=in.(...)` request. Keeps the URL sane and each page uncapped. */
export const IN_CHUNK = 200;

/**
 * The slice of the PostgREST builder this helper drives.
 *
 * Deliberately structural and loose: postgrest-js's generics resolve the row
 * shape from the literal passed to `.select()`, and threading that through a
 * generic helper produces `GenericStringError` for every column. The caller
 * keeps its literal select — and therefore its real row type — by declaring
 * the element type on the call, e.g. `scanAll<{ id: string }>(...)`.
 */
export interface PageQuery {
  range(from: number, to: number): PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
    count?: number | null;
  }>;
}

/** Options accepted at the `.select()` call site. `undefined` on later pages. */
export type CountOption = { count: "exact" } | undefined;

/**
 * Build one page's query. Called once per page.
 *
 * MUST apply `.select("<literal>", countOpt)` and an `.order(...)` on a stable,
 * unique-enough column — offset paging over an unordered result is not paging,
 * it is sampling.
 */
export type PageQueryFactory = (countOpt: CountOption) => PageQuery;

export interface ScanResult<T> {
  /** Every row read. Empty when `error` is set. */
  rows: T[];
  /** The server's own exact count for these filters, or null if it withheld one. */
  total: number | null;
  /** True only when the read demonstrably saw everything. */
  complete: boolean;
  /** Human, numeric reason when `complete` is false. Null when it is true. */
  shortfall: string | null;
  /** Requests issued. Useful in a run body when a scan gets expensive. */
  pages: number;
  /** NEVER dropped. A caller that ignores this is asserting an empty table. */
  error: { message: string } | null;
}

/**
 * Read every row matching a query, paging past `db-max-rows`.
 *
 * @param label  Table/scan name, used in the shortfall message.
 * @param build  Page factory — see `PageQueryFactory`.
 */
export async function scanAll<T>(
  label: string,
  build: PageQueryFactory,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<ScanResult<T>> {
  const pageSize = Math.max(1, opts.pageSize ?? PAGE_SIZE);
  const maxPages = Math.max(1, opts.maxPages ?? MAX_PAGES);

  const rows: T[] = [];
  let total: number | null = null;
  let pages = 0;
  let offset = 0;

  for (;;) {
    // The exact count is asked for ONCE. It is a real COUNT(*) over the same
    // filters, so repeating it on every page would double the cost of the scan
    // for an answer that does not change within a run.
    const countOpt: CountOption = pages === 0 ? { count: "exact" } : undefined;
    const { data, error, count } = await build(countOpt).range(offset, offset + pageSize - 1);

    if (error) {
      return { rows: [], total, complete: false, shortfall: null, pages, error };
    }

    pages++;
    if (pages === 1 && typeof count === "number") total = count;

    const batch = (data ?? []) as T[];
    rows.push(...batch);

    // A SHORT page is the only honest end-of-data signal available: PostgREST
    // does not say "that was the last one". Under the 1000-row cap a 500-row
    // request that returns 500 was not capped, so a short page really is the
    // tail. If the cap is ever lowered below `pageSize` this stops early — and
    // the count comparison below is what turns that into a reported defect
    // instead of a quiet half-scan.
    if (batch.length < pageSize) break;

    offset += batch.length;

    // Only a ceiling we hit with work still outstanding is a shortfall. A scan
    // whose final page happens to be exactly full at page `maxPages` has read
    // everything the server says exists, and reporting that as dropped work
    // would be a false page.
    if (pages >= maxPages && !(total !== null && rows.length >= total)) {
      return {
        rows,
        total,
        complete: false,
        shortfall:
          `${label}: stopped after ${pages} pages (${rows.length} rows) at the ${maxPages}-page ceiling` +
          (total === null ? "" : ` — the server reports ${total} matching rows`),
        pages,
        error: null,
      };
    }
  }

  if (total === null) {
    // No independent total came back, so nothing corroborates this read. See
    // the header: certifying it anyway is the failure mode this module exists
    // to remove, and the realistic cause is a caller that forgot to pass
    // `countOpt` into its `.select()`.
    return {
      rows,
      total,
      complete: false,
      shortfall: `${label}: the server returned no exact count, so completeness could not be verified (did the query pass countOpt to .select()?)`,
      pages,
      error: null,
    };
  }

  if (rows.length < total) {
    return {
      rows,
      total,
      complete: false,
      shortfall: `${label}: read ${rows.length} of ${total} rows the server reports — the result was truncated`,
      pages,
      error: null,
    };
  }

  return { rows, total, complete: true, shortfall: null, pages, error: null };
}

/**
 * Read every row for a LIST of ids, chunking the `.in(...)` filter.
 *
 * `.in()` is capped exactly like any other read — a 3,000-id `IN` returns 1000
 * rows and no complaint — and a long enough id list also blows the URL length
 * before that. Both are handled here; each chunk is itself paged by `scanAll`,
 * so a chunk that fans out to more rows than ids (a one-to-many join) is safe.
 *
 * `total` is the sum across chunks; `complete` is the AND of them.
 */
export async function scanAllIn<T>(
  label: string,
  ids: readonly string[],
  build: (chunk: string[], countOpt: CountOption) => PageQuery,
  opts: { pageSize?: number; maxPages?: number; chunkSize?: number } = {},
): Promise<ScanResult<T>> {
  const chunkSize = Math.max(1, opts.chunkSize ?? IN_CHUNK);
  const unique = [...new Set(ids)];

  const rows: T[] = [];
  let total: number | null = unique.length === 0 ? 0 : null;
  let pages = 0;
  const shortfalls: string[] = [];

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const res = await scanAll<T>(`${label}[${i}..${i + chunk.length - 1}]`, (c) => build(chunk, c), opts);
    pages += res.pages;
    if (res.error) {
      return { rows: [], total: null, complete: false, shortfall: null, pages, error: res.error };
    }
    rows.push(...res.rows);
    if (res.total !== null) total = (total ?? 0) + res.total;
    // `res.shortfall` and not `res.complete` are separate facts; keying the
    // push on the MESSAGE would drop a chunk's incompleteness whenever the
    // message happened to be null. Key on the verdict.
    if (!res.complete) shortfalls.push(res.shortfall ?? `${label} chunk ${i} was incomplete`);
  }

  return {
    rows,
    total,
    complete: shortfalls.length === 0,
    shortfall: shortfalls.length ? shortfalls.join("; ") : null,
    pages,
    error: null,
  };
}

/**
 * One line naming what went wrong with a scan, or null when it went right.
 *
 * Collapses the two distinguishable failures — the read errored, and the read
 * silently returned less than exists — into the single string a defect tracker
 * wants, without letting either turn into "no rows today".
 */
export function scanDefect(label: string, res: ScanResult<unknown>): string | null {
  if (res.error) return `${label} read failed: ${res.error.message}`;
  if (!res.complete) return res.shortfall ?? `${label} read was incomplete`;
  return null;
}
