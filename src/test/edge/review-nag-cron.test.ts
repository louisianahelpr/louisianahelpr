/**
 * Unit tests for the `review-nag-cron` Supabase edge function.
 *
 * THE DEFECT THESE PIN
 *
 * The cron runs ONCE A DAY (`26 16 * * *`) and used to test TWELVE-hour
 * windows: `hoursSince ∈ [24,36)` and `[72,84)`. A window narrower than the
 * sampling interval is not a window.
 *
 * Let t₀ be the gap between completion and the next tick, t₀ ∈ [0,24). The job
 * is only ever graded at t₀, t₀+24, t₀+48, … With the old first window,
 * `t₀+24k ∈ [24,36)` has a solution only for t₀ ∈ [0,12) — and the old SECOND
 * window needed t₀ ∈ [0,12) as well, THE SAME HALF. So it was never "half miss
 * the first nag and catch the second": every job completed in the twelve hours
 * before a tick was graded at 12–24h, 36–48h, 60–72h, 84–96h and was never
 * once inside either window. Half of all completed jobs got zero review nags,
 * forever, while the run reported `nags_sent` and a 200.
 *
 * The test below walks a completion across all 24 possible values of t₀ and
 * asserts EVERY one is nagged. Under `[24,36)` twelve of them are not — see the
 * negative-control note on that test.
 *
 * Runs the REAL function source through the edge harness.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret";
/** The deployed schedule: once a day. */
const CRON_PERIOD_HOURS = 24;

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    CRON_SECRET,
  });
  return loadEdgeFunction("review-nag-cron");
}

