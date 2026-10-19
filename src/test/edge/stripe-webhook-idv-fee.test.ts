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
// @mutate supabase/functions/stripe-webhook/handlers/settleIdvFee.ts |   if (claimErr \|\| !Array.isArray(claimed) \|\| claimed.length === 0) { |   if (claimErr) {
// @mutate supabase/functions/stripe-webhook/handlers/settleIdvFee.ts |     (o) => o.status !== "paid" \|\| (o.created_at ? Date.parse(o.created_at) : 0) < mine, |     (o) => true,
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

  // lh-money-escrow review of the landlord-idv train, must-fix #1: the surplus row is claimed
  // (paid -> refunded) BEFORE Stripe is called, so a "start" tap in between cannot run a check
  // on refunded money; and of two paid rows only the NEWER one is surplus.
  it("claims the surplus row (paid -> refunded) before calling Stripe", async () => {
    scenario.writeSelectRows["idv_fee_payments:update"] = [{ id: "pay-9", user_id: "landlord-1" }];
    scenario.reads.profiles = { rows: [{ idv_status: "verified", stripe_identity_verified: false }] };
    scenario.reads.idv_fee_payments = { rows: [] };
    let claimedBeforeRefund = false;
    stripeMock.refunds.create.mockImplementation(async () => {
      claimedBeforeRefund = idvWrites().some((w) => w.op === "update" && w.payload.status === "refunded"
        && w.filters.some((f) => f.op === "eq" && f.column === "status" && f.value === "paid"));
      return { id: "re_9" };
    });
    await deliver({ ...SESSION, id: "cs_idv_10" });
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(claimedBeforeRefund).toBe(true);
  });

  it("no refund when the claim finds the row no longer paid (a check started on it)", async () => {
    scenario.writeSelectRows["idv_fee_payments:update"] = [{ id: "pay-9", user_id: "landlord-1" }];
    scenario.writeOverrides = [{ table: "idv_fee_payments", op: "update", when: (payload) => payload.status === "refunded", rows: [] }];
    scenario.reads.profiles = { rows: [{ idv_status: "verified", stripe_identity_verified: false }] };
    scenario.reads.idv_fee_payments = { rows: [] };
    const res = await deliver({ ...SESSION, id: "cs_idv_11" });
    expect(res.status).toBe(200);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("of two paid checks only the newer is refunded", async () => {
    scenario.writeSelectRows["idv_fee_payments:update"] = [{ id: "pay-new", user_id: "landlord-1", created_at: "2026-10-19T01:00:00Z" }];
    scenario.reads.profiles = { rows: [{ idv_status: "pending", stripe_identity_verified: false }] };
    scenario.reads.idv_fee_payments = { rows: [{ id: "pay-old", status: "paid", created_at: "2026-10-19T00:00:00Z" }] };
    stripeMock.refunds.create.mockResolvedValue({ id: "re_new" });
    await deliver({ ...SESSION, id: "cs_idv_12" });
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);

    resetStripeMock();
    scenario.writeSelectRows["idv_fee_payments:update"] = [{ id: "pay-old", user_id: "landlord-1", created_at: "2026-10-19T00:00:00Z" }];
    scenario.reads.idv_fee_payments = { rows: [{ id: "pay-new", status: "paid", created_at: "2026-10-19T01:00:00Z" }] };
    await deliver({ ...SESSION, id: "cs_idv_13" });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
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
