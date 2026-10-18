/**
 * Shops M1, the Stripe side (migration 20261017225605_shops_orders_checkout;
 * docs/specs/local-shops-prep.md L17/L18, F1, O1): shop-checkout (order /
 * accept / decline / cancel), the stripe-webhook hold handler, and
 * declutter-money's shop step, all through _shared/shopHolds.ts.
 *
 * Runs the REAL function source through the edge harness; Stripe, Supabase and
 * the Deno runtime are doubled. The order RULES live in SQL and are proven by
 * src/test/pglite/shopsOrders.pglite.mjs; this file proves the edge side calls
 * them as the right person, with the right numbers, and moves money once.
 *
 * Registered mutations - each turns this file RED on its own:
 * @mutate supabase/functions/shop-checkout/index.ts |       payment_intent_data: { metadata: meta, capture_method: "manual", transfer_group: `shop_order_${o.id}` }, |       payment_intent_data: { metadata: meta, transfer_group: `shop_order_${o.id}` },
 * @mutate supabase/functions/shop-checkout/index.ts |       automatic_tax: { enabled: true }, |
 * @mutate supabase/functions/shop-checkout/index.ts |     { idempotencyKey: `shop-order-${o.id}` }, |     {},
 * @mutate supabase/functions/shop-checkout/index.ts |   if (session.amount_subtotal !== o.items_cents + o.premium_cents) { |   if (false) {
 * @mutate supabase/functions/shop-checkout/index.ts |   if (frozen.superseded_session_id) await expirePage(frozen.superseded_session_id); |
 * @mutate supabase/functions/_shared/shopHolds.ts |     const pi = await stripe.paymentIntents.capture(paymentIntentId, {}, { idempotencyKey: shopCaptureKey(orderId, attempt) }); |     const pi = await stripe.paymentIntents.capture(paymentIntentId);
 * @mutate supabase/functions/_shared/shopHolds.ts |   return `shop-capture-${orderId}-${Number.isInteger(attempt) && attempt >= 0 ? attempt : 0}`; |   return `shop-capture-${orderId}`;
 * @mutate supabase/functions/_shared/shopHolds.ts |       await recordReleaseFailure(admin, row.order_id, "payment captured on a closed order"); |
 * @mutate supabase/functions/stripe-webhook/handlers/shopCheckout.ts |       if (applied) return; |       if (true) return;
 * @mutate supabase/functions/_shared/shopHolds.ts |     else if (now.status === "canceled") lost = true; |
 * @mutate supabase/functions/_shared/shopHolds.ts |   } else if (pi.status === "succeeded") { |   } else if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |   if (isShopSession(session)) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/shopCheckout.ts |   if (pi.status !== "requires_capture") { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/shopCheckout.ts |     p_livemode: event.livemode === true,\n  }); |     p_livemode: false,\n  });
 * @mutate supabase/functions/declutter-money/index.ts |     const swept = await admin.rpc("shop_order_sweep", {}); |     const swept = { error: null, data: {} };
 * @mutate supabase/functions/shop-checkout/index.ts |     name, tax_details: { tax_code: taxCode, performance_location: location }, |     name, tax_details: { tax_code: taxCode, performance_location: "" },
 * @mutate supabase/functions/shop-checkout/index.ts |   if (a.stripe_tax_location_id && a.stripe_tax_location_mode === mode) return a.stripe_tax_location_id; |   if (a.stripe_tax_location_id) return a.stripe_tax_location_id;
 * @mutate supabase/functions/shop-checkout/index.ts |   if (!location) return json({ error: "pickup_address_missing" }, 409); |
 * @mutate supabase/functions/shop-checkout/index.ts |     .eq("shop_id", shopId).eq("updated_at", a.updated_at); |     .eq("shop_id", shopId);
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";
import { resetEmailMocks } from "./mocks/email";

const BUYER = "0000000b-0000-4000-8000-000000000001";
const MAKER = "0000000b-0000-4000-8000-000000000002";
const SHOP = "0000000b-0000-4000-8000-0000000000cc";
const ORDER = "0000000b-0000-4000-8000-0000000000aa";
const ITEM = "0000000b-0000-4000-8000-0000000000bb";

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
/** The order row as the service-role read returns it. */
const orderRow = (over: Record<string, unknown> = {}) => ({
  id: ORDER, buyer_id: BUYER, seller_id: MAKER, status: "awaiting_hold", items_cents: 6100, premium_cents: 375,
  stripe_checkout_session_id: null, stripe_payment_intent_id: null, payment_livemode: null, captured_at: null,
  capture_attempts: 0, ...over,
});

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
  resetEmailMocks();
  // Real members (no test_accounts rows): live mode.
  scenario.reads.test_accounts = { rows: [] };
});

