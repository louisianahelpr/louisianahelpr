/**
 * stripe-webhook settles a paid ID check (owner 2026-10-19: "they have to pay
 * for their own ID"): checkout.session.completed with metadata.kind 'idv_fee'
 * moves the idv_fee_payments row awaiting_payment -> paid. That 'paid' row is
 * the ONLY thing that lets stripe-idv-start create a VerificationSession
 * (src/test/edge/stripe-idv-start-paid.test.ts), so this is the "payment
 * confirmed by the webhook" half of the ordering.
 */
// @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |   if (isIdvFeeSession(session)) { |   if (false) {
// @mutate supabase/functions/stripe-webhook/handlers/settleIdvFee.ts |   if (session.payment_status !== "paid") { |   if (false) {
// @mutate supabase/functions/stripe-webhook/handlers/settleIdvFee.ts |   if (!verified && !duplicate) return; |   return;
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

async function deliver(session: Record<string, unknown>) {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  const fn = await loadEdgeFunction("stripe-webhook");
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({
    id: `evt_idv_${String(session.id)}`,
    type: "checkout.session.completed",
    data: { object: session },
  });
  return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" } }));
}
const SESSION = {
  id: "cs_idv_1",
  livemode: false,
  mode: "payment",
  payment_status: "paid",
  amount_total: 185,
  payment_intent: "pi_idv_1",
  client_reference_id: "landlord-1",
  customer_email: "landlord@test.com",
  metadata: { kind: "idv_fee", user_id: "landlord-1" },
};
const idvWrites = () => scenario.writes.filter((w) => w.table === "idv_fee_payments");

describe("stripe-webhook: paid ID check", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("marks the awaiting row paid (only an awaiting row), recording the PaymentIntent for a refund", async () => {
    scenario.writeSelectRows["idv_fee_payments:update"] = [{ id: "pay-1", user_id: "landlord-1" }];
    scenario.reads.profiles = { rows: [{ idv_status: "pending", stripe_identity_verified: false }] };
    scenario.reads.idv_fee_payments = { rows: [] };
    const res = await deliver(SESSION);
    expect(res.status).toBe(200);
    const upd = idvWrites().find((w) => w.op === "update");
    expect(upd?.payload).toMatchObject({ status: "paid", stripe_payment_intent_id: "pi_idv_1" });
    expect(upd?.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "eq", column: "stripe_checkout_session_id", value: "cs_idv_1" }),
      expect.objectContaining({ op: "eq", column: "status", value: "awaiting_payment" }),
    ]));
    // it is not mistaken for a job / Pro / gift checkout, and a needed payment is kept
    expect(scenario.writes.some((w) => w.table === "jobs" || w.table === "profiles")).toBe(false);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("a payment from an account that is already verified (either verdict) is refunded in full", async () => {
    scenario.writeSelectRows["idv_fee_payments:update"] = [{ id: "pay-9", user_id: "landlord-1" }];
    scenario.reads.profiles = { rows: [{ idv_status: "pending", stripe_identity_verified: true }] };
    scenario.reads.idv_fee_payments = { rows: [] };
    stripeMock.refunds.create.mockResolvedValue({ id: "re_9" });
    const res = await deliver({ ...SESSION, id: "cs_idv_9" });
    expect(res.status).toBe(200);
    const [args, opts] = stripeMock.refunds.create.mock.calls[0];
    expect(args.payment_intent).toBe("pi_idv_1");
    expect(args.amount).toBeUndefined();
    expect(opts.idempotencyKey).toBe("idv-fee-refund:pay-9");
  });

  it("an unpaid completion (delayed method) unlocks nothing", async () => {
    const res = await deliver({ ...SESSION, id: "cs_idv_2", payment_status: "unpaid" });
    expect(res.status).toBe(200);
    expect(idvWrites()).toHaveLength(0);
  });

  it("a DB error is refused (non-2xx) so Stripe retries, never acknowledged", async () => {
    scenario.writeErrors.idv_fee_payments = { message: "db down" };
    const res = await deliver({ ...SESSION, id: "cs_idv_3" });
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
