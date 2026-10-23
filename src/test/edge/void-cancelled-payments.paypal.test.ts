/**
 * PayPal phase 6: a cancelled job paid through PayPal never reaches the Stripe loop of
 * void-cancelled-payments. That loop reads "no PaymentIntent" as "no payment was ever made" and
 * flips the job out of escrow, so a PayPal job reaching it would strand the poster's money.
 *
 * Runs the REAL function source via the edge harness.
 *
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if (paypalJobs?.has(job.id)) { | if (false) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if (paypalJobs === null && !job.stripe_payment_intent_id && !job.stripe_session_id) { | if (false) {
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret-void-pp";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_void",
    CRON_SECRET,
  });
  return loadEdgeFunction("void-cancelled-payments");
}
const cronReq = () => new Request("https://x/functions/v1/void-cancelled-payments", { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } });

function seedPayPalCancelledJob() {
  scenario.reads.jobs = {
    selectOverrides: [{
      includes: "cancellation_fee",
      result: {
        rows: [{
          id: "a0000000-0000-4000-8000-0000000000aa", title: "Paid with PayPal", stripe_session_id: null, stripe_payment_intent_id: null,
          budget: 100, customer_fee_amount: 0, cancellation_fee: 25, date_needed: "2026-11-10", start_time: "18:00:00",
          cancelled_at: "2026-11-10T14:00:00Z", helper_id: "helper-1", helper_confirmed_at: "2026-11-01T00:00:00Z", customer_id: "poster-1",
          helper_fee_percent: 8, helper_fee_flat_cents: 70,
        }],
      },
    }],
    rows: [],
  };
}

describe("void-cancelled-payments: a PayPal-paid cancellation takes the PayPal leg, never the Stripe loop", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  it("a job with a funded PayPal payment is not flipped out of escrow by the Stripe loop (PayPal not configured here: skipped as a defect)", async () => {
    seedPayPalCancelledJob();
    scenario.reads.provider_payments = { rows: [{ subject_id: "a0000000-0000-4000-8000-0000000000aa", funds_job_id: null }] };
    const h = await load();
    const res = await h.fetch(cronReq());
    const body = JSON.parse(await res.text());
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(scenario.writes.filter((w) => w.table === "jobs")).toHaveLength(0);
    expect(JSON.stringify(body.results)).toContain('"status":"paypal_skipped"');
    expect(res.status).toBe(500);
  });

  it("an unreadable PayPal ledger lets no job without a Stripe payment through (fail closed)", async () => {
    seedPayPalCancelledJob();
    scenario.reads.provider_payments = { error: { message: "ledger down" } };
    const h = await load();
    const res = await h.fetch(cronReq());
    const body = JSON.parse(await res.text());
    expect(scenario.writes.filter((w) => w.table === "jobs")).toHaveLength(0);
    expect(JSON.stringify(body.results)).toContain('"status":"paypal_read_failed_skipped"');
    expect(res.status).toBe(500);
  });

  it("control: the same job with no PayPal payment goes on to the Stripe loop as before (no PayPal status)", async () => {
    seedPayPalCancelledJob();
    scenario.reads.provider_payments = { rows: [] };
    const h = await load();
    const body = JSON.parse(await (await h.fetch(cronReq())).text());
    expect(JSON.stringify(body.results)).not.toContain('paypal_');
  });
});
