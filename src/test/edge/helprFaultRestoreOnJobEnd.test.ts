/**
 * A Helpr-fault card-fee deduction is given back when the job ENDS with no
 * payout that kept it (lh-money-escrow re-review of b1730c932 #2).
 *
 * take_helpr_fault_fee books the debt as collected when a payout run decides
 * to withhold it; restore_helpr_fault_fee gave it back only from the run's own
 * in-run exits. A payout attempt that stopped unclear and was followed by a
 * full refund, or a transfer fully reversed (a lost card dispute, a reversal by
 * hand), left the debt reading collected while nothing was withheld: a fee the
 * platform absorbed. Now:
 *   - charge.refunded (every full refund lands there), a full transfer.reversed
 *     that is not a dispute clawback, and a LOST charge.dispute.closed call
 *     restore_helpr_fault_fee_for_job (20261019043251, which refuses unless the
 *     job is refunded or holds a fully reversed transfer, and keeps whatever a
 *     live pending/paid/partly reversed payout carries: PGlite
 *     ~/.lh-shots/jobs-followups/jfu_restore_end.mjs, 35/35);
 *   - a clawback reversal is NOT given back (a won dispute repays the reversed
 *     amount, which is net of the fee);
 *   - money-reconciliation pages any deduction older than its window that no
 *     paid or reversed payout row records as withheld
 *     (helpr_fault_deduction_not_collected), for a person to settle.
 *
 * Runs the REAL handler sources through the edge harness.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | await restoreHelprFaultFeeForJob(supabase, String(refundedJob.id), "stripe-webhook charge.refunded"); | void 0;
 * @mutate supabase/functions/stripe-webhook/handlers/transferReversed.ts | if (recordedFullyReversed && reversedLedger?.job_id && !ours.error) { | if (reversedLedger?.job_id && !ours.error) {
 * @mutate supabase/functions/stripe-webhook/handlers/transferReversed.ts | if (recordedFullyReversed && reversedLedger?.job_id && !ours.error) { | if (recordedFullyReversed && reversedLedger?.job_id) {
 * @mutate supabase/functions/money-reconciliation/index.ts | ((p.metadata ?? {}).fully_reversed !== true \|\| | ((p.metadata ?? {}).fully_reversed !== "never" \|\|
 * @mutate supabase/functions/stripe-webhook/handlers/transferReversed.ts | await restoreHelprFaultFeeForJob(supabase, String(reversedLedger.job_id), "stripe-webhook transfer.reversed"); | void 0;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | await restoreHelprFaultFeeForJob(supabase, String(closedJob.id), "stripe-webhook charge.dispute.closed lost"); | void 0;
 * @mutate supabase/functions/money-reconciliation/index.ts | (p.status === "paid" \|\| p.status === "reversed") && | (p.status === "paid" \|\| p.status === "reversed" \|\| p.status === "pending") &&
 * @mutate supabase/functions/money-reconciliation/index.ts | Number((p.metadata ?? {}).helpr_fault_fee_cents ?? 0) > 0 | true
 * @mutate supabase/functions/_shared/helprFaultFee.ts | const { data, error } = await supabaseAdmin.rpc("restore_helpr_fault_fee_for_job", { p_job_id: jobId }); | const { data, error } = { data: 0, error: null as { code?: string } \| null };
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const RESTORE = "restore_helpr_fault_fee_for_job";
const restoreCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === RESTORE);

async function loadWebhook(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  return loadEdgeFunction("stripe-webhook");
}
const post = (fn: EdgeHarness) => fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc" } }));

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
});

describe("charge.refunded gives a job's Helpr-fault deduction back", () => {
  function refunded(id: string) {
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id,
      type: "charge.refunded",
      data: { object: { id: `ch_${id}`, payment_intent: "pi_r", amount: 5000, amount_refunded: 5000, currency: "usd", refunds: { data: [{ id: `re_${id}`, amount: 5000 }] } } },
    });
  }

  it("a full refund that closes the job calls restore_helpr_fault_fee_for_job for it", async () => {
    const fn = await loadWebhook();
    refunded("evt_hf_refund");
    scenario.reads.jobs = { rows: [{ id: "job-r", customer_id: "p", helper_id: "h", title: "Job", payment_status: "escrow" }] };
    scenario.rpc[RESTORE] = 369;
    const res = await post(fn);
    expect(res.status).toBe(200);
    expect(restoreCalls()).toHaveLength(1);
    expect(restoreCalls()[0].args).toEqual({ p_job_id: "job-r" });
  });

  it("a refund on a released job (the Helpr was paid) gives nothing back", async () => {
    const fn = await loadWebhook();
    refunded("evt_hf_refund_released");
    scenario.reads.jobs = { rows: [{ id: "job-r", customer_id: "p", helper_id: "h", title: "Job", payment_status: "released" }] };
    await post(fn);
    expect(restoreCalls()).toHaveLength(0);
  });

  it("a failed give-back never fails the webhook (the refund already happened)", async () => {
    const fn = await loadWebhook();
    refunded("evt_hf_refund_err");
    scenario.reads.jobs = { rows: [{ id: "job-r", customer_id: "p", helper_id: "h", title: "Job", payment_status: "escrow" }] };
    scenario.rpcErrors = { ...(scenario.rpcErrors ?? {}), [RESTORE]: { message: "boom", code: "XX000" } };
    const res = await post(fn);
    expect(res.status).toBe(200);
    expect(restoreCalls()).toHaveLength(1);
  });
});

describe("transfer.reversed gives it back only on a FULL reversal that is not a clawback", () => {
  function reversed(id: string, transfer: Record<string, unknown>) {
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id,
      type: "transfer.reversed",
      data: { object: { id: "tr_hf", amount: 4631, destination: "acct_h", metadata: { job_id: "job-t" }, ...transfer } },
    });
    scenario.reads.payout_transfers = { rows: [{ metadata: { helpr_fault_fee_cents: 369 } }] };
    scenario.writeSelectRows.payout_transfers = [{ job_id: "job-t" }];
    scenario.writeSelectRows["jobs:update"] = [{ id: "job-t" }];
    scenario.reads.chargeback_clawbacks = { rows: [] };
  }

  it("a full reversal by hand calls restore for the job", async () => {
    const fn = await loadWebhook();
    reversed("evt_hf_rev_full", { reversed: true, amount_reversed: 4631 });
    await post(fn);
    expect(restoreCalls().map((c) => c.args)).toEqual([{ p_job_id: "job-t" }]);
  });

  it("a partial reversal keeps the deduction (the Helpr kept part of a transfer that withheld it)", async () => {
    const fn = await loadWebhook();
    reversed("evt_hf_rev_part", { reversed: false, amount_reversed: 1000 });
    await post(fn);
    expect(restoreCalls()).toHaveLength(0);
  });

  it("an unreadable clawback lookup gives nothing back (it may be a clawback a won dispute repays)", async () => {
    const fn = await loadWebhook();
    reversed("evt_hf_rev_lookupfail", { reversed: true, amount_reversed: 4631 });
    scenario.reads.chargeback_clawbacks = { error: { message: "connection reset" } };
    await post(fn);
    expect(restoreCalls()).toHaveLength(0);
  });

  it("a card-dispute clawback is not given back (a won dispute repays it net of the fee)", async () => {
    const fn = await loadWebhook();
    reversed("evt_hf_rev_claw", { reversed: true, amount_reversed: 4631 });
    scenario.reads.chargeback_clawbacks = { rows: [{ dispute_id: "dp_1", status: "reversed" }] };
    await post(fn);
    expect(restoreCalls()).toHaveLength(0);
  });
});

describe("a LOST card dispute gives it back", () => {
  it("charge.dispute.closed lost calls restore for the job", async () => {
    const fn = await loadWebhook();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_hf_lost",
      type: "charge.dispute.closed",
      data: { object: { id: "dp_hf", status: "lost", amount: 5000, payment_intent: "pi_disputed", charge: "ch_d" } },
    });
    stripeMock.charges.retrieve.mockResolvedValue({ id: "ch_d", amount: 5000, amount_captured: 5000 });
    scenario.reads.jobs = { rows: [{
      id: "job-lost", customer_id: "p", helper_id: "h", title: "Gutter clean",
      dispute_status: null, disputed_at: "2026-09-20T00:00:00.000Z",
      payment_status: "chargeback", status: "completed", payout_scheduled_at: null,
    }] };
    scenario.rpc.settle_dispute_by_chargeback = { outcome: "no_unsettled_dispute" };
    await post(fn);
    expect(restoreCalls().map((c) => c.args)).toEqual([{ p_job_id: "job-lost" }]);
  });

  it("a WON dispute gives nothing back", async () => {
    const fn = await loadWebhook();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_hf_won",
      type: "charge.dispute.closed",
      data: { object: { id: "dp_hf_w", status: "won", amount: 5000, payment_intent: "pi_disputed", charge: "ch_d" } },
    });
    scenario.reads.jobs = { rows: [{
      id: "job-won", customer_id: "p", helper_id: "h", title: "Gutter clean",
      dispute_status: null, disputed_at: null,
      payment_status: "chargeback", status: "completed", payout_scheduled_at: null,
    }] };
    await post(fn);
    expect(restoreCalls()).toHaveLength(0);
  });
});

describe("money-reconciliation: helpr_fault_deduction_not_collected", () => {
  const CRON_SECRET = "cron-secret";
  const HOUR = 3_600_000;
  async function loadRecon(): Promise<EdgeHarness> {
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
    return JSON.parse(await res.text()) as Record<string, any>;
  }
  const finding = (b: Record<string, any>) =>
    (b.findings as Array<{ check: string; severity: string; count: number; sample: any[] }>).find((f) => f.check === "helpr_fault_deduction_not_collected");
  function seed(ageHours: number, payoutRows: Array<Record<string, unknown>>) {
    scenario.reads.jobs = { rows: [] };
    scenario.reads.disputes = { rows: [] };
    scenario.reads.profiles = { rows: [] };
    scenario.reads.gift_cards = { rows: [] };
    scenario.reads.payment_refunds = { rows: [] };
    scenario.reads.payout_transfers = { rows: payoutRows };
    scenario.reads.job_helpr_fault_fee_deductions = { rows: [
      { ruling_id: "rul-1", payout_ref: "job_payout_job-x", deducted_cents: 369, created_at: new Date(Date.now() - ageHours * HOUR).toISOString() },
    ] };
    scenario.reads.job_helpr_fault_rulings = { rows: [{ id: "rul-1", helper_id: "h-1", job_id: "job-fault" }] };
  }

  it("pages CRITICAL for an old deduction no settled payout withheld (a stuck pending claim, then a refund)", async () => {
    const fn = await loadRecon();
    seed(5, [{ job_id: "job-x", helper_id: "h-1", status: "pending", amount_cents: 4600, metadata: { helpr_fault_fee_cents: 369 } }]);
    const b = await run(fn);
    expect(b.checks_run).toContain("helpr_fault_deduction_not_collected");
    const f = finding(b);
    expect(f).toMatchObject({ severity: "critical", count: 1 });
    expect(f!.sample[0]).toMatchObject({ job_id: "job-x", helper_id: "h-1", ruling_id: "rul-1", payout_rows: "pending" });
  });

  it("pages for a FULLY reversed payout (it collected nothing) unless a won dispute re-paid it", async () => {
    let fn = await loadRecon();
    seed(5, [{ job_id: "job-x", helper_id: "h-1", status: "reversed", stripe_transfer_id: "tr_o", amount_cents: 4600, metadata: { helpr_fault_fee_cents: 369, fully_reversed: true } }]);
    expect(finding(await run(fn))).toMatchObject({ count: 1 });

    resetSupabaseMock(); resetSharedMocks(); resetStripeMock();
    fn = await loadRecon();
    seed(5, [
      { job_id: "job-x", helper_id: "h-1", status: "reversed", stripe_transfer_id: "tr_o", amount_cents: 4600, metadata: { helpr_fault_fee_cents: 369, fully_reversed: true } },
      { job_id: "job-x", helper_id: "h-1", status: "paid", stripe_transfer_id: "tr_repay", amount_cents: 4600, metadata: { original_transfer_id: "tr_o" } },
    ]);
    expect(finding(await run(fn))).toBeUndefined();
  });

  it("pages when the paid row records no withheld fee", async () => {
    const fn = await loadRecon();
    seed(5, [{ job_id: "job-x", helper_id: "h-1", status: "paid", amount_cents: 4600, metadata: {} }]);
    expect(finding(await run(fn))).toMatchObject({ count: 1 });
  });

  it("is quiet when a paid payout row withheld it, and for a deduction still inside its window", async () => {
    let fn = await loadRecon();
    seed(5, [{ job_id: "job-x", helper_id: "h-1", status: "paid", amount_cents: 4600, metadata: { helpr_fault_fee_cents: 369 } }]);
    let b = await run(fn);
    expect(b.checks_run).toContain("helpr_fault_deduction_not_collected");
    expect(finding(b)).toBeUndefined();

    resetSupabaseMock(); resetSharedMocks(); resetStripeMock();
    fn = await loadRecon();
    seed(0.5, []);
    b = await run(fn);
    expect(finding(b)).toBeUndefined();
  });

  it("inventory floor: every give-back site is wired (refund, full reversal, lost dispute)", async () => {
    const { readFileSync } = await import("node:fs");
    const sites = [
      "supabase/functions/stripe-webhook/handlers/chargeRefunded.ts",
      "supabase/functions/stripe-webhook/handlers/transferReversed.ts",
      "supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts",
    ].filter((p) => /await restoreHelprFaultFeeForJob\(/.test(readFileSync(p, "utf8")));
    expect(sites.length).toBeGreaterThan(2);
  });
});
