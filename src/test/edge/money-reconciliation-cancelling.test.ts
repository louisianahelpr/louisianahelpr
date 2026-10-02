/**
 * money-reconciliation: a cancel that claimed the job and never finished
 * (docs/OPEN.md Q456).
 *
 * cancel_escrow (create-payment) claims a job by flipping payment_status to
 * 'cancelling', refunds, gives a gift back, then flips to 'cancelled'. When a
 * step after the claim fails (gift restore, the final flip, putting the claim
 * back) the job is left 'cancelling'. Nothing retries it, and the critical
 * alert those paths post fires ONCE. Measured on prod 2026-10-02 (read-only):
 * 0 jobs at 'cancelling', no cron command and no sweep function selects it.
 * The job is already out of browse (open_jobs_browse admits only escrow /
 * payout_pending / released) and cannot be hired (trg_job_funded_before_award
 * requires job_payment_is_funded), so the remaining gap was memory: this check
 * re-reports a stranded cancel on every reconciler run until a human ends it.
 *
 * Runs the REAL function source through the edge harness.
 *
 * @mutate supabase/functions/money-reconciliation/index.ts | if (job.payment_status !== "cancelling") continue; | continue;
 * @mutate supabase/functions/money-reconciliation/index.ts | if (nowMs - claimedAt <= CANCELLING_WINDOW_MS) continue; | if (true) continue;
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { resetStripeMock } from "./mocks/stripe";

const CRON_SECRET = "cron-secret";
const MIN = 60_000;

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_x",
    CRON_SECRET,
  });
  return loadEdgeFunction("money-reconciliation");
}

async function run(fn: EdgeHarness) {
  const res = await fn.fetch(fn.request({ url: "https://edge.test/fn", headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
  return { res, b: JSON.parse(await res.text()) as Record<string, any> };
}

/** An open, unhired $25 job whose cancel_escrow claimed it `ageMin` minutes ago. */
function cancellingJob(ageMin: number) {
  return {
    id: "job-stuck",
    is_seed: false,
    status: "open",
    payment_status: "cancelling",
    budget: 25,
    urgent_fee: 0,
    customer_fee_amount: 3,
    stripe_payment_intent_id: null,
    date_needed: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    start_time: null,
    cancelled_at: null,
    helper_id: null,
    helper_confirmed_at: null,
    cancellation_fee: 0,
    cancellation_fee_status: null,
    late_cancellation: false,
    platform_fee_amount: null,
    helper_fee_percent: null,
    is_group_job: false,
    helpers_needed: 1,
    has_active_dispute: false,
    dispute_status: null,
    poster_completed_at: null,
    helper_completed_at: null,
    payout_scheduled_at: null,
    updated_at: new Date(Date.now() - ageMin * MIN).toISOString(),
  };
}

function seed(job: Record<string, unknown>) {
  scenario.reads.jobs = { rows: [job] };
  scenario.reads.payout_transfers = { rows: [] };
  scenario.reads.disputes = { rows: [] };
  scenario.reads.profiles = { rows: [] };
  scenario.reads.gift_cards = { rows: [] };
  scenario.reads.payment_refunds = { rows: [] };
}

const finding = (b: Record<string, any>, check: string) =>
  (b.findings as Array<{ check: string; severity: string; count: number; sample: any[] }>).find((f) => f.check === check);

describe("money-reconciliation — stranded 'cancelling' (Q456)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
  });

  it("pages CRITICAL for a job left at 'cancelling' past the window", async () => {
    const fn = await load();
    seed(cancellingJob(3 * 60));

    const { res, b } = await run(fn);

    expect(b.checks_run).toContain("cancelling_stranded");
    const f = finding(b, "cancelling_stranded");
    expect(f).toMatchObject({ severity: "critical", count: 1 });
    expect(f!.sample[0]).toMatchObject({ job_id: "job-stuck", status: "open" });
    expect(res.status).toBe(500);
    expect(slackAlerts.some((a: any) => a.severity === "critical")).toBe(true);
  });

  it("leaves a cancel that is still inside its own round-trips alone", async () => {
    const fn = await load();
    seed(cancellingJob(5));

    const { b } = await run(fn);

    expect(b.checks_run).toContain("cancelling_stranded");
    expect(finding(b, "cancelling_stranded")).toBeUndefined();
  });
});
