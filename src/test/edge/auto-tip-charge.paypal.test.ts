/**
 * PayPal phase 6: an automatic tip on a job paid through PayPal is never charged through
 * Stripe. It goes through the poster's saved PayPal method, behind paypal_payments, and is
 * never silent: switch off or no saved method marks the claim failed and tells the poster.
 *
 * Runs the REAL function source via the edge harness.
 *
 * @mutate supabase/functions/auto-tip-charge/index.ts | if (paypalJob) { | if (false) {
 * @mutate supabase/functions/_shared/payments/phase6PayoutDoors.ts | export const QUEUE_TAKES_TIP_PAYMENTS = true; | export const QUEUE_TAKES_TIP_PAYMENTS = false;
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
  // paypalFundedJob reads "id"; the saved charge's own row lookup reads "idempotency_key".
  scenario.reads.provider_payments = { rows: [{ id: "pay-1" }], selectOverrides: [{ includes: "idempotency_key", result: { rows: [] } }] };
}
const tipUpdates = () => scenario.writes.filter((w) => w.table === "tips" && w.op === "update").map((w) => (w.payload as { payment_status?: string; failure_reason?: string }));

describe("auto-tip-charge: a PayPal-paid job", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("switch off for the poster: nothing charged anywhere, the claim marked failed and the poster told", async () => {
    seed();
    const fn = await load({ PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" });
    await fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(scenario.writes.some((w) => w.table === "provider_payments" && w.op === "insert")).toBe(false);
    expect(tipUpdates()).toEqual([expect.objectContaining({ payment_status: "failed", failure_reason: "paypal_switch_off" })]);
    expect(scenario.writes.some((w) => w.table === "notifications" && w.op === "insert")).toBe(true);
  });

  it("switch on, no saved PayPal method: nothing charged, failed with that reason, the poster told", async () => {
    seed();
    scenario.rpc.feature_enabled_for_user = () => true;
    scenario.reads.paypal_saved_payment_methods = { rows: [] };
    const fn = await load({ PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" });
    await fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(scenario.writes.some((w) => w.table === "provider_payments" && w.op === "insert")).toBe(false);
    expect(tipUpdates()).toEqual([expect.objectContaining({ payment_status: "failed", failure_reason: "no_saved_paypal_method" })]);
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
