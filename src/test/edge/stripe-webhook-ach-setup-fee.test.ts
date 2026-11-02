/**
 * The one-time setup fee on a bank (ACH) checkout is marked paid only when the
 * debit lands (docs/OPEN.md Q1975, part 1).
 *
 * THE BUG. checkout.session.completed called settleOnboardingFee on every
 * session that carried the fee, including an async (ACH) session that
 * completes "unpaid": the debit has only started. When the debit then bounced,
 * profiles.onboarding_fee_paid stayed true, so the member was never asked for
 * the fee again and the job carried a fee that was never collected.
 *
 * NOW. An "unpaid" session defers; payment_intent.succeeded settles the fee on
 * the write that moves the job to escrow, and only when the charge is a bank
 * debit (a card retry on the same checkout is settled by the checkout handler
 * itself; settling it twice would refund the real fee as a "duplicate").
 *
 * Runs the REAL stripe-webhook source through the edge harness, Stripe mocked.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | if (session.payment_status === "unpaid") { | if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts |         await settleDeferredSetupFee(pi, ctx, taxJob.id, taxJob.is_seed ?? false); |
 * @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts |   if (methodType !== "us_bank_account") return; |
 * @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts |   if ((pi.metadata as { onboarding_fee_charged?: string } \| null)?.onboarding_fee_charged !== "true") return; |
 * @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts |     await page("no checkout session found for this payment"); |
 * @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts |     await page("the payment's charge could not be read"); |
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks } from "./mocks/shared";

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  return loadEdgeFunction("stripe-webhook");
}

function webhookRequest(fn: EdgeHarness) {
  return fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" } });
}

const FEE_META = { job_id: "job-1", onboarding_fee_charged: "true", customer_id: "poster-1", onboarding_fee_cents: "200" };

const feeFlips = () =>
  scenario.writes.filter(
    (w) => w.table === "profiles" && w.op === "update" && (w.payload as Record<string, unknown>).onboarding_fee_paid === true,
  );

function checkoutCompleted(paymentStatus: "paid" | "unpaid") {
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({
    id: `evt_cs_${paymentStatus}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_ach",
        mode: "payment",
        customer_email: "poster@test.com",
        payment_intent: "pi_ach",
        payment_status: paymentStatus,
        metadata: FEE_META,
      },
    },
  });
}

function piSucceeded(meta: Record<string, string> = { job_id: "job-1", customer_id: "poster-1", onboarding_fee_charged: "true" }) {
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({
    id: "evt_pi_ach",
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_ach", amount: 5200, amount_details: { tax: { total_tax_amount: 0 } }, metadata: meta } },
  });
  scenario.reads.jobs = {
    rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "unpaid", status: "open", sales_tax_amount: 0, is_seed: false }],
  };
  scenario.writeSelectRows.jobs = [{ id: "job-1" }];
}

function sessionWithCharge(type: string | null) {
  stripeMock.checkout.sessions.list.mockResolvedValue({
    data: [{
      id: "cs_ach",
      payment_status: "paid",
      metadata: FEE_META,
      payment_intent: { id: "pi_ach", latest_charge: type === null ? null : { id: "ch_1", payment_method_details: { type } } },
    }],
  });
}

describe("ACH setup fee is marked paid only when the debit lands (Q1975)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("an 'unpaid' (bank debit still settling) checkout does NOT mark the setup fee paid", async () => {
    const fn = await loadConfigured();
    checkoutCompleted("unpaid");
    scenario.writeSelectRows.profiles = [{ user_id: "poster-1" }];
    await fn.fetch(webhookRequest(fn));
    expect(feeFlips()).toEqual([]);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("control: a 'paid' (card) checkout still marks it paid at once", async () => {
    const fn = await loadConfigured();
    checkoutCompleted("paid");
    scenario.writeSelectRows.profiles = [{ user_id: "poster-1" }];
    await fn.fetch(webhookRequest(fn));
    expect(feeFlips()).toHaveLength(1);
  });

  it("the bank debit landing (payment_intent.succeeded) marks the fee paid and stamps it on the job", async () => {
    const fn = await loadConfigured();
    piSucceeded();
    sessionWithCharge("us_bank_account");
    scenario.writeSelectRows.profiles = [{ user_id: "poster-1" }];
    await fn.fetch(webhookRequest(fn));
    expect(stripeMock.checkout.sessions.list).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: "pi_ach" }));
    expect(feeFlips()).toHaveLength(1);
    const stamps = scenario.writes.filter(
      (w) => w.table === "jobs" && w.op === "update" && "onboarding_fee_amount" in (w.payload as Record<string, unknown>),
    );
    expect(stamps.map((w) => w.payload)).toEqual([{ onboarding_fee_amount: 2 }]);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("a CARD payment's success never settles the fee here (the checkout handler did; a second settle would refund it)", async () => {
    const fn = await loadConfigured();
    piSucceeded();
    sessionWithCharge("card");
    scenario.writeSelectRows.profiles = [];
    await fn.fetch(webhookRequest(fn));
    expect(feeFlips()).toEqual([]);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("a payment that carried no fee never looks the session up", async () => {
    const fn = await loadConfigured();
    piSucceeded({ job_id: "job-1", customer_id: "poster-1", onboarding_fee_charged: "false" });
    sessionWithCharge("us_bank_account");
    await fn.fetch(webhookRequest(fn));
    expect(stripeMock.checkout.sessions.list).not.toHaveBeenCalled();
    expect(feeFlips()).toEqual([]);
  });

  it("no session found: ops is told to set the fee by hand (never silent), the job still funds", async () => {
    const fn = await loadConfigured();
    piSucceeded();
    stripeMock.checkout.sessions.list.mockResolvedValue({ data: [] });
    const res = await fn.fetch(webhookRequest(fn));
    expect(res.status).toBe(200);
    expect(feeFlips()).toEqual([]);
    expect((slackAlerts as Array<{ title?: string }>).some((a) => /setup fee was not recorded/.test(a.title ?? ""))).toBe(true);
  });

  it("an unreadable charge: ops is told, the fee is not guessed", async () => {
    const fn = await loadConfigured();
    piSucceeded();
    sessionWithCharge(null);
    await fn.fetch(webhookRequest(fn));
    expect(feeFlips()).toEqual([]);
    expect((slackAlerts as Array<{ title?: string }>).some((a) => /setup fee was not recorded/.test(a.title ?? ""))).toBe(true);
  });

  it("a session read that throws: ops is told, the event is still acked (the job is funded)", async () => {
    const fn = await loadConfigured();
    piSucceeded();
    stripeMock.checkout.sessions.list.mockRejectedValue(new Error("stripe down"));
    const res = await fn.fetch(webhookRequest(fn));
    expect(res.status).toBe(200);
    expect((slackAlerts as Array<{ title?: string }>).some((a) => /setup fee was not recorded/.test(a.title ?? ""))).toBe(true);
  });
});
