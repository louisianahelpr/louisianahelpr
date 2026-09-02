/**
 * Unit tests for the `money-reconciliation` Supabase edge function — the
 * read-only alarm for money rows that disagree with what settlement derives.
 *
 * THE DEFECT THESE PIN
 *
 * Every scan was `.limit(SCAN_LIMIT)` with `SCAN_LIMIT = 5000`, guarded by
 * `if (rows.length >= SCAN_LIMIT) caps.push(...)`. That alarm was
 * UNSATISFIABLE. PostgREST enforces `db-max-rows = 1000` on this project and
 * an explicit larger `.limit()` does not raise it — measured against prod on
 * 2026-09-01, `notifications?select=id&limit=5000` on a 1,619-row table
 * returned exactly 1000 rows. So `rows.length` topped out at 1000, `1000 >=
 * 5000` was false on every run forever, and a reconciler that had audited at
 * most a fifth of the money reported "clean, no caps hit".
 *
 * A reconciler that certifies completeness over data it never read is worse
 * than no reconciler. The scans now page (`_shared/paginate.ts`, real, not
 * mocked) and compare what they read against the SERVER'S OWN exact count, and
 * a shortfall is a defect that reaches both Slack and the HTTP status.
 *
 * Runs the REAL function source through the edge harness, including the real
 * `_shared/cancellationFee.ts`, `_shared/helperFees.ts`, `_shared/escrowTiming.ts`
 * and `_shared/cron-result.ts`, so the comparisons under test are the ones
 * settlement actually performs.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";

const CRON_SECRET = "cron-secret";

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    CRON_SECRET,
  });
  return loadEdgeFunction("money-reconciliation");
}

function cronRequest(fn: EdgeHarness, url = "https://edge.test/fn") {
  return fn.request({ url, headers: { Authorization: `Bearer ${CRON_SECRET}` } });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

/** A clean, fully-settled completed job with a matching payout ledger row. */
function seedCleanLedger() {
  scenario.reads.jobs = {
    rows: [
      {
        id: "job-1",
        is_seed: false,
        status: "completed",
        payment_status: "released",
        budget: 100,
        date_needed: new Date(Date.now() - 5 * 86_400_000).toISOString(),
        cancelled_at: null,
        helper_id: "helper-1",
        cancellation_fee: 0,
        cancellation_fee_status: null,
        late_cancellation: false,
        platform_fee_amount: 12,
        helper_fee_percent: 12,
        is_group_job: false,
        helpers_needed: 1,
        has_active_dispute: false,
        dispute_status: null,
        poster_completed_at: new Date(Date.now() - 4 * 86_400_000).toISOString(),
        helper_completed_at: new Date(Date.now() - 4 * 86_400_000).toISOString(),
        payout_scheduled_at: null,
        updated_at: new Date(Date.now() - 4 * 86_400_000).toISOString(),
      },
    ],
  };
  scenario.reads.payout_transfers = {
    rows: [
      {
        job_id: "job-1",
        amount_cents: 8800,
        platform_fee_cents: 1200,
        status: "paid",
        stripe_transfer_id: "tr_1",
      },
    ],
  };
  scenario.reads.disputes = { rows: [] };
  scenario.reads.profiles = { rows: [] };
}

