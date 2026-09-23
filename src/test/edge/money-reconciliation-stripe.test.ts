/**
 * money-reconciliation: the DB's "settled" vs Stripe's own PaymentIntent
 * (docs/OPEN.md Q50).
 *
 * THE GAP. Q31 closed "no card holds left on cancelled jobs" by reading the
 * DB: 79 cancelled jobs with a PaymentIntent, every one payment_status
 * 'cancelled'/'refunded'. That is the DB grading itself. The settlement paths
 * (void-cancelled-payments, create-payment cancel_escrow) only ever select jobs
 * still in 'escrow', so a job flipped to settled while its money stayed at
 * Stripe — a live hold, a captured charge never refunded — is never looked at
 * again, and every existing reconciler check agreed with it. A one-off Stripe
 * read on 2026-09-23 found the 79 genuinely settled (0 requires_capture; all
 * captured then refunded, each refund equal to its payment_refunds row); this
 * file pins the standing comparison that would notice the day they are not.
 *
 * Runs the REAL function source through the edge harness (with the real
 * `_shared/cancellationFee.ts` and `_shared/stripeFees.ts`), Stripe mocked.
 *
 * RED WITH THE COMPARISON REMOVED — each mutation below turns a named test red:
 * @mutate supabase/functions/money-reconciliation/index.ts | if (pi.status === "requires_capture" \|\| pi.status === "processing") { | if (false) {
 * @mutate supabase/functions/money-reconciliation/index.ts | if (retainedCents > maxRetainedCents + 1) { | if (false) {
 * @mutate supabase/functions/money-reconciliation/index.ts | if (refundedCents < ledgerRefunded) { | if (false) {
 * @mutate supabase/functions/money-reconciliation/index.ts | if (refundedCents > ledgerRefunded) { | if (false) {
 * @mutate supabase/functions/money-reconciliation/index.ts | if (decidedBySplit === null ? job.dispute_status != null : decidedBySplit.has(job.id as string)) return; | if (job.dispute_status != null) return;
 * @mutate supabase/functions/money-reconciliation/index.ts | if (capturedCents !== receivedCents) { | if (false) {
 * @mutate supabase/functions/money-reconciliation/index.ts | if (Date.now() - stripeStartedMs > STRIPE_PHASE_BUDGET_MS) { | if (false) {
 * @mutate supabase/functions/money-reconciliation/index.ts | (j.payment_status === "cancelled" \|\| j.payment_status === "refunded") && | false &&
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { computeCancellationFee } from "../../../supabase/functions/_shared/cancellationFee";
import { jobLocalDateISO } from "../helpers/jobLocalDate";

const CRON_SECRET = "cron-secret";
const DAY = 86_400_000;

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

/** A $25 job with a $3 service fee, cancelled by the poster yesterday with no Helpr committed. */
function cancelledJob(over: Record<string, unknown> = {}) {
  return {
    id: "job-c",
    is_seed: false,
    status: "cancelled",
    payment_status: "cancelled",
    budget: 25,
    customer_fee_amount: 3,
    stripe_payment_intent_id: "pi_c",
    date_needed: new Date(Date.now() + 5 * DAY).toISOString(),
    start_time: null,
    cancelled_at: new Date(Date.now() - DAY).toISOString(),
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
    updated_at: new Date(Date.now() - DAY).toISOString(),
    ...over,
  };
}

/** The shape Stripe returned for all 79 prod jobs on 2026-09-23: $28 captured, $25 refunded, $1.11 fee. */
function refundedPi(over: { piStatus?: string; refunded?: number; captured?: number; fee?: number } = {}) {
  const captured = over.captured ?? 2800;
  return {
    id: "pi_c",
    status: over.piStatus ?? "succeeded",
    amount: captured,
    amount_received: captured,
    amount_capturable: 0,
    latest_charge: {
      id: "ch_c",
      amount_captured: captured,
      amount_refunded: over.refunded ?? 2500,
      balance_transaction: { fee: over.fee ?? 111 },
    },
  };
}

function seed(job = cancelledJob(), ledgerCents: number | null = 2500) {
  scenario.reads.jobs = { rows: [job] };
  scenario.reads.payout_transfers = { rows: [] };
  scenario.reads.disputes = { rows: [] };
  scenario.reads.profiles = { rows: [] };
  scenario.reads.gift_cards = { rows: [] };
  scenario.reads.payment_refunds = {
    rows: ledgerCents === null ? [] : [{ job_id: job.id, amount_cents: ledgerCents }],
  };
}

