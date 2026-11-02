/**
 * Q2173 (lh-money-escrow re-review of b1730c932 #2): a Helpr-fault card-fee
 * deduction is booked (job_helpr_fault_fee_deductions) before the transfer, and
 * restore_helpr_fault_fee runs only on a payout's in-run exits. A Quick Refund
 * after an unclear Stripe failure, a stuck claim on a job later refunded, or a
 * transfer clawed back leave the rows: the debt reads collected while nothing
 * was withheld. money-reconciliation now reports every such deduction older
 * than the settle window (helpr_fault_deduction_not_withheld).
 *
 * Runs the REAL function source through the edge harness.
 *
 * @mutate supabase/functions/money-reconciliation/index.ts |          if (!jobById.has(jobId) \|\| withheldJobs.has(jobId)) continue; |          if (true) continue;
 * @mutate supabase/functions/money-reconciliation/index.ts |          if (!jobById.has(jobId) \|\| withheldJobs.has(jobId)) continue; |          if (!jobById.has(jobId)) continue;
 * @mutate supabase/functions/money-reconciliation/index.ts |            .filter((t) => isSettledTransfer(t) && money( |            .filter((t) => true && money(
 * @mutate supabase/functions/money-reconciliation/index.ts |          if (at !== null && at > settledBefore) continue; |          void at;
 * @mutate supabase/functions/money-reconciliation/index.ts |        notes.push(`Helpr-fault deduction check skipped (${dedTable}): ${dedCap ?? transferCap}`); |        void 0;
 * Q2245 (d): a lapsed series visit's card-fee debt deduction (helpr_card_fee_debt_deductions) is read the same way.
 * @mutate supabase/functions/money-reconciliation/index.ts |     for (const dedTable of ["job_helpr_fault_fee_deductions", "helpr_card_fee_debt_deductions"] as const) { |     for (const dedTable of ["job_helpr_fault_fee_deductions"] as const) {
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

const CRON_SECRET = "cron-secret";
const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const CHECK = "helpr_fault_deduction_not_withheld";

async function load(): Promise<EdgeHarness> {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_x", CRON_SECRET });
  return loadEdgeFunction("money-reconciliation");
}

async function run() {
  const fn = await load();
  const res = await fn.fetch(fn.request({ url: "https://edge.test/fn", headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
  return JSON.parse(await res.text()) as Record<string, any>;
}

/** A $100 job its poster got back in full (Quick Refund) after a payout attempt. */
const refundedJob = {
  id: "job-1", is_seed: false, status: "cancelled", payment_status: "refunded", budget: 100, urgent_fee: 0,
  helper_id: "helper-1", is_group_job: false, helpers_needed: 1, has_active_dispute: false, dispute_status: null,
  stripe_payment_intent_id: null, stripe_session_id: null, cancelled_at: ago(DAY), updated_at: ago(DAY),
};

function seed(opts: { transfers?: Record<string, unknown>[]; deductions?: Record<string, unknown>[] | { error: { message: string } }; cardDeductions?: Record<string, unknown>[] | { error: { message: string } } } = {}) {
  scenario.reads.jobs = { rows: [refundedJob] };
  scenario.reads.payout_transfers = { rows: opts.transfers ?? [] };
  scenario.reads.disputes = { rows: [] };
  scenario.reads.profiles = { rows: [] };
  scenario.reads.gift_cards = { rows: [] };
  scenario.reads.payment_refunds = { rows: [] };
  scenario.reads.crew_cancellation_fee_shares = { rows: [] };
  scenario.reads.cancellation_fee_transfers = { rows: [] };
  const d = opts.deductions ?? [{ id: "ded-1", payout_ref: "job_payout_job-1", deducted_cents: 369, created_at: ago(DAY) }];
  scenario.reads.job_helpr_fault_fee_deductions = Array.isArray(d) ? { rows: d } : d;
  const c = opts.cardDeductions ?? [];
  scenario.reads.helpr_card_fee_debt_deductions = Array.isArray(c) ? { rows: c } : c;
  stripeMock.transfers.list.mockResolvedValue({ data: [], has_more: false });
}

const hit = (b: Record<string, any>) =>
  (b.findings as Array<{ check: string; count: number; sample: Array<Record<string, unknown>> }>).find((f) => f.check === CHECK);

