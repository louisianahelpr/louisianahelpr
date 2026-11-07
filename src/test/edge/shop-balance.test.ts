/**
 * Shops custom orders slice 2b, the Stripe side of a 50% deposit order's rest (migrations 20261106215722 +
 * 20261106221300; _shared/shopBalance.ts; plan ~/.lh-shots/handoffs-1106/builder4-shops.md; OWNER 11-06 balance-failure
 * rule; LEAD 11-06 tax rule). The decisions (what is owed, when, paid once, the lapse, the tax step) live in SQL and are
 * proven by src/test/pglite/shopsCustomBalance.pglite.mjs + shopsCustomBalanceEdge.pglite.mjs. This file proves the
 * edge side: the deposit page saves the card, the webhook records it, the rest is charged once per attempt with its own
 * key, a card error goes to the buyer, a payment the order no longer owes is refunded whole, the buyer's page and the
 * shop's tap are each only theirs, the deposit capture commits the whole tax calculation, and an unpaid close reverses
 * it in full exactly once (no refund on that charge reverses again).
 *
 * Registered mutations - each turns this file RED on its own:
 * @mutate supabase/functions/_shared/shopBalance.ts |       { idempotencyKey: shopBalanceKey(row.order_id) }, |       {},
 * 11-07 money review of 2b (each RED on its own):
 * @mutate supabase/functions/_shared/shopBalance.ts |  return `shop-balance-${orderId}`; |  return `shop-balance-${orderId}-${Date.now()}`;
 * @mutate supabase/functions/_shared/shopBalance.ts |  if (!row.customer_id \|\| !row.payment_method_id) { |  if (false) {
 * @mutate supabase/functions/_shared/shopBalance.ts |  return buyer \|\| (failed as { result?: string } \| null)?.result === "buyer_pays" ? "buyer_pays" : "will_retry"; |  return buyer ? "buyer_pays" : "will_retry";
 * @mutate supabase/functions/_shared/shopBalance.ts |    p_amount_cents: Number(pi.amount_received ?? 0) > 0 ? Number(pi.amount_received) : Number(pi.amount ?? 0), |    p_amount_cents: 0,
 * @mutate supabase/functions/shop-checkout/index.ts |  if (off) return off; |
 * @mutate supabase/functions/shop-checkout/index.ts |  if (isLockedOut(standing?.ban_status, standing?.auto_suspended_until)) return json({ error: "account_restricted" }, 403); |
 * @mutate supabase/functions/shop-checkout/index.ts |    return json({ accepted: true, charged: false });\n  } | throw e;\n  }
 * @mutate supabase/functions/_shared/shopBalance.ts |   return err.type === "StripeCardError" \|\| err.rawType === "card_error"; |   return false;
 * @mutate supabase/functions/_shared/shopBalance.ts |   if (result === "refund") { |   if (result === "never") {
 * @mutate supabase/functions/_shared/shopBalance.ts |     if (md[SHOP_UNPAID_CLOSE_TAX_REV_KEY]) { |     if (false) {
 * @mutate supabase/functions/_shared/shopBalance.ts |           { mode: "full", original_transaction: txId, reference, metadata: { order_id: row.order_id, reason: "unpaid_close" } }, |           { mode: "partial", original_transaction: txId, reference, metadata: { order_id: row.order_id, reason: "unpaid_close" } },
 * @mutate supabase/functions/shop-checkout/index.ts |   if (o && o.buyer_id !== user.id) return json({ error: "order_not_found" }, 404); |
 * @mutate supabase/functions/shop-checkout/index.ts |   if (o && o.seller_id !== user.id) return json({ error: "order_not_found" }, 404); |
 * @mutate supabase/functions/shop-checkout/index.ts |   if (o.ready_date > today) return json({ paid: false, not_due: true }); |
 * @mutate supabase/functions/shop-checkout/index.ts |        ...(depositPlan ? { setup_future_usage: "off_session" as const } : {}), |        ...{},
 * @mutate supabase/functions/shop-checkout/index.ts |   if (session.amount_total !== cents) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/shopCheckout.ts |     if (meta.payment_plan === "deposit_50") { |     if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts |   if (piMeta.kind === SHOP_BALANCE_KIND) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/_jobTaxCommit.ts |   if (!recordCapturedPart && !depositCapture && | if (!recordCapturedPart &&
 * @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |   if (piMeta[SHOP_UNPAID_CLOSE_TAX_REV_KEY]) { |   if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |     const balances = await admin.rpc("shop_balances_due", { p_limit: BATCH }); |     const balances = { error: null, data: [] };
 * @mutate supabase/functions/declutter-money/index.ts |     const taxDue = await admin.rpc("shop_lapse_tax_due", { p_limit: BATCH }); |     const taxDue = { error: null, data: [] };
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";
import { resetEmailMocks } from "./mocks/email";

const BUYER = "0000000d-0000-4000-8000-000000000001";
const MAKER = "0000000d-0000-4000-8000-000000000002";
const OTHER = "0000000d-0000-4000-8000-000000000003";
const ORDER = "0000000d-0000-4000-8000-0000000000aa";
const SHOP = "0000000d-0000-4000-8000-0000000000cc";

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

/** A deposit order whose deposit was captured and whose rest is owed, as readOwedRest reads it. */
const owed = (over: Record<string, unknown> = {}) => ({
  id: ORDER, buyer_id: BUYER, seller_id: MAKER, status: "accepted", payment_plan: "deposit_50",
  balance_cents: 3385, balance_payment_intent_id: null, captured_at: "2026-11-01T10:00:00Z",
  balance_customer_id: "cus_buyer", balance_payment_method_id: "pm_saved", balance_attempts: 0,
  balance_failed_at: null, balance_checkout_session_id: null, ready_date: "2026-11-06",
  stripe_checkout_session_id: "cs_live_dep", stripe_payment_intent_id: "pi_dep", payment_livemode: true,
  items_cents: 6100, premium_cents: 375, capture_attempts: 1, shop_id: SHOP, ...over,
});
const paidPi = (id: string, over: Record<string, unknown> = {}) => ({
  id, status: "succeeded", amount: 3385, metadata: { kind: "shop_balance", order_id: ORDER },
  latest_charge: { id: "ch_rest", balance_transaction: { fee: 128 } }, ...over,
});

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
  resetEmailMocks();
  scenario.reads.test_accounts = { rows: [] };
  // The Shops switch is on for these accounts (11-07: the shop's charge-the-rest tap checks it).
  scenario.rpc.feature_enabled_for_user = true;
});

