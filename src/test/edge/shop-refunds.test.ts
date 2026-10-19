/**
 * Shops M3, the Stripe side (migration 20261019043209_shops_refunds_cancels_strikes;
 * docs/specs/local-shops-prep.md L41-L43, O2, O3): shop-checkout's buyer_cancel /
 * shop_cancel / no_show / admin_refund and its terms check, _shared/shopRefunds.ts,
 * declutter-money's shop refund step and the webhook's Shops refund branches.
 *
 * The decisions (free vs late, who pays the card fee, the amounts) live in SQL and
 * are proven by src/test/pglite/shopsRefunds.pglite.mjs. This file proves the edge
 * side runs the member's RPC FIRST (the decision commits under the order's row
 * lock) and only THEN calls Stripe, once, with the refund's own key.
 *
 * Registered mutations - each turns this file RED on its own:
 * @mutate supabase/functions/_shared/shopRefunds.ts |         { idempotencyKey: shopRefundKey(row.refund_id, row.attempts) }, |         {},
 * @mutate supabase/functions/_shared/shopRefunds.ts |   return n === 0 ? `shop-refund-${refundId}` : `shop-refund-${refundId}-r${n}`; |   return `shop-refund-${refundId}`;
 * @mutate supabase/functions/_shared/shopRefunds.ts |     if (mine) { |     if (false) {
 * @mutate supabase/functions/_shared/shopRefunds.ts |           metadata: { kind: "shop_refund", shop_refund_id: row.refund_id, order_id: row.order_id }, |           metadata: { kind: "shop_refund", order_id: row.order_id },
 * @mutate supabase/functions/shop-checkout/index.ts |   if (typeof refundId !== "string" \|\| !UUID_RE.test(refundId)) return null; |   if (false) return null;
 * @mutate supabase/functions/shop-checkout/index.ts |   if (ft.cancel_policy !== terms.cancel_policy \|\| ft.ready_tap_cancel !== terms.ready_tap_cancel) { |   if (false) {
 * @mutate supabase/functions/shop-checkout/index.ts |     return json({ error: "terms_required" }, 400); |
 * @mutate supabase/functions/declutter-money/index.ts |     const dueRefunds = await admin.rpc("shop_refunds_due", { p_limit: BATCH }); |     const dueRefunds = { error: null, data: [] };
 * @mutate supabase/functions/declutter-money/index.ts |     if (f?.ops_alert_due === true && typeof f.year === "number") { |     if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |       const { error: sentErr } = await admin.rpc("facilitator_alert_sent", { p_year: f.year }); |       const sentErr = null;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |   if (meta.kind === "shop_refund" && meta.shop_refund_id) { |   if (false) {
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";
import { resetEmailMocks } from "./mocks/email";

const BUYER = "0000000c-0000-4000-8000-000000000001";
const MAKER = "0000000c-0000-4000-8000-000000000002";
const ADMIN = "0000000c-0000-4000-8000-000000000003";
const ORDER = "0000000c-0000-4000-8000-0000000000aa";
const REFUND = "0000000c-0000-4000-8000-0000000000ff";
const SHOP = "0000000c-0000-4000-8000-0000000000cc";
const ITEM = "0000000c-0000-4000-8000-0000000000bb";

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
async function json(res: Response): Promise<Record<string, any>> {
  return JSON.parse(await res.text());
}
const rpcs = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);
const clientOf = (call: { client?: number }) => scenario.clients?.[call.client ?? -1];
const charged = {
  id: ORDER, buyer_id: BUYER, seller_id: MAKER, status: "refunded", items_cents: 1800, premium_cents: 160,
  stripe_checkout_session_id: "cs_live_shop", stripe_payment_intent_id: "pi_shop", payment_livemode: true,
  captured_at: "2026-10-18T10:00:00Z", capture_attempts: 0,
};
const toSend = (over: Record<string, unknown> = {}) => ({
  refund_id: REFUND, order_id: ORDER, buyer_id: BUYER, seller_id: MAKER, payment_intent_id: "pi_shop", refund_cents: 2056,
  livemode: true, checkout_session_id: "cs_live_shop", attempts: 0, ...over,
});

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
  resetEmailMocks();
  scenario.reads.test_accounts = { rows: [] };
});

async function as(uid: string) {
  env();
  scenario.authUser = { id: uid, email: `${uid}@test.dev`, email_confirmed_at: "2026-10-01T00:00:00Z" };
  return loadEdgeFunction("shop-checkout");
}
const tap = (fn: Awaited<ReturnType<typeof as>>, body: Record<string, unknown>) =>
  fn.fetch(fn.request({ headers: { Authorization: "Bearer member-jwt" }, body }));
/** Records, at the moment Stripe is asked to refund, how many times the decision RPC had already run. */
function refundAfter(rpcName: string): { seen: number[] } {
  const seen: number[] = [];
  stripeMock.refunds.create.mockImplementation(async () => {
    seen.push(rpcs(rpcName).length);
    return { id: "re_new", status: "pending" };
  });
  return { seen };
}

