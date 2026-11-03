/**
 * Q1904: a cancel that runs in the seconds between a checkout funding its job
 * and settleOnboardingFee refunding a DUPLICATE $2 setup fee returned those $2
 * twice. checkoutSessionCompleted sets payment_status 'escrow', then settles
 * the fee; a cancel_escrow or void-cancelled-payments in that gap refunds
 * everything the charge does not keep, and the duplicate fee is not a kept
 * part (only the winning checkout stamps onboarding_fee_amount), so it already
 * went back. settleOnboardingFee now skips its refund when the charge carries
 * a refund AND the job is in a cancel/refund state on this payment. An admin's
 * partial refund (job still in escrow) and a failed read keep the old refund.
 *
 * Runs the REAL stripe-webhook source via the edge harness.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts |       if (await cancelAlreadyReturnedFee(session, piId, { stripe, supabase, logStep })) { |       if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts |   return j.stripe_payment_intent_id === piId && CANCELLED_PAYMENT_STATES.has(String(j.payment_status)); |   return CANCELLED_PAYMENT_STATES.has(String(j.payment_status));
 * @mutate supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts |   if (!(refundedCents > 0)) return false; |   if (false) return false;
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  return loadEdgeFunction("stripe-webhook");
}

/** A completed job checkout that carried the $2 setup fee to a member who had already paid it. */
async function deliverDuplicateFee(opts: { amountRefunded: number; jobPaymentStatus: string; jobPi?: string; retrieveThrows?: boolean }) {
  const fn = await loadConfigured();
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({
    id: "evt_q1904",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_q1904", mode: "payment", customer_email: "poster@test.com", payment_intent: "pi_q1904",
        metadata: { job_id: "job-1", onboarding_fee_charged: "true", customer_id: "poster-1", onboarding_fee_cents: "200" },
      },
    },
  });
  // The flag flip matches no rows: the fee was already paid, so this checkout's $2 is a duplicate.
  scenario.writeSelectRows.profiles = [];
  if (opts.retrieveThrows) stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error("stripe down"));
  else stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_q1904", latest_charge: { id: "ch_1", amount: 10812, amount_refunded: opts.amountRefunded } });
  // Only settleOnboardingFee's job read selects exactly these columns.
  scenario.reads.jobs = {
    rows: [],
    selectOverrides: [{
      includes: "stripe_payment_intent_id, payment_status",
      result: { rows: [{ stripe_payment_intent_id: opts.jobPi ?? "pi_q1904", payment_status: opts.jobPaymentStatus }] },
    }],
  };
  stripeMock.refunds.create.mockResolvedValue({ id: "re_dup", amount: 200 });
  await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" } }));
  return stripeMock.refunds.create.mock.calls.filter((c) => (c[0] as { metadata?: { reason?: string } }).metadata?.reason === "duplicate_onboarding_fee");
}

describe("Q1904: a cancel's refund already returned the duplicate setup fee", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  for (const status of ["cancelled", "refunded", "cancelling"]) {
    it(`no second $2 refund when the charge was refunded and the job is ${status}`, async () => {
      const dup = await deliverDuplicateFee({ amountRefunded: 10450, jobPaymentStatus: status });
      expect(dup).toHaveLength(0);
      expect(scenario.writes.filter((w) => w.table === "payment_refunds")).toHaveLength(0);
    });
  }

  it("control: no refund on the charge yet, the $2 goes back as before", async () => {
    const dup = await deliverDuplicateFee({ amountRefunded: 0, jobPaymentStatus: "escrow" });
    expect(dup).toHaveLength(1);
    expect((dup[0][0] as { amount: number }).amount).toBe(200);
  });

  it("control: an admin's partial refund (job still in escrow) does not stop the $2 refund", async () => {
    const dup = await deliverDuplicateFee({ amountRefunded: 3000, jobPaymentStatus: "escrow" });
    expect(dup).toHaveLength(1);
  });

  it("control: a cancelled job funded by ANOTHER payment does not stop this checkout's $2 refund", async () => {
    const dup = await deliverDuplicateFee({ amountRefunded: 10450, jobPaymentStatus: "cancelled", jobPi: "pi_other" });
    expect(dup).toHaveLength(1);
  });

  it("control: a cancelled job whose charge has NO refund on it (a cancel that sent nothing back) still gets the $2", async () => {
    const dup = await deliverDuplicateFee({ amountRefunded: 0, jobPaymentStatus: "cancelled" });
    expect(dup).toHaveLength(1);
  });

  it("control: an unreadable charge refunds the $2 as before (never a fee kept on a guess)", async () => {
    const dup = await deliverDuplicateFee({ amountRefunded: 0, jobPaymentStatus: "cancelled", retrieveThrows: true });
    expect(dup).toHaveLength(1);
  });
});