function cronRequest(fn: EdgeHarness) {
  return fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

/** One completed job, its poster_completed_at set `hoursAgo` before now. */
function seedJob(hoursAgo: number) {
  scenario.reads.jobs = {
    rows: [
      {
        id: "job-1",
        title: "Move a couch",
        customer_id: "poster-1",
        helper_id: "helper-1",
        poster_completed_at: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
        helper_completed_at: null,
      },
    ],
  };
  scenario.reads.reviews = { rows: [] };
  scenario.reads.notifications = { rows: [] };
}

function nagWrites() {
  return scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert");
}

describe("review-nag-cron edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    // send-notification-email is a cross-function fetch. Answer it as the real
    // one does on a successful send so the nag counter is exercised.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a request without the cron bearer", async () => {
    const fn = await loadConfigured();
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
  });

  it("nags BOTH parties once a job is 24h old", async () => {
    const fn = await loadConfigured();
    seedJob(30);

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.nags_sent).toBe(2);
    expect(nagWrites()).toHaveLength(2);
  });

  it("EVERY completion age a daily cron can observe lands in a window", async () => {
    // The whole bug, expressed as a property. For each t₀ ∈ [0,24) the job is
    // graded at t₀, t₀+24, t₀+48, t₀+72, t₀+96 — the ages a once-a-day cron
    // actually sees. At least one of those must fall in a nag window, or that
    // job is never nagged at all.
    //
    // NEGATIVE CONTROL (run 2026-09-01): set `WINDOW_HOURS = 12` in
    // `supabase/functions/review-nag-cron/index.ts` — its shipped value — and
    // this test fails with
    //   AssertionError: expected [ Array(12) ] to deeply equal []
    //   received [12,13,14,15,16,17,18,19,20,21,22,23]
    // Twelve of the twenty-four offsets, never nagged at any age the cron can
    // observe. Restoring 24 turns it green.
    const fn = await loadConfigured();
    const missed: number[] = [];

    for (let t0 = 0; t0 < CRON_PERIOD_HOURS; t0++) {
      let nagged = false;
      for (const age of [t0, t0 + 24, t0 + 48, t0 + 72, t0 + 96]) {
        resetSupabaseMock();
        seedJob(age);
        const res = await fn.fetch(cronRequest(fn));
        const b = await body(res);
        if (Number(b.nags_sent) > 0) nagged = true;
      }
      if (!nagged) missed.push(t0);
    }

    expect(missed).toEqual([]);
  });

  it("the two windows stay disjoint — no age is graded by both", async () => {
    // Widening to 24h must not make [24,48) and [72,96) overlap, or a single
    // completion would be nagged twice in one pass with two different titles.
    const fn = await loadConfigured();

    for (const age of [24, 36, 47, 72, 84, 95]) {
      resetSupabaseMock();
      seedJob(age);
      const b = await body(await fn.fetch(cronRequest(fn)));
      const results = b.results as Array<{ window: string }>;
      expect(new Set(results.map((r) => r.window)).size).toBe(1);
    }
  });

  it("stays quiet outside both windows", async () => {
    const fn = await loadConfigured();
    for (const age of [1, 12, 23, 48, 60, 71, 96, 120]) {
      resetSupabaseMock();
      seedJob(age);
      const b = await body(await fn.fetch(cronRequest(fn)));
      expect(b.nags_sent).toBe(0);
    }
  });

  it("does not nag a party who already reviewed", async () => {
    const fn = await loadConfigured();
    seedJob(30);
    scenario.reads.reviews = { rows: [{ reviewer_id: "poster-1" }] };

    const b = await body(await fn.fetch(cronRequest(fn)));

    expect(b.nags_sent).toBe(1);
    expect((nagWrites()[0].payload as { user_id: string }).user_id).toBe("helper-1");
  });

  it("PAGES the completed-jobs scan rather than taking one capped read", async () => {
    const fn = await loadConfigured();
    // 1,200 completed jobs in the week — past the 1000-row cap. The mock slices
    // on `.range()` the way PostgREST does, so an unpaged read would grade 500.
    scenario.reads.jobs = {
      rows: Array.from({ length: 1200 }, (_, i) => ({
        id: `job-${i}`,
        title: "Job",
        customer_id: `poster-${i}`,
        helper_id: `helper-${i}`,
        poster_completed_at: new Date(Date.now() - 30 * 3600_000).toISOString(),
        helper_completed_at: null,
      })),
    };
    scenario.reads.reviews = { rows: [] };
    scenario.reads.notifications = { rows: [] };

    const b = await body(await fn.fetch(cronRequest(fn)));

    expect(b.jobs_checked).toBe(1200);
    expect(b.nags_sent).toBe(2400);
  });

  it("a TRUNCATED job scan ABORTS — it does not grade the subset", async () => {
    // Aborting, not degrading: this file's windows have exactly one solution
    // per job, so a job dropped by a short read misses its window permanently
    // and is never nagged for it. Grading the subset would turn a read fault
    // into a silent, unrecoverable loss while still reporting nags "sent".
    const fn = await loadConfigured();
    seedJob(30);
    // The server hands back one row while insisting 1,619 match.
    scenario.reads.jobs = { ...scenario.reads.jobs, count: 1619 };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(b.ok).toBe(false);
    expect(String(b.error)).toContain("read 1 of 1619 rows");
    expect(nagWrites()).toHaveLength(0);
  });

  it("fails CLOSED when the dedupe count cannot be read", async () => {
    // A dropped error here read as `count: null` → 0 → "not yet nagged", which
    // turns the duplicate guard into a duplicate guarantee. A missed nag costs
    // a review; a double nag costs trust.
    const fn = await loadConfigured();
    seedJob(30);
    scenario.reads.notifications = { error: { message: "statement timeout" } };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(b.nags_sent).toBe(0);
    expect(nagWrites()).toHaveLength(0);
    expect(String(b.defectReasons)).toContain("nag withheld");
  });

  it("does not nag on an unreadable reviews list", async () => {
    // An errored read yields an empty `reviewedBy`, which reads exactly like
    // "neither party has reviewed" and nags two people who already did.
    const fn = await loadConfigured();
    seedJob(30);
    scenario.reads.reviews = { error: { message: "permission denied" } };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(b.nags_sent).toBe(0);
    expect(String(b.defectReasons)).toContain("permission denied");
  });
});
