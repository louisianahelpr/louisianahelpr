/**
 * Unit tests for the `payment-confirm-reminder` Supabase edge function — the
 * nudge that tells a poster to confirm completion (or request a revision)
 * before escrow auto-releases.
 *
 * THE DEFECT THESE PIN
 *
 * The cron runs ONCE A DAY (`15 15 * * *`) and tests a TWELVE-hour window:
 * `helper_completed_at ∈ [now-24h, now-12h]`. A job is only ever graded at
 * ages t₀, t₀+24, t₀+48, … for some t₀ ∈ [0,24), so it lands in the window
 * only when t₀ ∈ [12,24]. Every submission in the other half is looked at
 * once while it is too young and next while escrow has already auto-released,
 * and is never reminded — no error, no log, no row, and a 200 with a
 * plausible `sent` count.
 *
 * Unlike `review-nag-cron`, this window CANNOT be widened: the upper bound is
 * pinned by `AUTO_COMPLETE_HOURS` (24h), when the money actually moves. So the
 * fix is the schedule — every six hours, which lives in a migration — and what
 * this function can do on its own is MEASURE the hole. `missed` is that
 * measurement, and it is asserted below.
 *
 * Runs the REAL function source through the edge harness, including the real
 * `_shared/escrowTiming.ts`, so the 24 the window is derived from is the same
 * 24 the payout cron and the user-facing copy use.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret";

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    CRON_SECRET,
  });
  return loadEdgeFunction("payment-confirm-reminder");
}

function cronRequest(fn: EdgeHarness) {
  return fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

function seedDueJob() {
  scenario.reads.jobs = {
    rows: [
      {
        id: "job-1",
        title: "Deep clean",
        customer_id: "poster-1",
        helper_completed_at: new Date(Date.now() - 18 * 3600_000).toISOString(),
      },
    ],
  };
}

function notifWrites() {
  return scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert");
}
function markWrites() {
  return scenario.writes.filter((w) => w.table === "jobs" && w.op === "update");
}

describe("payment-confirm-reminder edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("rejects a request without the cron bearer", async () => {
    const fn = await loadConfigured();
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
  });

  it("answers the unauthenticated health probe", async () => {
    // `?health=1` is the only liveness signal this function exposes, and it is
    // what proved the function is genuinely deployed in prod (200 {"ok":true}).
    const fn = await loadConfigured();
    const res = await fn.fetch(fn.request({ url: "https://edge.test/fn?health=1" }));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ ok: true });
  });

  it("notifies the poster and marks the job so it cannot fire twice", async () => {
    const fn = await loadConfigured();
    seedDueJob();

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.sent).toBe(1);
    expect(b.defects).toBe(0);
    expect(notifWrites()).toHaveLength(1);
    expect((notifWrites()[0].payload as { user_id: string }).user_id).toBe("poster-1");
    // The link carries the poster to the job itself, not a filtered list.
    expect((notifWrites()[0].payload as { link: string }).link).toBe("/my-posts?job=job-1");
    expect(markWrites()).toHaveLength(1);
  });

  it("GUARDS the idempotency mark: a zero-row update is a defect, not a success", async () => {
    // `payment_confirm_notif_sent` is the ONLY thing stopping tomorrow's tick
    // nudging the same poster again, and an UPDATE matching zero rows returns
    // `{ data: [], error: null }` — indistinguishable from success without a
    // row count.
    const fn = await loadConfigured();
    seedDueJob();
    scenario.writeSelectRows["jobs:update"] = [];

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(b.ok).toBe(false);
    expect(String(b.defectReasons)).toContain("zero rows matched");
    expect(markWrites()[0].selectCols).toBe("id");
  });

  it("MEASURES the coverage hole: jobs that auto-released un-reminded are defects", async () => {
    // This is the alarm that replaces one that could never fire. The count is
    // the server's own — jobs past the auto-release cutoff with
    // `payment_confirm_notif_sent IS NULL` and no poster confirmation.
    const fn = await loadConfigured();
    scenario.reads.jobs = { rows: [], count: 7 };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(b.missed).toBe(7);
    expect(String(b.defectReasons)).toContain("auto-release cutoff with no confirm reminder");
    // And it names the fix, so whoever reads the alert does not have to derive
    // the arithmetic from scratch at 3am.
    expect(String(b.defectReasons)).toContain("15 */6 * * *");
  });

  it("stays clean when nothing is due and nothing was missed", async () => {
    const fn = await loadConfigured();
    scenario.reads.jobs = { rows: [] };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.ok).toBe(true);
    expect(b.sent).toBe(0);
    expect(b.missed).toBe(0);
    expect(notifWrites()).toHaveLength(0);
  });

  it("PAGES the due-jobs scan rather than taking one capped read", async () => {
    const fn = await loadConfigured();
    scenario.reads.jobs = {
      rows: Array.from({ length: 1200 }, (_, i) => ({
        id: `job-${i}`,
        title: "Job",
        customer_id: `poster-${i}`,
        helper_completed_at: new Date(Date.now() - 18 * 3600_000).toISOString(),
      })),
    };

    const b = await body(await fn.fetch(cronRequest(fn)));

    // An unpaged read stops at the 1000-row cap; the mock slices on `.range()`
    // the way PostgREST does, so this number is the paging.
    expect(b.processed).toBe(1200);
    expect(b.sent).toBe(1200);
  });

  it("a TRUNCATED due-jobs scan is a defect, not a quiet short run", async () => {
    const fn = await loadConfigured();
    seedDueJob();
    scenario.reads.jobs = { ...scenario.reads.jobs, count: 1619 };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(String(b.defectReasons)).toContain("read 1 of 1619 rows");
  });

  it("a FAILED read is an error, not zero due jobs", async () => {
    const fn = await loadConfigured();
    scenario.reads.jobs = { error: { message: "statement timeout" } };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(b.ok).toBe(false);
    expect(String(b.error)).toContain("statement timeout");
    expect(notifWrites()).toHaveLength(0);
  });
});