describe("money-reconciliation: a Helpr-fault deduction no payout withheld (Q2173)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
  });

  it("a deduction on a job with no payout row is reported", async () => {
    seed();
    const f = hit(await run());
    expect(f?.count).toBe(1);
    expect(f?.sample[0]).toEqual({ job_id: "job-1", deduction_id: "ded-1", deducted_cents: 369, deduction_table: "job_helpr_fault_fee_deductions" });
  });

  it("Q2245: a lapsed-visit card-fee deduction no payout withheld is reported; one a paid transfer withheld is not", async () => {
    seed({ deductions: [], cardDeductions: [{ id: "cded-1", payout_ref: "job_payout_job-1", deducted_cents: 320, created_at: ago(DAY) }] });
    const f = hit(await run());
    expect(f?.count).toBe(1);
    expect(f?.sample[0]).toEqual({ job_id: "job-1", deduction_id: "cded-1", deducted_cents: 320, deduction_table: "helpr_card_fee_debt_deductions" });

    resetSupabaseMock();
    seed({ deductions: [], cardDeductions: [{ id: "cded-1", payout_ref: "job_payout_job-1", deducted_cents: 320, created_at: ago(DAY) }],
      transfers: [{ job_id: "job-1", helper_id: "helper-1", amount_cents: 8480, platform_fee_cents: 1200, status: "paid", stripe_transfer_id: "tr_1", metadata: { helpr_fault_fee_cents: 320 } }] });
    expect(hit(await run())).toBeUndefined();
  });

  it("Q2245: a failed lapsed-visit deduction read skips that half and says so", async () => {
    seed({ deductions: [], cardDeductions: { error: { message: "boom" } } });
    expect(JSON.stringify(await run())).toContain("Helpr-fault deduction check skipped (helpr_card_fee_debt_deductions)");
  });

  it("a paid transfer that withheld it clears the deduction", async () => {
    seed({ transfers: [{ job_id: "job-1", helper_id: "helper-1", amount_cents: 8431, platform_fee_cents: 1200, status: "paid", stripe_transfer_id: "tr_1", metadata: { helpr_fault_fee_cents: 369 } }] });
    expect(hit(await run())).toBeUndefined();
  });

  it("a failed attempt or a reversed transfer withheld nothing: reported", async () => {
    seed({ transfers: [
      { job_id: "job-1", helper_id: "helper-1", amount_cents: 8431, platform_fee_cents: 1200, status: "failed", stripe_transfer_id: null, metadata: { helpr_fault_fee_cents: 369 } },
      { job_id: "job-1", helper_id: "helper-1", amount_cents: 8431, platform_fee_cents: 1200, status: "reversed", stripe_transfer_id: "tr_2", metadata: { helpr_fault_fee_cents: 369 } },
    ] });
    expect(hit(await run())?.count).toBe(1);
  });

  it("a deduction inside the settle window is a payout in flight, not a finding", async () => {
    seed({ deductions: [{ id: "ded-1", payout_ref: "job_payout_job-1", deducted_cents: 369, created_at: ago(10 * 60_000) }] });
    expect(hit(await run())).toBeUndefined();
  });

  it("a deduction read that fails skips the check and says so (no silent clean)", async () => {
    seed({ deductions: { error: { message: "boom" } } });
    const b = await run();
    expect(hit(b)).toBeUndefined();
    expect(JSON.stringify(b)).toContain("Helpr-fault deduction check skipped");
  });

  it("inventory floor: the four paths that take the debt all write helpr_fault_fee_cents on the ledger row", async () => {
    const { readFileSync } = await import("node:fs");
    const { blankComments } = await import("../helpers/blankNonCode");
    const files = [
      "supabase/functions/release-payout/index.ts",
      "supabase/functions/process-scheduled-payouts/index.ts",
      "supabase/functions/create-payment/index.ts",
      "supabase/functions/execute-dispute-split/index.ts",
    ];
    const n = files.filter((f) => /helpr_fault_fee_cents|payoutWithheldMetadata\(/.test(blankComments(readFileSync(f, "utf8")))).length;
    expect(n).toBe(files.length);
    expect(n).toBeGreaterThan(3);
  });
});
