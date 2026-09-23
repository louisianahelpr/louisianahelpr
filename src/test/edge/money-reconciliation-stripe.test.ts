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
 * @mutate supabase/functions/money-reconciliation/index.ts | if (ledgerCents && refundedCents !== (ledgerCents.get(job.id as string) ?? 0)) { | if (false) {
 * @mutate supabase/functions/money-reconciliation/index.ts | (j.payment_status === "cancelled" \|\| j.payment_status === "refunded") && | false &&
 */
import { describe, it, expect, beforeEach } from "vitest";
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
      "stripe_refund_ledger_mismatch",
      "stripe_payment_intent_not_found",
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
    expect(finding(b, "stripe_refund_ledger_mismatch")).toBeUndefined();
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

  it("does not grade a disputed job against the cancellation ceiling", async () => {
    // Prod job e7e09075 (2026-09-23): an admin dispute refund of $26.89 of $28.
    // A split decision may keep far more; only the ledger is compared.
    const fn = await load();
    seed(cancelledJob({ payment_status: "refunded", dispute_status: "resolved" }), 500);
    stripeMock.paymentIntents.retrieve.mockResolvedValue(refundedPi({ refunded: 500 }));

    const { b } = await run(fn);
    expect(finding(b, "stripe_charge_not_refunded_on_cancelled_job")).toBeUndefined();
  });

  it("warns when Stripe's refunded total disagrees with the payment_refunds ledger", async () => {
    const fn = await load();
    seed(cancelledJob(), null); // refund went out, no ledger row
    stripeMock.paymentIntents.retrieve.mockResolvedValue(refundedPi());

    const { b } = await run(fn);
    expect(finding(b, "stripe_refund_ledger_mismatch")).toMatchObject({ severity: "warning", count: 1 });
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
