// @mutate supabase/functions/void-cancelled-payments/index.ts |         jobCancellationFee = sellerFault \|\| raceChargedNobodyHired \|\| refundsSeriesVisitInFull(job) \|\| noFeeRecorded ? 0 : computeCancellationFee(job); |         jobCancellationFee = raceChargedNobodyHired \|\| refundsSeriesVisitInFull(job) ? 0 : computeCancellationFee(job);
// @mutate supabase/functions/_shared/posterCancelSplit.ts |     actualFeeCents: noCardFee ? 0 : c.actualFeeCents, |     actualFeeCents: c.actualFeeCents,
// @mutate supabase/functions/void-cancelled-payments/index.ts |         if (faultErr && !notDeployed) { |         if (false) {
// @mutate supabase/functions/void-cancelled-payments/index.ts |           if (sellerFault) { |           if (sellerFault && refundAmount > 0 && !alreadyRefunded) {
// @mutate supabase/functions/void-cancelled-payments/index.ts |         if (withheldForSeller > 0) { |         if (false) {
// @mutate supabase/functions/void-cancelled-payments/index.ts |               results.push({ job_id: job.id, title: job.title, status: "seller_fee_debt_failed" });\n              continue; |               results.push({ job_id: job.id, title: job.title, status: "seller_fee_debt_failed" });
// @mutate supabase/functions/void-cancelled-payments/index.ts |                 ...(sellerFault ? { seller_fault: "yes", seller_fee_cents: unbilledSellerFeeCents } : {}), |                 ...({}),
// @mutate supabase/functions/void-cancelled-payments/index.ts |             const unbilledSellerFeeCents = sellerFault ? actualOrEstimatedFeeCents(pi, capturedCents) : 0; |             const unbilledSellerFeeCents = 0;
// @mutate supabase/functions/void-cancelled-payments/index.ts |         retrievedPi = pi;\n | \n
// @mutate supabase/functions/void-cancelled-payments/index.ts |               results.push({ job_id: job.id, title: job.title, status: "already_refunded_seller_fee_debt_failed" });\n              continue; |               results.push({ job_id: job.id, title: job.title, status: "already_refunded_seller_fee_debt_failed" });
// @mutate supabase/functions/void-cancelled-payments/index.ts |           const billSellerBeforeSettling = sellerFault; |           const billSellerBeforeSettling = false;
/**
 * A10 (owner rule, 2026-10-17): a Declutter refund that is the SELLER's fault
 * cancels the buyer's linked Helpr setup job (declutter_refund_cancels_setup_jobs,
 * 20261017073146) and marks declutter_order_jobs.seller_fault_refund_id. The
 * sweep recomputes the cancellation fee itself, so it must read that marker:
 *   - a marked job pays the Helpr NO cancellation fee and refunds the poster
 *     IN FULL, card fee included, keeping only a first job's one-time setup fee
 *     (lead decision: never refunded once onboarding is done);
 *   - the card fee Stripe kept is billed to the seller ONCE, after the refund,
 *     through declutter_setup_job_fee_debt; a failed bill leaves the job in
 *     escrow (the refund ledger stops a second refund) and pages ops, and a
 *     re-run with the refund already on the ledger bills it then;
 *   - a marker read error moves NO money; a marker table that is not deployed
 *     reads "not marked" (the ordinary fee and card-fee rules).
 * Against the REAL function source, with the job shape of banSettle.test.ts.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock, PAYABLE_CONNECT_ACCOUNT } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";

const CRON_SECRET = "cron-secret-a10";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_a10",
    CRON_SECRET,
  });
  return loadEdgeFunction("void-cancelled-payments");
}
const cronReq = () =>
  new Request("https://x/functions/v1/void-cancelled-payments", {
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });

const STRIPE_FEE = 668;

/**
 * A $200 setup job with a committed Helpr, cancelled 10 hours out (the 25% tier
 * = $50 for an ordinary poster cancel), captured $200 + $20 card-cost fee line
 * (+ $2 setup fee when `setupFee`).
 */
