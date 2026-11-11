/**
 * Shops M1, the Stripe side (migration 20261018164442_shops_orders_checkout;
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
 * @mutate supabase/functions/shop-checkout/index.ts |        metadata: meta, capture_method: "manual", transfer_group: `shop_order_${o.id}`, |        metadata: meta, transfer_group: `shop_order_${o.id}`,
 * @mutate supabase/functions/shop-checkout/index.ts |       billing_address_collection: "required", |       automatic_tax: { enabled: true },\n      billing_address_collection: "required",
 * @mutate supabase/functions/shop-checkout/index.ts |     { idempotencyKey: `shop-order-${o.id}${walletRetry ? ":new-wallet" : ""}` }, |     {},
 * @mutate supabase/functions/shop-checkout/index.ts |   if (session.amount_subtotal !== chargedCents - giftCents) { |   if (false) {
 * @mutate supabase/functions/shop-checkout/index.ts |   if (frozen.superseded_session_id) await expirePage(frozen.superseded_session_id); |
 * @mutate supabase/functions/shop-checkout/index.ts |     customerId = (await storedStripeCustomer(admin, user.id, mode)) ?? undefined; |     customerId = undefined;
 * @mutate supabase/functions/shop-checkout/index.ts | await withStoredWalletCustomer(admin, stripe, user, mode, customerId, (payer, walletRetry) => | await ((_a: unknown, _b: unknown, _c: unknown, _d: unknown, c: string \| undefined, f: (c: string \| undefined, r: boolean) => unknown) => f(c, false))(admin, stripe, user, mode, customerId, (payer, walletRetry) =>
 * @mutate supabase/functions/shop-checkout/index.ts |     return json({ error: TRY_AGAIN }, 503);\n  }\n\n  /** The order sheet's own name | }\n\n  /** The order sheet's own name
 * @mutate supabase/functions/_shared/shopHolds.ts |       { idempotencyKey: shopCaptureKey(orderId, attempt) }); |       );
 * @mutate supabase/functions/shop-checkout/index.ts |        if (pg.stripe_checkout_session_id) await expirePage(pg.stripe_checkout_session_id); |        if (pg.stripe_checkout_session_id) void 0;
 * @mutate supabase/functions/_shared/shopHolds.ts | amountToCapture === null ? {} : { amount_to_capture: amountToCapture, metadata: { [SHOP_DEPOSIT_CAPTURE_KEY]: String(amountToCapture) } }, | {},
 * @mutate supabase/functions/_shared/shopHolds.ts |   if (row.payment_plan !== "deposit_50" \|\| typeof cents !== "number" | if (row.payment_plan !== "deposit_50" \|\| typeof cents === "symbol"
 * @mutate supabase/functions/_shared/shopHolds.ts |   return `shop-capture-${orderId}-${Number.isInteger(attempt) && attempt >= 0 ? attempt : 0}`; |   return `shop-capture-${orderId}`;
 * @mutate supabase/functions/_shared/shopHolds.ts |       await recordReleaseFailure(admin, row.order_id, "payment captured on a closed order"); |
 * @mutate supabase/functions/stripe-webhook/handlers/shopCheckout.ts |       if (applied) return; |       if (true) return;
 * @mutate supabase/functions/_shared/shopHolds.ts |     else if (now.status === "canceled") lost = true; |
 * @mutate supabase/functions/_shared/shopHolds.ts |   } else if (pi.status === "succeeded") { |   } else if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |   if (isShopSession(session)) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/shopCheckout.ts |   if (pi.status !== "requires_capture") { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/shopCheckout.ts |     p_livemode: event.livemode === true,\n  }); |     p_livemode: false,\n  });
 * @mutate supabase/functions/declutter-money/index.ts |     const swept = await admin.rpc("shop_order_sweep", {}); |     const swept = { error: null, data: {} };
 * @mutate supabase/functions/shop-checkout/index.ts |     if (addr === "missing") return json({ error: "pickup_address_missing" }, 409); |
 * @mutate supabase/functions/shop-checkout/index.ts |   if (!mode \|\| !taxAddress \|\| o.seller_id !== ownerId) { |   if (!mode \|\| !taxAddress) {
 * Q2105 step 2 (a gift card pays first):
 * @mutate supabase/functions/shop-checkout/index.ts |      p_credit_id: giftCardId, p_order_id: o.id, p_user_id: user.id, p_tax_cents: tax.cents, p_retired_session: null, |      p_credit_id: giftCardId, p_order_id: o.id, p_user_id: user.id, p_tax_cents: 0, p_retired_session: null,
 * @mutate supabase/functions/shop-checkout/index.ts |        \|\| applied <= 0 \|\| rest + applied !== chargedCents) { |        \|\| applied <= 0) {
 * @mutate supabase/functions/shop-checkout/index.ts |      await closeOrder("a gift that covers it all"); |      void 0;
 * @mutate supabase/functions/shop-checkout/index.ts |      await closeOrder("its gift was refused"); |      void 0;
 * @mutate supabase/functions/shop-checkout/index.ts |    meta.gift_cents = String(applied); |    void 0;
 * H6 (tax at capture, not at the hold):
 * @mutate supabase/functions/shop-checkout/index.ts |    customer_details: { address, address_source: addressSource }, |    customer_details: { address: { ...address, postal_code: "70112" }, address_source: addressSource },
 * @mutate supabase/functions/shop-checkout/index.ts |  }, { idempotencyKey: `shop-tax-${orderId}` }); |  });
 * @mutate supabase/functions/shop-checkout/index.ts |  meta.tax_calculation_id = tax.calculationId; |
 * @mutate supabase/functions/shop-checkout/index.ts |  meta.job_tax_cents = String(tax.cents); |
 * @mutate supabase/functions/shop-checkout/index.ts |  if (tax.cents > 0) {\n    lineItems.push({ |  if (false) {\n    lineItems.push({
 * @mutate supabase/functions/shop-checkout/index.ts |    const { error: closeErr } = await asBuyer.rpc("shops_cancel_order_request", { p_order_id: o.id });\n    if (closeErr) console.error(`[shop-checkout] order ${o.id} not closed after its tax failed | const closeErr = null;\n    if (closeErr) console.error(`[shop-checkout] order ${o.id} not closed after its tax failed
 * @mutate supabase/functions/shop-checkout/index.ts |  return err.code === "customer_tax_location_invalid" \|\| | return true \|\|
 * @mutate supabase/functions/shop-checkout/index.ts |      ...feeParts.map((p, i) => ({ amount: p.cents, | ...feeParts.slice(1).map((p, i) => ({ amount: p.cents,
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |   const taxRefunds = ordinaryRefunds.filter((r) => !(r?.metadata as Record<string, string> \| null)?.shop_delivery_refund_id); |   const taxRefunds = ordinaryRefunds;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |   if (meta.kind === "shop_refund" && meta.shop_delivery_refund_id) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/shopCheckout.ts |  const taxCents = sessionJobTaxCents(session) ?? 0; |  const taxCents = session.total_details?.amount_tax ?? 0;
 * @mutate supabase/functions/stripe-webhook/handlers/_jobTaxCommit.ts |  const subjectId = md.job_id \|\| (md.kind === "shop_order" ? md.order_id : ""); |  const subjectId = md.job_id;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |  if (isShopCharge && !isOnboardingCorrectionOnly(liveRefunds, ordinaryRefunds)\n      && (taxRefunds.length > 0 \|\| ordinaryRefunds.length === 0)) { |  if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |    // money stayed. Undone before the row reopens (a re-sent refund then reverses its own share). Never throws.\n    await undoVisitTaxForFailedRefund({ |    // money stayed.\n    void ({
 * @mutate supabase/functions/shop-checkout/index.ts |   if (termsErr) return rpcRefusal(termsErr); |
 * H8 (b) (at-home cleaning taxed at the buyer's address):
 * @mutate supabase/functions/shop-checkout/index.ts |     calcAddress = { line1: serviceAddress.line1, | void { line1: serviceAddress.line1,
 * @mutate supabase/functions/shop-checkout/index.ts | \|\| !isLouisianaZip5(zip)) return "invalid"; | \|\| !/^7[01][0-9]{3}$/.test(zip)) return "invalid";
 * @mutate supabase/functions/shop-checkout/index.ts | description: atHome ? "Louisiana sales tax where the work is done" : | description: atHome ? "Louisiana sales tax where you pick up the order" :
 * @mutate supabase/functions/shop-checkout/index.ts |     if (atHome && askedLines.length > 1) return json({ error: "service_at_buyer_alone" }, 409); |
 * @mutate supabase/functions/shop-checkout/index.ts |     if (atHome && delivery) return json({ error: "at_buyer_no_delivery" }, 409); |
 * @mutate supabase/functions/shop-checkout/index.ts |     if (atHome && !serviceAddress) return json({ error: "service_address_needed" }, 400); |
 * @mutate supabase/functions/shop-checkout/index.ts |   const atHome = lines.some((l) => l.at_buyer === true); |   const atHome = false;
 * @mutate supabase/functions/shop-checkout/index.ts |   if (serviceAddress === "invalid") return json({ error: "invalid_service_address" }, 400); |
 * @mutate supabase/functions/shop-checkout/index.ts |     if (unusable) return json({ error: atHome ? "service_address_unusable" : "pickup_address_unusable" }, 409); |     if (unusable) return json({ error: "pickup_address_unusable" }, 409);
 * Q2146: a refused pickup address is stamped and its owner told (never for the buyer's own address or a try-again).
 * @mutate supabase/functions/shop-checkout/index.ts |     if (unusable && !atHome && pickupVersion?.updatedAt) { |     if (false) {
 * @mutate supabase/functions/shop-checkout/index.ts |     if (unusable && !atHome && pickupVersion?.updatedAt) { |     if (shopId) {
 * @mutate supabase/functions/shop-checkout/index.ts |     pickupVersion = null;
 | 

 * @mutate supabase/functions/shop-checkout/index.ts |   if (!atHome && pickupVersion?.refused && pickupVersion.updatedAt) { |   if (false) {
 * @mutate supabase/functions/shop-checkout/index.ts |      const { error: purgeErr } = await admin.from("shop_order_service_addresses").delete().eq("order_id", o.id); |      const purgeErr = null;
 * Delivery (migration 20261106180902, "Shop delivers"):
 * @mutate supabase/functions/shop-checkout/index.ts |  const chargedCents = o.items_cents + o.premium_cents + deliveryCents + setupFeeCents + tax.cents; |  const chargedCents = o.items_cents + o.premium_cents + setupFeeCents + tax.cents;
 * @mutate supabase/functions/shop-checkout/index.ts |  if (deliveryCents > 0) {\n    lineItems.push({ |  if (false) {\n    lineItems.push({
 * @mutate supabase/functions/shop-checkout/index.ts |    taxAddress = { line1: delivery.line1, | void { line1: delivery.line1,
 * @mutate supabase/functions/shop-checkout/index.ts |      p_city: delivery.city, p_postal_code: delivery.postal_code, p_lat: dropoff.lat, p_lng: dropoff.lng, |      p_city: delivery.city, p_postal_code: delivery.postal_code, p_lat: 30.22, p_lng: -92.02,
 * @mutate supabase/functions/shop-checkout/index.ts |      const { error: closeErr } = await asBuyer.rpc("shops_cancel_order_request", { p_order_id: frozen.order_id });\n      if (closeErr) console.error(`[shop-checkout] order ${frozen.order_id} not closed after its delivery | const closeErr = null;\n      if (closeErr) console.error(`[shop-checkout] order ${frozen.order_id} not closed after its delivery
 * @mutate supabase/functions/shop-checkout/index.ts |  if (atHome && fulfillment !== "pickup") { |  if (false) {
 * @mutate supabase/functions/shop-checkout/index.ts |    const { error: purgeErr } = await admin.from("shop_order_delivery_addresses").delete().eq("order_id", o.id); |    const purgeErr = null;
 * Helpr delivery, slice 2 (20261106223244):
 * @mutate supabase/functions/shop-checkout/index.ts |    if (!delErr && byHelpr && frozenHelprCents !== shownHelprCents) { |    if (false) {
 * @mutate supabase/functions/shop-checkout/index.ts |    const { data: setRow, error: delErr } = await admin.rpc(byHelpr ? "shop_set_order_helpr_delivery" : "shop_set_order_delivery", { |    const { data: setRow, error: delErr } = await admin.rpc("shop_set_order_delivery", {
 * @mutate supabase/functions/shop-checkout/index.ts |  const askedFulfillment = !delivery ? "pickup" : byHelpr ? "helpr_delivers" : "shop_delivers"; |  const askedFulfillment = fulfillment;
 * @mutate supabase/functions/shop-checkout/index.ts |  if (byHelpr && (!delivery \|\| !Number.isInteger(shownHelprCents) \|\| shownHelprCents <= 0)) { |  if (false) {
 * @mutate supabase/functions/shop-checkout/index.ts |  const { error: gateErr } = await asBuyer.rpc("shops_order_terms", { p_shop_id: shopId });\n  if (gateErr) return rpcRefusal(gateErr);\n  const apple | const apple
 * @mutate supabase/functions/shop-checkout/index.ts |      else ({ data: q, error: qErr } = await ask()); |      else void 0;
 * @mutate supabase/functions/shop-checkout/index.ts |      const { error: pauseErr } = await admin.rpc("declutter_route_outage", { p_minutes: 10 }); |      const pauseErr = null;
 * @mutate supabase/functions/shop-checkout/index.ts |  return json({ delivery_cents: cents, delivery_miles: miles }); |  return json({ delivery_cents: cents, delivery_miles: miles, route: (q as { route?: unknown }).route });
 * @mutate supabase/functions/shop-checkout/index.ts |  const off = await requireFeature(admin, "shops", user, corsHeaders);\n  if (off) return off; |
 * @mutate supabase/functions/shop-checkout/index.ts |    p_lat: point.lat, p_lng: point.lng,\n  });\n  if (setErr) return rpcRefusal(setErr); |    p_lat: 30.22, p_lng: -92.02,\n  });\n  if (setErr) return rpcRefusal(setErr);
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
  capture_attempts: 0, cancel_policy: "until_24h_before_ready", ready_tap_cancel: "from_day_before",
  payment_plan: "full_hold", deposit_cents: null, ...over,
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
    body: { action: "order", shop_id: SHOP, lines: [{ item_id: ITEM, quantity: 2 }], ready_date: "2026-10-30", note: "",
      terms: { cancel_policy: "until_24h_before_ready", ready_tap_cancel: "from_day_before" } },
  });
  function frozen(over: Record<string, unknown> = {}) {
    scenario.rpc.shops_request_order = { order_id: ORDER, items_cents: 6100, premium_cents: 375, superseded_session_id: null, ...over };
    scenario.reads.shop_orders = { rows: [orderRow()] };
    scenario.reads.shop_order_lines = { rows: [
      { title: "Kolache dozen", kind: "home_food", unit_cents: 1800, quantity: 2, line_cents: 3600 },
      { title: "Fig candle", kind: "made", unit_cents: 2500, quantity: 1, line_cents: 2500 },
    ] };
    scenario.reads.stripe_customers = { rows: [] };
    scenario.rpc.shop_attach_checkout_session = null;
    scenario.reads.shop_pickup_addresses = { rows: [pickup()] };
    scenario.reads.shops = { rows: [{ owner_id: MAKER }] };
    stripeMock.tax.calculations.create.mockResolvedValue({ id: "taxcalc_shop", tax_amount_exclusive: 150 });
  }
  /** The shop's private pickup address row (M1b part 2), as the service-role read returns it. */
  const pickup = (over: Record<string, unknown> = {}) => ({
    line1: "705 W University Ave", line2: null, city: "Lafayette", state_code: "LA", postal_code: "70506",
    stripe_tax_location_id: null, stripe_tax_location_mode: null, updated_at: "2026-10-18T03:00:00.123456+00:00", ...over,
  });

  // H8 (b) (lead 11-05; migration 20261106164313): carpet or furniture cleaning done at the buyer's place is taxed at
  // the buyer's address, ordered on its own; the address is kept for the order only (the shop reads it after accepting).
  const SERVICE = { line1: "12 Oak St", city: "Lafayette", postal_code: "70501" };
  const askAtHome = (fn: Awaited<ReturnType<typeof load>>, over: Record<string, unknown> = {}) => fn.request({
    headers: { Authorization: "Bearer buyer-jwt" },
    body: { action: "order", shop_id: SHOP, lines: [{ item_id: ITEM, quantity: 1 }], ready_date: "2026-10-30", note: "",
      terms: { cancel_policy: "until_24h_before_ready", ready_tap_cancel: "from_day_before" }, service_address: SERVICE, ...over },
  });
  function frozenAtHome() {
    frozen({ items_cents: 12000, premium_cents: 670 });
    scenario.reads.shop_orders = { rows: [orderRow({ items_cents: 12000, premium_cents: 670 })] };
    scenario.reads.shop_items = { rows: [{ id: ITEM, subtype: "fabric_cleaning", at_buyer: true }] };
    scenario.reads.shop_order_lines = { rows: [
      { title: "Couch cleaning at your home", kind: "service", tax_kind: "fabric_cleaning", at_buyer: true, unit_cents: 12000, quantity: 1, line_cents: 12000 },
    ] };
  }

  it("H8 (b): an at-home cleaning is taxed at the buyer's service address, never the pickup address, and the address is kept for the order", async () => {
    const fn = await load();
    frozenAtHome();
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://checkout.stripe.test/shop", amount_subtotal: 12820 });
    const res = await fn.fetch(askAtHome(fn));
    expect(res.status).toBe(200);
    const [calc] = stripeMock.tax.calculations.create.mock.calls[0];
    expect(calc.customer_details.address).toEqual({ line1: "12 Oak St", city: "Lafayette", state: "LA", postal_code: "70501", country: "US" });
    const saved = scenario.writes.filter((w) => w.table === "shop_order_service_addresses");
    expect(saved).toHaveLength(1);
    expect(saved[0].payload).toEqual({ order_id: ORDER, buyer_id: BUYER, line1: "12 Oak St", city: "Lafayette", state: "LA", postal_code: "70501" });
    // Stripe gets the address only in the tax calculation: never in the page's metadata.
    const [params] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(JSON.stringify(params)).not.toContain("12 Oak St");
    // The tax line says where the tax was figured (money review of 47a1a77824, note 3).
    const taxLine = params.line_items.find((l: any) => l.price_data.product_data.name === "Sales tax");
    expect(taxLine?.price_data.product_data.description).toBe("Louisiana sales tax where the work is done");
  });

  it("H8 (b): only a Louisiana ZIP is a service address: 702xx, 709xx and Arkansas' 716xx are refused (money review of 47a1a77824)", async () => {
    for (const zip of ["71601", "70200", "70901", "71500", "7050", "70501-1234"]) {
      const fn = await load();
      frozenAtHome();
      const res = await fn.fetch(askAtHome(fn, { service_address: { ...SERVICE, postal_code: zip } }));
      expect([zip, res.status]).toEqual([zip, 400]);
      expect((await json(res)).error).toBe("invalid_service_address");
    }
    expect(rpcs("shops_request_order")).toHaveLength(0);
    expect(stripeMock.tax.calculations.create).not.toHaveBeenCalled();
  });

  it("H8 (b): an in-shop order is still taxed at the pickup address and stores no service address", async () => {
    const fn = await load();
    frozen();
    scenario.reads.shop_items = { rows: [{ id: ITEM, subtype: "baked_goods", at_buyer: false }] };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://checkout.stripe.test/shop", amount_subtotal: 6625 });
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(200);
    expect(stripeMock.tax.calculations.create.mock.calls[0][0].customer_details.address.postal_code).toBe("70506");
    expect(scenario.writes.filter((w) => w.table === "shop_order_service_addresses")).toHaveLength(0);
  });

  // Custom orders slice 2b (20261106215722): a 50% deposit order's page saves the card for the rest (charged off-session
  // from the ready date, _shared/shopBalance.ts); a buyer with no stored customer gets one made by Checkout.
  it("a deposit order's page saves the card off-session (a Customer is made) and says when the rest is charged", async () => {
    const fn = await load();
    frozen();
    scenario.reads.shop_orders = { rows: [orderRow({ payment_plan: "deposit_50" })] };
    scenario.reads.shop_items = { rows: [{ id: ITEM, subtype: "baked_goods", at_buyer: false }] };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://checkout.stripe.test/shop", amount_subtotal: 6625 });
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(200);
    const [params] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params.payment_intent_data).toMatchObject({ capture_method: "manual", setup_future_usage: "off_session", metadata: { payment_plan: "deposit_50" } });
    expect(params.customer_creation).toBe("always");
    expect(params.metadata.payment_plan).toBe("deposit_50");
    expect(params.custom_text?.submit?.message).toMatch(/rest is charged to this card on the ready date/);
  });

  it("a full-hold order's page saves no card", async () => {
    const fn = await load();
    frozen();
    scenario.reads.shop_items = { rows: [{ id: ITEM, subtype: "baked_goods", at_buyer: false }] };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://checkout.stripe.test/shop", amount_subtotal: 6625 });
    await fn.fetch(ask(fn));
    const [params] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params.payment_intent_data.setup_future_usage).toBeUndefined();
    expect(params.customer_creation).toBeUndefined();
    expect(params.metadata.payment_plan).toBeUndefined();
  });

  it("H8 (b): an at-home cleaning with no address, or with other items, is refused before the order freezes", async () => {
    const fn = await load();
    frozenAtHome();
    const none = await fn.fetch(askAtHome(fn, { service_address: undefined }));
    expect(none.status).toBe(400);
    expect((await json(none)).error).toBe("service_address_needed");
    const mixed = await fn.fetch(askAtHome(fn, { lines: [{ item_id: ITEM, quantity: 1 }, { item_id: SHOP, quantity: 1 }] }));
    expect(mixed.status).toBe(409);
    expect((await json(mixed)).error).toBe("service_at_buyer_alone");
    // Restack (l106 + delivery): work done at the buyer's place has nothing to deliver.
    const delivered = await fn.fetch(askAtHome(fn, { delivery: { line1: "100 Main St", city: "Lafayette", postal_code: "70501" } }));
    expect(delivered.status).toBe(409);
    expect((await json(delivered)).error).toBe("at_buyer_no_delivery");
    const bad = await fn.fetch(askAtHome(fn, { service_address: { ...SERVICE, postal_code: "77002" } }));
    expect(bad.status).toBe(400);
    expect((await json(bad)).error).toBe("invalid_service_address");
    expect(rpcs("shops_request_order")).toHaveLength(0);
    expect(stripeMock.tax.calculations.create).not.toHaveBeenCalled();
  });

  it("H8 (b): a frozen at-home line with no address closes the order (the item changed after the early check)", async () => {
    const fn = await load();
    frozenAtHome();
    scenario.reads.shop_items = { rows: [{ id: ITEM, subtype: "fabric_cleaning", at_buyer: false }] };
    const res = await fn.fetch(askAtHome(fn, { service_address: undefined }));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("service_address_needed");
    expect(rpcs("shops_cancel_order_request")).toHaveLength(1);
    expect(stripeMock.tax.calculations.create).not.toHaveBeenCalled();
  });

  it("H8 (b): an address Stripe cannot tax says so in the buyer's words, closes the order and keeps no copy", async () => {
    const fn = await load();
    frozenAtHome();
    stripeMock.tax.calculations.create.mockRejectedValue(Object.assign(new Error("bad address"), { type: "StripeInvalidRequestError", code: "customer_tax_location_invalid" }));
    const res = await fn.fetch(askAtHome(fn));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("service_address_unusable");
    // Q2146: the buyer's own address is not the shop's to fix: no stamp, no notice to the shop.
    expect(rpcs("shops_mark_pickup_address_refused")).toHaveLength(0);
    expect(rpcs("shops_cancel_order_request")).toHaveLength(1);
    expect(scenario.writes.filter((w) => w.table === "shop_order_service_addresses").map((w) => w.op)).toEqual(["insert", "delete"]);
  });

  it("freezes the order AS THE BUYER and opens a manual-capture page: the items + the F1 fee + our own Sales tax line (H6)", async () => {
    const fn = await load();
    frozen();
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://checkout.stripe.test/shop", amount_subtotal: 6625 });
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(200);
    expect((await json(res)).url).toBe("https://checkout.stripe.test/shop");
    const req = rpcs("shops_request_order")[0];
    expect(clientOf(req)?.key).toBe("anon-key");
    expect(JSON.stringify(clientOf(req)?.options)).toContain("Bearer buyer-jwt");
    const [params, opts] = stripeMock.checkout.sessions.create.mock.calls[0];
    const sum = params.line_items.reduce((s: number, l: any) => s + l.price_data.unit_amount * l.quantity, 0);
    expect(sum).toBe(6100 + 375 + 150);
    expect(params.payment_intent_data.capture_method).toBe("manual");
    expect(params.payment_intent_data.transfer_data).toBeUndefined();
    expect(params.payment_intent_data.transfer_group).toBe(`shop_order_${ORDER}`);
    // H6: Stripe does not tax the page (that would record tax at the hold); the tax is our own line.
    expect(params.automatic_tax).toBeUndefined();
    // Tax memo Q2/Q5: the kolaches are food for home, the candle general goods, and the 375c fee
    // follows them pro rata (221 + 154), one fee line per code; then the 150c Sales tax, never taxed.
    expect(params.line_items.map((l: any) => [l.price_data.product_data.tax_code, l.price_data.unit_amount])).toEqual([
      ["txcd_40040000", 1800], ["txcd_99999999", 2500], ["txcd_40040000", 221], ["txcd_99999999", 154], ["txcd_00000000", 150],
    ]);
    for (const l of params.line_items) expect(l.price_data.product_data).not.toHaveProperty("tax_details");
    expect(params.line_items.slice(2).map((l: any) => l.price_data.product_data.name)).toEqual([
      "Service fee (5% + $0.70), food items", "Service fee (5% + $0.70), made items", "Sales tax",
    ]);
    const meta = { kind: "shop_order", order_id: ORDER, buyer_id: BUYER, payer_id: BUYER, seller_id: MAKER, tax_calculation_id: "taxcalc_shop", job_tax_cents: "150" };
    expect(params.metadata).toEqual(meta);
    // The webhook commits the tax from the PaymentIntent when the hold is captured: the calculation rides on it.
    expect(params.payment_intent_data.metadata).toEqual(meta);
    expect(opts.idempotencyKey).toBe(`shop-order-${ORDER}`);
    expect(stripeMock.__key).toBe("sk_live_shops");
    const attach = rpcs("shop_attach_checkout_session")[0];
    expect(attach?.args).toEqual({ p_order_id: ORDER, p_session_id: "cs_live_shop" });
    expect(clientOf(attach)?.key).toBe("service-key");
  });

  // @mutate supabase/functions/shop-checkout/index.ts |       p_request_id: customRequestId, p_shop_id: shopId, p_ready_date: readyDate, p_note: note, |       p_request_id: customRequestId, p_ready_date: readyDate, p_note: note,
  // @mutate supabase/functions/shop-checkout/index.ts |   if (customRequestId === "invalid") return json({ error: "request_not_found" }, 404); |   if (customRequestId === "invalid") return json({ error: "request_not_found" }, 200);
  it("custom orders (20261106205852): a price the shop sent is ordered AS THE BUYER for its own shop, with no lines, then the ordinary page", async () => {
    const fn = await load();
    frozen();
    scenario.rpc.shops_order_custom_quote = { order_id: ORDER, items_cents: 6100, premium_cents: 375, superseded_session_id: null };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://checkout.stripe.test/shop", amount_subtotal: 6625 });
    const REQ = "00000000-0000-4000-8000-00000000c0de";
    const res = await fn.fetch(fn.request({
      headers: { Authorization: "Bearer buyer-jwt" },
      body: { action: "order", shop_id: SHOP, custom_request_id: REQ, ready_date: "2026-10-30", note: "No nuts",
        terms: { cancel_policy: "until_24h_before_ready", ready_tap_cancel: "from_day_before" } },
    }));
    expect(res.status).toBe(200);
    expect(rpcs("shops_request_order")).toHaveLength(0);
    const req = rpcs("shops_order_custom_quote")[0];
    expect(req?.args).toEqual({ p_request_id: REQ, p_shop_id: SHOP, p_ready_date: "2026-10-30", p_note: "No nuts" });
    expect(JSON.stringify(clientOf(req)?.options)).toContain("Bearer buyer-jwt");
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    // A malformed request id is refused before anything is asked of Stripe or the SQL.
    const bad = await fn.fetch(fn.request({
      headers: { Authorization: "Bearer buyer-jwt" },
      body: { action: "order", shop_id: SHOP, custom_request_id: "nope", ready_date: "2026-10-30" },
    }));
    expect(bad.status).toBe(404);
    expect(rpcs("shops_order_custom_quote")).toHaveLength(1);
  });

  it("H6: the tax is figured ONCE at the shop's pickup address, from exactly the taxed lines; no tax/locations call (Q2153)", async () => {
    const fn = await load();
    frozen();
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://x", amount_subtotal: 6625 });
    expect((await fn.fetch(ask(fn))).status).toBe(200);
    expect(stripeMock.rawRequest).not.toHaveBeenCalled();
    expect(stripeMock.tax.calculations.create).toHaveBeenCalledTimes(1);
    const [calc, opts] = stripeMock.tax.calculations.create.mock.calls[0];
    expect(calc.currency).toBe("usd");
    expect(calc.line_items.map((l: any) => [l.amount, l.tax_code, l.tax_behavior])).toEqual([
      [3600, "txcd_40040000", "exclusive"], [2500, "txcd_99999999", "exclusive"], [221, "txcd_40040000", "exclusive"], [154, "txcd_99999999", "exclusive"],
    ]);
    expect(new Set(calc.line_items.map((l: any) => l.reference)).size).toBe(4);
    expect(calc.customer_details).toEqual({
      address: { line1: "705 W University Ave", city: "Lafayette", state: "LA", postal_code: "70506", country: "US" },
      address_source: "shipping",
    });
    expect(opts).toEqual({ idempotencyKey: `shop-tax-${ORDER}` });
    // Nothing is committed when the page opens or the hold lands.
    expect(stripeMock.tax.transactions.createFromCalculation).not.toHaveBeenCalled();
  });

  it("H6: a $0 tax adds no Sales tax line and the page is the items + the fee", async () => {
    const fn = await load();
    frozen();
    stripeMock.tax.calculations.create.mockResolvedValue({ id: "taxcalc_zero", tax_amount_exclusive: 0 });
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://x", amount_subtotal: 6475 });
    expect((await fn.fetch(ask(fn))).status).toBe(200);
    const [params] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params.line_items.map((l: any) => l.price_data.product_data.name)).not.toContain("Sales tax");
    expect(params.metadata).toMatchObject({ tax_calculation_id: "taxcalc_zero", job_tax_cents: "0" });
    expect(rpcs("shop_attach_checkout_session")).toHaveLength(1);
  });

  it("H6: the one-time setup fee is charged untaxed and is not in the tax calculation", async () => {
    const fn = await load();
    frozen();
    scenario.reads.shop_orders = { rows: [{ ...orderRow(), setup_fee_cents: 200 }] };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://x", amount_subtotal: 6825 });
    expect((await fn.fetch(ask(fn))).status).toBe(200);
    const [calc] = stripeMock.tax.calculations.create.mock.calls[0];
    expect(calc.line_items.reduce((a: number, l: any) => a + l.amount, 0)).toBe(6475);
    const [params] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params.line_items.map((l: any) => [l.price_data.product_data.name, l.price_data.unit_amount]).slice(-2)).toEqual([
      ["One-time account setup fee", 200], ["Sales tax", 150],
    ]);
  });

  // Q2105 step 2: a gift card pays first; the page holds only what is left.
  const askGift = (fn: Awaited<ReturnType<typeof load>>, giftId: unknown) => fn.request({
    headers: { Authorization: "Bearer buyer-jwt" },
    body: { action: "order", shop_id: SHOP, lines: [{ item_id: ITEM, quantity: 2 }], ready_date: "2026-10-30", note: "",
      terms: { cancel_policy: "until_24h_before_ready", ready_tap_cancel: "from_day_before" }, gift_card_id: giftId },
  });
  const GIFT = "0000000b-0000-4000-8000-0000000000dd";
  it("Q2105: a gift is applied AS THE SERVICE on the tax just figured, and the page holds only the remainder as one line", async () => {
    const fn = await load();
    frozen();
    // 6100 + 375 + 150 tax = 6625; a $40 gift leaves 2625.
    scenario.rpc.redeem_gift_card_for_shop_order = { outcome: "needs_hold", difference_cents: 2625, applied_cents: 4000, leftover_cents: 0 };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://x", amount_subtotal: 2625 });
    expect((await fn.fetch(askGift(fn, GIFT))).status).toBe(200);
    const [call] = rpcs("redeem_gift_card_for_shop_order");
    expect(call.args).toEqual({ p_credit_id: GIFT, p_order_id: ORDER, p_user_id: BUYER, p_tax_cents: 150, p_retired_session: null });
    expect(clientOf(call)?.key).toBe("service-key");
    const [params] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params.line_items.map((l: any) => l.price_data.unit_amount)).toEqual([2625]);
    expect(params.metadata.gift_cents).toBe("4000");
    // The tax the hold step checks is still the whole order's (the gift was sized on it).
    expect(params.metadata.job_tax_cents).toBe("150");
    expect(rpcs("shops_cancel_order_request")).toHaveLength(0);
  });

  it("Q2105: a gift answer that does not add up to the price closes the order and opens no page", async () => {
    const fn = await load();
    frozen();
    scenario.rpc.redeem_gift_card_for_shop_order = { outcome: "needs_hold", difference_cents: 2600, applied_cents: 4000 };
    expect((await fn.fetch(askGift(fn, GIFT))).status).toBe(500);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(rpcs("shops_cancel_order_request")).toHaveLength(1);
  });

  it("Q2105: a gift that covers the whole order is not taken yet: the order closes (gift back) and the buyer is told", async () => {
    const fn = await load();
    frozen();
    scenario.rpc.redeem_gift_card_for_shop_order = { outcome: "covered", difference_cents: 0, applied_cents: 6625 };
    const res = await fn.fetch(askGift(fn, GIFT));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("gift_covers_whole_order");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(rpcs("shops_cancel_order_request")).toHaveLength(1);
  });

  it("Q2105: a refused gift is passed through in its words and closes the order; a malformed id freezes nothing", async () => {
    const fn = await load();
    frozen();
    scenario.rpcErrors = { ...(scenario.rpcErrors ?? {}), redeem_gift_card_for_shop_order: { message: "This gift has expired", code: "P0001" } };
    const res = await fn.fetch(askGift(fn, GIFT));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("This gift has expired");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(rpcs("shops_cancel_order_request")).toHaveLength(1);
    const bad = await fn.fetch(askGift(fn, "not-a-uuid"));
    expect(bad.status).toBe(404);
    expect(rpcs("shops_request_order")).toHaveLength(1);
  });

  it("no pickup address: refused in its own words, no tax call, nothing frozen and no page", async () => {
    const fn = await load();
    frozen();
    scenario.reads.shop_pickup_addresses = { rows: [] };
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("pickup_address_missing");
    expect(rpcs("shops_request_order")).toHaveLength(0);
    expect(stripeMock.tax.calculations.create).not.toHaveBeenCalled();
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("H6: an address Stripe cannot tax closes the frozen order and says so; no page opens (review findings 2, 3)", async () => {
    const fn = await load();
    frozen();
    stripeMock.tax.calculations.create.mockRejectedValue(Object.assign(new Error("Unable to determine tax location"), { type: "StripeInvalidRequestError", code: "customer_tax_location_invalid", statusCode: 400 }));
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("pickup_address_unusable");
    const closed = rpcs("shops_cancel_order_request");
    expect(closed.map((c) => c.args)).toEqual([{ p_order_id: ORDER }]);
    expect(clientOf(closed[0])?.key).toBe("anon-key");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(rpcs("shop_attach_checkout_session")).toHaveLength(0);
    // Q2146: the refused pickup address is stamped for the shop (My shop says so) and its owner told once, by the server.
    const marked = rpcs("shops_mark_pickup_address_refused");
    expect(marked.map((c) => c.args)).toEqual([
      { p_shop_id: SHOP, p_address_updated_at: "2026-10-18T03:00:00.123456+00:00", p_reason: "Unable to determine tax location" },
    ]);
    expect(clientOf(marked[0])?.key).toBe("service-key");
  });

  it("Q2146 (review 2): a pickup address Stripe taxes after refusing it before is cleared; one never refused calls nothing", async () => {
    const fn = await load();
    frozen();
    scenario.reads.shop_pickup_addresses = { rows: [pickup({ tax_refused_at: "2026-11-10T20:00:00Z" })] };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://x", amount_subtotal: 6625 });
    expect((await fn.fetch(ask(fn))).status).toBe(200);
    const cleared = rpcs("shops_clear_pickup_address_refused");
    expect(cleared.map((c) => c.args)).toEqual([{ p_shop_id: SHOP, p_address_updated_at: "2026-10-18T03:00:00.123456+00:00" }]);
    expect(clientOf(cleared[0])?.key).toBe("service-key");

    resetSupabaseMock();
    resetStripeMock();
    scenario.reads.test_accounts = { rows: [] };
    const fn2 = await load();
    frozen();
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://x", amount_subtotal: 6625 });
    expect((await fn2.fetch(ask(fn2))).status).toBe(200);
    expect(rpcs("shops_clear_pickup_address_refused")).toHaveLength(0);
  });

  it("H6: any other tax refusal (Stripe Tax off, an API change, a timeout) is a try-again, never 'unusable'; the order is closed", async () => {
    for (const err of [
      Object.assign(new Error("Stripe Tax is not active"), { type: "StripeInvalidRequestError", code: "tax_not_active", statusCode: 400 }),
      Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" }),
    ]) {
      resetSupabaseMock();
      resetStripeMock();
      scenario.reads.test_accounts = { rows: [] };
      const fn = await load();
      frozen();
      stripeMock.tax.calculations.create.mockRejectedValue(err);
      const res = await fn.fetch(ask(fn));
      expect(res.status).toBe(503);
      expect((await json(res)).error).not.toBe("pickup_address_unusable");
      expect(rpcs("shops_cancel_order_request")).toHaveLength(1);
      // Q2146: only Stripe refusing the ADDRESS is the shop's to fix; a try-again tells the shop nothing.
      expect(rpcs("shops_mark_pickup_address_refused")).toHaveLength(0);
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    }
  });

  it("H6: a calculation with no usable figure opens no page (never an untaxed or guessed charge)", async () => {
    const fn = await load();
    frozen();
    stripeMock.tax.calculations.create.mockResolvedValue({ id: "taxcalc_bad", tax_amount_exclusive: null });
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(503);
    expect(rpcs("shops_cancel_order_request")).toHaveLength(1);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("an order whose seller is not the shop's owner read first is never given a page", async () => {
    const fn = await load();
    frozen();
    scenario.reads.shops = { rows: [{ owner_id: BUYER }] };
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(500);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("the shop's terms are asked AS THE BUYER first: a refused caller sends nothing to Stripe and learns nothing of the address (authz note 1)", async () => {
    const fn = await load();
    frozen();
    scenario.rpcErrors = { ...(scenario.rpcErrors ?? {}), shops_order_terms: { message: "account_restricted", code: "42501" } };
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await json(res)).error).toBe("account_restricted");
    expect(stripeMock.tax.calculations.create).not.toHaveBeenCalled();
    expect(rpcs("shops_request_order")).toHaveLength(0);
    expect(clientOf(rpcs("shops_order_terms")[0])?.key).not.toBe("service-key");
  });

  it("expires the page a superseded order had open", async () => {
    const fn = await load();
    frozen({ superseded_session_id: "cs_live_old" });
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://x", amount_subtotal: 6625 });
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

  // One wallet (owner 2026-10-18): the buyer's stored Stripe customer pre-fills the page. Every case above has no
  // stored customer, so these three paths were never seen (post-merge vacuity, run 42136050907: @mutates 6-8 survived).
  it("a buyer with a stored wallet customer gets the page ON that customer, not a bare email", async () => {
    const fn = await load();
    frozen();
    scenario.reads.stripe_customers = { rows: [{ stripe_customer_id: "cus_buyerwallet" }] };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://x", amount_subtotal: 6625 });
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(200);
    const [params, opts] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params.customer).toBe("cus_buyerwallet");
    expect(params.customer_update).toEqual({ address: "auto" });
    expect(params.customer_email).toBeUndefined();
    expect(opts.idempotencyKey).toBe(`shop-order-${ORDER}`);
  });

  it("a stored customer Stripe no longer has is replaced once and the page retried on the new one (Q2140)", async () => {
    const fn = await load();
    frozen();
    scenario.reads.stripe_customers = { rows: [{ stripe_customer_id: "cus_deadwallet" }] };
    scenario.rpc.replace_stripe_customer = "cus_newwallet";
    stripeMock.customers.create.mockResolvedValue({ id: "cus_newwallet" });
    stripeMock.checkout.sessions.create
      .mockRejectedValueOnce(Object.assign(new Error("No such customer: 'cus_deadwallet'"), { type: "StripeInvalidRequestError", code: "resource_missing", param: "customer" }))
      .mockResolvedValueOnce({ id: "cs_live_shop", url: "https://x", amount_subtotal: 6625 });
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(200);
    const calls = stripeMock.checkout.sessions.create.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].customer).toBe("cus_deadwallet");
    expect(calls[1][0].customer).toBe("cus_newwallet");
    expect(calls[1][1].idempotencyKey).toBe(`shop-order-${ORDER}:new-wallet`);
    expect(rpcs("replace_stripe_customer")[0]?.args).toEqual({ p_user: BUYER, p_mode: "live", p_old: "cus_deadwallet", p_new: "cus_newwallet" });
  });

  it("a wallet read that fails is a try-again (503) and opens no page on a guessed customer", async () => {
    const fn = await load();
    frozen();
    scenario.reads.stripe_customers = { rows: [], error: { message: "connection reset" } };
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(503);
    expect((await json(res)).error).toMatch(/try again/i);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  describe("delivery: the shop delivers (migration 20261106180902)", () => {
    const geocoder = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify([
      { lat: "30.2400", lon: "-92.0600", address: { house_number: "100", road: "Main St", city: "Lafayette", state: "Louisiana" } },
    ]), { status: 200 }));
    beforeEach(() => { geocoder.mockClear(); vi.stubGlobal("fetch", geocoder); });
    afterEach(() => { vi.unstubAllGlobals(); });
    const DROP = { line1: "100 Main St", city: "Lafayette", postal_code: "70501" };
    const askDelivered = (fn: Awaited<ReturnType<typeof load>>, delivery: unknown = DROP) => fn.request({
      headers: { Authorization: "Bearer buyer-jwt" },
      body: { action: "order", shop_id: SHOP, lines: [{ item_id: ITEM, quantity: 2 }], ready_date: "2026-10-30", note: "",
        terms: { cancel_policy: "until_24h_before_ready", ready_tap_cancel: "from_day_before" }, delivery },
    });
    function delivered() {
      frozen();
      scenario.rpc.shop_set_order_delivery = { order_id: ORDER, delivery_cents: 800, delivery_miles: 4, total_cents: 7275 };
      scenario.reads.shop_orders = { rows: [orderRow({ fulfillment: "shop_delivers", delivery_cents: 800 })] };
    }

    it("geocodes ON THE SERVER, sets the delivery as the service, adds a non-taxable Shop delivery line and taxes at the drop-off", async () => {
      const fn = await load();
      delivered();
      stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://x", amount_subtotal: 6100 + 375 + 800 + 150 });
      const res = await fn.fetch(askDelivered(fn));
      expect(res.status).toBe(200);
      expect(geocoder).toHaveBeenCalled();
      const set = rpcs("shop_set_order_delivery")[0];
      expect(clientOf(set)?.key).toBe("service-key");
      expect(set?.args).toEqual({ p_order_id: ORDER, p_buyer: BUYER, p_line1: "100 Main St", p_line2: null, p_city: "Lafayette",
        p_postal_code: "70501", p_lat: 30.24, p_lng: -92.06 });
      const [params] = stripeMock.checkout.sessions.create.mock.calls[0];
      const line = params.line_items.find((l: any) => l.price_data.product_data.name === "Shop delivery");
      expect(line?.price_data.unit_amount).toBe(800);
      expect(line?.price_data.product_data.tax_code).toBe("txcd_00000000");
      const sum = params.line_items.reduce((t: number, l: any) => t + l.price_data.unit_amount * l.quantity, 0);
      expect(sum).toBe(6100 + 375 + 800 + 150);
      const [calc] = stripeMock.tax.calculations.create.mock.calls[0];
      expect(calc.customer_details.address).toMatchObject({ line1: "100 Main St", city: "Lafayette", postal_code: "70501", state: "LA" });
      // The delivery is not in the tax calculation (only the items and the fee).
      expect(calc.line_items.reduce((t: number, l: any) => t + l.amount, 0)).toBe(6100 + 375);
    });

    it("Q2146: a drop-off Stripe cannot tax is the buyer's address: the shop's pickup address is never stamped", async () => {
      const fn = await load();
      delivered();
      stripeMock.tax.calculations.create.mockRejectedValue(Object.assign(new Error("Unable to determine tax location"), { type: "StripeInvalidRequestError", code: "customer_tax_location_invalid", statusCode: 400 }));
      const res = await fn.fetch(askDelivered(fn));
      expect(res.status).toBe(409);
      expect(rpcs("shops_mark_pickup_address_refused")).toHaveLength(0);
    });

    it("a drop-off the SQL refuses (too far) closes the just-frozen order and opens no page", async () => {
      const fn = await load();
      delivered();
      scenario.rpcErrors = { ...(scenario.rpcErrors ?? {}), shop_set_order_delivery: { message: "delivery_too_far", code: "22023" } };
      const res = await fn.fetch(askDelivered(fn));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(rpcs("shops_cancel_order_request")).toHaveLength(1);
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it("an address the geocoder cannot find never freezes an order", async () => {
      const fn = await load();
      delivered();
      geocoder.mockImplementation(async () => new Response("[]", { status: 200 }));
      const res = await fn.fetch(askDelivered(fn));
      expect(res.status).toBe(422);
      expect((await json(res)).error).toBe("address_not_found");
      expect(rpcs("shops_request_order")).toHaveLength(0);
    });

    it("a malformed address is a bad request", async () => {
      const fn = await load();
      delivered();
      const res = await fn.fetch(askDelivered(fn, { line1: "1", city: "", postal_code: "7050" }));
      expect(res.status).toBe(400);
      expect(rpcs("shops_request_order")).toHaveLength(0);
    });

    it("a frozen at-home line on a delivered order closes the order (the item changed after the early check)", async () => {
      const fn = await load();
      delivered();
      // An earlier case leaves the geocoder answering "not found" (mockClear keeps an implementation).
      geocoder.mockImplementation(async () => new Response(JSON.stringify([
        { lat: "30.2400", lon: "-92.0600", address: { house_number: "100", road: "Main St", city: "Lafayette", state: "Louisiana" } },
      ]), { status: 200 }));
      // The live item read says in-shop; the frozen line says at the buyer's place.
      scenario.reads.shop_items = { rows: [{ id: ITEM, subtype: "fabric_cleaning", at_buyer: false }] };
      scenario.reads.shop_order_lines = { rows: [
        { title: "Couch cleaning at your home", kind: "service", tax_kind: "fabric_cleaning", at_buyer: true, unit_cents: 3050, quantity: 2, line_cents: 6100 },
      ] };
      const res = await fn.fetch(fn.request({
        headers: { Authorization: "Bearer buyer-jwt" },
        body: { action: "order", shop_id: SHOP, lines: [{ item_id: ITEM, quantity: 2 }], ready_date: "2026-10-30", note: "",
          terms: { cancel_policy: "until_24h_before_ready", ready_tap_cancel: "from_day_before" }, delivery: DROP,
          service_address: { line1: "12 Oak St", city: "Lafayette", postal_code: "70501" } },
      }));
      expect(res.status).toBe(409);
      expect((await json(res)).error).toBe("at_buyer_no_delivery");
      expect(rpcs("shops_cancel_order_request")).toHaveLength(1);
      // The closed order keeps no copy of the drop-off (lead + authz review of 551ea68e0c).
      expect(scenario.writes.filter((w) => w.table === "shop_order_delivery_addresses").map((w) => w.op)).toEqual(["delete"]);
      expect(stripeMock.tax.calculations.create).not.toHaveBeenCalled();
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    // Slice 2 (20261106223244): a Helpr delivers, at Declutter's price for the road miles from the shop's point.
    const askHelpr = (fn: Awaited<ReturnType<typeof load>>, over: Record<string, unknown> = {}) => fn.request({
      headers: { Authorization: "Bearer buyer-jwt" },
      body: { action: "order", shop_id: SHOP, lines: [{ item_id: ITEM, quantity: 2 }], ready_date: "2026-10-30", note: "",
        terms: { cancel_policy: "until_24h_before_ready", ready_tap_cancel: "from_day_before" }, delivery: DROP,
        delivery_by: "helpr", delivery_cents: 1200, ...over },
    });
    function helprDelivered(frozenCents = 1200) {
      frozen();
      scenario.rpc.shop_set_order_helpr_delivery = { order_id: ORDER, delivery_cents: frozenCents, delivery_miles: 4, total_cents: 6475 + frozenCents };
      scenario.reads.shop_orders = { rows: [orderRow({ fulfillment: "helpr_delivers", delivery_cents: frozenCents })] };
    }
    const resetGeocoder = () => geocoder.mockImplementation(async () => new Response(JSON.stringify([
      { lat: "30.2400", lon: "-92.0600", address: { house_number: "100", road: "Main St", city: "Lafayette", state: "Louisiana" } },
    ]), { status: 200 }));

    it("a Helpr delivery freezes through the Helpr setter as the service, adds a non-taxable Helpr delivery line and taxes at the drop-off", async () => {
      const fn = await load();
      resetGeocoder();
      helprDelivered();
      stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://x", amount_subtotal: 6100 + 375 + 1200 + 150 });
      const res = await fn.fetch(askHelpr(fn));
      expect(res.status).toBe(200);
      const set = rpcs("shop_set_order_helpr_delivery")[0];
      expect(clientOf(set)?.key).toBe("service-key");
      expect(set?.args).toEqual({ p_order_id: ORDER, p_buyer: BUYER, p_line1: "100 Main St", p_line2: null, p_city: "Lafayette",
        p_postal_code: "70501", p_lat: 30.24, p_lng: -92.06 });
      expect(rpcs("shop_set_order_delivery")).toHaveLength(0);
      const [params] = stripeMock.checkout.sessions.create.mock.calls[0];
      const line = params.line_items.find((l: any) => l.price_data.product_data.name === "Helpr delivery");
      expect(line?.price_data.unit_amount).toBe(1200);
      expect(line?.price_data.product_data.tax_code).toBe("txcd_00000000");
      expect(params.line_items.some((l: any) => l.price_data.product_data.name === "Shop delivery")).toBe(false);
      const taxLine = params.line_items.find((l: any) => l.price_data.product_data.name === "Sales tax");
      expect(taxLine?.price_data.product_data.description).toBe("Louisiana sales tax where the order is delivered");
      expect(stripeMock.tax.calculations.create.mock.calls[0][0].customer_details.address.postal_code).toBe("70501");
    });

    it("a Helpr price that moved since the buyer's quote closes the order, keeps no drop-off copy and says the new price", async () => {
      const fn = await load();
      resetGeocoder();
      helprDelivered(1500);
      const res = await fn.fetch(askHelpr(fn));
      expect(res.status).toBe(409);
      expect(await json(res)).toEqual({ error: "delivery_rate_changed", delivery_cents: 1500 });
      expect(rpcs("shops_cancel_order_request")).toHaveLength(1);
      expect(scenario.writes.filter((w) => w.table === "shop_order_delivery_addresses").map((w) => w.op)).toEqual(["delete"]);
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it("a Helpr delivery without the shown price, or a delivery choice the app does not know, is a bad request", async () => {
      const fn = await load();
      resetGeocoder();
      helprDelivered();
      for (const over of [{ delivery_cents: undefined }, { delivery_cents: 0 }, { delivery: undefined }, { delivery_by: "drone" }]) {
        const res = await fn.fetch(askHelpr(fn, over));
        expect([JSON.stringify(over), res.status]).toEqual([JSON.stringify(over), 400]);
        expect((await json(res)).error).toBe("invalid_delivery_choice");
      }
      expect(rpcs("shops_request_order")).toHaveLength(0);
    });

    it("a Helpr order the SQL froze as a shop delivery (or the reverse) closes before any page", async () => {
      const fn = await load();
      resetGeocoder();
      helprDelivered();
      scenario.reads.shop_orders = { rows: [orderRow({ fulfillment: "shop_delivers", delivery_cents: 1200 })] };
      const res = await fn.fetch(askHelpr(fn));
      expect(res.status).toBe(500);
      expect(rpcs("shops_cancel_order_request")).toHaveLength(1);
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it("a pickup order carries no delivery line", async () => {
      const fn = await load();
      frozen();
      stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_shop", url: "https://x", amount_subtotal: 6625 });
      expect((await fn.fetch(ask(fn))).status).toBe(200);
      expect(rpcs("shop_set_order_delivery")).toHaveLength(0);
      const [params] = stripeMock.checkout.sessions.create.mock.calls[0];
      expect(params.line_items.some((l: any) => l.price_data.product_data.name === "Shop delivery")).toBe(false);
    });
  });
});

describe("shop-checkout: the Helpr delivery quote and the shop's pickup point (slice 2, 20261106223244)", () => {
  async function load() {
    env();
    scenario.authUser = { id: BUYER, email: "buyer@test.dev", email_confirmed_at: "2026-10-01T00:00:00Z" };
    return loadEdgeFunction("shop-checkout");
  }
  const DROP = { line1: "100 Main St", city: "Lafayette", postal_code: "70501" };
  const nominatim = () => new Response(JSON.stringify([
    { lat: "30.2400", lon: "-92.0600", address: { house_number: "100", road: "Main St", city: "Lafayette", state: "Louisiana" } },
  ]), { status: 200 });
  const net = vi.fn(async (_url: string, _init?: RequestInit) => nominatim());
  beforeEach(() => { net.mockReset(); net.mockImplementation(async () => nominatim()); vi.stubGlobal("fetch", net); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const quoteReq = (fn: Awaited<ReturnType<typeof load>>, delivery: unknown = DROP) => fn.request({
    headers: { Authorization: "Bearer buyer-jwt" }, body: { action: "helpr_quote", shop_id: SHOP, delivery },
  });
  const ROUTE = { o_lat: 30.22412, o_lng: -92.01987, d_lat: 30.24, d_lng: -92.06 };
  async function withMapkit() {
    const { generateKeyPairSync } = await import("node:crypto");
    const pem = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    setEnv({ APPLE_MAPKIT_PRIVATE_KEY: pem, APPLE_MAPKIT_KEY_ID: "KEY1234567", APPLE_MAPKIT_TEAM_ID: "TEAM123456" });
    net.mockImplementation(async (u: string) => {
      const url = String(u);
      if (url.endsWith("/v1/token")) return new Response(JSON.stringify({ accessToken: "apple-access" }), { status: 200 });
      if (url.includes("/v1/geocode")) return new Response(JSON.stringify({ results: [{ coordinate: { latitude: 30.24, longitude: -92.06 },
        structuredAddress: { locality: "Lafayette", administrativeAreaCode: "LA" } }] }), { status: 200 });
      if (url.includes("/v1/etas")) return new Response(JSON.stringify({ etas: [
        { destination: { latitude: 30.24, longitude: -92.06 }, transportType: "Automobile", distanceMeters: 9000, expectedTravelTimeSeconds: 900 },
      ] }), { status: 200 });
      return new Response("unexpected", { status: 500 });
    });
  }

  it("answers the price and miles only, after the buyer's own gates, from a server-side lookup", async () => {
    const fn = await load();
    scenario.rpc.shops_order_terms = { cancel_policy: "until_24h_before_ready" };
    scenario.rpc.shop_helpr_delivery_quote = { delivery_cents: 1200, delivery_miles: 4, route: null };
    const res = await fn.fetch(quoteReq(fn));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ delivery_cents: 1200, delivery_miles: 4 });
    expect(clientOf(rpcs("shops_order_terms")[0])?.key).toBe("anon-key");
    const q = rpcs("shop_helpr_delivery_quote")[0];
    expect(clientOf(q)?.key).toBe("service-key");
    expect(q?.args).toEqual({ p_shop_id: SHOP, p_lat: 30.24, p_lng: -92.06 });
  });

  it("a buyer the SQL refuses gets no lookup", async () => {
    const fn = await load();
    scenario.rpcErrors = { shops_order_terms: { message: "feature_disabled", code: "42501" } };
    const res = await fn.fetch(quoteReq(fn));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(net).not.toHaveBeenCalled();
    expect(rpcs("shop_helpr_delivery_quote")).toHaveLength(0);
  });

  it("an unrouted pair is routed by Apple, stored under the SQL's exact key, and the routed price answers (Q1930)", async () => {
    const fn = await load();
    await withMapkit();
    scenario.rpc.shops_order_terms = {};
    let asked = 0;
    scenario.rpc.shop_helpr_delivery_quote = () => (++asked === 1
      ? { delivery_cents: 1200, delivery_miles: 4, route: ROUTE }
      : { delivery_cents: 1500, delivery_miles: 6, route: null });
    const res = await fn.fetch(quoteReq(fn));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toEqual({ delivery_cents: 1500, delivery_miles: 6 });
    expect(JSON.stringify(body)).not.toContain("30.22412");
    const stored = scenario.writes.filter((w) => w.table === "declutter_route_miles");
    expect(stored).toHaveLength(1);
    // 9000 m = 5.59 mi -> 6; 900 s -> 15 min.
    expect(stored[0].payload).toMatchObject({ ...ROUTE, miles: 6, minutes: 15, source: "apple" });
    expect(net.mock.calls.some((c) => String(c[0]).includes("/v1/etas"))).toBe(true);
    expect(rpcs("shop_helpr_delivery_quote")).toHaveLength(2);
  });

  it("an Apple routing miss pauses routing and the estimate answers", async () => {
    const fn = await load();
    await withMapkit();
    const base = net.getMockImplementation()!;
    net.mockImplementation(async (u: string, i?: RequestInit) =>
      String(u).includes("/v1/etas") ? new Response("busy", { status: 503 }) : base(u, i));
    scenario.rpc.shops_order_terms = {};
    scenario.rpc.declutter_route_outage = null;
    scenario.rpc.shop_helpr_delivery_quote = { delivery_cents: 1200, delivery_miles: 4, route: ROUTE };
    const res = await fn.fetch(quoteReq(fn));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ delivery_cents: 1200, delivery_miles: 4 });
    expect(rpcs("declutter_route_outage")[0]?.args).toEqual({ p_minutes: 10 });
    expect(scenario.writes.filter((w) => w.table === "declutter_route_miles")).toHaveLength(0);
  });

  it("the SQL's refusal (too far, no Helpr delivery) is the buyer's answer", async () => {
    const fn = await load();
    scenario.rpc.shops_order_terms = {};
    scenario.rpcErrors = { shop_helpr_delivery_quote: { message: "delivery_too_far", code: "22023" } };
    const res = await fn.fetch(quoteReq(fn));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await json(res)).error).toBe("delivery_too_far");
  });

  it("a malformed drop-off is a bad request", async () => {
    const fn = await load();
    const res = await fn.fetch(quoteReq(fn, { line1: "1", city: "", postal_code: "7050" }));
    expect(res.status).toBe(400);
    expect(rpcs("shop_helpr_delivery_quote")).toHaveLength(0);
  });

  const pointReq = (fn: Awaited<ReturnType<typeof load>>) => fn.request({
    headers: { Authorization: "Bearer buyer-jwt" }, body: { action: "pickup_point" },
  });

  it("the pickup point is looked up from the owner's saved address and stored by the service, never returned", async () => {
    const fn = await load();
    scenario.rpc.feature_enabled_for_user = true;
    scenario.rpc.shops_my_pickup_address = [{ line1: "705 W University Ave", line2: null, city: "Lafayette", state: "LA", postal_code: "70506" }];
    scenario.reads.shops = { rows: [{ id: SHOP }] };
    scenario.rpc.shop_set_pickup_point = { shop_id: SHOP, result: "point_saved" };
    const res = await fn.fetch(pointReq(fn));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ saved: true });
    expect(clientOf(rpcs("shops_my_pickup_address")[0])?.key).toBe("anon-key");
    const set = rpcs("shop_set_pickup_point")[0];
    expect(clientOf(set)?.key).toBe("service-key");
    expect(set?.args).toEqual({ p_shop_id: SHOP, p_owner: BUYER, p_expect_line1: "705 W University Ave",
      p_expect_postal_code: "70506", p_lat: 30.24, p_lng: -92.06 });
  });

  it("the pickup point is refused while the switch is off, with no lookup", async () => {
    const fn = await load();
    scenario.rpc.feature_enabled_for_user = false;
    const res = await fn.fetch(pointReq(fn));
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("feature_disabled");
    expect(net).not.toHaveBeenCalled();
    expect(rpcs("shop_set_pickup_point")).toHaveLength(0);
  });

  it("no saved address: nothing to look up; an address changed meanwhile: the SQL's refusal", async () => {
    const fn = await load();
    scenario.rpc.feature_enabled_for_user = true;
    scenario.rpc.shops_my_pickup_address = [];
    const none = await fn.fetch(pointReq(fn));
    expect(none.status).toBe(409);
    expect((await json(none)).error).toBe("pickup_address_missing");
    expect(net).not.toHaveBeenCalled();
    scenario.rpc.shops_my_pickup_address = [{ line1: "705 W University Ave", city: "Lafayette", postal_code: "70506" }];
    scenario.reads.shops = { rows: [{ id: SHOP }] };
    scenario.rpcErrors = { shop_set_pickup_point: { message: "address_changed", code: "55000" } };
    const changed = await fn.fetch(pointReq(fn));
    expect(changed.status).toBeGreaterThanOrEqual(400);
    expect((await json(changed)).error).toBe("address_changed");
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

  // Custom orders slice 2 (20261106212437): a 50% deposit order captures ONLY its frozen deposit; Stripe releases the rest.
  it("accept: a deposit order captures its frozen deposit only, never the whole hold", async () => {
    const fn = await load();
    scenario.rpc.shops_accept_order = { result: "accepted", order_id: ORDER, captured: false };
    scenario.reads.shop_orders = { rows: [{ ...held, payment_plan: "deposit_50", deposit_cents: 3240 }] };
    stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_shop", status: "succeeded" });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_shop", status: "succeeded", latest_charge: { balance_transaction: { fee: 124 } } });
    scenario.rpc.shop_order_captured = { result: "captured" };
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer maker-jwt" }, body: { action: "accept", order_id: ORDER } }));
    expect(res.status).toBe(200);
    expect(stripeMock.paymentIntents.capture).toHaveBeenCalledTimes(1);
    expect(stripeMock.paymentIntents.capture).toHaveBeenCalledWith("pi_shop", { amount_to_capture: 3240, metadata: { shop_deposit_capture_cents: "3240" } }, { idempotencyKey: `shop-capture-${ORDER}-3` });
  });

  // Custom orders slice 2a (review follow-up a on 9abcc8018a): a closed request's unpaid page is expired.
  it("close_request: the member closes the request in SQL, then the unpaid page for that price is expired", async () => {
    const fn = await load();
    const REQ = "0000000c-0000-4000-8000-0000000000c1";
    scenario.rpc.shops_decline_custom_request = "declined";
    scenario.reads.shop_order_lines = { rows: [{ order_id: ORDER }] };
    scenario.reads.shop_orders = { rows: [{ stripe_checkout_session_id: "cs_live_custom" }] };
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer maker-jwt" }, body: { action: "close_request", request_id: REQ } }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ closed: true, status: "declined" });
    expect(rpcs("shops_decline_custom_request")[0]?.args).toEqual({ p_request_id: REQ });
    expect(clientOf(rpcs("shops_decline_custom_request")[0])?.key).toBe("anon-key");
    expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith("cs_live_custom");
  });

  it("close_request: a refusal from SQL expires nothing", async () => {
    const fn = await load();
    scenario.rpcErrors = { ...(scenario.rpcErrors ?? {}), shops_decline_custom_request: { message: "request_not_open", code: "55000" } };
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer maker-jwt" }, body: { action: "close_request", request_id: "0000000c-0000-4000-8000-0000000000c2" } }));
    expect(res.status).toBe(409);
    expect(stripeMock.checkout.sessions.expire).not.toHaveBeenCalled();
  });

  it("accept: a deposit order with no frozen deposit is never captured (the cron retries); the shop is told it is accepted", async () => {
    const fn = await load();
    scenario.rpc.shops_accept_order = { result: "accepted", order_id: ORDER, captured: false };
    scenario.reads.shop_orders = { rows: [{ ...held, payment_plan: "deposit_50", deposit_cents: null }] };
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer maker-jwt" }, body: { action: "accept", order_id: ORDER } }));
    // 11-07 money review: the order IS accepted; the capture step failing is not the shop's error.
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ accepted: true, charged: false });
    expect(stripeMock.paymentIntents.capture).not.toHaveBeenCalled();
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
    // H6: a hold that is let go never reports tax.
    expect(stripeMock.tax.transactions.createFromCalculation).not.toHaveBeenCalled();
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

  it("H6: a page taxed at the pickup address reads the tax from its metadata (Stripe's own amount_tax is 0 there)", async () => {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_shop_h6", type: "checkout.session.completed", livemode: true, created: 1_760_000_000,
      data: { object: {
        id: "cs_live_shop", mode: "payment", payment_status: "unpaid", payment_intent: "pi_shop", amount_total: 6625,
        total_details: { amount_tax: 0 }, client_reference_id: ORDER,
        metadata: { kind: "shop_order", order_id: ORDER, buyer_id: BUYER, payer_id: BUYER, seller_id: MAKER, tax_calculation_id: "taxcalc_shop", job_tax_cents: "150" },
      } },
    });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_shop", status: "requires_capture" });
    scenario.rpc.shop_mark_order_held = { result: "held", order_id: ORDER };
    const res = await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
    expect(res.status).toBe(200);
    expect((rpcs("shop_mark_order_held")[0]?.args as Record<string, unknown>).p_tax_cents).toBe(150);
    // A hold records no tax: only its capture does.
    expect(stripeMock.tax.transactions.createFromCalculation).not.toHaveBeenCalled();
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

describe("stripe-webhook: H6, a shop order's tax is recorded at CAPTURE and reversed on a refund", () => {
  const TAXED = { kind: "shop_order", order_id: ORDER, buyer_id: BUYER, payer_id: BUYER, seller_id: MAKER, tax_calculation_id: "taxcalc_shop", job_tax_cents: "150" };
  async function deliver(event: Record<string, unknown>) {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({ livemode: true, created: 1_760_000_000, ...event });
    return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
  }
  const captured = (metadata: Record<string, string>) => deliver({
    id: `evt_cap_${Math.random()}`, type: "payment_intent.succeeded",
    data: { object: { id: "pi_shop", amount: 6625, amount_received: 6625, livemode: true, metadata } },
  });

  it("the capture commits the order's calculation once (keyed on the payment) and stamps the transaction on it", async () => {
    scenario.reads.jobs = { rows: [] };
    scenario.reads.shop_orders = { rows: [{ is_seed: false, buyer_id: BUYER, seller_id: MAKER }] };
    stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_shop" });
    const res = await captured(TAXED);
    expect(res.status).toBe(200);
    expect(stripeMock.tax.transactions.createFromCalculation.mock.calls).toEqual([
      [{ calculation: "taxcalc_shop", reference: "pi_shop" }, { idempotencyKey: "job-site-tax:pi_shop" }],
    ]);
    expect(stripeMock.paymentIntents.update).toHaveBeenCalledWith("pi_shop", { metadata: { tax_transaction_id: "tax_txn_shop" } });
  });

  it("a failed commit pages ops with the hand step and still answers 200 (the capture stands); a test order's page is marked seed", async () => {
    scenario.reads.jobs = { rows: [] };
    scenario.reads.shop_orders = { rows: [{ is_seed: true, buyer_id: BUYER, seller_id: MAKER }] };
    stripeMock.tax.transactions.createFromCalculation.mockRejectedValue(new Error("calculation expired"));
    const res = await captured(TAXED);
    expect(res.status).toBe(200);
    const page = (slackAlerts as Array<{ title: string; message: string; seed?: boolean }>).find((a) => /NOT recorded in Stripe Tax/.test(a.title));
    expect(page?.message).toContain(`Shops order ${ORDER}`);
    expect(page?.seed).toBe(true);
  });

  it("an order from before H6 (Stripe taxed the page itself) commits nothing", async () => {
    scenario.reads.jobs = { rows: [] };
    scenario.reads.shop_orders = { rows: [{ is_seed: false, buyer_id: BUYER, seller_id: MAKER }] };
    await captured({ kind: "shop_order", order_id: ORDER, buyer_id: BUYER, seller_id: MAKER });
    expect(stripeMock.tax.transactions.createFromCalculation).not.toHaveBeenCalled();
  });

  it("the app's own Shops refund reverses its share of the transaction, keyed on the refund", async () => {
    stripeMock.refunds.list.mockResolvedValue({ data: [
      { id: "re_shop", amount: 3000, created: 60, status: "succeeded", charge: "ch_shop", metadata: { kind: "shop_refund", shop_refund_id: "r1", order_id: ORDER } },
    ], has_more: false });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_shop", metadata: { ...TAXED, tax_transaction_id: "tax_txn_shop" } });
    stripeMock.tax.transactions.listLineItems.mockResolvedValue({ data: [{ amount: 6475, amount_tax: 150, tax_behavior: "exclusive" }], has_more: false });
    stripeMock.tax.transactions.createReversal.mockResolvedValue({ id: "taxrev_shop" });
    const res = await deliver({ id: "evt_ref_shop", type: "charge.refunded",
      data: { object: { id: "ch_shop", payment_intent: "pi_shop", amount: 6625, amount_captured: 6625, amount_refunded: 3000, metadata: { kind: "shop_order", order_id: ORDER } } } });
    expect(res.status).toBe(200);
    expect(stripeMock.tax.transactions.createReversal.mock.calls).toEqual([[
      { mode: "partial", flat_amount: -3000, original_transaction: "tax_txn_shop", reference: "refund:re_shop", metadata: { refund_id: "re_shop", charge_id: "ch_shop" } },
      { idempotencyKey: "visit-tax-reversal:re_shop" },
    ]]);
    expect(stripeMock.paymentIntents.update).toHaveBeenCalledWith("pi_shop", { metadata: { tax_rev_re_shop: "taxrev_shop" } });
  });

  it("a refund made in the Stripe Dashboard reverses its share too, and is still recorded against the order", async () => {
    stripeMock.refunds.list.mockResolvedValue({ data: [
      { id: "re_hand", amount: 6625, created: 60, status: "succeeded", charge: "ch_shop", metadata: {} },
    ], has_more: false });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_shop", metadata: { ...TAXED, tax_transaction_id: "tax_txn_shop" } });
    stripeMock.tax.transactions.listLineItems.mockResolvedValue({ data: [{ amount: 6475, amount_tax: 150, tax_behavior: "exclusive" }], has_more: false });
    stripeMock.tax.transactions.createReversal.mockResolvedValue({ id: "taxrev_hand" });
    scenario.rpc.shop_record_hand_refund = "closed_refunded";
    scenario.reads.shop_orders = { rows: [{ is_seed: false, buyer_id: BUYER, seller_id: MAKER }] };
    const res = await deliver({ id: "evt_ref_hand", type: "charge.refunded",
      data: { object: { id: "ch_shop", payment_intent: "pi_shop", amount: 6625, amount_captured: 6625, amount_refunded: 6625, metadata: { kind: "shop_order", order_id: ORDER } } } });
    expect(res.status).toBe(200);
    // The whole order: a partial flat reversal of the whole total (never mode full: it could not be undone).
    expect(stripeMock.tax.transactions.createReversal.mock.calls[0][0]).toMatchObject({ mode: "partial", flat_amount: -6625, reference: "refund:re_hand" });
    expect(rpcs("shop_record_hand_refund")).toHaveLength(1);
  });

  // Helpr delivery (20261106194913, money review BLOCK on 85549dc06a): the delivery line is untaxed, so a
  // delivery-only refund reverses no tax, and beside an order refund only the order refund's share is reversed.
  const DELIVERY_REFUND = { id: "re_dlv", amount: 1200, created: 50, status: "succeeded", charge: "ch_shop",
    metadata: { kind: "shop_refund", shop_delivery_refund_id: "d1", order_id: ORDER } };
  it("a delivery-only refund reverses no tax and pages nobody", async () => {
    stripeMock.refunds.list.mockResolvedValue({ data: [DELIVERY_REFUND], has_more: false });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_shop", metadata: { ...TAXED, tax_transaction_id: "tax_txn_shop" } });
    stripeMock.tax.transactions.listLineItems.mockResolvedValue({ data: [{ amount: 6475, amount_tax: 150, tax_behavior: "exclusive" }], has_more: false });
    const res = await deliver({ id: "evt_ref_dlv", type: "charge.refunded",
      data: { object: { id: "ch_shop", payment_intent: "pi_shop", amount: 6625, amount_captured: 6625, amount_refunded: 1200, metadata: { kind: "shop_order", order_id: ORDER } } } });
    expect(res.status).toBe(200);
    expect(stripeMock.tax.transactions.createReversal).not.toHaveBeenCalled();
    expect((slackAlerts as Array<{ title: string }>).filter((a) => /tax/i.test(a.title))).toEqual([]);
  });

  it("a delivery refund beside the order's refund: only the order refund's share is reversed", async () => {
    stripeMock.refunds.list.mockResolvedValue({ data: [
      { id: "re_shop", amount: 3000, created: 60, status: "succeeded", charge: "ch_shop", metadata: { kind: "shop_refund", shop_refund_id: "r1", order_id: ORDER } },
      DELIVERY_REFUND,
    ], has_more: false });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_shop", metadata: { ...TAXED, tax_transaction_id: "tax_txn_shop" } });
    stripeMock.tax.transactions.listLineItems.mockResolvedValue({ data: [{ amount: 6475, amount_tax: 150, tax_behavior: "exclusive" }], has_more: false });
    stripeMock.tax.transactions.createReversal.mockResolvedValue({ id: "taxrev_shop" });
    const res = await deliver({ id: "evt_ref_both", type: "charge.refunded",
      data: { object: { id: "ch_shop", payment_intent: "pi_shop", amount: 6625, amount_captured: 6625, amount_refunded: 4200, metadata: { kind: "shop_order", order_id: ORDER } } } });
    expect(res.status).toBe(200);
    expect(stripeMock.tax.transactions.createReversal.mock.calls).toEqual([[
      { mode: "partial", flat_amount: -3000, original_transaction: "tax_txn_shop", reference: "refund:re_shop", metadata: { refund_id: "re_shop", charge_id: "ch_shop" } },
      { idempotencyKey: "visit-tax-reversal:re_shop" },
    ]]);
  });

  it("a delivery refund that later FAILS reopens its row and undoes no tax reversal", async () => {
    scenario.rpc.shop_delivery_refund_reversed = "reopened";
    const res = await deliver({ id: "evt_ref_dlv_fail", type: "charge.refund.updated",
      data: { object: { ...DELIVERY_REFUND, status: "failed", payment_intent: "pi_shop" } } });
    expect(res.status).toBe(200);
    expect(rpcs("shop_delivery_refund_reversed")).toHaveLength(1);
    expect(rpcs("shop_refund_reversed")).toHaveLength(0);
    expect(stripeMock.tax.transactions.createReversal).not.toHaveBeenCalled();
  });

  it("a Shops refund that later FAILS undoes its own tax reversal before the row reopens", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_shop", metadata: { ...TAXED, tax_transaction_id: "tax_txn_shop", tax_rev_re_shop: "taxrev_shop" } });
    stripeMock.tax.transactions.createReversal.mockResolvedValue({ id: "taxrev_undo" });
    scenario.rpc.shop_refund_reversed = true;
    const res = await deliver({ id: "evt_ref_fail", type: "charge.refund.updated",
      data: { object: { id: "re_shop", status: "failed", amount: 3000, payment_intent: "pi_shop", charge: "ch_shop", metadata: { kind: "shop_refund", shop_refund_id: "r1", order_id: ORDER } } } });
    expect(res.status).toBe(200);
    expect(stripeMock.tax.transactions.createReversal.mock.calls[0][0]).toMatchObject({ mode: "full", original_transaction: "taxrev_shop", reference: "refund-failed:re_shop" });
    expect(rpcs("shop_refund_reversed")).toHaveLength(1);
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
    scenario.reads.shop_orders = { rows: [{ payment_plan: "full_hold", deposit_cents: null }] };
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
