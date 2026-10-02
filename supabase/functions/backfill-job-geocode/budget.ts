// Time budget for one backfill-job-geocode run. Pure (no Deno/esm imports) so
// vitest can import it: src/test/geocodeCronFitsItsTimeout.test.ts.
//
// THE BUG (ops ledger 13662001, measured 2026-10-02): pg_net gives this cron
// 90,000ms (migration 20260830102806). error_logs row at 00:30:00Z: "Timeout
// of 90000 ms reached ... HTTP Request/Response time: 89960 ms"; the 04:17Z
// run took 88,731ms, against 291-568ms per run on 10-01. The reseed left 118
// open jobs without coords, so every run had a full 30-job batch, and
// 30 x (1,100ms fair-use sleep + an unbounded Nominatim lookup) has no ceiling.
//
// THE FIX: each lookup is abandoned after NOMINATIM_ATTEMPT_MS, and no new
// lookup starts after RUN_BUDGET_MS; the rest wait for the next run.

/** One Nominatim lookup may take this long before it is abandoned. */
export const NOMINATIM_ATTEMPT_MS = 8000;
/** Fair-use spacing between lookups (Nominatim: max 1 req/sec). */
export const NOMINATIM_DELAY_MS = 1100;
/** No new lookup starts once this much of the run has elapsed. */
export const RUN_BUDGET_MS = 60_000;
/** Allowance for the jobs read, one coord write and the response. */
const RUN_OVERHEAD_MS = 10_000;

/** Worst-case run length: the last lookup starts just inside the budget. */
export const worstCaseRunMs = () => RUN_BUDGET_MS + NOMINATIM_ATTEMPT_MS + RUN_OVERHEAD_MS;

/** Whether another lookup (plus its fair-use sleep) may start at `now`. */
export function mayStartLookup(startedAt: number, now: number): boolean {
  return now - startedAt < RUN_BUDGET_MS;
}