function seed(opts: { marker: { rows?: Array<Record<string, unknown>>; error?: { message: string; code?: string } }; setupFee?: boolean }) {
  scenario.reads.jobs = {
    selectOverrides: [
      {
        includes: "cancellation_fee",
        result: {
          rows: [{
            id: "job-a10",
            title: "Assemble a bookshelf",
            stripe_session_id: null,
            stripe_payment_intent_id: "pi_a10",
            budget: 200,
            customer_fee_amount: 20,
            onboarding_fee_amount: opts.setupFee ? 2 : 0,
            cancellation_fee: 0,
            date_needed: "2024-06-25",
            start_time: "10:00:00",
            cancelled_at: "2024-06-25T05:00:00Z",
            helper_id: "helper-1",
            helper_confirmed_at: "2024-06-20T12:00:00Z",
            customer_id: "poster-1",
            helper_fee_percent: 10,
            is_group_job: false,
            helpers_needed: 1,
          }],
        },
      },
    ],
    rows: [],
  };
  scenario.reads.declutter_order_jobs = opts.marker.error ? { rows: [], error: opts.marker.error } : { rows: opts.marker.rows ?? [] };
  scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper", subscription_tier: null }] };
  const captured = 22000 + (opts.setupFee ? 200 : 0);
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_a10", status: "succeeded", amount: captured, amount_received: captured,
    latest_charge: { id: "ch_a10", balance_transaction: { fee: STRIPE_FEE } },
  });
  stripeMock.refunds.create.mockResolvedValue({ id: "re_a10", amount: 1 });
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_a10_fee" });
  scenario.rpc.declutter_setup_job_fee_debt = STRIPE_FEE;
  return captured;
}
const MARKED = { rows: [{ seller_fault_refund_id: "refund-1" }] };
const debtCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "declutter_setup_job_fee_debt");
const settledRefunded = () =>
  scenario.writes.some((w) => w.table === "jobs" && w.op === "update" && (w.payload as { payment_status?: string }).payment_status === "refunded");

