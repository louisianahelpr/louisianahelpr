/**
 * Q993 — the server cutoffs, with the clock MOVED.
 *
 * No test moved the clock for auto-expire-jobs step 2 or expiring-jobs-push
 * (time-travel lane, 2026-09-12). Both decide WHICH rows to act on in their
 * query, from `new Date()`, so the decision is the cutoff value they send. The
 * edge double records every filter of every read (readQueries), so this runs
 * the REAL function source through the harness at chosen instants and asserts
 * the cutoff the function asked the database for.
 *
 *   auto-expire-jobs step 2 cancels open jobs whose `date_needed < today`.
 *   `date_needed` is a Louisiana date, so "today" must be the America/Chicago
 *   date: between 19:00 and midnight Central the UTC date is already tomorrow
 *   (the bug that cancelled same-evening jobs hours early). Checked at a CDT
 *   evening, both sides of Central midnight, and across both 2026 DST nights.
 *
 *   expiring-jobs-push warns open jobs expiring in (now, now + 24 h]; the window
 *   must slide with the clock, never a fixed calendar day.
 *
 * The SQL sweep_* functions are PGlite territory; this file covers the two
 * edge cutoffs the item names.
 */
// @mutate supabase/functions/auto-expire-jobs/index.ts |     const today = new Intl.DateTimeFormat("en-CA", { |     const today = new Date().toISOString().slice(0, 10); const _unusedToday = new Intl.DateTimeFormat("en-CA", {
// @mutate supabase/functions/expiring-jobs-push/index.ts |     const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000); |     const in24h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret-clock";

async function load(name: string): Promise<EdgeHarness> {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET });
  return loadEdgeFunction(name);
}

async function runAt(name: string, iso: string) {
  vi.setSystemTime(new Date(iso));
  const fn = await load(name);
  const res = await fn.fetch(
    fn.request({ method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` }, url: `https://edge.test/${name}` }),
  );
  expect(res.status, `${name} at ${iso}`).toBe(200);
}

/** The value of `op(column)` on reads of `table`, across every read that used it. */
function filterValues(table: string, op: string, column: string): unknown[] {
  return scenario.readQueries
    .filter((q) => q.table === table)
    .flatMap((q) => q.filters.filter((f) => f.op === op && f.column === column).map((f) => f.value));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  resetSupabaseMock();
  resetSharedMocks();
  resetEnv();
  scenario.reads.jobs = { rows: [] };
  scenario.rpc.expire_unanswered_offers = 0;
  scenario.rpc.expire_pending_direct_offers = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("auto-expire-jobs step 2: 'today' is the Louisiana date at every instant (Q993)", () => {
  const cases: Array<[string, string, string]> = [
    // [instant (UTC), Central wall clock, the date_needed cutoff it must send]
    ["2026-10-05T01:30:00Z", "Sun Oct 4, 20:30 CDT (UTC is already Oct 5)", "2026-10-04"],
    ["2026-10-05T04:59:00Z", "Sun Oct 4, 23:59 CDT", "2026-10-04"],
    ["2026-10-05T05:00:00Z", "Mon Oct 5, 00:00 CDT", "2026-10-05"],
    // Fall back, 2026-11-01 02:00 CDT -> 01:00 CST (07:00Z). 01:30 happens twice.
    ["2026-11-01T04:59:00Z", "Sat Oct 31, 23:59 CDT", "2026-10-31"],
    ["2026-11-01T06:30:00Z", "Sun Nov 1, 01:30 CDT (first)", "2026-11-01"],
    ["2026-11-01T07:30:00Z", "Sun Nov 1, 01:30 CST (second)", "2026-11-01"],
    ["2026-11-02T05:59:00Z", "Sun Nov 1, 23:59 CST", "2026-11-01"],
    // Spring forward, 2026-03-08 02:00 CST -> 03:00 CDT (08:00Z).
    ["2026-03-08T05:59:00Z", "Sat Mar 7, 23:59 CST", "2026-03-07"],
    ["2026-03-08T06:00:00Z", "Sun Mar 8, 00:00 CST", "2026-03-08"],
    ["2026-03-08T08:30:00Z", "Sun Mar 8, 03:30 CDT", "2026-03-08"],
  ];
  for (const [iso, wall, cutoff] of cases) {
    it(`${wall}: cancels only jobs dated before ${cutoff}`, async () => {
      await runAt("auto-expire-jobs", iso);
      expect(filterValues("jobs", "lt", "date_needed")).toEqual([cutoff]);
      // The other half of step 2 compares the listing expiry to the instant itself.
      expect(filterValues("jobs", "lt", "expires_at")).toEqual([iso.replace("Z", ".000Z")]);
    });
  }
});

describe("expiring-jobs-push: the warning window slides with the clock (Q993)", () => {
  for (const iso of ["2026-10-05T13:14:00Z", "2026-10-05T23:14:00Z", "2026-11-01T07:14:00Z", "2026-03-08T08:14:00Z"]) {
    it(`at ${iso} it asks for jobs expiring in (now, now + 24h]`, async () => {
      await runAt("expiring-jobs-push", iso);
      const now = new Date(iso);
      expect(filterValues("jobs", "gt", "expires_at")).toEqual([now.toISOString()]);
      expect(filterValues("jobs", "lte", "expires_at")).toEqual([new Date(now.getTime() + 24 * 3_600_000).toISOString()]);
    });
  }
});
