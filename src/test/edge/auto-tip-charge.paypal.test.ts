/**
 * PayPal phase 6: an automatic tip on a job paid through PayPal is never charged through
 * Stripe, and is NOT charged at all while the Helpr's tip payout cannot be put on the pay queue
 * (phase 4's writer does not take a tip's own payment yet: QUEUE_TAKES_TIP_PAYMENTS). The claim
 * is released so the job stays a candidate.
 *
 * Runs the REAL function source via the edge harness.
 *
 * @mutate supabase/functions/auto-tip-charge/index.ts | if (paypalJob) { | if (false) {
 * @mutate supabase/functions/_shared/payments/manualPayoutQueue.ts | export const QUEUE_TAKES_TIP_PAYMENTS = false; | export const QUEUE_TAKES_TIP_PAYMENTS = true;
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret";

async function load(extra: Record<string, string> = {}): Promise<EdgeHarness> {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_abc", CRON_SECRET, ...extra });
  return loadEdgeFunction("auto-tip-charge");
}

function seed() {
  scenario.rpc.auto_tip_candidates = [{ job_id: "job-pp", customer_id: "poster-1", helper_id: "helper-1", budget: 100, tip_amount: 10, tip_state: "chargeable" }];
  scenario.rpc.auto_tip_job_state = "chargeable";
  scenario.reads.provider_payments = { rows: [{ id: "pay-1" }] };
}

describe("auto-tip-charge: a PayPal-paid job", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("is not charged through Stripe, and not charged at all while the tip payout cannot be queued; the claim is released", async () => {
    seed();
    const fn = await load({ PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" });
    const res = await fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(scenario.writes.some((w) => w.table === "provider_payments" && w.op === "insert")).toBe(false);
    expect(scenario.writes.some((w) => w.table === "tips" && w.op === "delete")).toBe(true);
    const b = JSON.parse(await res.text());
    expect(JSON.stringify(b)).toContain('"held":1');
  });

  it("PayPal not configured: nothing charged, the claim released, a defect", async () => {
    seed();
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(scenario.writes.some((w) => w.table === "tips" && w.op === "delete")).toBe(true);
    expect(String(JSON.parse(await res.text()).defectReasons)).toContain("PayPal not configured");
  });

  it("an unreadable PayPal ledger charges nothing (fail closed)", async () => {
    seed();
    scenario.reads.provider_payments = { error: { message: "down", code: "08006" } };
    const fn = await load();
    await fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(scenario.writes.some((w) => w.table === "tips" && w.op === "delete")).toBe(true);
  });
});