describe("void-cancelled-payments: a setup job a Declutter seller's backing out cancelled (A10)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock(); stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT);
    resetSharedMocks();
  });

  it("pays no cancellation fee, refunds every cent (card fee included) and bills the seller the card fee once", async () => {
    const captured = seed({ marker: MARKED });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_a10", amount: captured },
      { idempotencyKey: "cancel-refund-job-a10" },
    );
    expect(debtCalls().map((c) => c.args)).toEqual([{ p_job_id: "job-a10", p_card_fee_cents: STRIPE_FEE }]);
    expect(settledRefunded()).toBe(true);
  });

  it("keeps only a first job's one-time $2 setup fee (lead decision: never refunded once onboarding is done)", async () => {
    const captured = seed({ marker: MARKED, setupFee: true });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_a10", amount: captured - 200 },
      { idempotencyKey: "cancel-refund-job-a10" },
    );
    expect(debtCalls()).toHaveLength(1);
  });

  // Q1966 (lh-money-escrow review of the train's rebase resolution): A10 + Q1675 together. An earlier partial refund
  // on the charge is taken off the refund (alreadyRefundedCents), the setup fee is still kept, and the seller is still
  // billed the card fee Stripe kept: captured $222.00, $30.00 refunded earlier, $2 setup fee -> $190.00 back.
  // @mutate supabase/functions/void-cancelled-payments/index.ts |               alreadyRefundedCents: chargeRefundedCents,\n              taxCents: await chargeTaxCentsFor(stripe, pi), |               alreadyRefundedCents: 0,\n              taxCents: await chargeTaxCentsFor(stripe, pi),
  it("a charge with an earlier partial refund: refunds the rest less the setup fee, and still bills the seller", async () => {
    const captured = seed({ marker: MARKED, setupFee: true });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_a10", status: "succeeded", amount: captured, amount_received: captured,
      latest_charge: { id: "ch_a10", amount_refunded: 3000, balance_transaction: { fee: STRIPE_FEE } },
    });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_a10", amount: captured - 3000 - 200 },
      { idempotencyKey: "cancel-refund-job-a10" },
    );
    expect(debtCalls().map((c) => c.args)).toEqual([{ p_job_id: "job-a10", p_card_fee_cents: STRIPE_FEE }]);
    expect(settledRefunded()).toBe(true);
  });

  it("the committed Helpr's withheld late-cancel fee is paged to ops, once a day per job", async () => {
    seed({ marker: MARKED });
    const h = await load();
    await h.fetch(cronReq());
    const page = (slackAlerts as Array<{ title: string; fields?: Record<string, unknown> }>).find((a) => /Declutter seller's fault cancelled/.test(a.title));
    expect(page, JSON.stringify(slackAlerts)).toBeDefined();
    expect(page!.fields).toMatchObject({ job_id: "job-a10", helper_id: "helper-1", withheld_fee: 50 });
  });

  it("an unmarked job keeps the ordinary rules: the Helpr's fee, the card fee kept, no seller bill", async () => {
    const captured = seed({ marker: { rows: [] } });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_a10", amount: captured - 5000 - 2000 },
      { idempotencyKey: "cancel-refund-job-a10" },
    );
    expect(debtCalls()).toEqual([]);
  });

  it("a marker table not deployed yet (42P01) reads as not marked", async () => {
    const captured = seed({ marker: { error: { message: 'relation "public.declutter_order_jobs" does not exist', code: "42P01" } } });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_a10", amount: captured - 5000 - 2000 },
      { idempotencyKey: "cancel-refund-job-a10" },
    );
    expect(debtCalls()).toEqual([]);
  });

  it("any other marker read error moves NO money for the job this run", async () => {
    seed({ marker: { error: { message: "canceling statement due to statement timeout", code: "57014" } } });
    const h = await load();
    const res = await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(debtCalls()).toEqual([]);
    expect(settledRefunded()).toBe(false);
    expect(JSON.stringify(await res.json())).toContain("seller_fault_marker_read_failed");
  });

  it("a failed seller bill leaves the job in escrow (no settle) and pages ops; the refund is not repeated", async () => {
    seed({ marker: MARKED });
    scenario.rpcErrors = { declutter_setup_job_fee_debt: { message: "boom", code: "XX000" } };
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(settledRefunded()).toBe(false);
    const page = (slackAlerts as Array<{ title: string; fields?: Record<string, unknown> }>).find((a) => /seller not billed/.test(a.title));
    expect(page, JSON.stringify(slackAlerts)).toBeDefined();
    expect(page!.fields).toMatchObject({ job_id: "job-a10", seller_fee_cents: STRIPE_FEE });
  });

  // Q1965: the refunded-past-kept-fees skip stops before the seller's card-fee bill, so its page must say this is a
  // seller fault and name the unbilled amount (whoever reconciles it bills the seller too).
  it("a charge already refunded past what the cancel keeps: the skip page names the seller fault and the unbilled fee", async () => {
    const captured = seed({ marker: MARKED, setupFee: true });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_a10", status: "succeeded", amount: captured, amount_received: captured,
      latest_charge: { id: "ch_a10", amount_refunded: captured, balance_transaction: { fee: STRIPE_FEE } },
    });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(debtCalls()).toEqual([]);
    const page = (slackAlerts as Array<{ title: string; message?: string; fields?: Record<string, unknown> }>).find((a) => /already refunded past/.test(a.title));
    expect(page, JSON.stringify(slackAlerts)).toBeDefined();
    expect(page!.fields).toMatchObject({ job_id: "job-a10", seller_fault: "yes", seller_fee_cents: STRIPE_FEE });
    expect(page!.message).toContain("seller-fault setup job: the seller's $6.68 card-fee debt was NOT billed");
  });

  // Q1940 (b): Stripe says the charge "has already been refunded" (a refund made elsewhere): the job still bills the
  // seller the card fee Stripe kept before it settles, and a failed bill leaves it in escrow.
  it("a charge Stripe says was already refunded still bills the seller the card fee, then settles", async () => {
    seed({ marker: MARKED });
    stripeMock.refunds.create.mockRejectedValue(new Error("Charge ch_a10 has already been refunded."));
    const h = await load();
    await h.fetch(cronReq());
    expect(debtCalls().map((c) => c.args)).toEqual([{ p_job_id: "job-a10", p_card_fee_cents: STRIPE_FEE }]);
    expect(settledRefunded()).toBe(true);
  });

  it("an already-refunded charge whose seller bill fails is not settled and pages ops", async () => {
    seed({ marker: MARKED });
    stripeMock.refunds.create.mockRejectedValue(new Error("Charge ch_a10 has already been refunded."));
    scenario.rpcErrors = { declutter_setup_job_fee_debt: { message: "boom", code: "XX000" } };
    const h = await load();
    await h.fetch(cronReq());
    expect(settledRefunded()).toBe(false);
    const page = (slackAlerts as Array<{ title: string; fields?: Record<string, unknown> }>).find((a) => /seller not billed/.test(a.title));
    expect(page, JSON.stringify(slackAlerts)).toBeDefined();
  });

  it("the next run, with the refund already on the ledger, bills the seller and settles without a second refund", async () => {
    seed({ marker: MARKED });
    scenario.reads.payment_refunds = { rows: [{ stripe_refund_id: "re_a10" }] };
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(debtCalls()).toHaveLength(1);
    expect(settledRefunded()).toBe(true);
  });
});
