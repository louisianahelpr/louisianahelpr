/**
 * Shops M3, the Stripe side (migration 20261019071055_shops_refunds_cancels_strikes;
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
 * @mutate supabase/functions/_shared/shopRefunds.ts |         { idempotencyKey: shopRefundKey(row.refund_id, row.attempts, Number(row.reversals ?? 0)) }, |         {},
 * @mutate supabase/functions/_shared/shopRefunds.ts |   return `shop-refund-${refundId}${v === 0 ? "" : `-v${v}`}${n === 0 ? "" : `-r${n}`}`; |   return `shop-refund-${refundId}`;
 * @mutate supabase/functions/_shared/shopRefunds.ts |         { idempotencyKey: shopRefundKey(row.refund_id, row.attempts, Number(row.reversals ?? 0)) }, |         { idempotencyKey: shopRefundKey(row.refund_id, row.attempts) },
 * @mutate supabase/functions/_shared/shopRefunds.ts |     if (mine) { |     if (false) {
 * @mutate supabase/functions/_shared/shopRefunds.ts |           metadata: { kind: "shop_refund", shop_refund_id: row.refund_id, order_id: row.order_id }, |           metadata: { kind: "shop_refund", order_id: row.order_id },
 * @mutate supabase/functions/shop-checkout/index.ts |   if (typeof refundId !== "string" \|\| !UUID_RE.test(refundId)) return null; |   if (false) return null;
 * @mutate supabase/functions/shop-checkout/index.ts |     if (ft.cancel_policy !== terms.cancel_policy \|\| ft.ready_tap_cancel !== terms.ready_tap_cancel) { |     if (false) {
 * @mutate supabase/functions/shop-checkout/index.ts |     return json({ error: "invalid_terms" }, 400); |
 * @mutate supabase/functions/shop-checkout/index.ts |   if (terms !== null && (typeof terms | if (true \|\| (typeof terms
 * @mutate supabase/functions/declutter-money/index.ts |     const dueRefunds = await admin.rpc("shop_refunds_due", { p_limit: BATCH }); |     const dueRefunds = { error: null, data: [] };
 * @mutate supabase/functions/declutter-money/index.ts |     if (f?.ops_alert_due === true && typeof f.year === "number") { |     if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |         const { error: sentErr } = await admin.rpc("facilitator_alert_sent", { p_year: f.year }); |         const sentErr = null;
 * @mutate supabase/functions/declutter-money/index.ts |       if (delivered === true) { |       if (true) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |     await recordShopHandRefunds(event, charge, refundPiId, allRefunds, chargeMeta.order_id ?? null, supabase, logStep); |
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |       if ((error as { code?: string }).code !== "PGRST202") throw | if (false) throw
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |         message: `Refund ${r.id} ($${formatExactDollars(Number(r.amount ?? 0) / 100)}) on ${paymentIntentId} was made in Stripe, not by the app. ${why} Refunds on this charge: ${history}.`, |         message: `Refund ${r.id} on ${paymentIntentId}. ${why}`,
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |     if (!shErr && (shopHand === "marked_failed" \|\| shopHand === "reopened_held" \|\| shopHand === "already")) { |     if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |       if (shopHand === "marked_failed" \|\| shopHand === "reopened_held") { |       if (shopHand === "marked_failed") {
 * @mutate supabase/functions/shop-checkout/index.ts |   if (refundPi !== row.stripe_payment_intent_id) return json({ error: "refund_not_on_this_order" }, 409); |
 * @mutate supabase/functions/shop-checkout/index.ts |   if (Number(refund.amount ?? 0) < Number(row.refund_cents)) return json({ error: "hand_refund_short", amount_cents: refund.amount }, 409); |
 * @mutate supabase/functions/shop-checkout/index.ts |   if (role == null) return json({ error: "admin_only" }, 403); |
 * @mutate supabase/functions/shop-checkout/index.ts |   if (refund.status !== "succeeded") return json({ error: "refund_pending" }, 409); |
 * @mutate supabase/functions/shop-checkout/index.ts |   if (Number(settled.over_refunded_cents ?? 0) > 0) { |   if (false) {
 * @mutate supabase/functions/shop-checkout/index.ts |     if (err?.code === "resource_missing" \|\| err?.statusCode === 404) return null; |
 * @mutate supabase/functions/shop-checkout/index.ts |     if (body.action === "admin_settle_held_refund") return await adminSettleHeldRefund(body, user.id, admin);\n |
 * @mutate supabase/functions/shop-checkout/index.ts |   if (refundPi !== o.stripe_payment_intent_id) return json({ error: "refund_not_on_this_order" }, 409); |
 * @mutate supabase/functions/shop-checkout/index.ts |   if (refund.amount !== cents) return json({ error: "refund_amount_differs", amount_cents: refund.amount }, 409); |
 * @mutate supabase/functions/shop-checkout/index.ts |   if (!role) return json({ error: "admin_only" }, 403); |
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |   if (meta.kind === "shop_refund" && meta.shop_refund_id) { |   if (false) {
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts, postSlackOpsAlert } from "./mocks/shared";
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

  // /code-review of shops-m3-v1 #4: a reversal resets the tries; its run of keys is new (-v<n>), never the reversed refund's.
  it.each([
    [{ attempts: 0, reversals: 1 }, `shop-refund-${REFUND}-v1`],
    [{ attempts: 2, reversals: 1 }, `shop-refund-${REFUND}-v1-r2`],
    [{ attempts: 0, reversals: 0 }, `shop-refund-${REFUND}`],
  ])("a row reopened after a reversal sends under its own key (%o -> %s)", async (over, key) => {
    env();
    const fn = await loadEdgeFunction("declutter-money");
    scenario.rpc.shop_refund_sweep = { no_ready_photo_refunded: 0 };
    scenario.rpc.shop_refunds_due = [toSend(over)];
    scenario.rpc.shop_refund_executed = "succeeded";
    stripeMock.refunds.create.mockResolvedValue({ id: "re_again", status: "succeeded" });
    await fn.fetch(fn.request({ headers: { Authorization: "Bearer cron-secret" } }));
    expect(stripeMock.refunds.create.mock.calls[0][1]).toEqual({ idempotencyKey: key });
  });

  it("after a reversal, the give-up page still comes on the 12th refusal of the new run", async () => {
    env();
    const fn = await loadEdgeFunction("declutter-money");
    scenario.rpc.shop_refund_sweep = { no_ready_photo_refunded: 0 };
    scenario.rpc.shop_refunds_due = [toSend({ attempts: 11, reversals: 1 })];
    scenario.rpc.shop_refund_executed = "failed";
    stripeMock.refunds.create.mockRejectedValue(new Error("card_declined"));
    await fn.fetch(fn.request({ headers: { Authorization: "Bearer cron-secret" } }));
    expect(stripeMock.refunds.create.mock.calls[0][1]).toEqual({ idempotencyKey: `shop-refund-${REFUND}-v1-r11` });
    expect(slackAlerts.some((a: any) => /refund gave up/i.test(String(a.title ?? "")))).toBe(true);
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

  // /code-review of shops-m3-v1 #5: an app build from before the terms field still orders.
  it("no terms (an older app build): the order freezes the current terms and goes ahead, never terms_changed", async () => {
    const fn = await load();
    scenario.reads.shop_orders = { rows: [{ id: ORDER, buyer_id: BUYER, seller_id: MAKER, status: "awaiting_hold", items_cents: 1800, premium_cents: 160,
      cancel_policy: "until_accept", ready_tap_cancel: "from_day_before" }] };
    const res = await ask(fn);
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(409);
    expect(rpcs("shops_request_order")).toHaveLength(1);
    expect(rpcs("shops_cancel_order_request")).toHaveLength(0);
  });

  it("terms sent in the wrong shape: a bad request, nothing frozen", async () => {
    const fn = await load();
    const res = await ask(fn, { cancel_policy: 7 });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("invalid_terms");
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
    postSlackOpsAlert.mockImplementation((async (input: unknown) => { slackAlerts.push(input); return true; }) as never);
    try {
      await fn.fetch(fn.request({ headers: { Authorization: "Bearer cron-secret" } }));
    } finally {
      postSlackOpsAlert.mockImplementation(async (input: unknown) => { slackAlerts.push(input); });
    }
    const alert = slackAlerts.find((a: any) => /facilitator threshold/i.test(String(a.title ?? ""))) as { kind?: string; message?: string } | undefined;
    expect(alert?.kind).toBe("money_at_risk");
    expect(String(alert?.message)).toContain("$80123.45");
    expect(rpcs("facilitator_alert_sent")[0]?.args).toEqual({ p_year: 2026 });
  });

  // /code-review of shops-m3-v1 #3: a post that did not go out is never marked sent; it is tried again next run.
  it("an alert that was not delivered is not marked sent (retried next run)", async () => {
    env();
    const fn = await loadEdgeFunction("declutter-money");
    scenario.rpc.facilitator_threshold_check = { year: 2026, total_cents: 8012345, ops_alert_due: true };
    postSlackOpsAlert.mockImplementation((async (input: unknown) => { slackAlerts.push(input); return false; }) as never);
    try {
      await fn.fetch(fn.request({ headers: { Authorization: "Bearer cron-secret" } }));
    } finally {
      postSlackOpsAlert.mockImplementation(async (input: unknown) => { slackAlerts.push(input); });
    }
    expect(slackAlerts.some((a: any) => /facilitator threshold/i.test(String(a.title ?? "")))).toBe(true);
    expect(rpcs("facilitator_alert_sent")).toHaveLength(0);
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

// /code-review of shops-m3-v1 #1: a Shops charge refunded by hand in the Stripe Dashboard is recorded against its order.
describe("stripe-webhook: a Shops refund made by hand in Stripe", () => {
  async function deliver(type: string, object: Record<string, unknown>) {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id: `evt_${type}`, type, livemode: true, created: 1_760_000_000, data: { object } });
    return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
  }
  const shopCharge = (refunds: unknown[]) => ({
    id: "ch_shop", payment_intent: "pi_shop", amount: 2056, amount_refunded: 2056, currency: "usd",
    metadata: { kind: "shop_order", order_id: ORDER }, refunds: { has_more: false, data: refunds },
  });

  it("each hand refund is recorded once (shop_record_hand_refund), never the app's own; the jobs path never runs", async () => {
    scenario.rpc.shop_record_hand_refund = "closed_refunded";
    const res = await deliver("charge.refunded", shopCharge([
      { id: "re_hand", amount: 2056, status: "succeeded", metadata: {} },
      { id: "re_app", amount: 2000, status: "succeeded", metadata: { kind: "shop_refund", shop_refund_id: REFUND } },
      { id: "re_dead", amount: 2056, status: "failed", metadata: {} },
    ]));
    expect(res.status).toBe(200);
    expect(rpcs("shop_record_hand_refund").map((c) => c.args)).toEqual([{
      p_payment_intent_id: "pi_shop", p_stripe_refund_id: "re_hand", p_amount_cents: 2056, p_livemode: true,
      p_how: "webhook", p_admin: null, p_note: null,
    }]);
    expect(scenario.writes.filter((w) => w.table !== "stripe_webhook_events")).toEqual([]);
    const page = slackAlerts.find((a: any) => /refunded outside the app/.test(String(a.title))) as any;
    expect(page?.message).toMatch(/shop is not paid/);
  });

  it("only the app's own refunds: nothing recorded, nothing paged", async () => {
    const res = await deliver("charge.refunded", shopCharge([{ id: "re_app", amount: 2000, status: "succeeded", metadata: { kind: "shop_refund", shop_refund_id: REFUND } }]));
    expect(res.status).toBe(200);
    expect(rpcs("shop_record_hand_refund")).toHaveLength(0);
    expect(slackAlerts.some((a: any) => /refunded outside the app/.test(String(a.title)))).toBe(false);
  });

  it("before the function is deployed (PGRST202) ops is paged to record it in admin Shops orders", async () => {
    scenario.rpcErrors = { shop_record_hand_refund: { message: "not found", code: "PGRST202" } };
    const res = await deliver("charge.refunded", shopCharge([{ id: "re_hand", amount: 2056, status: "succeeded", metadata: {} }]));
    expect(res.status).toBe(200);
    const page = slackAlerts.find((a: any) => /refunded outside the app/.test(String(a.title))) as any;
    expect(page?.message).toMatch(/Record a refund made in Stripe/);
  });

  it("any other failure to record it is a 500 (Stripe redelivers)", async () => {
    scenario.rpcErrors = { shop_record_hand_refund: { message: "deadlock detected" } };
    const res = await deliver("charge.refunded", shopCharge([{ id: "re_hand", amount: 2056, status: "succeeded", metadata: {} }]));
    expect(res.status).toBe(500);
  });

  it("a recorded hand refund Stripe later fails pages 'NOT repaid' and stops; the jobs ledger is not touched", async () => {
    scenario.rpc.shop_hand_refund_failed = "marked_failed";
    scenario.rpc.declutter_hand_refund_failed = "not_declutter";
    const res = await deliver("charge.refund.updated", { id: "re_hand", object: "refund", status: "failed", failure_reason: "expired_or_canceled_card",
      amount: 2056, payment_intent: "pi_shop", charge: "ch_shop", metadata: {} });
    expect(res.status).toBe(200);
    expect(rpcs("shop_hand_refund_failed")[0]?.args).toEqual({ p_stripe_refund_id: "re_hand" });
    expect(scenario.writes.some((w) => w.table === "payment_refunds")).toBe(false);
    expect((slackAlerts.find((a: any) => /Shops refund made by hand FAILED/.test(String(a.title))) as any)?.message).toMatch(/NOT been repaid/);
  });

  it("pages that the settled refund row is held for review again", async () => {
    scenario.rpc.shop_hand_refund_failed = "reopened_held";
    scenario.rpc.declutter_hand_refund_failed = "not_declutter";
    const res = await deliver("charge.refund.updated", { id: "re_set", object: "refund", status: "failed", failure_reason: "lost_or_stolen_card",
      amount: 2056, payment_intent: "pi_shop", charge: "ch_shop", metadata: {} });
    expect(res.status).toBe(200);
    expect(scenario.writes.some((w) => w.table === "payment_refunds")).toBe(false);
    const page = slackAlerts.find((a: any) => /Shops refund made by hand FAILED/.test(String(a.title))) as any;
    expect(page?.message).toMatch(/held for review again/);
    expect(page?.fields?.Outcome).toBe("reopened_held");
  });

  it("a hand refund on an order whose own refund was unsent says it is held, with the charge's refund history, once per order", async () => {
    scenario.rpc.shop_record_hand_refund = "recorded_refund_held";
    const res = await deliver("charge.refunded", shopCharge([
      { id: "re_hand", amount: 1000, status: "succeeded", metadata: {} },
      { id: "re_app", amount: 2000, status: "succeeded", metadata: { kind: "shop_refund", shop_refund_id: REFUND } },
    ]));
    expect(res.status).toBe(200);
    const page = slackAlerts.find((a: any) => /refunded outside the app/.test(String(a.title))) as any;
    expect(page?.message).toMatch(/HELD/);
    expect(page?.message).toMatch(/re_hand \$10 succeeded \(by hand\); re_app \$20 succeeded \(app\)/);
    expect(page?.message).toMatch(/Refund re_hand \(\$10\) on pi_shop/);
    expect(page?.oncePerDayKey).toBe(`shop-hand-refund-${ORDER}`);
  });
});

// Run-3 review #2/#3: a held Shops refund is settled by Stripe id only after Stripe confirms the refund.
describe("shop-checkout admin_settle_held_refund: only a live refund on THIS row's payment, for at least the whole refund", () => {
  const ROW = "0000000e-0000-4000-8000-0000000000aa";
  const ask = (fn: Awaited<ReturnType<typeof as>>, over: Record<string, unknown> = {}) => tap(fn, {
    action: "admin_settle_held_refund", refund_row_id: ROW, refund_id: "re_dash", note: "Refunded by phone", ...over,
  });
  async function setup(isAdmin = true) {
    const fn = await as(ADMIN);
    scenario.reads.user_roles = { rows: isAdmin ? [{ role: "admin" }] : [] };
    scenario.reads.shop_refunds = { rows: [{ id: ROW, order_id: ORDER, stripe_payment_intent_id: "pi_shop", refund_cents: 1906, status: "held_for_review" }] };
    scenario.reads.shop_orders = { rows: [{ ...charged, status: "refunded" }] };
    scenario.rpc.shops_admin_settle_held_refund = { result: "settled", refund_id: ROW, adopted_hand_refund: true };
    return fn;
  }

  it("a finished refund for exactly what the row owes is settled with the admin's id and Stripe's amount, through the service key; no Stripe write, no page", async () => {
    const fn = await setup();
    stripeMock.refunds.retrieve.mockResolvedValue({ id: "re_dash", amount: 1906, status: "succeeded", payment_intent: "pi_shop" });
    const res = await ask(fn);
    expect(res.status).toBe(200);
    expect((await json(res)).result).toBe("settled");
    const call = rpcs("shops_admin_settle_held_refund")[0];
    expect(call?.args).toEqual({ p_admin: ADMIN, p_refund_id: ROW, p_stripe_refund_id: "re_dash", p_amount_cents: 1906, p_note: "Refunded by phone" });
    expect(clientOf(call)?.key).toBe("service-key");
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(slackAlerts.some((a: any) => /LARGER Stripe refund/.test(String(a.title)))).toBe(false);
  });

  it("a LARGER refund settles (the money moved) but pages ops, critical, with owed vs refunded (run-3 review L2)", async () => {
    const fn = await setup();
    scenario.rpc.shops_admin_settle_held_refund = { result: "settled", refund_id: ROW, adopted_hand_refund: true, owed_cents: 1906, over_refunded_cents: 150 };
    stripeMock.refunds.retrieve.mockResolvedValue({ id: "re_dash", amount: 2056, status: "succeeded", payment_intent: "pi_shop" });
    const res = await ask(fn);
    expect(res.status).toBe(200);
    expect((await json(res)).over_refunded_cents).toBe(150);
    const page = slackAlerts.find((a: any) => /LARGER Stripe refund/.test(String(a.title))) as any;
    expect(page?.severity).toBe("critical");
    expect(page?.message).toMatch(/gave the buyer \$20\.56; this order's refund owed \$19\.06\. The \$1\.50 difference/);
  });

  it("a refund Stripe has not finished is refused until it has (run-3 review L3)", async () => {
    const fn = await setup();
    stripeMock.refunds.retrieve.mockResolvedValue({ id: "re_dash", amount: 1906, status: "pending", payment_intent: "pi_shop" });
    const res = await ask(fn);
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("refund_pending");
    expect(rpcs("shops_admin_settle_held_refund")).toHaveLength(0);
  });

  it("a refund id Stripe does not know here (bad, other mode, other account) is refund_not_found, not try-again (run-3 review L5)", async () => {
    const fn = await setup();
    stripeMock.refunds.retrieve.mockRejectedValue(Object.assign(new Error("No such refund: 're_dash'"), { code: "resource_missing", statusCode: 404 }));
    const res = await ask(fn);
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe("refund_not_found");
    expect(rpcs("shops_admin_settle_held_refund")).toHaveLength(0);
  });

  it.each([
    [{ payment_intent: "pi_other", amount: 2056, status: "succeeded" }, "refund_not_on_this_order"],
    [{ payment_intent: "pi_shop", amount: 1905, status: "succeeded" }, "hand_refund_short"],
    [{ payment_intent: "pi_shop", amount: 2056, status: "canceled" }, "refund_not_live"],
  ])("a refund Stripe describes differently (%o) is refused (%s) and nothing is settled", async (rf, err) => {
    const fn = await setup();
    stripeMock.refunds.retrieve.mockResolvedValue({ id: "re_dash", ...rf });
    const res = await ask(fn);
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe(err);
    expect(rpcs("shops_admin_settle_held_refund")).toHaveLength(0);
  });

  it("a non-admin never reaches Stripe", async () => {
    const fn = await setup(false);
    const res = await ask(fn);
    expect(res.status).toBe(403);
    expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled();
    expect(rpcs("shops_admin_settle_held_refund")).toHaveLength(0);
  });
});

// v2 rule B: "Record a refund made in Stripe" is checked against Stripe before anything is recorded.
describe("shop-checkout admin_record_hand_refund: only a live refund on THIS order's payment, for this amount", () => {
  const ask = (fn: Awaited<ReturnType<typeof as>>, over: Record<string, unknown> = {}) => tap(fn, {
    action: "admin_record_hand_refund", order_id: ORDER, refund_id: "re_dash", amount_cents: 2056, note: "Refunded by phone", ...over,
  });
  async function setup(isAdmin = true) {
    const fn = await as(ADMIN);
    scenario.reads.user_roles = { rows: isAdmin ? [{ role: "admin" }] : [] };
    scenario.reads.shop_orders = { rows: [{ ...charged, status: "accepted" }] };
    scenario.rpc.shops_admin_record_hand_refund = { result: "closed_refunded", order_id: ORDER };
    return fn;
  }

  it("a matching refund is recorded with the admin's id, through the service key; no Stripe write", async () => {
    const fn = await setup();
    stripeMock.refunds.retrieve.mockResolvedValue({ id: "re_dash", amount: 2056, status: "succeeded", payment_intent: "pi_shop" });
    const res = await ask(fn);
    expect(res.status).toBe(200);
    expect((await json(res)).result).toBe("closed_refunded");
    const call = rpcs("shops_admin_record_hand_refund")[0];
    expect(call?.args).toEqual({ p_admin: ADMIN, p_order_id: ORDER, p_stripe_refund_id: "re_dash", p_amount_cents: 2056, p_note: "Refunded by phone" });
    expect(clientOf(call)?.key).toBe("service-key");
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ payment_intent: "pi_other", amount: 2056, status: "succeeded" }, "refund_not_on_this_order"],
    [{ payment_intent: "pi_shop", amount: 1000, status: "succeeded" }, "refund_amount_differs"],
    [{ payment_intent: "pi_shop", amount: 2056, status: "failed" }, "refund_not_live"],
  ])("a refund Stripe describes differently (%o) is refused (%s) and nothing is recorded", async (rf, err) => {
    const fn = await setup();
    stripeMock.refunds.retrieve.mockResolvedValue({ id: "re_dash", ...rf });
    const res = await ask(fn);
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe(err);
    expect(rpcs("shops_admin_record_hand_refund")).toHaveLength(0);
  });

  it("a non-admin never reaches Stripe", async () => {
    const fn = await setup(false);
    const res = await ask(fn);
    expect(res.status).toBe(403);
    expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled();
    expect(rpcs("shops_admin_record_hand_refund")).toHaveLength(0);
  });

  it("a refund id Stripe does not know here is refund_not_found, not try-again (run-3 review L5)", async () => {
    const fn = await setup();
    stripeMock.refunds.retrieve.mockRejectedValue(Object.assign(new Error("No such refund: 're_dash'"), { code: "resource_missing", statusCode: 404 }));
    const res = await ask(fn);
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe("refund_not_found");
    expect(rpcs("shops_admin_record_hand_refund")).toHaveLength(0);
  });
});