describe("shop-checkout: the buyer asks for an order (a card HOLD, Stripe Tax on)", () => {
  async function load() {
    env();
    scenario.authUser = { id: BUYER, email: "buyer@test.dev", email_confirmed_at: "2026-10-01T00:00:00Z" };
    return loadEdgeFunction("shop-checkout");
  }
  const ask = (fn: Awaited<ReturnType<typeof load>>) => fn.request({
    headers: { Authorization: "Bearer buyer-jwt" },
    body: { action: "order", shop_id: SHOP, lines: [{ item_id: ITEM, quantity: 2 }], ready_date: "2026-10-30", note: "" },
  });
  function frozen(over: Record<string, unknown> = {}) {
    scenario.rpc.shops_request_order = { order_id: ORDER, items_cents: 6100, premium_cents: 375, superseded_session_id: null, ...over };
    scenario.reads.shop_orders = { rows: [orderRow()] };
    scenario.reads.shop_order_lines = { rows: [
      { title: "Kolache dozen", kind: "home_food", unit_cents: 1800, quantity: 2, line_cents: 3600 },
      { title: "Fig candle", kind: "made", unit_cents: 2500, quantity: 1, line_cents: 2500 },
    ] };
    scenario.reads.declutter_buyer_cards = { rows: [] };
    scenario.rpc.shop_attach_checkout_session = null;
    scenario.reads.shop_pickup_addresses = { rows: [pickup()] };
    stripeMock.rawRequest.mockResolvedValue({ id: "taxloc_new", type: "performance" });
  }
  /** The shop's private pickup address row (M1b part 2), as the service-role read returns it. */
  const pickup = (over: Record<string, unknown> = {}) => ({
    line1: "705 W University Ave", line2: null, city: "Lafayette", state: "LA", postal_code: "70506",
    stripe_tax_location_id: null, stripe_tax_location_mode: null, updated_at: "2026-10-18T03:00:00.123456+00:00", ...over,
  });

  it("freezes the order AS THE BUYER and opens a manual-capture page for exactly the items + the F1 fee, tax by Stripe", async () => {
    const fn = await load();
    frozen();
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://checkout.stripe.test/shop", amount_subtotal: 6475 });
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(200);
    expect((await json(res)).url).toBe("https://checkout.stripe.test/shop");
    const req = rpcs("shops_request_order")[0];
    expect(clientOf(req)?.key).toBe("anon-key");
    expect(JSON.stringify(clientOf(req)?.options)).toContain("Bearer buyer-jwt");
    const [params, opts] = stripeMock.checkout.sessions.create.mock.calls[0];
    const sum = params.line_items.reduce((s: number, l: any) => s + l.price_data.unit_amount * l.quantity, 0);
    expect(sum).toBe(6100 + 375);
    expect(params.payment_intent_data.capture_method).toBe("manual");
    expect(params.payment_intent_data.transfer_data).toBeUndefined();
    expect(params.payment_intent_data.transfer_group).toBe(`shop_order_${ORDER}`);
    expect(params.automatic_tax).toEqual({ enabled: true });
    // Tax memo Q2/Q5: the kolaches are food for home, the candle general goods, and the 375c fee
    // follows them pro rata (221 + 154), one fee line per code.
    expect(params.line_items.map((l: any) => [l.price_data.product_data.tax_details.tax_code, l.price_data.unit_amount])).toEqual([
      ["txcd_40040000", 1800], ["txcd_99999999", 2500], ["txcd_40040000", 221], ["txcd_99999999", 154],
    ]);
    expect(params.line_items.slice(2).map((l: any) => l.price_data.product_data.name)).toEqual([
      "Service fee (5% + $0.70), food items", "Service fee (5% + $0.70), made items",
    ]);
    expect(params.metadata).toMatchObject({ kind: "shop_order", order_id: ORDER, buyer_id: BUYER, payer_id: BUYER, seller_id: MAKER });
    expect(opts.idempotencyKey).toBe(`shop-order-${ORDER}`);
    expect(stripeMock.__key).toBe("sk_live_shops");
    const attach = rpcs("shop_attach_checkout_session")[0];
    expect(attach?.args).toEqual({ p_order_id: ORDER, p_session_id: "cs_live_shop" });
    expect(clientOf(attach)?.key).toBe("service-key");
  });

  it("taxes every line at the shop's pickup address: a Stripe Tax location made once, cached for that address", async () => {
    const fn = await load();
    frozen();
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://x", amount_subtotal: 6475 });
    expect((await fn.fetch(ask(fn))).status).toBe(200);
    expect(stripeMock.rawRequest).toHaveBeenCalledTimes(1);
    const [method, path, params, opts] = stripeMock.rawRequest.mock.calls[0];
    expect([method, path]).toEqual(["POST", "/v1/tax/locations"]);
    expect(params).toMatchObject({ type: "performance", address: { line1: "705 W University Ave", city: "Lafayette", state: "LA", postal_code: "70506", country: "US" } });
    expect(params.address).not.toHaveProperty("line2");
    expect(opts.idempotencyKey).toBe(`shop-taxloc-${SHOP}-live-2026-10-18T03:00:00.123456+00:00`);
    const [session] = stripeMock.checkout.sessions.create.mock.calls[0];
    for (const l of session.line_items) {
      expect(l.price_data.product_data.tax_details.performance_location).toBe("taxloc_new");
      // Stripe takes tax_code OR tax_details (measured in TEST mode: "only one of these parameters").
      expect(l.price_data.product_data).not.toHaveProperty("tax_code");
    }
    const cache = scenario.writes.filter((w) => w.table === "shop_pickup_addresses");
    expect(cache).toHaveLength(1);
    expect(cache[0].payload).toEqual({ stripe_tax_location_id: "taxloc_new", stripe_tax_location_mode: "live" });
    expect(cache[0].filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: "shop_id", value: SHOP }),
      expect.objectContaining({ column: "updated_at", value: "2026-10-18T03:00:00.123456+00:00" }),
    ]));
  });

  it("reuses the cached location in the same Stripe mode, and makes a new one for the other mode", async () => {
    const fn = await load();
    frozen();
    scenario.reads.shop_pickup_addresses = { rows: [pickup({ stripe_tax_location_id: "taxloc_cached", stripe_tax_location_mode: "live" })] };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://x", amount_subtotal: 6475 });
    expect((await fn.fetch(ask(fn))).status).toBe(200);
    expect(stripeMock.rawRequest).not.toHaveBeenCalled();
    expect(stripeMock.checkout.sessions.create.mock.calls[0][0].line_items[0].price_data.product_data.tax_details.performance_location).toBe("taxloc_cached");
    expect(scenario.writes.filter((w) => w.table === "shop_pickup_addresses")).toHaveLength(0);

    stripeMock.checkout.sessions.create.mockClear();
    scenario.reads.shop_pickup_addresses = { rows: [pickup({ stripe_tax_location_id: "taxloc_cached", stripe_tax_location_mode: "test" })] };
    expect((await fn.fetch(ask(fn))).status).toBe(200);
    expect(stripeMock.rawRequest).toHaveBeenCalledTimes(1);
    expect(stripeMock.checkout.sessions.create.mock.calls[0][0].line_items[0].price_data.product_data.tax_details.performance_location).toBe("taxloc_new");
  });

  it("no pickup address: refused in its own words, no location and no page", async () => {
    const fn = await load();
    frozen();
    scenario.reads.shop_pickup_addresses = { rows: [] };
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("pickup_address_missing");
    expect(stripeMock.rawRequest).not.toHaveBeenCalled();
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("expires the page a superseded order had open", async () => {
    const fn = await load();
    frozen({ superseded_session_id: "cs_live_old" });
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://x", amount_subtotal: 6475 });
    await fn.fetch(ask(fn));
    expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith("cs_live_old");
  });

  it("a page whose subtotal is not the frozen order is expired and never attached", async () => {
    const fn = await load();
    frozen();
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_bad", url: "https://x", amount_subtotal: 6000 });
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(500);
    expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith("cs_live_bad");
    expect(rpcs("shop_attach_checkout_session")).toHaveLength(0);
  });

  it("a refusal from the SQL is passed through in its own words, and no page is opened", async () => {
    const fn = await load();
    scenario.rpcErrors = { ...(scenario.rpcErrors ?? {}), shops_request_order: { message: "day_full", code: "55000" } };
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("day_full");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe("shop-checkout: the maker answers", () => {
  async function load() {
    env();
    scenario.authUser = { id: MAKER, email: "maker@test.dev", email_confirmed_at: "2026-10-01T00:00:00Z" };
    return loadEdgeFunction("shop-checkout");
  }
  const held = orderRow({ status: "accepted", stripe_checkout_session_id: "cs_live_shop", stripe_payment_intent_id: "pi_shop", payment_livemode: true, capture_attempts: 3 });

  it("accept: the SQL accepts AS THE MAKER, then the hold is captured once and recorded with Stripe's fee", async () => {
    const fn = await load();
    scenario.rpc.shops_accept_order = { result: "accepted", order_id: ORDER, captured: false };
    scenario.reads.shop_orders = { rows: [held] };
    stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_shop", status: "succeeded" });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_shop", status: "succeeded", latest_charge: { balance_transaction: { fee: 211 } } });
    scenario.rpc.shop_order_captured = { result: "captured" };
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer maker-jwt" }, body: { action: "accept", order_id: ORDER } }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ accepted: true, charged: true });
    expect(clientOf(rpcs("shops_accept_order")[0])?.key).toBe("anon-key");
    expect(stripeMock.paymentIntents.capture).toHaveBeenCalledTimes(1);
    // One key per attempt (review fix 1): Stripe replays a stored error for a reused key.
    expect(stripeMock.paymentIntents.capture).toHaveBeenCalledWith("pi_shop", {}, { idempotencyKey: `shop-capture-${ORDER}-3` });
    expect(rpcs("shop_order_captured")[0]?.args).toEqual({ p_order_id: ORDER, p_card_fee_cents: 211 });
  });

  it("accept: a hold Stripe already let go ends the order (hold_lost), it is never left 'accepted'", async () => {
    const fn = await load();
    scenario.rpc.shops_accept_order = { result: "accepted", order_id: ORDER, captured: false };
    scenario.reads.shop_orders = { rows: [held] };
    stripeMock.paymentIntents.capture.mockRejectedValue(new Error("This PaymentIntent could not be captured because it has a status of canceled."));
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_shop", status: "canceled" });
    scenario.rpc.shop_order_capture_failed = { result: "cancelled", order_id: ORDER };
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer maker-jwt" }, body: { action: "accept", order_id: ORDER } }));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("hold_lost");
    expect((rpcs("shop_order_capture_failed")[0]?.args as Record<string, unknown>).p_final).toBe(true);
    expect(rpcs("shop_order_captured")).toHaveLength(0);
  });

  it("accept: a passing Stripe error leaves the order accepted for the cron to charge (not final)", async () => {
    const fn = await load();
    scenario.rpc.shops_accept_order = { result: "accepted", order_id: ORDER, captured: false };
    scenario.reads.shop_orders = { rows: [held] };
    stripeMock.paymentIntents.capture.mockRejectedValue(new Error("timeout"));
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_shop", status: "requires_capture" });
    scenario.rpc.shop_order_capture_failed = { result: "will_retry", attempts: 1 };
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer maker-jwt" }, body: { action: "accept", order_id: ORDER } }));
    expect(await json(res)).toEqual({ accepted: true, charged: false });
    expect((rpcs("shop_order_capture_failed")[0]?.args as Record<string, unknown>).p_final).toBe(false);
  });

  it("accept: when even the payment's state cannot be read, it is a counted retry (the next try gets a new key), never a thrown 500", async () => {
    const fn = await load();
    scenario.rpc.shops_accept_order = { result: "accepted", order_id: ORDER, captured: false };
    scenario.reads.shop_orders = { rows: [held] };
    stripeMock.paymentIntents.capture.mockRejectedValue(new Error("timeout"));
    stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error("timeout again"));
    scenario.rpc.shop_order_capture_failed = { result: "will_retry", attempts: 4 };
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer maker-jwt" }, body: { action: "accept", order_id: ORDER } }));
    expect(await json(res)).toEqual({ accepted: true, charged: false });
    const args = rpcs("shop_order_capture_failed")[0]?.args as Record<string, unknown>;
    expect(args.p_final).toBe(false);
    expect(String(args.p_error)).toMatch(/state unreadable/);
  });

  it("decline: the SQL declines AS THE MAKER, then the hold is cancelled (no cost) and recorded", async () => {
    const fn = await load();
    scenario.rpc.shops_decline_order = { result: "declined", order_id: ORDER };
    scenario.reads.shop_orders = { rows: [orderRow({ status: "declined", stripe_checkout_session_id: "cs_live_shop", stripe_payment_intent_id: "pi_shop", payment_livemode: true })] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_shop", status: "requires_capture" });
    stripeMock.paymentIntents.cancel.mockResolvedValue({ id: "pi_shop", status: "canceled" });
    scenario.rpc.shop_hold_released = null;
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer maker-jwt" }, body: { action: "decline", order_id: ORDER, reason: "Sold out" } }));
    expect(res.status).toBe(200);
    expect(rpcs("shops_decline_order")[0]?.args).toEqual({ p_order_id: ORDER, p_reason: "Sold out" });
    expect(stripeMock.paymentIntents.cancel).toHaveBeenCalledWith("pi_shop", {}, { idempotencyKey: `shop-release-${ORDER}` });
    expect(rpcs("shop_hold_released")[0]?.args).toEqual({ p_order_id: ORDER });
    expect(stripeMock.paymentIntents.capture).not.toHaveBeenCalled();
  });

  it("a closed order whose payment Stripe shows CAPTURED is never marked released, and ops are paged", async () => {
    const fn = await load();
    scenario.rpc.shops_decline_order = { result: "declined", order_id: ORDER };
    scenario.reads.shop_orders = { rows: [orderRow({ status: "declined", stripe_checkout_session_id: "cs_live_shop", stripe_payment_intent_id: "pi_shop", payment_livemode: true })] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_shop", status: "succeeded" });
    await fn.fetch(fn.request({ headers: { Authorization: "Bearer maker-jwt" }, body: { action: "decline", order_id: ORDER } }));
    expect(stripeMock.paymentIntents.cancel).not.toHaveBeenCalled();
    expect(rpcs("shop_hold_released")).toHaveLength(0);
    expect((slackAlerts as Array<{ title: string }>).some((a) => /closed order's payment was captured/.test(a.title))).toBe(true);
    // Counted, so it goes behind the cancels that can still happen (review note 6).
    expect(rpcs("shop_hold_release_failed")[0]?.args).toMatchObject({ p_order_id: ORDER });
  });
});

describe("stripe-webhook: a shop order's hold lands", () => {
  async function deliver(answer: unknown, piStatus = "requires_capture") {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_shop_1", type: "checkout.session.completed", livemode: true, created: 1_760_000_000,
      data: { object: {
        id: "cs_live_shop", mode: "payment", payment_status: "unpaid", payment_intent: "pi_shop", amount_total: 6625,
        total_details: { amount_tax: 150 }, client_reference_id: ORDER,
        metadata: { kind: "shop_order", order_id: ORDER, buyer_id: BUYER, payer_id: BUYER, seller_id: MAKER },
      } },
    });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_shop", status: piStatus });
    stripeMock.paymentIntents.cancel.mockResolvedValue({ id: "pi_shop", status: "canceled" });
    scenario.rpc.shop_mark_order_held = answer;
    scenario.rpc.shop_hold_released = null;
    return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
  }

  it("records the hold with Stripe's total and tax and the payment's mode; nothing is captured or cancelled", async () => {
    const res = await deliver({ result: "held", order_id: ORDER });
    expect(res.status).toBe(200);
    expect(rpcs("shop_mark_order_held")[0]?.args).toEqual({
      p_session_id: "cs_live_shop", p_payment_intent_id: "pi_shop", p_amount_total: 6625, p_tax_cents: 150, p_livemode: true,
    });
    expect(stripeMock.paymentIntents.capture).not.toHaveBeenCalled();
    expect(stripeMock.paymentIntents.cancel).not.toHaveBeenCalled();
  });

  it("a 'cancel_hold' answer cancels the hold once and records it", async () => {
    await deliver({ result: "cancel_hold", reason: "order_closed", order_id: ORDER });
    expect(stripeMock.paymentIntents.cancel).toHaveBeenCalledWith("pi_shop", {}, { idempotencyKey: `shop-release-${ORDER}` });
    expect(rpcs("shop_hold_released")[0]?.args).toEqual({ p_order_id: ORDER });
  });

  it("a payment that is not an open hold is never marked held", async () => {
    scenario.reads.shop_orders = { rows: [] };
    await deliver({ result: "held", order_id: ORDER }, "succeeded");
    expect(rpcs("shop_mark_order_held")).toHaveLength(0);
  });

  it("a redelivery after the capture is a quiet no-op, not a throw Stripe would redeliver for days (review note 7)", async () => {
    scenario.reads.shop_orders = { rows: [{ id: ORDER, status: "accepted", stripe_payment_intent_id: "pi_shop" }] };
    const res = await deliver({ result: "held", order_id: ORDER }, "succeeded");
    expect(res.status).toBe(200);
    expect((slackAlerts as Array<{ title: string }>).some((a) => /no order recorded/.test(a.title))).toBe(false);
  });

  it("a captured payment no order carries pages ops and answers 200", async () => {
    scenario.reads.shop_orders = { rows: [] };
    const res = await deliver({ result: "held", order_id: ORDER }, "succeeded");
    expect(res.status).toBe(200);
    expect((slackAlerts as Array<{ title: string }>).some((a) => /no order recorded/.test(a.title))).toBe(true);
  });

  it("a failed write throws, so Stripe redelivers (the dedupe row is rolled back)", async () => {
    scenario.rpcErrors = { ...(scenario.rpcErrors ?? {}), shop_mark_order_held: { message: "boom" } };
    const res = await deliver(null);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});

describe("declutter-money: the shop step", () => {
  it("runs the order clock, cancels due holds and retries due captures, each once", async () => {
    env();
    const fn = await loadEdgeFunction("declutter-money");
    scenario.rpc.shop_order_sweep = { no_answer: 1, page_unpaid: 0 };
    scenario.rpc.shop_holds_to_release = [{ order_id: ORDER, buyer_id: BUYER, seller_id: MAKER, payment_intent_id: "pi_rel", livemode: true, checkout_session_id: "cs_live_rel" }];
    scenario.rpc.shop_captures_due = [{ order_id: "0000000b-0000-4000-8000-0000000000ab", buyer_id: BUYER, seller_id: MAKER, payment_intent_id: "pi_cap", livemode: true, checkout_session_id: "cs_live_cap", attempts: 1 }];
    scenario.rpc.shop_hold_released = null;
    scenario.rpc.shop_order_captured = { result: "captured" };
    stripeMock.paymentIntents.retrieve.mockImplementation(async (id: string) => ({ id, status: id === "pi_rel" ? "requires_capture" : "succeeded", latest_charge: { balance_transaction: { fee: 99 } } }));
    stripeMock.paymentIntents.cancel.mockResolvedValue({ status: "canceled" });
    stripeMock.paymentIntents.capture.mockResolvedValue({ status: "succeeded" });
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer cron-secret" } }));
    expect(res.status).toBe(200);
    expect(rpcs("shop_order_sweep")).toHaveLength(1);
    expect(stripeMock.paymentIntents.cancel).toHaveBeenCalledWith("pi_rel", {}, { idempotencyKey: `shop-release-${ORDER}` });
    expect(stripeMock.paymentIntents.capture).toHaveBeenCalledWith("pi_cap", {}, { idempotencyKey: "shop-capture-0000000b-0000-4000-8000-0000000000ab-1" });
    expect(rpcs("shop_order_captured")[0]?.args).toEqual({ p_order_id: "0000000b-0000-4000-8000-0000000000ab", p_card_fee_cents: 99 });
  });
});