describe("money-reconciliation edge function", () => {
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

  it("is SILENT on a clean ledger — no Slack, 200, zero defects", async () => {
    const fn = await loadConfigured();
    seedCleanLedger();

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.ok).toBe(true);
    expect(b.clean).toBe(true);
    expect(slackAlerts).toHaveLength(0);
  });

  it("reports what it read NEXT TO what the server says exists", async () => {
    // The whole remedy in one field. "0 findings" is only meaningful alongside
    // the number of rows the finding-free claim covers, and that number now
    // comes from the server rather than from a client-side limit.
    const fn = await loadConfigured();
    seedCleanLedger();
    scenario.reads.jobs = { ...scenario.reads.jobs, count: 1 };

    const b = await body(await fn.fetch(cronRequest(fn)));
    const scanned = b.scanned as Record<string, unknown>;

    expect(scanned.jobs).toBe(1);
    expect((scanned.server_totals as Record<string, unknown>).jobs).toBe(1);
    expect(Number(scanned.pages)).toBeGreaterThan(0);
  });

  it("TRUNCATION is a defect: a short jobs scan fails the run and pages Slack", async () => {
    // The case the old alarm could never see. The rows themselves say nothing
    // is wrong; only the server's count reveals that four fifths of the money
    // was never looked at.
    const fn = await loadConfigured();
    seedCleanLedger();
    scenario.reads.jobs = { ...scenario.reads.jobs, count: 1619 };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(b.ok).toBe(false);
    expect(b.clean).toBe(true); // no discrepancies found…
    expect(String(b.defectReasons)).toContain("truncated scan");
    expect(String(b.defectReasons)).toContain("read 1 of 1619 rows");
    // …but "clean" over an unknown fraction is not a clean run, so it speaks.
    expect(slackAlerts).toHaveLength(1);
    expect(String((slackAlerts[0] as { title: string }).title)).toContain("degraded");
  });

  it("PAGES past the 1000-row cap on the jobs scan", async () => {
    const fn = await loadConfigured();
    seedCleanLedger();
    const base = (scenario.reads.jobs.rows ?? [])[0];
    scenario.reads.jobs = {
      rows: Array.from({ length: 1200 }, (_, i) => ({ ...base, id: `job-${i}` })),
      count: 1200,
    };
    // Every job now claims a payout row; the ledger check needs one per job or
    // `released_without_payout_transfer` fires 1,200 times.
    scenario.reads.payout_transfers = {
      rows: Array.from({ length: 1200 }, (_, i) => ({
        job_id: `job-${i}`,
        amount_cents: 8800,
        platform_fee_cents: 1200,
        status: "paid",
        stripe_transfer_id: `tr_${i}`,
      })),
      count: 1200,
    };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    // An unpaged read stops at the first 1000-row window; the mock slices on
    // `.range()` exactly as PostgREST does, so 1200 IS the paging.
    expect((b.scanned as Record<string, unknown>).jobs).toBe(1200);
    expect(res.status).toBe(200);
    expect(b.clean).toBe(true);
  });

  it("still catches a real discrepancy — a released job with no payout row", async () => {
    const fn = await loadConfigured();
    seedCleanLedger();
    scenario.reads.payout_transfers = { rows: [] };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    const findings = b.findings as Array<{ check: string; severity: string }>;
    expect(findings.map((f) => f.check)).toContain("released_without_payout_transfer");
    expect(res.status).toBe(500);
    expect(slackAlerts).toHaveLength(1);
  });

  it("a truncated DISPUTE cross-check skips the check instead of inventing criticals", async () => {
    // `dispute_flag_without_row` is a CRITICAL, and a short read makes flagged
    // jobs look like they have no dispute row. So a shortfall here would not
    // hide findings, it would MANUFACTURE them — the fastest way to teach
    // everyone to ignore this alarm.
    const fn = await loadConfigured();
    seedCleanLedger();
    scenario.reads.jobs = {
      rows: [{ ...(scenario.reads.jobs.rows ?? [])[0], has_active_dispute: true, dispute_status: "open" }],
    };
    scenario.reads.disputes = { rows: [], count: 5 };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    const findings = b.findings as Array<{ check: string }>;
    expect(findings.map((f) => f.check)).not.toContain("dispute_flag_without_row");
    expect(String(b.notes)).toContain("dispute cross-check skipped");
    expect(res.status).toBe(500);
  });

  // The two TIME-CREDIT tests that lived here (truncated-scan degradation and
  // the (user, created_at, id) re-sort after paging by id) were removed with
  // the check they covered: migration 20260901035602 dropped
  // public.time_credits, so the reconciler no longer reads it at all.

  it("a truncated PAYOUT LEDGER skips its checks instead of inventing criticals", async () => {
    // `paidJobIds` is built from whatever the scan returned, so every
    // `released` job whose transfer row fell outside a short read would be
    // reported as `released_without_payout_transfer` — "money supposedly left,
    // with no record of where", a CRITICAL. A critical that fires because a
    // scan came up short is how an alarm gets muted.
    const fn = await loadConfigured();
    seedCleanLedger();
    scenario.reads.payout_transfers = { ...scenario.reads.payout_transfers, count: 900 };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    const findings = b.findings as Array<{ check: string }>;
    expect(findings.map((f) => f.check)).not.toContain("released_without_payout_transfer");
    expect(findings.map((f) => f.check)).not.toContain("transfer_platform_fee_mismatch");
    expect(String(b.notes)).toContain("payout-ledger checks skipped");
    expect(res.status).toBe(500);
  });

  it("NEVER drops a read error — a failed jobs scan throws rather than reporting clean", async () => {
    const fn = await loadConfigured();
    seedCleanLedger();
    scenario.reads.jobs = { error: { message: "permission denied for table jobs" } };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(String(b.error)).toContain("jobs read failed");
    expect(String(b.error)).toContain("permission denied");
  });

  it("performs no writes — it reports, it never repairs", async () => {
    const fn = await loadConfigured();
    seedCleanLedger();
    scenario.reads.payout_transfers = { rows: [] }; // force a critical finding

    await fn.fetch(cronRequest(fn));

    expect(scenario.writes).toHaveLength(0);
  });
});