async function as(uid: string) {
  env();
  scenario.authUser = { id: uid, email: `${uid}@test.dev`, email_confirmed_at: "2026-10-01T00:00:00Z" };
  return loadEdgeFunction("shop-checkout");
}
const tap = (fn: Awaited<ReturnType<typeof as>>, body: Record<string, unknown>) =>
  fn.fetch(fn.request({ headers: { Authorization: "Bearer member-jwt" }, body }));

describe("shop-checkout pay_balance: the buyer's pay-the-rest page", () => {
  it("opens ONE page for exactly the rest, keyed on the order and the page it replaces, and attaches it", async () => {
    const fn = await as(BUYER);
    scenario.reads.shop_orders = { rows: [owed({ balance_failed_at: "2026-11-06T15:00:00Z", balance_checkout_session_id: "cs_live_old" })] };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_rest", url: "https://checkout.stripe.com/rest", amount_total: 3385 });
    scenario.rpc.shop_attach_balance_session = { replaced: "cs_live_old" };
    const res = await tap(fn, { action: "pay_balance", order_id: ORDER });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ url: "https://checkout.stripe.com/rest", order_id: ORDER });
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    const [params, opts] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params.line_items).toHaveLength(1);
    expect(params.line_items[0].price_data.unit_amount).toBe(3385);
    expect(params.metadata).toMatchObject({ kind: "shop_balance", order_id: ORDER, buyer_id: BUYER });
    expect(params.payment_intent_data).toMatchObject({ metadata: { kind: "shop_balance", order_id: ORDER }, transfer_group: `shop_order_${ORDER}` });
    // Charged at once (the rest is owed now), never a hold.
    expect(params.payment_intent_data.capture_method).toBeUndefined();
    expect(opts).toEqual({ idempotencyKey: `shop-balance-page-${ORDER}-cs_live_old` });
    expect(rpcs("shop_attach_balance_session")[0]?.args).toEqual({ p_order_id: ORDER, p_session_id: "cs_live_rest" });
    // The page it replaced is closed, so only one can be paid.
    expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith("cs_live_old");
  });

  it("another member (even the shop) is told the order does not exist, and nothing is opened", async () => {
    for (const who of [MAKER, OTHER]) {
      resetStripeMock();
      resetSupabaseMock();
      scenario.reads.test_accounts = { rows: [] };
      const fn = await as(who);
      scenario.reads.shop_orders = { rows: [owed()] };
      const res = await tap(fn, { action: "pay_balance", order_id: ORDER });
      expect(res.status).toBe(404);
      expect((await json(res)).error).toBe("order_not_found");
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    }
  });

  it("an order whose rest is already paid opens nothing", async () => {
    const fn = await as(BUYER);
    scenario.reads.shop_orders = { rows: [owed({ balance_payment_intent_id: "pi_rest" })] };
    const res = await tap(fn, { action: "pay_balance", order_id: ORDER });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("nothing_owed");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("a page whose total is not the rest is closed and never attached", async () => {
    const fn = await as(BUYER);
    scenario.reads.shop_orders = { rows: [owed()] };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_rest", url: "https://x", amount_total: 3400 });
    const res = await tap(fn, { action: "pay_balance", order_id: ORDER });
    expect(res.status).toBe(500);
    expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith("cs_live_rest");
    expect(rpcs("shop_attach_balance_session")).toHaveLength(0);
  });
});