describe("shop-checkout: cancels after the accept (the decision commits first, Stripe after)", () => {
  it("buyer_cancel free: the SQL decides AS THE BUYER, then ONE refund with the row's own key and metadata", async () => {
    const fn = await as(BUYER);
    scenario.rpc.shops_buyer_cancel_order = { result: "cancelled_free", order_id: ORDER, refund_id: REFUND, refund_cents: 2056 };
    scenario.rpc.shop_refund_to_send = [toSend()];
    scenario.rpc.shop_refund_executed = "succeeded";
    scenario.reads.shop_orders = { rows: [charged] };
    const order = refundAfter("shops_buyer_cancel_order");
    const res = await tap(fn, { action: "buyer_cancel", order_id: ORDER, expect: "free" });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ cancelled: true, result: "cancelled_free", refund_cents: 2056, refund: "sent" });
    const call = rpcs("shops_buyer_cancel_order")[0];
    expect(call?.args).toEqual({ p_order_id: ORDER, p_expect: "free" });
    expect(clientOf(call)?.key).toBe("anon-key");
    expect(order.seen).toEqual([1]);
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_shop", amount: 2056, metadata: { kind: "shop_refund", shop_refund_id: REFUND, order_id: ORDER } },
      { idempotencyKey: `shop-refund-${REFUND}` },
    );
    expect(rpcs("shop_refund_executed")[0]?.args).toEqual({ p_refund_id: REFUND, p_stripe_refund_id: "re_new", p_succeeded: true, p_error: null });
  });

  it("buyer_cancel refused by the SQL (window moved, problem open, not the buyer): no Stripe call at all", async () => {
    const fn = await as(BUYER);
    scenario.rpcErrors = { shops_buyer_cancel_order: { message: "cancel_terms_changed", code: "55000" } };
    const res = await tap(fn, { action: "buyer_cancel", order_id: ORDER, expect: "free" });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("cancel_terms_changed");
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.refunds.list).not.toHaveBeenCalled();
  });

  it("buyer_cancel late and no_show refund nothing: no Stripe call (the shop is paid by the payout step)", async () => {
    const fn = await as(BUYER);
    scenario.rpc.shops_buyer_cancel_order = { result: "cancelled_late", order_id: ORDER, refund_id: null, refund_cents: 0 };
    const res = await tap(fn, { action: "buyer_cancel", order_id: ORDER, expect: "late" });
    expect((await json(res)).refund).toBeNull();
    const fn2 = await as(MAKER);
    scenario.rpc.shops_report_no_show = { result: "no_show", order_id: ORDER };
    const res2 = await tap(fn2, { action: "no_show", order_id: ORDER });
    expect(res2.status).toBe(200);
    expect(clientOf(rpcs("shops_report_no_show")[0])?.key).toBe("anon-key");
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(rpcs("shop_refund_to_send")).toHaveLength(0);
  });

  it("buyer_cancel without a valid expect is refused before any RPC", async () => {
    const fn = await as(BUYER);
    const res = await tap(fn, { action: "buyer_cancel", order_id: ORDER });
    expect(res.status).toBe(400);
    expect(rpcs("shops_buyer_cancel_order")).toHaveLength(0);
  });

  it("shop_cancel: the SQL decides AS THE SHOP, then the full refund goes out once", async () => {
    const fn = await as(MAKER);
    scenario.rpc.shops_shop_cancel_order = { result: "cancelled", order_id: ORDER, refund_id: REFUND, refund_cents: 2110 };
    scenario.rpc.shop_refund_to_send = [toSend({ refund_cents: 2110 })];
    scenario.rpc.shop_refund_executed = "succeeded";
    scenario.reads.shop_orders = { rows: [charged] };
    const order = refundAfter("shops_shop_cancel_order");
    const res = await tap(fn, { action: "shop_cancel", order_id: ORDER, reason: "Oven broke" });
    expect(res.status).toBe(200);
    expect(rpcs("shops_shop_cancel_order")[0]?.args).toEqual({ p_order_id: ORDER, p_reason: "Oven broke" });
    expect(order.seen).toEqual([1]);
    expect(stripeMock.refunds.create.mock.calls[0][0].amount).toBe(2110);
  });

  it("a Stripe failure after the commit answers 200 'pending' and records the failure (the money step retries)", async () => {
    const fn = await as(MAKER);
    scenario.rpc.shops_shop_cancel_order = { result: "cancelled", order_id: ORDER, refund_id: REFUND, refund_cents: 2110 };
    scenario.rpc.shop_refund_to_send = [toSend({ refund_cents: 2110 })];
    scenario.rpc.shop_refund_executed = "failed";
    scenario.reads.shop_orders = { rows: [charged] };
    stripeMock.refunds.create.mockRejectedValue(new Error("api_connection_error"));
    const res = await tap(fn, { action: "shop_cancel", order_id: ORDER });
    expect(res.status).toBe(200);
    expect((await json(res)).refund).toBe("pending");
    expect(rpcs("shop_refund_executed")[0]?.args).toMatchObject({ p_refund_id: REFUND, p_succeeded: false });
  });

  it("admin_refund runs AS THE CALLER (the SQL checks the admin role), then sends the refund", async () => {
    const fn = await as(ADMIN);
    scenario.rpc.shops_admin_refund_order = { result: "refunded", order_id: ORDER, refund_id: REFUND, refund_cents: 2056 };
    scenario.rpc.shop_refund_to_send = [toSend()];
    scenario.rpc.shop_refund_executed = "succeeded";
    scenario.reads.shop_orders = { rows: [charged] };
    const order = refundAfter("shops_admin_refund_order");
    const res = await tap(fn, { action: "admin_refund", order_id: ORDER, reason: "problem_no_fault", note: "photo" });
    expect(res.status).toBe(200);
    const call = rpcs("shops_admin_refund_order")[0];
    expect(call?.args).toEqual({ p_order_id: ORDER, p_reason: "problem_no_fault", p_note: "photo" });
    expect(clientOf(call)?.key).toBe("anon-key");
    expect(order.seen).toEqual([1]);
  });
});

