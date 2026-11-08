/**
 * shop-checkout 'buy_digital' (Shops digital downloads, owner 11-08; migration 20261108185110): the buyer's page for
 * one download. A card HOLD like every Shops page (the webhook captures it at once), flagged digital in its metadata,
 * taxed at the buyer's BILLING address with the digital-book code, the same buyer fee line, and refused when the
 * iPhone app asks for it (the app links out to the website: App Review Guideline 3.1.1(a) / 3.1.3, US storefront).
 *
 * @mutate supabase/functions/shop-checkout/index.ts |   if (isNativeRequest(body)) return json({ error: "digital_on_website" }, 409); |
 * @mutate supabase/functions/shop-checkout/index.ts |     tax = await shopOrderTax(stripe, o.id, billing, lines, feeParts, "billing"); |     tax = await shopOrderTax(stripe, o.id, billing, lines, feeParts);
 * @mutate supabase/functions/shop-checkout/index.ts |     kind: "shop_order", digital: "1", order_id: o.id, |     kind: "shop_order", order_id: o.id,
 * @mutate supabase/functions/shop-checkout/index.ts |       payment_intent_data: { metadata: meta, capture_method: "manual", transfer_group: `shop_order_${o.id}` },\n      custom_text: { submit: { message: "Your download | payment_intent_data: { metadata: meta, transfer_group: `shop_order_${o.id}` },\n      custom_text: { submit: { message: "Your download
 * @mutate supabase/functions/shop-checkout/index.ts |   if (chargedCents !== session.amount_subtotal) { |   if (false) {
 * @mutate supabase/functions/shop-checkout/index.ts | o.is_digital !== true \|\| o.status !== "awaiting_hold" | o.status !== "awaiting_hold"
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";
import { resetEmailMocks } from "./mocks/email";

const BUYER = "0000000b-0000-4000-8000-000000000001";
const MAKER = "0000000b-0000-4000-8000-000000000002";
const SHOP = "0000000b-0000-4000-8000-0000000000cc";
const ORDER = "0000000b-0000-4000-8000-0000000000aa";
const ITEM = "0000000b-0000-4000-8000-0000000000bb";
const BILLING = { line1: "500 Main St", city: "Houston", state: "tx", postal_code: "77002" };

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
  resetEmailMocks();
  scenario.reads.test_accounts = { rows: [] };
});

async function load() {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_shops", STRIPE_TEST_SECRET_KEY: "sk_test_shops", STRIPE_WEBHOOK_SECRET: "whsec_live", CRON_SECRET: "cron-secret",
  });
  scenario.authUser = { id: BUYER, email: "buyer@test.dev", email_confirmed_at: "2026-10-01T00:00:00Z" };
  return loadEdgeFunction("shop-checkout");
}
const ask = (fn: Awaited<ReturnType<typeof load>>, over: Record<string, unknown> = {}) => fn.request({
  headers: { Authorization: "Bearer buyer-jwt" },
  body: { action: "buy_digital", item_id: ITEM, billing: BILLING, ...over },
});
function frozen(orderOver: Record<string, unknown> = {}) {
  scenario.reads.shop_items = { rows: [{ shop_id: SHOP, owner_id: MAKER, kind: "digital" }] };
  scenario.rpc.shops_request_digital_order = { order_id: ORDER, items_cents: 1200, premium_cents: 130, superseded_session_id: null };
  scenario.reads.shop_orders = { rows: [{ id: ORDER, seller_id: MAKER, items_cents: 1200, premium_cents: 130, setup_fee_cents: 0,
    is_digital: true, status: "awaiting_hold", ...orderOver }] };
  scenario.reads.shop_order_lines = { rows: [
    { title: "Bayou coloring book", kind: "digital", tax_kind: "digital_book", unit_cents: 1200, quantity: 1, line_cents: 1200 },
  ] };
  scenario.reads.stripe_customers = { rows: [] };
  scenario.rpc.shop_attach_checkout_session = null;
  scenario.rpc.shops_cancel_order_request = null;
  stripeMock.tax.calculations.create.mockResolvedValue({ id: "taxcalc_dl", tax_amount_exclusive: 108 });
}

describe("shop-checkout buy_digital", () => {
  it("opens a card hold, flagged digital, taxed at the billing address with the digital-book code", async () => {
    const fn = await load();
    frozen();
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_dl", url: "https://checkout.stripe.test/dl", amount_subtotal: 1200 + 130 + 108 });
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(200);
    const [calc] = stripeMock.tax.calculations.create.mock.calls[0];
    expect(calc.customer_details).toEqual({
      address: { line1: "500 Main St", city: "Houston", state: "TX", postal_code: "77002", country: "US" }, address_source: "billing",
    });
    expect(calc.line_items.map((l: any) => [l.amount, l.tax_code])).toEqual([[1200, "txcd_10302000"], [130, "txcd_10302000"]]);
    const [params, opts] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params.payment_intent_data.capture_method).toBe("manual");
    expect(params.metadata).toMatchObject({ kind: "shop_order", digital: "1", order_id: ORDER, tax_calculation_id: "taxcalc_dl", job_tax_cents: "108" });
    expect(params.payment_intent_data.metadata.digital).toBe("1");
    expect(params.line_items.map((l: any) => l.price_data.unit_amount)).toEqual([1200, 130, 108]);
    expect(opts).toEqual({ idempotencyKey: `shop-order-${ORDER}` });
    expect((scenario.rpcCalls ?? []).filter((c) => c.name === "shop_attach_checkout_session")).toHaveLength(1);
  });

  it("the iPhone app never gets a card page for a download (it links out to the website)", async () => {
    const fn = await load();
    frozen();
    const res = await fn.fetch(ask(fn, { native: true }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("digital_on_website");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect((scenario.rpcCalls ?? []).filter((c) => c.name === "shops_request_digital_order")).toHaveLength(0);
  });

  it("a bad billing address, a non-download item or a row that is not a download opens nothing", async () => {
    for (const [over, items, orderOver, code] of [
      [{ billing: { ...BILLING, state: "ZZ" } }, null, {}, "invalid_billing_address"],
      [{}, [{ shop_id: SHOP, owner_id: MAKER, kind: "made" }], {}, "item_unavailable"],
      [{}, null, { is_digital: false }, null],
    ] as const) {
      resetStripeMock();
      resetSupabaseMock();
      scenario.reads.test_accounts = { rows: [] };
      const fn = await load();
      frozen(orderOver as Record<string, unknown>);
      if (items) scenario.reads.shop_items = { rows: [...items] };
      const res = await fn.fetch(ask(fn, over as Record<string, unknown>));
      expect(res.status).toBeGreaterThanOrEqual(400);
      if (code) expect((await res.json()).error).toBe(code);
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    }
  });

  it("a Stripe subtotal that differs from the order expires the page and opens nothing", async () => {
    const fn = await load();
    frozen();
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_dl", url: "https://x", amount_subtotal: 999 });
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(500);
    expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith("cs_live_dl");
    expect((scenario.rpcCalls ?? []).filter((c) => c.name === "shop_attach_checkout_session")).toHaveLength(0);
  });
});
