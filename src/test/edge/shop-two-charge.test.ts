/**
 * Shops custom orders, a 50% deposit order paid in TWO charges (migration 20261107162454; LEAD 11-07 option B): the
 * app never sends a refund across two charges, so a person refunds it by hand. This file proves the edge side of that:
 * a refund made by hand on the REST's charge is recorded against the order (shop_record_hand_refund, which finds the
 * order by the rest's PaymentIntent in SQL, proven by src/test/pglite/shopsCustomTwoCharge.pglite.mjs), ops are paged
 * with the tax step they must do by hand, and the jobs path never runs; a member's cancel whose refund was held is
 * not told it was sent. The two-leg payout is proven in src/test/edge/shop-payouts.test.ts.
 *
 * Registered mutations - each turns this file RED on its own:
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |  if ((((charge as { metadata?: Record<string, string> \| null }).metadata ?? {}) as Record<string, string>).kind === "shop_balance") { |  if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |      if (alwaysSay && String(data) !== "already") why = `${why ?? ""} ${alwaysSay}`.trim(); |
 * @mutate supabase/functions/shop-checkout/index.ts |      return (held as { status?: string } \| null)?.status === "held_for_review" ? "pending" : "sent"; |      return "sent";
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";
import { resetEmailMocks } from "./mocks/email";

const BUYER = "0000000e-0000-4000-8000-000000000001";
const MAKER = "0000000e-0000-4000-8000-000000000002";
const ORDER = "0000000e-0000-4000-8000-0000000000aa";
const REFUND = "0000000e-0000-4000-8000-0000000000ff";

function env() {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_shops",
    STRIPE_TEST_SECRET_KEY: "sk_test_shops",
    STRIPE_WEBHOOK_SECRET: "whsec_live",
    CRON_SECRET: "cron-secret",
  });
}
const rpcs = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
  resetEmailMocks();
  scenario.reads.test_accounts = { rows: [] };
});

describe("stripe-webhook: a refund made by hand on the rest's charge", () => {
  async function deliver(object: Record<string, unknown>) {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id: "evt_rest_ref", type: "charge.refunded", livemode: true, created: 1_760_000_000, data: { object } });
    return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
  }
  const restCharge = (refunds: unknown[]) => ({
    id: "ch_rest", payment_intent: "pi_rest", amount: 3385, amount_refunded: 1000, currency: "usd",
    metadata: { kind: "shop_balance", order_id: ORDER }, refunds: { has_more: false, data: refunds },
  });

  it("is recorded against the order by the rest's payment, ops are told to reverse its tax by hand, and the jobs path never runs", async () => {
    scenario.rpc.shop_record_hand_refund = "recorded_refund_held";
    scenario.reads.shop_orders = { rows: [{ is_seed: false, buyer_id: BUYER, seller_id: MAKER }] };
    const res = await deliver(restCharge([
      { id: "re_rest_hand", amount: 1000, status: "succeeded", metadata: {} },
      { id: "re_not_owed", amount: 3385, status: "succeeded", metadata: { kind: "shop_balance_refund", order_id: ORDER } },
    ]));
    expect(res.status).toBe(200);
    expect(rpcs("shop_record_hand_refund").map((c) => c.args)).toEqual([{
      p_payment_intent_id: "pi_rest", p_stripe_refund_id: "re_rest_hand", p_amount_cents: 1000, p_livemode: true,
      p_how: "webhook", p_admin: null, p_note: null,
    }]);
    expect(scenario.writes.filter((w) => w.table !== "stripe_webhook_events")).toEqual([]);
    const page = slackAlerts.find((a: any) => /refunded outside the app/.test(String(a.title))) as any;
    expect(page?.message).toMatch(/REST of a 50% deposit order/);
    expect(page?.message).toMatch(/NOT reversed/);
    expect(stripeMock.tax.transactions.createReversal).not.toHaveBeenCalled();
  });

  it("a hand refund already recorded is not paged again", async () => {
    scenario.rpc.shop_record_hand_refund = "already";
    await deliver(restCharge([{ id: "re_rest_hand", amount: 1000, status: "succeeded", metadata: {} }]));
    expect(rpcs("shop_record_hand_refund")).toHaveLength(1);
    expect(slackAlerts.some((a: any) => /refunded outside the app/.test(String(a.title)))).toBe(false);
  });

  it("the not-owed refund of the rest alone still records nothing (unchanged)", async () => {
    const res = await deliver(restCharge([{ id: "re_not_owed", amount: 3385, status: "succeeded", metadata: { kind: "shop_balance_refund", order_id: ORDER } }]));
    expect(res.status).toBe(200);
    expect(rpcs("shop_record_hand_refund")).toHaveLength(0);
  });
});

describe("shop-checkout: a cancel whose refund is held for a person (two charges)", () => {
  it("the shop's cancel answers refund 'pending', and Stripe is never asked", async () => {
    env();
    scenario.authUser = { id: MAKER, email: `${MAKER}@test.dev`, email_confirmed_at: "2026-10-01T00:00:00Z" };
    const fn = await loadEdgeFunction("shop-checkout");
    scenario.rpc.shops_shop_cancel_order = { result: "cancelled", order_id: ORDER, refund_id: REFUND, refund_cents: 6770 };
    scenario.rpc.shop_refund_to_send = [];
    scenario.reads.shop_refunds = { rows: [{ status: "held_for_review" }] };
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer member-jwt" }, body: { action: "shop_cancel", order_id: ORDER, reason: "sick" } }));
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text())).toMatchObject({ cancelled: true, refund: "pending" });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("a refund the queue already finished still answers 'sent' (unchanged)", async () => {
    env();
    scenario.authUser = { id: MAKER, email: `${MAKER}@test.dev`, email_confirmed_at: "2026-10-01T00:00:00Z" };
    const fn = await loadEdgeFunction("shop-checkout");
    scenario.rpc.shops_shop_cancel_order = { result: "cancelled", order_id: ORDER, refund_id: REFUND, refund_cents: 6770 };
    scenario.rpc.shop_refund_to_send = [];
    scenario.reads.shop_refunds = { rows: [{ status: "succeeded" }] };
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer member-jwt" }, body: { action: "shop_cancel", order_id: ORDER, reason: "sick" } }));
    expect(JSON.parse(await res.text())).toMatchObject({ refund: "sent" });
  });
});