describe("_shared/shopRefunds.ts: idempotent sending", () => {
  it("a refund already on the payment for this row is recorded, never sent again", async () => {
    const fn = await as(BUYER);
    scenario.rpc.shops_buyer_cancel_order = { result: "cancelled_free", order_id: ORDER, refund_id: REFUND, refund_cents: 2056 };
    scenario.rpc.shop_refund_to_send = [toSend()];
    scenario.rpc.shop_refund_executed = "succeeded";
    scenario.reads.shop_orders = { rows: [charged] };
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_old", status: "succeeded", metadata: { kind: "shop_refund", shop_refund_id: REFUND } }] });
    const res = await tap(fn, { action: "buyer_cancel", order_id: ORDER, expect: "free" });
    expect(res.status).toBe(200);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(rpcs("shop_refund_executed")[0]?.args).toMatchObject({ p_stripe_refund_id: "re_old", p_succeeded: true });
  });

  it("after n failed tries the key carries -r<n> (Stripe replays a stored error for a reused key)", async () => {
    env();
    const fn = await loadEdgeFunction("declutter-money");
    scenario.rpc.shop_refund_sweep = { no_ready_photo_refunded: 0 };
    scenario.rpc.shop_refunds_due = [toSend({ attempts: 3 })];
    scenario.rpc.shop_refund_executed = "succeeded";
    stripeMock.refunds.create.mockResolvedValue({ id: "re_retry", status: "succeeded" });
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer cron-secret" } }));
    expect(res.status).toBe(200);
    expect(rpcs("shop_refund_sweep")).toHaveLength(1);
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create.mock.calls[0][1]).toEqual({ idempotencyKey: `shop-refund-${REFUND}-r3` });
  });

  it("the 12th refusal pages ops to refund by hand", async () => {
    env();
    const fn = await loadEdgeFunction("declutter-money");
    scenario.rpc.shop_refund_sweep = { no_ready_photo_refunded: 0 };
    scenario.rpc.shop_refunds_due = [toSend({ attempts: 11 })];
    scenario.rpc.shop_refund_executed = "failed";
    stripeMock.refunds.create.mockRejectedValue(new Error("charge_already_refunded"));
    await fn.fetch(fn.request({ headers: { Authorization: "Bearer cron-secret" } }));
    expect(slackAlerts.some((a: any) => /refund gave up/i.test(String(a.title ?? "")))).toBe(true);
  });
});