const finding = (b: Record<string, any>, check: string) =>
  (b.findings as Array<{ check: string; severity: string; count: number }>).find((f) => f.check === check);

describe("money-reconciliation — settled jobs vs Stripe (Q50)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
  });

  it("asks Stripe about every settled job and stays silent when Stripe agrees", async () => {
    const fn = await load();
    seed();
    stripeMock.paymentIntents.retrieve.mockResolvedValue(refundedPi());

    const { res, b } = await run(fn);

    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledTimes(1);
    expect(stripeMock.paymentIntents.retrieve.mock.calls[0][0]).toBe("pi_c");
    expect(b.scanned.stripe_payment_intents).toBe(1);
    expect(b.checks_run).toEqual(expect.arrayContaining([
      "stripe_money_live_on_settled_job",
      "stripe_charge_not_refunded_on_cancelled_job",
      "stripe_refund_recorded_not_at_stripe",
      "stripe_refund_untracked",
      "stripe_payment_intent_not_found",
      "stripe_charge_not_the_payment",
    ]));
    expect(res.status).toBe(200);
    expect(b.clean).toBe(true);
    expect(slackAlerts).toHaveLength(0);
  });

  it("pages CRITICAL when a settled job's card hold is still live at Stripe", async () => {
    const fn = await load();
    seed(cancelledJob(), null);
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      ...refundedPi({ piStatus: "requires_capture" }),
      amount_capturable: 2800,
      latest_charge: null,
    });

    const { res, b } = await run(fn);

    expect(finding(b, "stripe_money_live_on_settled_job")).toMatchObject({ severity: "critical", count: 1 });
    expect(res.status).toBe(500);
    expect(b.ok).toBe(false);
    expect(slackAlerts.some((a: any) => a.severity === "critical")).toBe(true);
  });

  it("pages CRITICAL when a cancelled job's charge was captured and never refunded", async () => {
    const fn = await load();
    seed(cancelledJob(), null);
    stripeMock.paymentIntents.retrieve.mockResolvedValue(refundedPi({ refunded: 0 }));

    const { res, b } = await run(fn);

    expect(finding(b, "stripe_charge_not_refunded_on_cancelled_job")).toMatchObject({ severity: "critical", count: 1 });
    // The ledger agrees with Stripe (both 0), so this is not ALSO a ledger finding.
    expect(finding(b, "stripe_refund_recorded_not_at_stripe")).toBeUndefined();
    expect(finding(b, "stripe_refund_untracked")).toBeUndefined();
    expect(res.status).toBe(500);
  });

  it("lets the platform keep exactly the owed cancellation fee + service fee, and not a cent more", async () => {
    // Committed Helpr, cancelled 5h before the job: the ladder owes a
    // fee, so the platform legitimately keeps more than the service fee. The
    // ceiling is derived from the SAME module void-cancelled-payments settles
    // with, so a ladder change moves both together.
    const job = cancelledJob({
      helper_id: "helper-1",
      helper_confirmed_at: new Date(Date.now() - 3 * DAY).toISOString(),
      // Noon (Louisiana) two days ago, cancelled at 07:00 local that morning.
      date_needed: jobLocalDateISO(-2),
      start_time: "12:00",
      // 12:00Z is 06:00-07:00 Central: 5-6h before the job, inside the <24h tier.
      cancelled_at: `${jobLocalDateISO(-2)}T12:00:00Z`,
      payment_status: "refunded",
    });
    const feeCents = Math.round(computeCancellationFee(job as never) * 100);
    expect(feeCents).toBeGreaterThan(0);
    const ceiling = feeCents + 300; // $3 service fee > $1.11 Stripe fee
    const atCeiling = 2800 - ceiling;

    let fn = await load();
    seed(job, atCeiling);
    stripeMock.paymentIntents.retrieve.mockResolvedValue(refundedPi({ refunded: atCeiling }));
    expect(finding((await run(fn)).b, "stripe_charge_not_refunded_on_cancelled_job")).toBeUndefined();

    resetSupabaseMock(); resetSharedMocks(); resetStripeMock();
    fn = await load();
    seed(job, atCeiling - 2);
    stripeMock.paymentIntents.retrieve.mockResolvedValue(refundedPi({ refunded: atCeiling - 2 }));
    expect(finding((await run(fn)).b, "stripe_charge_not_refunded_on_cancelled_job")).toMatchObject({ count: 1 });
  });

  it("does not grade a job whose refund an executed dispute split decided", async () => {
    // Prod job e7e09075 (2026-09-23): dispute decided {poster:1,helper:0},
    // execution_status 'executed', $26.89 of $28 refunded. A split decision
    // may keep far more than the ladder; only the ledger is compared.
    const fn = await load();
    seed(cancelledJob({ payment_status: "refunded", dispute_status: "resolved" }), 500);
    scenario.reads.disputes = { rows: [{ job_id: "job-c", status: "decided", execution_status: "executed" }] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue(refundedPi({ refunded: 500 }));

    const { b } = await run(fn);
    expect(finding(b, "stripe_charge_not_refunded_on_cancelled_job")).toBeUndefined();
  });

  it("DOES grade a withdrawn-then-cancelled job: a withdrawal leaves dispute_status='resolved' forever", async () => {
    // rpc_withdraw_dispute stamps jobs.dispute_status='resolved' and
    // poster_cancel_job later cancels normally without touching it. The refund
    // on that job is the cancellation ladder's, not a split's.
    const fn = await load();
    seed(cancelledJob({ dispute_status: "resolved" }), 0);
    scenario.reads.disputes = { rows: [{ job_id: "job-c", status: "withdrawn", execution_status: null }] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue(refundedPi({ refunded: 0 }));

    const { res, b } = await run(fn);
    expect(finding(b, "stripe_charge_not_refunded_on_cancelled_job")).toMatchObject({ severity: "critical", count: 1 });
    expect(res.status).toBe(500);
  });

  it("an unreadable disputes table degrades the run and falls back to skipping any job with a dispute_status", async () => {
    const fn = await load();
    seed(cancelledJob({ dispute_status: "resolved" }), 0);
    scenario.reads.disputes = { error: { message: "boom", code: "XX000" } };
    stripeMock.paymentIntents.retrieve.mockResolvedValue(refundedPi({ refunded: 0 }));

    const { b } = await run(fn);
    expect(finding(b, "stripe_charge_not_refunded_on_cancelled_job")).toBeUndefined();
    expect(b.ok).toBe(false);
    expect((b.notes as string[]).join(" ")).toMatch(/dispute-split lookup failed/);
  });

  it("warns when Stripe refunded MORE than the payment_refunds ledger records (an untracked refund)", async () => {
    const fn = await load();
    seed(cancelledJob(), null); // refund went out, no ledger row
    stripeMock.paymentIntents.retrieve.mockResolvedValue(refundedPi());

    const { b } = await run(fn);
    const f = finding(b, "stripe_refund_untracked") as any;
    expect(f).toMatchObject({ severity: "warning", count: 1 });
    expect(f.sample[0]).toMatchObject({ direction: "stripe_more_than_ledger", stripe_refunded_cents: 2500, ledger_refunded_cents: 0, difference_cents: 2500 });
    expect(finding(b, "stripe_refund_recorded_not_at_stripe")).toBeUndefined();
  });

  it("pages CRITICAL when the ledger records a refund Stripe never sent (the poster is owed money)", async () => {
    const fn = await load();
    seed(cancelledJob(), 2500);
    // Ledger says $25 went back; Stripe refunded only $10. The ceiling check
    // also fires here; the ledger finding is what names the missing refund.
    stripeMock.paymentIntents.retrieve.mockResolvedValue(refundedPi({ refunded: 1000 }));

    const { res, b } = await run(fn);
    const f = finding(b, "stripe_refund_recorded_not_at_stripe") as any;
    expect(f).toMatchObject({ severity: "critical", count: 1 });
    expect(f.sample[0]).toMatchObject({ direction: "ledger_more_than_stripe", stripe_refunded_cents: 1000, ledger_refunded_cents: 2500, difference_cents: 1500 });
    expect(finding(b, "stripe_refund_untracked")).toBeUndefined();
    expect(res.status).toBe(500);
  });

  it("warns when the PaymentIntent's latest charge is not the one that took its money (more than one charge)", async () => {
    const fn = await load();
    seed();
    const pi = refundedPi();
    // amount_received 2800, but latest_charge only captured 1500: a second
    // charge holds the rest, and every figure read from latest_charge is partial.
    pi.latest_charge.amount_captured = 1500;
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi);

    const { b } = await run(fn);
    const f = finding(b, "stripe_charge_not_the_payment") as any;
    expect(f).toMatchObject({ severity: "warning", count: 1 });
    expect(f.sample[0]).toMatchObject({ amount_received_cents: 2800, latest_charge_captured_cents: 1500 });
    // Not graded on partial numbers.
    expect(finding(b, "stripe_charge_not_refunded_on_cancelled_job")).toBeUndefined();
    expect(finding(b, "stripe_refund_untracked")).toBeUndefined();
  });

  it("warns when the PaymentIntent does not exist for this key (test/live mismatch)", async () => {
    const fn = await load();
    seed();
    stripeMock.paymentIntents.retrieve.mockRejectedValue(Object.assign(new Error("No such payment_intent"), { statusCode: 404, code: "resource_missing" }));

    const { b } = await run(fn);
    expect(finding(b, "stripe_payment_intent_not_found")).toMatchObject({ severity: "warning", count: 1 });
  });

  it("a Stripe read that FAILS is degraded, never clean", async () => {
    const fn = await load();
    seed();
    stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error("connection reset"));

    const { res, b } = await run(fn);
    expect(b.clean).toBe(true); // no findings…
    expect(b.ok).toBe(false); // …but not ok: the job was never verified
    expect(res.status).toBe(500);
    expect((b.notes as string[]).join(" ")).toMatch(/stripe comparison incomplete: 1 of 1/);
  });

  it("a missing STRIPE_SECRET_KEY is degraded when there is something to check", async () => {
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET });
    const fn = await loadEdgeFunction("money-reconciliation");
    seed();
    const { b } = await run(fn);
    expect(b.ok).toBe(false);
    expect((b.notes as string[]).join(" ")).toMatch(/STRIPE_SECRET_KEY not set/);
  });

  it("skips jobs settled more than 30 days ago and jobs still in escrow", async () => {
    const fn = await load();
    seed(cancelledJob({ cancelled_at: new Date(Date.now() - 40 * DAY).toISOString(), updated_at: new Date(Date.now() - 40 * DAY).toISOString() }));
    scenario.reads.jobs!.rows!.push(cancelledJob({ id: "job-e", payment_status: "escrow", cancelled_at: new Date(Date.now() - 600_000).toISOString() }));
    const { b } = await run(fn);
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(b.scanned.settled_jobs_with_payment_intent).toBe(0);
  });

  describe("time budget", () => {
    afterEach(() => vi.restoreAllMocks());
    it("stops the Stripe phase at its time budget and reports the unchecked jobs as a truncated scan", async () => {
      const fn = await load();
      const jobs = Array.from({ length: 25 }, (_, i) => cancelledJob({ id: `job-${i}`, stripe_payment_intent_id: `pi_${i}` }));
      seed(jobs[0]);
      scenario.reads.jobs = { rows: jobs };
      scenario.reads.payment_refunds = { rows: jobs.map((j) => ({ job_id: j.id, amount_cents: 2500 })) };
      const realNow = Date.now.bind(Date);
      let skew = 0;
      vi.spyOn(Date, "now").mockImplementation(() => realNow() + skew);
      // Each read "takes" 3s of wall clock: the first round of 10 spends 30s.
      stripeMock.paymentIntents.retrieve.mockImplementation(async () => { skew += 3_000; return refundedPi(); });

      const { res, b } = await run(fn);
      expect(stripeMock.paymentIntents.retrieve.mock.calls.length).toBeLessThan(25);
      expect((b.scan_caps as string[]).join(" ")).toMatch(/stripe comparison stopped at its \d+s budget: \d+ of 25 checked/);
      expect(b.ok).toBe(false);
      expect(res.status).toBe(500);
    });
  });

  it("is READ-ONLY at Stripe: retrieve only, never a refund, capture, cancel or transfer", async () => {
    const fn = await load();
    seed(cancelledJob(), null);
    stripeMock.paymentIntents.retrieve.mockResolvedValue(refundedPi({ piStatus: "requires_capture" }));
    await run(fn);
    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalled();
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(scenario.writes.filter((w) => w.table !== "error_logs")).toHaveLength(0);
  });
});