describe("shop-checkout charge_rest: the shop's Handed-over tap tries the saved card", () => {
  it("on or after the ready date: ONE off-session charge for the rest, keyed on the order (one key for every try), then recorded", async () => {
    const fn = await as(MAKER);
    scenario.reads.shop_orders = { rows: [owed({ balance_attempts: 2 })] };
    scenario.rpc.shop_local_today = "2026-11-06";
    scenario.rpc.shop_balance_paid = { result: "paid" };
    stripeMock.paymentIntents.create.mockResolvedValue(paidPi("pi_rest"));
    const res = await tap(fn, { action: "charge_rest", order_id: ORDER });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ paid: true, waiting_on_buyer: false });
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
    const [params, opts] = stripeMock.paymentIntents.create.mock.calls[0];
    expect(params).toMatchObject({
      amount: 3385, currency: "usd", customer: "cus_buyer", payment_method: "pm_saved", off_session: true, confirm: true,
      transfer_group: `shop_order_${ORDER}`, metadata: { kind: "shop_balance", order_id: ORDER },
    });
    expect(opts).toEqual({ idempotencyKey: `shop-balance-${ORDER}` });
    expect(rpcs("shop_balance_paid")[0]?.args).toEqual({ p_order_id: ORDER, p_payment_intent_id: "pi_rest", p_card_fee_cents: 128, p_amount_cents: 3385 });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("before the ready date the tap charges nothing", async () => {
    const fn = await as(MAKER);
    scenario.reads.shop_orders = { rows: [owed({ ready_date: "2026-11-09" })] };
    scenario.rpc.shop_local_today = "2026-11-06";
    const res = await tap(fn, { action: "charge_rest", order_id: ORDER });
    expect(await json(res)).toEqual({ paid: false, not_due: true });
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("the buyer (or anyone but the shop) cannot make the shop's charge", async () => {
    for (const who of [BUYER, OTHER]) {
      resetStripeMock();
      resetSupabaseMock();
      scenario.reads.test_accounts = { rows: [] };
      const fn = await as(who);
      scenario.reads.shop_orders = { rows: [owed()] };
      scenario.rpc.shop_local_today = "2026-11-06";
      const res = await tap(fn, { action: "charge_rest", order_id: ORDER });
      expect(res.status).toBe(404);
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    }
  });

  it("a card the bank declines goes to the buyer (OWNER rule), recorded as theirs; the shop waits", async () => {
    const fn = await as(MAKER);
    scenario.reads.shop_orders = { rows: [owed()] };
    scenario.rpc.shop_local_today = "2026-11-06";
    scenario.rpc.shop_balance_failed = null;
    stripeMock.paymentIntents.create.mockRejectedValue(Object.assign(new Error("Your card was declined."), { type: "StripeCardError", code: "card_declined" }));
    const res = await tap(fn, { action: "charge_rest", order_id: ORDER });
    expect(await json(res)).toEqual({ paid: false, waiting_on_buyer: true });
    expect(rpcs("shop_balance_failed")[0]?.args).toEqual({ p_order_id: ORDER, p_error: "Your card was declined.", p_buyer: true });
    expect(rpcs("shop_balance_paid")).toHaveLength(0);
  });

  it("a Stripe outage is NOT the buyer's: counted for a retry, the buyer is not told", async () => {
    const fn = await as(MAKER);
    scenario.reads.shop_orders = { rows: [owed()] };
    scenario.rpc.shop_local_today = "2026-11-06";
    scenario.rpc.shop_balance_failed = null;
    stripeMock.paymentIntents.create.mockRejectedValue(Object.assign(new Error("api down"), { type: "StripeAPIError" }));
    const res = await tap(fn, { action: "charge_rest", order_id: ORDER });
    expect(await json(res)).toEqual({ paid: false, waiting_on_buyer: false });
    expect(rpcs("shop_balance_failed")[0]?.args).toMatchObject({ p_order_id: ORDER, p_buyer: false });
  });

  it("11-07: no card saved at Checkout: the rest is the buyer's to pay at once (notice + Pay button), with no Stripe call", async () => {
    const fn = await as(MAKER);
    scenario.reads.shop_orders = { rows: [owed({ balance_customer_id: null, balance_payment_method_id: null })] };
    scenario.rpc.shop_local_today = "2026-11-06";
    scenario.rpc.shop_balance_failed = { result: "buyer_pays" };
    const res = await tap(fn, { action: "charge_rest", order_id: ORDER });
    expect(await json(res)).toEqual({ paid: false, waiting_on_buyer: true });
    expect(rpcs("shop_balance_failed")[0]?.args).toEqual({ p_order_id: ORDER, p_error: "no card was saved at Checkout", p_buyer: true });
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("11-07: the 3rd failed try of any kind is the buyer's (the SQL answers buyer_pays); the same key every try", async () => {
    const fn = await as(MAKER);
    scenario.reads.shop_orders = { rows: [owed({ balance_attempts: 2 })] };
    scenario.rpc.shop_local_today = "2026-11-06";
    scenario.rpc.shop_balance_failed = { result: "buyer_pays" };
    stripeMock.paymentIntents.create.mockRejectedValue(Object.assign(new Error("api down"), { type: "StripeAPIError" }));
    const res = await tap(fn, { action: "charge_rest", order_id: ORDER });
    expect(await json(res)).toEqual({ paid: false, waiting_on_buyer: true });
    expect(stripeMock.paymentIntents.create.mock.calls[0][1]).toEqual({ idempotencyKey: `shop-balance-${ORDER}` });
  });

  it("11-07: the tap takes the Shops switch and the shop owner's standing; neither charges anything", async () => {
    let fn = await as(MAKER);
    scenario.reads.shop_orders = { rows: [owed()] };
    scenario.rpc.shop_local_today = "2026-11-06";
    scenario.rpc.feature_enabled_for_user = false;
    let res = await tap(fn, { action: "charge_rest", order_id: ORDER });
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: "feature_disabled" });
    resetSupabaseMock();
    scenario.reads.test_accounts = { rows: [] };
    scenario.rpc.feature_enabled_for_user = true;
    fn = await as(MAKER);
    scenario.reads.shop_orders = { rows: [owed()] };
    scenario.rpc.shop_local_today = "2026-11-06";
    scenario.reads.profiles = { rows: [{ ban_status: "banned", auto_suspended_until: null }] };
    res = await tap(fn, { action: "charge_rest", order_id: ORDER });
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: "account_restricted" });
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("an order already waiting on the buyer is never charged again from the tap", async () => {
    const fn = await as(MAKER);
    scenario.reads.shop_orders = { rows: [owed({ balance_failed_at: "2026-11-06T15:00:00Z" })] };
    const res = await tap(fn, { action: "charge_rest", order_id: ORDER });
    expect(await json(res)).toEqual({ paid: false, waiting_on_buyer: true });
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe("stripe-webhook: the saved card and the rest's payment", () => {
  async function deliver(event: Record<string, unknown>) {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({ livemode: true, created: 1_760_000_000, ...event });
    return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
  }
  const holdLands = (metadata: Record<string, string>) => deliver({
    id: `evt_hold_${Math.random()}`, type: "checkout.session.completed",
    data: { object: {
      id: "cs_live_dep", mode: "payment", payment_status: "unpaid", payment_intent: "pi_dep", amount_total: 6770,
      total_details: { amount_tax: 0 }, client_reference_id: ORDER, metadata,
    } },
  });
  const DEP_META = { kind: "shop_order", order_id: ORDER, buyer_id: BUYER, payer_id: BUYER, seller_id: MAKER, payment_plan: "deposit_50" };

  it("a deposit order's hold records the card it saved, once", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_dep", status: "requires_capture", payment_method: "pm_saved", customer: "cus_buyer" });
    scenario.rpc.shop_mark_order_held = { result: "held", order_id: ORDER };
    scenario.rpc.shop_order_record_saved_card = { result: "recorded" };
    const res = await holdLands(DEP_META);
    expect(res.status).toBe(200);
    expect(rpcs("shop_order_record_saved_card").map((c) => c.args)).toEqual([
      { p_order_id: ORDER, p_customer_id: "cus_buyer", p_payment_method_id: "pm_saved" },
    ]);
  });

  it("a full-hold order's page records no card", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_dep", status: "requires_capture", payment_method: "pm_saved", customer: "cus_buyer" });
    scenario.rpc.shop_mark_order_held = { result: "held", order_id: ORDER };
    const full: Record<string, string> = { ...DEP_META };
    delete full.payment_plan;
    await holdLands(full);
    expect(rpcs("shop_order_record_saved_card")).toHaveLength(0);
  });

  it("a failed card write throws, so Stripe redelivers", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_dep", status: "requires_capture", payment_method: "pm_saved", customer: "cus_buyer" });
    scenario.rpc.shop_mark_order_held = { result: "held", order_id: ORDER };
    scenario.rpcErrors = { shop_order_record_saved_card: { message: "boom" } };
    const res = await holdLands(DEP_META);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  it("the rest's payment is recorded with its card fee, and never runs the job path", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(paidPi("pi_rest"));
    scenario.rpc.shop_balance_paid = { result: "paid" };
    const res = await deliver({ id: "evt_rest", type: "payment_intent.succeeded",
      data: { object: { id: "pi_rest", amount: 3385, amount_received: 3385, livemode: true, metadata: { kind: "shop_balance", order_id: ORDER } } } });
    expect(res.status).toBe(200);
    expect(rpcs("shop_balance_paid").map((c) => c.args)).toEqual([{ p_order_id: ORDER, p_payment_intent_id: "pi_rest", p_card_fee_cents: 128, p_amount_cents: 3385 }]);
    expect(stripeMock.tax.transactions.createFromCalculation).not.toHaveBeenCalled();
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("a rest payment the order no longer owes is refunded whole, once, keyed on the payment", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(paidPi("pi_rest2"));
    scenario.rpc.shop_balance_paid = { result: "refund" };
    stripeMock.refunds.create.mockResolvedValue({ id: "re_rest2", status: "succeeded" });
    await deliver({ id: "evt_rest2", type: "payment_intent.succeeded",
      data: { object: { id: "pi_rest2", amount: 3385, amount_received: 3385, livemode: true, metadata: { kind: "shop_balance", order_id: ORDER } } } });
    expect(stripeMock.refunds.create.mock.calls).toEqual([[
      { payment_intent: "pi_rest2", metadata: { kind: "shop_balance_refund", order_id: ORDER } },
      { idempotencyKey: "shop-balance-refund-pi_rest2" },
    ]]);
  });
});

describe("stripe-webhook: a deposit order's tax", () => {
  const TAXED = { kind: "shop_order", order_id: ORDER, buyer_id: BUYER, payer_id: BUYER, seller_id: MAKER, tax_calculation_id: "taxcalc_dep", job_tax_cents: "290" };
  async function deliver(event: Record<string, unknown>) {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({ livemode: true, created: 1_760_000_000, ...event });
    return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
  }
  const captured = (metadata: Record<string, string>, received: number) => deliver({
    id: `evt_cap_${Math.random()}`, type: "payment_intent.succeeded",
    data: { object: { id: "pi_dep", amount: 6770, amount_received: received, livemode: true, metadata } },
  });

  it("the deposit capture (stamped with exactly what it took) commits the WHOLE calculation", async () => {
    scenario.reads.jobs = { rows: [] };
    scenario.reads.shop_orders = { rows: [{ is_seed: false, buyer_id: BUYER, seller_id: MAKER }] };
    stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_dep" });
    const res = await captured({ ...TAXED, shop_deposit_capture_cents: "3385" }, 3385);
    expect(res.status).toBe(200);
    expect(stripeMock.tax.transactions.createFromCalculation.mock.calls).toEqual([
      [{ calculation: "taxcalc_dep", reference: "pi_dep" }, { idempotencyKey: "job-site-tax:pi_dep" }],
    ]);
  });

  it("a short capture WITHOUT the deposit stamp (or with a different amount) still commits nothing and pages", async () => {
    for (const md of [TAXED, { ...TAXED, shop_deposit_capture_cents: "3000" }]) {
      resetStripeMock();
      resetSharedMocks();
      scenario.reads.jobs = { rows: [] };
      scenario.reads.shop_orders = { rows: [{ is_seed: false, buyer_id: BUYER, seller_id: MAKER }] };
      await captured(md, 3385);
      expect(stripeMock.tax.transactions.createFromCalculation).not.toHaveBeenCalled();
      expect((slackAlerts as Array<{ kind?: string }>).some((a) => a.kind === "money_at_risk")).toBe(true);
    }
  });

  it("a refund on a charge whose tax was reversed in full at an unpaid close reverses nothing more", async () => {
    stripeMock.refunds.list.mockResolvedValue({ data: [
      { id: "re_dep_tax", amount: 145, created: 60, status: "succeeded", charge: "ch_dep", metadata: { kind: "shop_refund", shop_refund_id: "r1", order_id: ORDER } },
    ], has_more: false });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_dep", metadata: { ...TAXED, tax_transaction_id: "tax_txn_dep", tax_rev_unpaid_close: "taxrev_close" } });
    stripeMock.tax.transactions.listLineItems.mockResolvedValue({ data: [{ amount: 6480, amount_tax: 290, tax_behavior: "exclusive" }], has_more: false });
    const res = await deliver({ id: "evt_ref_dep", type: "charge.refunded",
      data: { object: { id: "ch_dep", payment_intent: "pi_dep", amount: 3385, amount_captured: 3385, amount_refunded: 145, metadata: { kind: "shop_order", order_id: ORDER } } } });
    expect(res.status).toBe(200);
    expect(stripeMock.tax.transactions.createReversal).not.toHaveBeenCalled();
  });
});

describe("declutter-money: the rest and the unpaid-close tax step", () => {
  it("charges each due rest once (its own key), then reverses an unpaid close's tax in full and records the step", async () => {
    env();
    const fn = await loadEdgeFunction("declutter-money");
    scenario.rpc.shop_balances_due = [{
      order_id: ORDER, buyer_id: BUYER, seller_id: MAKER, balance_cents: 3385, customer_id: "cus_buyer",
      payment_method_id: "pm_saved", attempts: 1, livemode: true, checkout_session_id: "cs_live_dep",
    }];
    scenario.rpc.shop_balance_paid = { result: "paid" };
    scenario.rpc.shop_balance_lapse_sweep = [];
    const CLOSED = "0000000d-0000-4000-8000-0000000000ab";
    scenario.rpc.shop_lapse_tax_due = [{
      order_id: CLOSED, buyer_id: BUYER, seller_id: MAKER, payment_intent_id: "pi_closed", deposit_tax_cents: 145,
      livemode: true, checkout_session_id: "cs_live_closed",
    }];
    scenario.rpc.shop_lapse_tax_done = { result: "queued" };
    stripeMock.paymentIntents.create.mockResolvedValue(paidPi("pi_rest"));
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_closed", metadata: { tax_transaction_id: "tax_txn_closed" } });
    stripeMock.tax.transactions.createReversal.mockResolvedValue({ id: "taxrev_closed" });
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer cron-secret" } }));
    expect(res.status).toBe(200);
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.paymentIntents.create.mock.calls[0][1]).toEqual({ idempotencyKey: `shop-balance-${ORDER}` });
    expect(rpcs("shop_balance_paid")[0]?.args).toEqual({ p_order_id: ORDER, p_payment_intent_id: "pi_rest", p_card_fee_cents: 128, p_amount_cents: 3385 });
    expect(rpcs("shop_balance_lapse_sweep")).toHaveLength(1);
    expect(stripeMock.tax.transactions.createReversal.mock.calls).toEqual([[
      { mode: "full", original_transaction: "tax_txn_closed", reference: `unpaid_close:${CLOSED}`, metadata: { order_id: CLOSED, reason: "unpaid_close" } },
      { idempotencyKey: `shop-unpaid-close-tax-${CLOSED}` },
    ]]);
    expect(stripeMock.paymentIntents.update).toHaveBeenCalledWith("pi_closed", { metadata: { tax_rev_unpaid_close: "taxrev_closed" } });
    expect(rpcs("shop_lapse_tax_done")[0]?.args).toEqual({ p_order_id: CLOSED });
  });

  it("an unpaid close already reversed (a run that died before recording) is not reversed twice", async () => {
    env();
    const fn = await loadEdgeFunction("declutter-money");
    const CLOSED = "0000000d-0000-4000-8000-0000000000ab";
    scenario.rpc.shop_balances_due = [];
    scenario.rpc.shop_balance_lapse_sweep = [];
    scenario.rpc.shop_lapse_tax_due = [{ order_id: CLOSED, buyer_id: BUYER, seller_id: MAKER, payment_intent_id: "pi_closed", deposit_tax_cents: 145, livemode: true, checkout_session_id: "cs_live_closed" }];
    scenario.rpc.shop_lapse_tax_done = { result: "queued" };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_closed", metadata: { tax_transaction_id: "tax_txn_closed", tax_rev_unpaid_close: "taxrev_closed" } });
    await fn.fetch(fn.request({ headers: { Authorization: "Bearer cron-secret" } }));
    expect(stripeMock.tax.transactions.createReversal).not.toHaveBeenCalled();
    expect(rpcs("shop_lapse_tax_done")[0]?.args).toEqual({ p_order_id: CLOSED });
  });
});

describe("shop-checkout accept: the order is accepted even when the capture step throws (11-07 money review)", () => {
  it("a capture step that throws answers accepted, not charged (declutter-money captures it), never an error", async () => {
    const fn = await as(MAKER);
    scenario.rpc.shops_accept_order = { result: "accepted", order_id: ORDER, captured: false };
    scenario.reads.shop_orders = { rows: [owed({ status: "accepted", captured_at: null, payment_plan: "deposit_50", deposit_cents: 3385 })] };
    stripeMock.paymentIntents.capture.mockRejectedValue(Object.assign(new Error("api down"), { type: "StripeAPIError" }));
    stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error("still down"));
    scenario.rpcErrors = { shop_order_capture_failed: { message: "db down" } };
    const res = await tap(fn, { action: "accept", order_id: ORDER });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ accepted: true, charged: false });
  });
});