describe("shop-checkout order: the terms the buyer read", () => {
  async function load() {
    const fn = await as(BUYER);
    scenario.rpc.shops_request_order = { order_id: ORDER, items_cents: 1800, premium_cents: 160, superseded_session_id: null };
    scenario.rpc.shops_cancel_order_request = { result: "cancelled", order_id: ORDER };
    scenario.reads.shops = { rows: [{ owner_id: MAKER }] };
    scenario.reads.shop_pickup_addresses = { rows: [{ line1: "1 Main", line2: null, city: "Lafayette", state_code: "LA", postal_code: "70506",
      stripe_tax_location_id: "taxloc_x", stripe_tax_location_mode: "live", updated_at: "2026-10-18T00:00:00Z" }] };
    stripeMock.rawRequest.mockResolvedValue({ id: "taxloc_x" });
    return fn;
  }
  const ask = (fn: Awaited<ReturnType<typeof as>>, terms?: Record<string, unknown>) => tap(fn, {
    action: "order", shop_id: SHOP, lines: [{ item_id: ITEM, quantity: 1 }], ready_date: "2026-10-30", note: "",
    ...(terms ? { terms } : {}),
  });

  it("no terms: refused before anything is frozen", async () => {
    const fn = await load();
    const res = await ask(fn);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("terms_required");
    expect(rpcs("shops_request_order")).toHaveLength(0);
  });

  it("terms changed after the buyer loaded them: the frozen order is closed AS THE BUYER and no Stripe page opens", async () => {
    const fn = await load();
    scenario.reads.shop_orders = { rows: [{ id: ORDER, buyer_id: BUYER, seller_id: MAKER, status: "awaiting_hold", items_cents: 1800, premium_cents: 160,
      cancel_policy: "until_accept", ready_tap_cancel: "from_day_before" }] };
    const res = await ask(fn, { cancel_policy: "until_24h_before_ready", ready_tap_cancel: "from_day_before" });
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: "terms_changed", terms: { cancel_policy: "until_accept", ready_tap_cancel: "from_day_before" } });
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    const close = rpcs("shops_cancel_order_request")[0];
    expect(close?.args).toEqual({ p_order_id: ORDER });
    expect(clientOf(close)?.key).toBe("anon-key");
  });
});

describe("stripe-webhook: a Shops refund Stripe failed later is reopened", () => {
  it("charge.refund.updated failed with our metadata reopens the row (shop_refund_reversed), nothing else", async () => {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    scenario.rpc.shop_refund_reversed = true;
    const event = {
      id: "evt_shop_refund_failed", type: "charge.refund.updated", livemode: true,
      data: { object: { id: "re_new", object: "refund", status: "failed", payment_intent: "pi_shop",
        metadata: { kind: "shop_refund", shop_refund_id: REFUND, order_id: ORDER } } },
    };
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({ ...event, created: 1_760_000_000 });
    const res = await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
    expect(res.status).toBe(200);
    expect(rpcs("shop_refund_reversed")[0]?.args).toEqual({ p_refund_id: REFUND, p_stripe_refund_id: "re_new" });
  });
});

describe("declutter-money: the Louisiana marketplace-facilitator early warning (R.S. 47:340.1)", () => {
  it("past $80,000 it pages ops once and marks the year sent; not due, it stays quiet", async () => {
    env();
    const fn = await loadEdgeFunction("declutter-money");
    scenario.rpc.facilitator_threshold_check = { year: 2026, total_cents: 8012345, ops_alert_due: true };
    scenario.rpc.facilitator_alert_sent = null;
    await fn.fetch(fn.request({ headers: { Authorization: "Bearer cron-secret" } }));
    const alert = slackAlerts.find((a: any) => /facilitator threshold/i.test(String(a.title ?? "")));
    expect(alert?.kind).toBe("money_at_risk");
    expect(String(alert?.message)).toContain("$80123.45");
    expect(rpcs("facilitator_alert_sent")[0]?.args).toEqual({ p_year: 2026 });
  });

  it("not due: no alert, nothing marked", async () => {
    env();
    const fn = await loadEdgeFunction("declutter-money");
    scenario.rpc.facilitator_threshold_check = { year: 2026, total_cents: 100, ops_alert_due: false };
    await fn.fetch(fn.request({ headers: { Authorization: "Bearer cron-secret" } }));
    expect(slackAlerts.some((a: any) => /facilitator threshold/i.test(String(a.title ?? "")))).toBe(false);
    expect(rpcs("facilitator_alert_sent")).toHaveLength(0);
  });
});
