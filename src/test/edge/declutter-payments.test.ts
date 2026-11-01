/**
 * Declutter slice 3b, the Stripe step (docs/specs/declutter-auctions.md rows
 * 36, 60-62; B39-B45): declutter-card (save a card), declutter-checkout (pay /
 * seller cancel) and the stripe-webhook branch for their Checkout Sessions.
 *
 * Runs the REAL function source through the edge harness; Stripe, Supabase
 * and the Deno runtime are doubled. The money RULES (who is refunded what,
 * the fee debt, in-time payments) live in SQL and are proven by
 * src/test/pglite/declutterSlice3b.pglite.mjs; this file proves the edge side
 * calls them with the right identity and the right numbers and acts on their
 * answers exactly once.
 *
 * Registered mutations - each turns this file RED on its own:
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts | { idempotencyKey: mine.length === 0 ? `declutter-refund-${refund.refund_id}` : `declutter-refund-${refund.refund_id}-r${mine.length}` }, | {},
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     stripeRefund = existing ?? await stripe.refunds.create( |     stripeRefund = await stripe.refunds.create(
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |   if (isDeclutterCharge(charge, allRefunds)) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |   if (meta.kind === "declutter_refund" && meta.delivery_refund_id) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     \|\| (typeof charge.transfer_group === "string" && charge.transfer_group.startsWith("declutter_order_")) |
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     if (why) { |     if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |   if (await handleDeclutterHandRefundFailed(refund, { supabase })) return; |
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     if ((error as { code?: string }).code === "PGRST202") return false; |
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   if (refund.refund_status === "succeeded" \|\| refund.refund_status === "held_for_review" \|\| refund.refund_status === "settled_by_hand") return "already"; |
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   const paidAt = new Date((facts.chargedAt ?? event.created) * 1000).toISOString(); |   const paidAt = new Date().toISOString();
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |   if (isDeclutterSession(session)) { |   if (false) {
 * @mutate supabase/functions/declutter-checkout/index.ts |   if (row!.superseded_session_id) await expirePage(stripeOf(row!.superseded_session_id), row!.superseded_session_id); |
 * @mutate supabase/functions/declutter-checkout/index.ts |     { idempotencyKey: `declutter-order-${order.order_id}-${expiresAt}` }, |     {},
 * @mutate supabase/functions/declutter-checkout/index.ts |     if (page.status === "complete") return json({ paid: true, order_id: open.id }); |
 * @mutate supabase/functions/declutter-checkout/index.ts |     if (page.status === "open" && (open.handover !== handover \|\| slotChanged \|\| spotChanged \|\| bundleChanged \|\| pickupChanged)) { |     if (false) {
 * @mutate supabase/functions/declutter-checkout/index.ts |     bundleChanged = Number(off ?? 0) !== Number(open.bundle_discount_cents ?? 0); |     bundleChanged = false; void off;
 * @mutate supabase/functions/declutter-checkout/index.ts |         if (refused) return json({ error: "porch_unavailable" }, 400); |         if (false) return json({ error: "porch_unavailable" }, 400);
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   if (parties && !partyGone && (parties.buyer_id !== meta.buyer_id \|\| parties.seller_id !== meta.seller_id)) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   if (refunded === "sent") { |   if (true) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |   if (allRefunds.length > 0 && allRefunds.every((r) => (r?.metadata as Record<string, string> \| null)?.kind === "declutter_refund")) { |   if (allRefunds.length > 0 && allRefunds.some((r) => (r?.metadata as Record<string, string> \| null)?.kind === "declutter_refund")) {
 * @mutate supabase/functions/declutter-checkout/index.ts |     payer_id: user.id, |
 * @mutate supabase/functions/declutter-checkout/index.ts |   const off = await requireFeature(admin, "declutter", user, corsHeaders);\n  if (off) return off; |
 * @mutate supabase/functions/declutter-checkout/index.ts |   if (deliveryCents > 0) { |   if (false) {
 * @mutate supabase/functions/declutter-checkout/index.ts |         if (quoteErr) return rpcRefusal(quoteErr);\n      }\n      if (handover === "seller_delivery") { |         void quoteErr;\n      }\n      if (handover === "seller_delivery") {
 * @mutate supabase/functions/declutter-checkout/index.ts |   if (!deliveryShapeOk\n      \|\| | if (
 * @mutate supabase/functions/declutter-card/index.ts |   const refused = await requireFeature(admin, "declutter", user, corsHeaders);\n  if (refused) return refused; |
 * @mutate supabase/functions/_shared/stripeMode.ts |   if (session.mode === "setup") return meta.kind === "declutter_card"; |   if (session.mode === "setup") return false;
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     p_livemode: event.livemode === true, |     p_livemode: false,
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   if (modeErr) throw new Error(`declutter_refund_set_mode failed: ${modeErr.message}`); |
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |   if (meta.kind === "declutter_refund") { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |     const gaveUp = reopened === "gave_up"; |     const gaveUp = false;
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts | order_id: refund.order_id ?? "" }, | order_id: orderId },
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";
import { emailRenders, queuedEmails, resetEmailMocks } from "./mocks/email";

/** AUD31-35: the branded notice email each Declutter money email was rendered from (the mock records the element). */
type Rendered = { type: { name: string }; props: Record<string, string> };
const renderedEmail = (title: string | RegExp): Rendered | undefined =>
  (emailRenders as Rendered[]).find((e) => (typeof title === "string" ? e.props.title === title : title.test(e.props.title)));
import { isRoutedTestCheckout } from "../../../supabase/functions/_shared/stripeMode";

const BUYER = "0000000a-0000-4000-8000-000000000001";
const SELLER = "0000000a-0000-4000-8000-000000000002";
const ORDER = "0000000a-0000-4000-8000-0000000000aa";
const ITEM = "0000000a-0000-4000-8000-0000000000bb";

function env(extra: Record<string, string> = {}) {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_declutter",
    STRIPE_TEST_SECRET_KEY: "sk_test_declutter",
    STRIPE_WEBHOOK_SECRET: "whsec_live",
    ...extra,
  });
}
async function json(res: Response): Promise<Record<string, any>> {
  return JSON.parse(await res.text());
}
const rpcs = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);
/** The client an rpc ran on. */
const clientOf = (call: { client?: number }) => scenario.clients?.[call.client ?? -1];
/** A Stripe Checkout Session as retrieve() returns it (built, not a literal: its `status` is Stripe's, not a table's). */
const page = (id: string, status: string, url?: string) => ({ id, status, url });

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
  resetEmailMocks();
  // Real members (no test_accounts rows): live mode.
  scenario.reads.test_accounts = { rows: [] };
  // Q1929: every hand refund first asks whether it was on a delivery-pay raise's own charge. These
  // charges are orders, so the real RPC answers 'not_raise' (an unknown answer now throws).
  scenario.rpc.declutter_delivery_raise_hand_refund = "not_raise";
});

describe("stripe-webhook: Declutter order paid", () => {
  async function deliver(answer: unknown, opts: { created?: number; fee?: number | null; chargedAt?: number; orderRow?: Record<string, unknown>; meta?: Record<string, string>; sellerEmail?: string } = {}) {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_dc_1",
      type: "checkout.session.completed",
      livemode: true,
      created: opts.created ?? 1_760_000_000,
      data: { object: {
        id: "cs_live_dc", mode: "payment", payment_status: "paid", payment_intent: "pi_dc", amount_total: 4600,
        client_reference_id: ORDER,
        metadata: { kind: "declutter_order", order_id: ORDER, buyer_id: BUYER, payer_id: BUYER, seller_id: SELLER, ...opts.meta },
      } },
    });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_dc", latest_charge: { created: opts.chargedAt, balance_transaction: { fee: opts.fee === undefined ? 163 : opts.fee } },
    });
    scenario.rpc.declutter_mark_order_paid = answer;
    scenario.reads.profiles = { rows: [{ email: "buyer@test.dev", user_id: BUYER }],
      ...(opts.sellerEmail ? { eqOverrides: [{ column: "user_id", value: SELLER, result: { rows: [{ email: opts.sellerEmail, user_id: SELLER, full_name: "Sam Seller" }] } }] } : {}) };
    scenario.reads.declutter_orders = { rows: [opts.orderRow ?? { buyer_id: BUYER, seller_id: SELLER }] };
    const res = await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
    return res;
  }

  // Q2307 (lh-money-escrow review 2026-10-21 #3): a payment on an order a party has left (deleted account, column NULL)
  // is refunded automatically and never applied, instead of a "wrong people, refund by hand" page.
  // @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   const partyGone = !!parties && (parties.buyer_id == null \|\| parties.seller_id == null); |   const partyGone = false;
  it("a payment on an order a party has left is refunded automatically, never marked paid", async () => {
    stripeMock.refunds.create.mockResolvedValue({ id: "re_gone", status: "succeeded" });
    scenario.rpc.declutter_refund_party_gone = { result: "refund", refund_id: "rf-gone", reason: "order_closed", fee_policy: "full_platform_absorbs", refund_cents: 4600, refund_status: "pending" };
    const res = await deliver({ result: "paid" }, { orderRow: { buyer_id: BUYER, seller_id: null } });
    expect(res.status).toBe(200);
    expect(rpcs("declutter_mark_order_paid")).toHaveLength(0);
    expect(rpcs("declutter_refund_party_gone")[0]?.args).toMatchObject({ p_order_id: ORDER, p_payment_intent_id: "pi_dc", p_amount_cents: 4600 });
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: "pi_dc", amount: 4600 }), { idempotencyKey: "declutter-refund-rf-gone" });
    expect((slackAlerts as Array<{ title: string }>).some((a) => /names the wrong people/.test(a.title))).toBe(false);
  });

  // Q2352 (owner 2026-10-22, terms #9): the one-time setup fee is charged once per account. A sale whose account
  // had already paid it elsewhere (declutter_claim_setup_fee -> refund_due) sends exactly the fee back, once.
  // @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     await settleSetupFee(ctx, paymentIntentId, orderId); |
  // @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |         amount: cents, |         amount: cents + 1,
  // @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     feeRefund = existing ?? await stripe.refunds.create( |     feeRefund = await stripe.refunds.create(
  // @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   if (!row \|\| row.setup_fee_state !== "refund_due") return; |   if (!row) return;
  const feeOwed = { buyer_id: BUYER, seller_id: SELLER, setup_fee_cents: 200, setup_fee_state: "refund_due", stripe_payment_intent_id: "pi_dc" };
  it("Q2352: a sale whose account had paid the setup fee elsewhere sends exactly that fee back, once, and records it", async () => {
    stripeMock.refunds.create.mockResolvedValue({ id: "re_fee", status: "succeeded" });
    scenario.rpc.declutter_setup_fee_refunded = "recorded";
    const res = await deliver({ result: "paid" }, { orderRow: feeOwed });
    expect(res.status).toBe(200);
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_dc", amount: 200,
        metadata: expect.objectContaining({ kind: "declutter_refund", setup_fee_order_id: ORDER }) }),
      { idempotencyKey: `declutter-setup-fee-${ORDER}` });
    expect(rpcs("declutter_setup_fee_refunded")[0]?.args).toEqual({ p_order_id: ORDER, p_stripe_refund_id: "re_fee" });
  });
  it("Q2352: a replayed event adopts the fee refund Stripe already took (never a second one)", async () => {
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_fee_old", status: "succeeded", metadata: { kind: "declutter_refund", setup_fee_order_id: ORDER } }] });
    scenario.rpc.declutter_setup_fee_refunded = "already";
    const res = await deliver({ result: "already_paid" }, { orderRow: feeOwed });
    expect(res.status).toBe(200);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(rpcs("declutter_setup_fee_refunded")[0]?.args).toEqual({ p_order_id: ORDER, p_stripe_refund_id: "re_fee_old" });
  });
  // lh-silent-failure review of the Q2352 rebase #1: a sale paid without the fee it froze is never silent.
  // @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   if (row && row.setup_fee_state === "not_charged" && Number(row.setup_fee_cents ?? 0) > 0) { |   if (false) {
  it("Q2352: a sale paid without its frozen setup fee (not_charged) alerts ops and sends nothing back", async () => {
    const res = await deliver({ result: "paid" }, { orderRow: { ...feeOwed, setup_fee_state: "not_charged" } });
    expect(res.status).toBe(200);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect((slackAlerts as Array<{ title: string }>).some((a) => /setup fee not charged/.test(a.title))).toBe(true);
  });
  // lh-money-escrow review of the Q2352 rebase #4: the receipt names the fee only when this order's claim won.
  // @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     const setupFeeCents = feeClaimed ? Number.parseInt(meta.setup_fee_cents ?? "0", 10) : 0; |     const setupFeeCents = Number.parseInt(meta.setup_fee_cents ?? "0", 10);
  it("Q2352: the receipt names the setup fee only when the order's claim won", async () => {
    await deliver({ result: "paid" }, { orderRow: { ...feeOwed, setup_fee_state: "claimed" }, meta: { setup_fee_cents: "200" } });
    expect(renderedEmail("Your Declutter receipt")?.props.message).toMatch(/account setup fee/);
  });
  const feeRefundTaken = { id: "re_fee", status: "succeeded" };
  it("Q2352: a lost claim (fee coming back) gets a receipt that never says the payment included the fee", async () => {
    stripeMock.refunds.create.mockResolvedValue(feeRefundTaken);
    scenario.rpc.declutter_setup_fee_refunded = "recorded";
    await deliver({ result: "paid" }, { orderRow: feeOwed, meta: { setup_fee_cents: "200" } });
    expect(queuedEmails.map((e) => e.templateName)).toContain("declutter_receipt");
    const receipt = renderedEmail("Your Declutter receipt");
    expect(receipt?.props.message).toMatch(/^You paid /);
    expect(receipt?.props.message).not.toMatch(/account setup fee/);
  });
  it("Q2352: a sale that kept its setup fee (claimed) sends nothing back", async () => {
    const res = await deliver({ result: "paid" }, { orderRow: { ...feeOwed, setup_fee_state: "claimed" } });
    expect(res.status).toBe(200);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(rpcs("declutter_setup_fee_refunded")).toHaveLength(0);
  });
  it("Q2352: a fee refund Stripe refuses pages ops and is retried (500), nothing recorded", async () => {
    stripeMock.refunds.create.mockRejectedValue(new Error("stripe down"));
    const res = await deliver({ result: "paid" }, { orderRow: feeOwed });
    expect(res.status).toBe(500);
    expect(rpcs("declutter_setup_fee_refunded")).toHaveLength(0);
    expect((slackAlerts as Array<{ title: string }>).some((a) => /setup fee refund failed/.test(a.title))).toBe(true);
  });

  it("marks the order paid with the CHARGE's own time and the card fee Stripe kept, then sends a receipt", async () => {
    const res = await deliver({ result: "paid" }, { created: 1_760_000_123, chargedAt: 1_760_000_100 });
    expect(res.status).toBe(200);
    const call = rpcs("declutter_mark_order_paid")[0];
    expect(call?.args).toEqual({
      p_order_id: ORDER, p_payment_intent_id: "pi_dc", p_amount_cents: 4600,
      p_paid_at: new Date(1_760_000_100 * 1000).toISOString(), p_card_fee_cents: 163,
    });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(queuedEmails.map((e) => e.templateName)).toEqual(["declutter_receipt"]);
    expect(queuedEmails[0].to).toBe("buyer@test.dev");
  });

  // Deep audit #57 / audit 2 SH2-3 (A2-3): the seller is emailed when the buyer pays, once, with no fee words.
  // AUD31-35: rendered from the branded notice email (React escapes the member's item title), greeting by first name.
  // @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     await emailSeller(supabase, parties?.seller_id, orderId, "sold", parties?.items_cents, logStep, |     if (Math.random() > 2) await emailSeller(supabase, parties?.seller_id, orderId, "sold", parties?.items_cents, logStep,
  // @mutate supabase/functions/_shared/declutterSellerEmail.ts |       subject: `You sold ${items}`, |       subject: "You sold an item",
  // @mutate supabase/functions/_shared/declutterSellerEmail.ts |     userName: firstName(opts.fullName), |     userName: "",
  // @mutate supabase/functions/_shared/declutterSellerEmail.ts |     const result = await queueEmail(db, { to, subject, templateName, html, text }); |     const result = await queueEmail(db, { to, subject, templateName, html: `<p>${body}</p>`, text });
  it("the seller is emailed \"You sold ...\" when the buyer pays, at the seller's own address, naming the item and price", async () => {
    scenario.rpc.declutter_order_items_named = '"Lamp <b>"';
    const res = await deliver({ result: "paid" }, { orderRow: { buyer_id: BUYER, seller_id: SELLER, items_cents: 3000 }, sellerEmail: "seller@test.dev" });
    expect(res.status).toBe(200);
    expect(queuedEmails.map((e) => e.templateName)).toEqual(["declutter_receipt", "declutter_sold"]);
    const sold = queuedEmails[1] as Record<string, string>;
    expect(sold.to).toBe("seller@test.dev");
    expect(sold.subject).toBe('You sold "Lamp <b>"');
    const r = renderedEmail('You sold "Lamp <b>"');
    expect(r?.type.name).toBe("NotificationEmail");
    expect(r?.props.message).toMatch(/^You sold "Lamp <b>" for \$30\.00\. The buyer has paid\..*you get paid after the handover\./);
    expect(r?.props.userName).toBe("Sam");
    expect(r?.props.actionUrl).toMatch(/\/declutter\?tab=selling$/);
    expect(r?.props.actionLabel).toBe("Open Selling");
    expect(r?.props.prefsUrl).toMatch(/\/profile\?tab=notifications$/);
    // Both parts are the render's (the mock's), never a hand-built raw paragraph.
    expect(sold.html).toBe("<p>mock</p>");
    expect(sold.text).toBe("mock");
    expect(rpcs("declutter_order_items_named")[0]?.args).toEqual({ p_order_id: ORDER });
    expect(JSON.stringify({ sold, message: r?.props.message })).not.toMatch(/fee|%/i);
  });
  // AUD31-35: a seller who delivers is paid items + delivery (declutter_complete_handover's v_rate); the email says so.
  // @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |       parties?.handover === "seller_delivery" ? parties?.delivery_cents : 0); |       0);
  // @mutate supabase/functions/_shared/declutterSellerEmail.ts |     const plus = deliveryCents > 0 ? `, plus ${dollars(deliveryCents)} for delivering it` : ""; |     const plus = "";
  it("a seller who delivers is told the delivery money too; any other handover names the item price only", async () => {
    scenario.rpc.declutter_order_items_named = '"Lamp"';
    await deliver({ result: "paid" }, { orderRow: { buyer_id: BUYER, seller_id: SELLER, items_cents: 4500, delivery_cents: 1000, handover: "seller_delivery" }, sellerEmail: "seller@test.dev" });
    expect(renderedEmail('You sold "Lamp"')?.props.message).toMatch(/^You sold "Lamp" for \$45\.00, plus \$10\.00 for delivering it\. The buyer has paid\./);
    resetEmailMocks();
    await deliver({ result: "paid" }, { orderRow: { buyer_id: BUYER, seller_id: SELLER, items_cents: 4500, delivery_cents: 1000, handover: "delivery" }, sellerEmail: "seller@test.dev" });
    expect(renderedEmail('You sold "Lamp"')?.props.message).toMatch(/^You sold "Lamp" for \$45\.00\. The buyer has paid\./);
  });
  // @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |       title: subject, message: body, path: "/declutter?tab=buying", actionLabel: "Open Buying", |       title: subject, message: body, path: "/declutter", actionLabel: "Open Buying",
  it("the buyer's receipt is the branded notice email and opens Buying (AUD31-35)", async () => {
    await deliver({ result: "paid" });
    const r = renderedEmail("Your Declutter receipt");
    expect(r?.type.name).toBe("NotificationEmail");
    expect(r?.props.actionUrl).toMatch(/\/declutter\?tab=buying$/);
    expect(queuedEmails.find((e) => e.templateName === "declutter_receipt")?.html).toBe("<p>mock</p>");
  });
  it("a redelivered payment (already_paid) emails the seller nothing", async () => {
    await deliver({ result: "already_paid" }, { orderRow: { buyer_id: BUYER, seller_id: SELLER, items_cents: 3000 }, sellerEmail: "seller@test.dev" });
    expect(queuedEmails.filter((e) => e.templateName === "declutter_sold")).toHaveLength(0);
  });
  it("a payment that is refunded (the sale did not stand) emails the seller nothing", async () => {
    stripeMock.refunds.create.mockResolvedValue({ id: "re_x", status: "succeeded" });
    await deliver({ result: "refund", refund_id: "rf-1", reason: "order_closed", fee_policy: "full_platform_absorbs", refund_cents: 4600, refund_status: "pending" },
      { orderRow: { buyer_id: BUYER, seller_id: SELLER, items_cents: 3000 }, sellerEmail: "seller@test.dev" });
    expect(queuedEmails.filter((e) => e.templateName === "declutter_sold")).toHaveLength(0);
  });

  it("an unreadable card fee is sent as null (the SQL estimates it), never as a guess", async () => {
    stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error("boom"));
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_dc_2", type: "checkout.session.completed", livemode: true, created: 1_760_000_000,
      data: { object: { id: "cs_live_dc", mode: "payment", payment_status: "paid", payment_intent: "pi_dc", amount_total: 4600,
        metadata: { kind: "declutter_order", order_id: ORDER, buyer_id: BUYER } } },
    });
    scenario.rpc.declutter_mark_order_paid = { result: "paid" };
    await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
    expect((rpcs("declutter_mark_order_paid")[0]?.args as Record<string, unknown>).p_card_fee_cents).toBeNull();
  });

  it("a refund answer is executed once with Stripe, keyed on the refund row, and reported back", async () => {
    stripeMock.refunds.create.mockResolvedValue({ id: "re_dc", status: "succeeded" });
    const res = await deliver({ result: "refund", refund_id: "rf-1", reason: "seller_backed_out", fee_policy: "full_seller_pays_fee", refund_cents: 4600, refund_status: "pending" });
    expect(res.status).toBe(200);
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_dc", amount: 4600 }),
      { idempotencyKey: "declutter-refund-rf-1" },
    );
    expect(rpcs("declutter_refund_executed")[0]?.args).toEqual({ p_refund_id: "rf-1", p_stripe_refund_id: "re_dc", p_succeeded: true });
    expect(queuedEmails.map((e) => e.templateName)).toEqual(["declutter_refund"]);
  });

  it("a keep-the-fee refund sends exactly the amount the SQL decided", async () => {
    stripeMock.refunds.create.mockResolvedValue({ id: "re_dc", status: "succeeded" });
    await deliver({ result: "refund", refund_id: "rf-2", reason: "buyer_cancelled", fee_policy: "keep_card_fee", refund_cents: 4437, refund_status: "pending" });
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 4437 }), expect.anything());
  });

  it("a payment whose page names other people than its order is NOT applied, and ops are paged", async () => {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_dc_x", type: "checkout.session.completed", livemode: true, created: 1_760_000_000,
      data: { object: { id: "cs_live_dc", mode: "payment", payment_status: "paid", payment_intent: "pi_dc", amount_total: 4600,
        metadata: { kind: "declutter_order", order_id: ORDER, buyer_id: BUYER, seller_id: SELLER } } },
    });
    scenario.reads.declutter_orders = { rows: [{ buyer_id: "someone-else", seller_id: SELLER }] };
    scenario.rpc.declutter_mark_order_paid = { result: "paid" };
    const res = await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
    expect(res.status).toBe(200);
    expect(rpcs("declutter_mark_order_paid")).toHaveLength(0);
    expect((slackAlerts as Array<{ title: string }>).some((a) => /wrong people/.test(a.title))).toBe(true);
  });

  it("a refund Stripe answers 'failed' is recorded as failed, paged, and NOT announced to the buyer", async () => {
    stripeMock.refunds.create.mockResolvedValue({ id: "re_bad", status: "failed" });
    await deliver({ result: "refund", refund_id: "rf-9", reason: "superseded", fee_policy: "full_platform_absorbs", refund_cents: 4600, refund_status: "pending" });
    expect(rpcs("declutter_refund_executed")[0]?.args).toEqual({ p_refund_id: "rf-9", p_stripe_refund_id: "re_bad", p_succeeded: false });
    expect(queuedEmails).toHaveLength(0);
    expect((slackAlerts as Array<{ title: string }>).some((a) => /did not go through/.test(a.title))).toBe(true);
  });

  it("charge.refunded for a Declutter refund leaves it to the Declutter path (no job ledger row, no second notice)", async () => {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_dc_ref", type: "charge.refunded", livemode: true, created: 1_760_000_000,
      // A keep-the-card-fee refund is PARTIAL: the job path would write a "stripe_dashboard" ledger row for it.
      data: { object: { id: "ch_dc", payment_intent: "pi_dc", amount: 4600, amount_refunded: 4437, currency: "usd",
        refunds: { has_more: false, data: [{ id: "re_dc", amount: 4437, status: "succeeded", metadata: { kind: "declutter_refund", refund_id: "rf-1" } }] } } },
    });
    const res = await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
    expect(res.status).toBe(200);
    expect(scenario.writes.filter((w) => w.table !== "stripe_webhook_events")).toEqual([]);
  });

  it("money review 3.6: the refund row records the payment's Stripe mode BEFORE Stripe is asked to refund", async () => {
    stripeMock.refunds.create.mockResolvedValue({ id: "re_dc", status: "succeeded" });
    const res = await deliver({ result: "refund", refund_id: "rf-6", reason: "order_missing", fee_policy: "full_platform_absorbs", refund_cents: 4600, refund_status: "pending" });
    expect(res.status).toBe(200);
    expect(rpcs("declutter_refund_set_mode")[0]?.args).toEqual({ p_refund_id: "rf-6", p_livemode: true });
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("an unrecorded mode is a 500 (Stripe redelivers) and no refund is sent yet", async () => {
    scenario.rpcErrors = { ...(scenario.rpcErrors ?? {}), declutter_refund_set_mode: { message: "boom" } };
    const res = await deliver({ result: "refund", refund_id: "rf-7", reason: "order_missing", fee_policy: "full_platform_absorbs", refund_cents: 4600, refund_status: "pending" });
    expect(res.status).toBe(500);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("charge.refund.updated: a Declutter refund Stripe failed reopens its row for a new refund and pages; no job ledger is touched", async () => {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    scenario.rpc.declutter_refund_reversed = "reopened";
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_dc_ru", type: "charge.refund.updated", livemode: true, created: 1_760_000_000,
      data: { object: { id: "re_dc", object: "refund", status: "failed", failure_reason: "expired_or_canceled_card", amount: 4437,
        payment_intent: "pi_dc", charge: "ch_dc", metadata: { kind: "declutter_refund", refund_id: "rf-1", order_id: ORDER } } },
    });
    const res = await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
    expect(res.status).toBe(200);
    expect(rpcs("declutter_refund_reversed")[0]?.args).toEqual({ p_refund_id: "rf-1", p_stripe_refund_id: "re_dc", p_why: "failed: expired_or_canceled_card" });
    expect(scenario.writes.filter((w) => w.table !== "stripe_webhook_events")).toEqual([]);
    expect(slackAlerts.some((a: any) => a.severity === "critical" && /retrying/.test(a.title))).toBe(true);
  });

  // Q2352 (lh-money-escrow review #2): a setup-fee refund Stripe failed after taking it reopens the order's fee
  // (refund_due, no longer a known refund) and pages "refund it by hand"; it never throws for want of a refund_id.
  // @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |   if (meta.kind === "declutter_refund" && meta.setup_fee_order_id) { |   if (false) {
  it("charge.refund.updated: a failed setup-fee refund reopens the order's fee and pages; never a throw", async () => {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    scenario.rpc.declutter_setup_fee_refund_reversed = "reopened";
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_dc_sf", type: "charge.refund.updated", livemode: true, created: 1_760_000_000,
      data: { object: { id: "re_fee", object: "refund", status: "failed", failure_reason: "expired_or_canceled_card", amount: 200,
        payment_intent: "pi_dc", charge: "ch_dc", metadata: { kind: "declutter_refund", reason: "setup_fee_already_paid", order_id: ORDER, setup_fee_order_id: ORDER } } },
    });
    const res = await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
    expect(res.status).toBe(200);
    expect(rpcs("declutter_setup_fee_refund_reversed")[0]?.args).toEqual({ p_order_id: ORDER, p_stripe_refund_id: "re_fee" });
    expect(rpcs("declutter_refund_reversed")).toHaveLength(0);
    expect(slackAlerts.some((a: any) => a.severity === "critical" && /refund it by hand/.test(a.title))).toBe(true);
  });

  // lh-money-escrow re-review should-fix 1: a reversal of the row's last try is not promised a retry.
  it("charge.refund.updated: a reversal that used the row's LAST try pages 'refund it by hand', never 'a new refund within 10 minutes'", async () => {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    scenario.rpc.declutter_refund_reversed = "gave_up";
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_dc_ru12", type: "charge.refund.updated", livemode: true, created: 1_760_000_000,
      data: { object: { id: "re_dc12", object: "refund", status: "failed", failure_reason: "lost_or_stolen_card", amount: 4437,
        payment_intent: "pi_dc", charge: "ch_dc", metadata: { kind: "declutter_refund", refund_id: "rf-12", order_id: ORDER } } },
    });
    const res = await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
    expect(res.status).toBe(200);
    const page = slackAlerts.find((a: any) => a.severity === "critical") as any;
    expect(page?.title).toMatch(/by hand/);
    expect(page?.message).toMatch(/refund it by hand/i);
    expect(page?.message).not.toMatch(/within 10 minutes/);
  });

  // Slice 5: a delivery fee refunded on its own reopens ITS row (declutter_delivery_refunds), never an order refund row.
  it("charge.refund.updated: a failed delivery-fee refund reopens the delivery refund row and pages", async () => {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    scenario.rpc.declutter_delivery_refund_reversed = "reopened";
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_dc_dru", type: "charge.refund.updated", livemode: true, created: 1_760_000_000,
      data: { object: { id: "re_dd", object: "refund", status: "failed", failure_reason: "expired_or_canceled_card", amount: 2400,
        payment_intent: "pi_dc", charge: "ch_dc", metadata: { kind: "declutter_refund", delivery_refund_id: "dr-1", order_id: ORDER, reason: "no_helpr" } } },
    });
    const res = await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
    expect(res.status).toBe(200);
    expect(rpcs("declutter_delivery_refund_reversed")[0]?.args).toEqual({ p_id: "dr-1", p_stripe_refund_id: "re_dd", p_why: "failed: expired_or_canceled_card" });
    expect(rpcs("declutter_refund_reversed")).toHaveLength(0);
    expect(scenario.writes.filter((w) => w.table !== "stripe_webhook_events")).toEqual([]);
    expect(slackAlerts.some((a: any) => a.severity === "critical" && /delivery-fee refund/.test(a.title))).toBe(true);
  });

  // lh-money-escrow re-review should-fix 2: both paths use the key `declutter-refund-<row id>`, and Stripe refuses
  // a reused key with other parameters, so both must send the SAME parameters for the same row.
  async function runMoney(row: Record<string, unknown>) {
    env();
    scenario.rpc.declutter_payouts_due = [];
    scenario.rpc.declutter_refunds_due = [row];
    scenario.rpc.declutter_refund_executed = "succeeded";
    scenario.reads.ban_settlement_queue = { rows: [] };
    const fn = await loadEdgeFunction("declutter-money");
    const res = await fn.fetch(fn.request({ url: "https://edge.test/declutter-money", headers: { Authorization: "Bearer service-key" }, body: {} }));
    return res.status;
  }
  for (const c of [
    { name: "an order_missing row (no order; the page still names one)", order: null as string | null, reason: "order_missing" },
    { name: "a row with its order", order: ORDER as string | null, reason: "seller_backed_out" },
  ]) {
    it(`the webhook and declutter-money send identical refunds.create parameters under the same key: ${c.name}`, async () => {
      stripeMock.refunds.create.mockResolvedValue({ id: "re_same", status: "succeeded" });
      await deliver({ result: "refund", refund_id: "rf-same", reason: c.reason, fee_policy: "full_platform_absorbs", refund_cents: 4600, refund_status: "pending", order_id: c.order });
      const fromWebhook = stripeMock.refunds.create.mock.calls[0];
      stripeMock.refunds.create.mockClear();
      expect(await runMoney({
        refund_id: "rf-same", reason: c.reason, order_id: c.order, buyer_id: c.order ? BUYER : null, seller_id: c.order ? SELLER : null,
        payment_intent_id: "pi_dc", refund_cents: 4600, attempts: 0, livemode: true, checkout_session_id: c.order ? "cs_live_dc" : null,
      })).toBe(200);
      const fromCron = stripeMock.refunds.create.mock.calls[0];
      expect(fromWebhook?.[1]).toEqual({ idempotencyKey: "declutter-refund-rf-same" });
      expect(fromWebhook?.[0]?.metadata).toEqual({ kind: "declutter_refund", refund_id: "rf-same", reason: c.reason, order_id: c.order ?? "" });
      expect(fromCron).toEqual(fromWebhook);
    });
  }

  // lh-money-escrow should-fix (c): Stripe keeps an idempotency key for 24 h and redelivers a failed event for 3 days.
  // A Stripe double that honours keys for exactly 24 h: the first delivery's refund is taken but not recorded
  // (declutter_refund_executed fails, 500); Stripe redelivers 25 h later, after the key expired.
  it("two redeliveries 25 h apart create ONE refund, even after Stripe's 24 h idempotency key expired", async () => {
    const taken: Array<{ id: string; status: string; amount: number; metadata: Record<string, string> }> = [];
    const keys = new Map<string, { at: number; refund: (typeof taken)[number] }>();
    let clock = 0;
    stripeMock.refunds.create.mockImplementation(async (params: any, opts: any) => {
      const hit = opts?.idempotencyKey ? keys.get(opts.idempotencyKey) : undefined;
      if (hit && clock - hit.at < 24 * 3600) return hit.refund;
      const refund = { id: `re_25h_${taken.length + 1}`, status: "succeeded", amount: params.amount, metadata: params.metadata };
      taken.push(refund);
      if (opts?.idempotencyKey) keys.set(opts.idempotencyKey, { at: clock, refund });
      return refund;
    });
    stripeMock.refunds.list.mockImplementation(async () => ({ data: [...taken].reverse(), has_more: false }));
    const answer = { result: "refund", refund_id: "rf-25h", reason: "superseded", fee_policy: "full_platform_absorbs", refund_cents: 2000, refund_status: "pending" };
    scenario.rpcErrors = { declutter_refund_executed: { message: "connection reset" } };
    expect((await deliver(answer)).status).toBe(500);
    expect(taken).toHaveLength(1);
    clock += 25 * 3600;
    scenario.rpcErrors = {};
    expect((await deliver(answer)).status).toBe(200);
    expect(taken).toHaveLength(1);
    const executed = rpcs("declutter_refund_executed");
    expect(executed[executed.length - 1]?.args).toEqual({ p_refund_id: "rf-25h", p_stripe_refund_id: "re_25h_1", p_succeeded: true });
  });

  it("a refund Stripe failed is not adopted: the webhook's next refund goes under a new key", async () => {
    stripeMock.refunds.list.mockResolvedValue({ has_more: false, data: [{ id: "re_old", status: "failed", amount: 4600, metadata: { refund_id: "rf-f" } }] });
    stripeMock.refunds.create.mockResolvedValue({ id: "re_next", status: "succeeded" });
    await deliver({ result: "refund", refund_id: "rf-f", reason: "superseded", fee_policy: "full_platform_absorbs", refund_cents: 4600, refund_status: "failed" });
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create.mock.calls[0]?.[1]).toEqual({ idempotencyKey: "declutter-refund-rf-f-r1" });
  });

  // lh-money-escrow should-fix (b): "refund it by hand" in the Stripe Dashboard makes a refund with no metadata kind.
  async function deliverChargeRefunded(charge: Record<string, unknown>) {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_dc_hand", type: "charge.refunded", livemode: true, created: 1_760_000_000, data: { object: charge },
    });
    return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
  }
  const handCharge = (refunds: unknown[], extra: Record<string, unknown> = {}) => ({
    id: "ch_dc", payment_intent: "pi_dc", amount: 4600, amount_refunded: 4600, currency: "usd",
    transfer_group: `declutter_order_${ORDER}`, refunds: { has_more: false, data: refunds }, ...extra,
  });

  it("a refund made by hand on a Declutter charge is recorded against the order, never sent down the jobs path", async () => {
    scenario.rpc.declutter_record_hand_refund = "settled";
    const res = await deliverChargeRefunded(handCharge([{ id: "re_hand", amount: 4600, status: "succeeded", metadata: {} }]));
    expect(res.status).toBe(200);
    expect(rpcs("declutter_record_hand_refund").map((c) => c.args)).toEqual([
      { p_payment_intent_id: "pi_dc", p_stripe_refund_id: "re_hand", p_amount_cents: 4600, p_livemode: true },
    ]);
    expect(scenario.writes.filter((w) => w.table !== "stripe_webhook_events")).toEqual([]);
    expect(slackAlerts.some((a: any) => a.severity === "critical")).toBe(false);
  });

  // Q2352 (lh-money-escrow review of the rebase #1): the setup fee owed back, refunded by hand as the page asks, is
  // recorded as the fee's refund (so the seller's payout still sends), never as a hand refund of the sale.
  // @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     if (owed?.id && Number(owed.setup_fee_cents ?? 0) > 0 && Number(r.amount ?? 0) === Number(owed.setup_fee_cents)) { |     if (false) {
  const feeHandRefund = { id: "re_fee_hand", amount: 200, status: "succeeded", metadata: {} };
  it("Q2352: a hand refund of exactly a setup fee owed back is recorded as that fee's refund", async () => {
    scenario.reads.declutter_orders = { rows: [{ id: ORDER, setup_fee_cents: 200 }] };
    scenario.rpc.declutter_setup_fee_refunded = "recorded";
    const res = await deliverChargeRefunded(handCharge([feeHandRefund], { amount_refunded: 200 }));
    expect(res.status).toBe(200);
    expect(rpcs("declutter_setup_fee_refunded").map((c) => c.args)).toEqual([{ p_order_id: ORDER, p_stripe_refund_id: "re_fee_hand" }]);
    expect(rpcs("declutter_record_hand_refund")).toHaveLength(0);
  });

  // Also the kill for chargeRefunded's every -> some mutation: one Declutter refund must not hide a hand refund
  // beside it. (`if (false)` there is an equivalent mutant: recordDeclutterHandRefunds skips Declutter refunds itself.)
  it("a Declutter charge is known by its PaymentIntent's metadata too, and only the hand refund is recorded next to a Declutter one", async () => {
    scenario.rpc.declutter_record_hand_refund = "settled";
    const res = await deliverChargeRefunded(handCharge([
      { id: "re_hand2", amount: 100, status: "succeeded", metadata: {} },
      { id: "re_ours", amount: 4500, status: "succeeded", metadata: { kind: "declutter_refund", refund_id: "rf-1" } },
      { id: "re_dead", amount: 4500, status: "failed", metadata: {} },
    ], { transfer_group: null, metadata: { kind: "declutter_order", order_id: ORDER } }));
    expect(res.status).toBe(200);
    expect(rpcs("declutter_record_hand_refund").map((c) => (c.args as Record<string, unknown>).p_stripe_refund_id)).toEqual(["re_hand2"]);
    expect(scenario.writes.filter((w) => w.table !== "stripe_webhook_events")).toEqual([]);
  });

  for (const [answer, says] of [
    ["recorded_short", /do not yet cover/],
    ["recorded_no_row", /had no refund row/],
    ["recorded_row_already_settled", /refunded twice/],
  ] as const) {
    it(`a hand refund that settles nothing (${answer}) is recorded and pages a person with the reason`, async () => {
      scenario.rpc.declutter_record_hand_refund = answer;
      const res = await deliverChargeRefunded(handCharge([{ id: "re_part", amount: 1000, status: "succeeded", metadata: {} }]));
      expect(res.status).toBe(200);
      const page = slackAlerts.find((a: any) => a.severity === "critical") as any;
      expect(page?.title).toMatch(/outside Declutter/);
      expect(page?.message).toMatch(says);
      expect(page?.message).toMatch(/Nothing was moved/);
      // Never claims the payout is safe: a payout sent before the refund is not taken back.
      expect(page?.message).toMatch(/not taken back/);
    });
  }

  // lh-money-escrow review of lane J, should-fix 1: a hand refund Stripe fails AFTER we recorded it.
  async function deliverRefundUpdated(refund: Record<string, unknown>) {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_dc_hand_fail", type: "charge.refund.updated", livemode: true, created: 1_760_000_000, data: { object: refund },
    });
    return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
  }
  const failedHand = { id: "re_hand_f", object: "refund", status: "failed", failure_reason: "lost_or_stolen_card", amount: 4600,
    payment_intent: "pi_dc", charge: "ch_dc", metadata: {} };

  it("a hand refund Stripe fails reopens its Declutter row and pages 'NOT repaid'; the jobs ledger is not touched", async () => {
    scenario.rpc.declutter_hand_refund_failed = "reopened";
    const res = await deliverRefundUpdated(failedHand);
    expect(res.status).toBe(200);
    expect(rpcs("declutter_hand_refund_failed")[0]?.args).toEqual({ p_stripe_refund_id: "re_hand_f", p_why: "failed: lost_or_stolen_card" });
    expect(scenario.writes.filter((w) => w.table !== "stripe_webhook_events")).toEqual([]);
    const page = slackAlerts.find((a: any) => a.severity === "critical") as any;
    expect(page?.title).toMatch(/by hand FAILED/);
    expect(page?.message).toMatch(/NOT been repaid/);
  });

  it("a failed refund that is not a Declutter hand refund goes on down the jobs path", async () => {
    scenario.rpc.declutter_hand_refund_failed = "not_declutter";
    await deliverRefundUpdated(failedHand);
    expect(scenario.writes.some((w) => w.table === "payment_refunds" && w.op === "delete")).toBe(true);
  });

  it("before the function is deployed (PGRST202) the jobs path still runs", async () => {
    scenario.rpcErrors = { declutter_hand_refund_failed: { message: "not found", code: "PGRST202" } };
    const res = await deliverRefundUpdated(failedHand);
    expect(res.status).toBe(200);
    expect(scenario.writes.some((w) => w.table === "payment_refunds" && w.op === "delete")).toBe(true);
  });

  it("a hand refund that cannot be recorded is a 500 (Stripe redelivers)", async () => {
    scenario.rpcErrors = { declutter_record_hand_refund: { message: "deadlock detected" } };
    const res = await deliverChargeRefunded(handCharge([{ id: "re_hand3", amount: 4600, status: "succeeded", metadata: {} }]));
    expect(res.status).toBe(500);
  });

  // Q1929: the raise question decides the path only with a known answer. A missing answer used to read
  // as "a raise" and skip the order's own record (the 6 red tests of the wip, 2026-10-21).
  // @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     if (!raiseErr && !["not_raise", "settled", "already", "recorded_other"].includes(String(raiseAnswer))) { |     if (false) {
  it("a hand refund whose raise question gives no known answer is a 500 and records nothing (Stripe redelivers)", async () => {
    scenario.rpc.declutter_delivery_raise_hand_refund = null;
    const res = await deliverChargeRefunded(handCharge([{ id: "re_hand4", amount: 4600, status: "succeeded", metadata: {} }]));
    expect(res.status).toBe(500);
    expect(rpcs("declutter_record_hand_refund")).toHaveLength(0);
  });

  it("a hand refund on a raise's own charge settles the raise and never touches the order's rows", async () => {
    scenario.rpc.declutter_delivery_raise_hand_refund = "settled";
    const res = await deliverChargeRefunded(handCharge([{ id: "re_hand5", amount: 1000, status: "succeeded", metadata: {} }]));
    expect(res.status).toBe(200);
    expect(rpcs("declutter_delivery_raise_hand_refund")).toHaveLength(1);
    expect(rpcs("declutter_record_hand_refund")).toHaveLength(0);
  });

  it("a refund already done (replayed event) is never sent to Stripe again", async () => {
    await deliver({ result: "refund", refund_id: "rf-1", reason: "superseded", fee_policy: "full_platform_absorbs", refund_cents: 4600, refund_status: "succeeded" });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("a replayed payment (already_paid) does nothing and sends no second receipt", async () => {
    await deliver({ result: "already_paid" });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(queuedEmails).toHaveLength(0);
  });

  it("a failed mark-paid is a 500 (Stripe redelivers), never acknowledged", async () => {
    scenario.rpcErrors = { declutter_mark_order_paid: { message: "deadlock detected" } };
    const res = await deliver({ result: "paid" });
    expect(res.status).toBe(500);
    expect(scenario.writes.some((w) => w.table === "stripe_webhook_events" && w.op === "delete")).toBe(true);
  });

  it("a Stripe refund error pages ops and is retried (500)", async () => {
    stripeMock.refunds.create.mockRejectedValue(new Error("stripe down"));
    const res = await deliver({ result: "refund", refund_id: "rf-3", reason: "superseded", fee_policy: "full_platform_absorbs", refund_cents: 4600, refund_status: "pending" });
    expect(res.status).toBe(500);
    expect((slackAlerts as Array<{ title: string }>).some((a) => /Declutter refund failed at Stripe/.test(a.title))).toBe(true);
    expect(rpcs("declutter_refund_executed")).toHaveLength(0);
  });
});

describe("stripe-webhook: Declutter card saved", () => {
  it("stores the card read off the SetupIntent, in the event's mode, for the member named on the page", async () => {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_card", type: "checkout.session.completed", livemode: true, created: 1_760_000_000,
      data: { object: { id: "cs_live_card", mode: "setup", status: "complete", setup_intent: "seti_1", customer: "cus_1",
        client_reference_id: BUYER, metadata: { kind: "declutter_card", user_id: BUYER } } },
    });
    stripeMock.setupIntents.retrieve.mockResolvedValue({
      id: "seti_1", status: "succeeded", customer: "cus_1", payment_method: { id: "pm_1", card: { brand: "visa", last4: "4242" } },
    });
    const res = await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
    expect(res.status).toBe(200);
    expect(rpcs("declutter_save_card")[0]?.args).toEqual({
      p_user: BUYER, p_customer: "cus_1", p_payment_method: "pm_1", p_brand: "visa", p_last4: "4242", p_mode: "live",
    });
  });

  it("a page whose reference does not match its member is not applied", async () => {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_card2", type: "checkout.session.completed", livemode: true, created: 1_760_000_000,
      data: { object: { id: "cs_live_card", mode: "setup", setup_intent: "seti_1", client_reference_id: SELLER,
        metadata: { kind: "declutter_card", user_id: BUYER } } },
    });
    await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
    expect(rpcs("declutter_save_card")).toHaveLength(0);
  });
});

describe("test mode routing", () => {
  it("only Declutter's own setup page and order page are routed test checkouts", () => {
    expect(isRoutedTestCheckout({ mode: "setup", metadata: { kind: "declutter_card" } })).toBe(true);
    expect(isRoutedTestCheckout({ mode: "setup", metadata: { kind: "something_else" } })).toBe(false);
    expect(isRoutedTestCheckout({ mode: "payment", metadata: { kind: "declutter_order", order_id: ORDER } })).toBe(true);
    expect(isRoutedTestCheckout({ mode: "subscription", metadata: { kind: "declutter_order" } })).toBe(false);
  });
});

describe("declutter-checkout: pay", () => {
  async function load() {
    env();
    scenario.authUser = { id: BUYER, email: "buyer@test.dev" };
    // The order row the setup-fee read finds (Q2352): no fee unless a case says so; a missing row is its own case.
    scenario.reads.declutter_orders ??= { rows: [{ setup_fee_cents: 0 }] };
    return loadEdgeFunction("declutter-checkout");
  }
  const order = (over: Record<string, unknown> = {}) => [{
    order_id: ORDER, items_cents: 4000, premium_cents: 600, tax_cents: 0, total_cents: 4600,
    superseded_session_id: null, checkout_session_id: null, ...over,
  }];
  const payReq = (fn: EdgeHarness) => fn.request({ headers: { Authorization: "Bearer buyer-jwt" }, body: { action: "pay", seller_id: SELLER, handover: "porch" } });

  it("freezes the order AS THE BUYER and opens a card-only page for exactly its total, money held on the platform", async () => {
    const fn = await load();
    scenario.rpc.declutter_start_checkout = order();
    scenario.rpc.declutter_attach_checkout_session = null;
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_new", url: "https://checkout.stripe.test/new", amount_total: 4600 });
    const res = await fn.fetch(payReq(fn));
    expect(res.status).toBe(200);
    expect((await json(res)).url).toBe("https://checkout.stripe.test/new");
    const start = rpcs("declutter_start_checkout")[0];
    expect(clientOf(start)?.key).toBe("anon-key");
    expect(JSON.stringify(clientOf(start)?.options)).toContain("Bearer buyer-jwt");
    const [params, opts] = stripeMock.checkout.sessions.create.mock.calls[0];
    const sum = params.line_items.reduce((s: number, l: any) => s + l.price_data.unit_amount * l.quantity, 0);
    expect(sum).toBe(4600);
    expect(params.payment_method_types).toEqual(["card"]);
    expect(params.payment_intent_data.transfer_data).toBeUndefined();
    expect(params.payment_intent_data.transfer_group).toBe(`declutter_order_${ORDER}`);
    expect(params.metadata).toMatchObject({ kind: "declutter_order", order_id: ORDER, buyer_id: BUYER, payer_id: BUYER, seller_id: SELLER });
    expect(params.expires_at - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(30 * 60 - 60);
    expect(params.expires_at - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(31 * 60);
    expect(opts.idempotencyKey).toMatch(new RegExp(`^declutter-order-${ORDER}-\\d+$`));
    expect(stripeMock.__key).toBe("sk_live_declutter");
    const attach = rpcs("declutter_attach_checkout_session")[0];
    expect(attach?.args).toEqual({ p_order_id: ORDER, p_session_id: "cs_live_new" });
    expect(clientOf(attach)?.key).toBe("service-key");
  });

  // Q2352: the setup fee the order froze rides the page on its own line, outside the sale's total.
  // @mutate supabase/functions/declutter-checkout/index.ts |   if (setupFeeCents > 0) { |   if (false) {
  // @mutate supabase/functions/declutter-checkout/index.ts |   if (session.amount_total !== chargeCents) { |   if (session.amount_total !== order.total_cents) {
  it("Q2352: a first purchase puts the one-time setup fee on its own line; the page charges the sale plus the fee", async () => {
    const fn = await load();
    scenario.rpc.declutter_start_checkout = order();
    scenario.reads.declutter_orders = { rows: [{ setup_fee_cents: 200 }] };
    scenario.rpc.declutter_attach_checkout_session = null;
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_fee", url: "https://x/fee", amount_total: 4800 });
    const res = await fn.fetch(payReq(fn));
    expect(res.status).toBe(200);
    const [params] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params.line_items.map((l: any) => [l.price_data.product_data.name, l.price_data.unit_amount])).toEqual([
      ["Declutter purchase", 4600], ["One-time account setup fee", 200],
    ]);
    expect(params.metadata).toMatchObject({ setup_fee_cents: "200" });
    expect(rpcs("declutter_attach_checkout_session")[0]?.args).toEqual({ p_order_id: ORDER, p_session_id: "cs_live_fee" });
  });
  // Audit 1a #15 (2026-10-29): one page read "Pay Helpr", another "Declutter purchase". The purchase line
  // always names what is being bought: the item's title, read from the order's own cart lines.
  // @mutate supabase/functions/declutter-checkout/index.ts |       product_data: { name: purchaseName, tax_code: NONTAXABLE_TAX_CODE } } }, |       product_data: { name: "Declutter purchase", tax_code: NONTAXABLE_TAX_CODE } } },
  // @mutate supabase/functions/declutter-checkout/index.ts |     .select("declutter_items(title)").eq("order_id", order.order_id); |     .select("declutter_items(title)").eq("order_id", "none");
  it("audit 1a #15: the purchase line carries the item's own title, on a page with a setup fee line too", async () => {
    const fn = await load();
    scenario.rpc.declutter_start_checkout = order();
    scenario.reads.declutter_orders = { rows: [{ setup_fee_cents: 200 }] };
    scenario.reads.declutter_cart_items = { rows: [{ declutter_items: { title: "Blue coffee mug" } }] };
    scenario.rpc.declutter_attach_checkout_session = null;
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_name", url: "https://x/name", amount_total: 4800 });
    const res = await fn.fetch(payReq(fn));
    expect(res.status).toBe(200);
    const [params] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params.line_items.map((l: any) => [l.price_data.product_data.name, l.price_data.unit_amount])).toEqual([
      ["Blue coffee mug", 4600], ["One-time account setup fee", 200],
    ]);
    const read = (scenario.readQueries ?? []).find((q) => q.table === "declutter_cart_items" && q.cols.includes("title"));
    expect(read?.filters).toEqual([{ op: "eq", column: "order_id", value: ORDER }]);
  });
  it("audit 1a #15: a bundle names its first title and how many more", async () => {
    const fn = await load();
    scenario.rpc.declutter_start_checkout = order();
    scenario.reads.declutter_cart_items = { rows: [
      { declutter_items: { title: "Lamp" } }, { declutter_items: { title: "Desk" } }, { declutter_items: { title: "Chair" } },
    ] };
    scenario.rpc.declutter_attach_checkout_session = null;
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_b", url: "https://x/b", amount_total: 4600 });
    const res = await fn.fetch(payReq(fn));
    expect(res.status).toBe(200);
    const [params] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params.line_items[0].price_data.product_data.name).toBe("Chair + 2 more items");
  });
  // lh-silent-failure review of the Q2352 rebase #1: no order row is never read as "no setup fee".
  // @mutate supabase/functions/declutter-checkout/index.ts |   if (!feeErr && !feeRow) { |   if (false) {
  it("Q2352: the order's setup-fee read finding no row answers try again, and no page is made", async () => {
    const fn = await load();
    scenario.rpc.declutter_start_checkout = order();
    scenario.reads.declutter_orders = { rows: [] };
    const res = await fn.fetch(payReq(fn));
    expect(res.status).toBe(503);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it("Q2352: a page Stripe priced without the setup fee is expired, never attached", async () => {
    const fn = await load();
    scenario.rpc.declutter_start_checkout = order();
    scenario.reads.declutter_orders = { rows: [{ setup_fee_cents: 200 }] };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_short", url: "https://x/short", amount_total: 4600 });
    const res = await fn.fetch(payReq(fn));
    expect(res.status).toBe(500);
    expect(rpcs("declutter_attach_checkout_session")).toHaveLength(0);
  });

  it("one wallet: the buyer's stored customer (this mode) pre-fills the page; none stored -> email only, no customer made", async () => {
    const fn = await load();
    scenario.rpc.declutter_start_checkout = order();
    scenario.rpc.declutter_attach_checkout_session = null;
    scenario.reads.stripe_customers = { rows: [{ stripe_customer_id: "cus_wallet" }] };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_new", url: "https://x/new", amount_total: 4600 });
    await fn.fetch(payReq(fn));
    const [params] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params.customer).toBe("cus_wallet");
    expect(params.customer_email).toBeUndefined();
    const q = (scenario.readQueries ?? []).find((r) => r.table === "stripe_customers");
    expect(q?.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "eq", column: "user_id", value: BUYER }),
      expect.objectContaining({ op: "eq", column: "wallet_mode", value: "live" }),
    ]));

    const fn2 = await load();
    scenario.rpc.declutter_start_checkout = order();
    scenario.rpc.declutter_attach_checkout_session = null;
    scenario.reads.stripe_customers = { rows: [] };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_new", url: "https://x/new", amount_total: 4600 });
    await fn2.fetch(payReq(fn2));
    const [p2] = stripeMock.checkout.sessions.create.mock.calls[stripeMock.checkout.sessions.create.mock.calls.length - 1];
    expect(p2.customer).toBeUndefined();
    expect(p2.customer_email).toBe("buyer@test.dev");
    expect(stripeMock.customers.create).not.toHaveBeenCalled();
    expect(stripeMock.customers.list).not.toHaveBeenCalled();
  });

  it("one wallet: a failed wallet read opens no page (never a guessed customer)", async () => {
    const fn = await load();
    scenario.rpc.declutter_start_checkout = order();
    scenario.reads.stripe_customers = { error: { message: "boom" } };
    const res = await fn.fetch(payReq(fn));
    expect(res.status).toBe(503);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("expires the superseded order's page before opening the new one", async () => {
    const fn = await load();
    scenario.rpc.declutter_start_checkout = order({ superseded_session_id: "cs_live_old" });
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_new", url: "https://x/new", amount_total: 4600 });
    await fn.fetch(payReq(fn));
    expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith("cs_live_old");
  });

  it("an open order whose page was already PAID is reported paid and never replaced (money review 3b #2)", async () => {
    const fn = await load();
    scenario.reads.declutter_orders = { rows: [{ id: ORDER, handover: "porch", stripe_checkout_session_id: "cs_live_paid" }] };
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(page("cs_live_paid", "complete"));
    const body = await json(await fn.fetch(fn.request({ headers: { Authorization: "Bearer buyer-jwt" }, body: { action: "pay", seller_id: SELLER, handover: "pickup_home" } })));
    expect(body.paid).toBe(true);
    expect(rpcs("declutter_start_checkout")).toHaveLength(0);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("changing how you get it closes the old open page BEFORE the order is replaced", async () => {
    const fn = await load();
    scenario.reads.declutter_orders = { rows: [{ id: ORDER, handover: "porch", stripe_checkout_session_id: "cs_live_old" }] };
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(page("cs_live_old", "open", "https://x/old"));
    const order: string[] = [];
    stripeMock.checkout.sessions.expire.mockImplementation(async () => { order.push("expire"); return { status: "expired" }; });
    scenario.rpc.declutter_start_checkout = () => { order.push("start"); return [{ order_id: ORDER, items_cents: 4000, premium_cents: 600, tax_cents: 0, total_cents: 4600, superseded_session_id: "cs_live_old", checkout_session_id: null }]; };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_new", url: "https://x/new", amount_total: 4600 });
    await fn.fetch(fn.request({ headers: { Authorization: "Bearer buyer-jwt" }, body: { action: "pay", seller_id: SELLER, handover: "pickup_home" } }));
    expect(order[0]).toBe("expire");
    expect(order).toContain("start");
  });

  it("Q2427 ruling 2: the SELLER changed their bundle discount: the open page is closed BEFORE the order is replaced", async () => {
    const fn = await load();
    scenario.reads.declutter_orders = { rows: [{ id: ORDER, handover: "porch", stripe_checkout_session_id: "cs_live_old", bundle_discount_cents: 650 }] };
    scenario.rpc.declutter_bundle_preview = 1300;
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(page("cs_live_old", "open", "https://x/old"));
    const steps: string[] = [];
    stripeMock.checkout.sessions.expire.mockImplementation(async () => { steps.push("expire"); return { status: "expired" }; });
    scenario.rpc.declutter_start_checkout = () => { steps.push("start"); return order({ superseded_session_id: "cs_live_old" }); };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_new", url: "https://x/new", amount_total: 4600 });
    await fn.fetch(payReq(fn));
    expect(rpcs("declutter_bundle_preview")[0]?.args).toEqual({ p_seller_id: SELLER });
    expect(clientOf(rpcs("declutter_bundle_preview")[0])?.key).toBe("anon-key");
    expect(steps.slice(0, 2)).toEqual(["expire", "start"]);
  });

  it("Q2427: the same bundle discount as the open order leaves its page alone (the RPC hands the same order back)", async () => {
    const fn = await load();
    scenario.reads.declutter_orders = { rows: [{ id: ORDER, handover: "porch", stripe_checkout_session_id: "cs_live_open", bundle_discount_cents: 650 }] };
    scenario.rpc.declutter_bundle_preview = 650;
    scenario.rpc.declutter_start_checkout = order({ checkout_session_id: "cs_live_open" });
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(page("cs_live_open", "open", "https://x/open"));
    const body = await json(await fn.fetch(payReq(fn)));
    expect(body.url).toBe("https://x/open");
    expect(stripeMock.checkout.sessions.expire).not.toHaveBeenCalled();
  });

  it("Q2427: a bundle read that fails says try again and touches nothing", async () => {
    const fn = await load();
    scenario.reads.declutter_orders = { rows: [{ id: ORDER, handover: "porch", stripe_checkout_session_id: "cs_live_open", bundle_discount_cents: 650 }] };
    scenario.rpcErrors = { declutter_bundle_preview: { message: "boom", code: "XX000" } };
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(page("cs_live_open", "open", "https://x/open"));
    const res = await fn.fetch(payReq(fn));
    expect(res.status).toBe(503);
    expect(rpcs("declutter_start_checkout")).toHaveLength(0);
    expect(stripeMock.checkout.sessions.expire).not.toHaveBeenCalled();
  });

  it("Q2427: a page already PAID is answered paid before any bundle read (follow-up review note 5)", async () => {
    const fn = await load();
    scenario.reads.declutter_orders = { rows: [{ id: ORDER, handover: "porch", stripe_checkout_session_id: "cs_live_paid", bundle_discount_cents: 650 }] };
    scenario.rpcErrors = { declutter_bundle_preview: { message: "boom", code: "XX000" } };
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(page("cs_live_paid", "complete"));
    const body = await json(await fn.fetch(payReq(fn)));
    expect(body.paid).toBe(true);
    expect(rpcs("declutter_bundle_preview")).toHaveLength(0);
  });

  it("row 101: a switch TO porch the server would refuse keeps the open pickup page (money review, porch default #1)", async () => {
    const fn = await load();
    scenario.reads.declutter_orders = { rows: [{ id: ORDER, handover: "pickup_home", stripe_checkout_session_id: "cs_live_old" }] };
    scenario.reads.declutter_cart_items = { rows: [{ item_id: "item-1" }] };
    scenario.reads.declutter_items = { rows: [{ id: "item-1" }] };
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(page("cs_live_old", "open", "https://x/old"));
    const res = await fn.fetch(payReq(fn));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("porch_unavailable");
    expect(stripeMock.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(rpcs("declutter_start_checkout")).toHaveLength(0);
  });

  it("asks for 3D Secure from $300 up (Q202)", async () => {
    const fn = await load();
    scenario.rpc.declutter_start_checkout = order({ items_cents: 30000, premium_cents: 4500, total_cents: 34500 });
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_big", url: "https://x/big", amount_total: 34500 });
    await fn.fetch(payReq(fn));
    expect(stripeMock.checkout.sessions.create.mock.calls[0][0].payment_method_options).toEqual({ card: { request_three_d_secure: "any" } });
  });

  it("a double tap returns the open page, never a second one", async () => {
    const fn = await load();
    scenario.rpc.declutter_start_checkout = order({ checkout_session_id: "cs_live_open" });
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(page("cs_live_open", "open", "https://x/open"));
    const body = await json(await fn.fetch(payReq(fn)));
    expect(body.url).toBe("https://x/open");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("a timed-out page retires its order and a fresh order gets a fresh page", async () => {
    const fn = await load();
    let n = 0;
    scenario.rpc.declutter_start_checkout = () => (n++ === 0 ? order({ checkout_session_id: "cs_live_dead" }) : order({ order_id: "0000000a-0000-4000-8000-0000000000cc" }));
    scenario.rpc.declutter_retire_order = true;
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(page("cs_live_dead", "expired"));
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_fresh", url: "https://x/fresh", amount_total: 4600 });
    const body = await json(await fn.fetch(payReq(fn)));
    expect(rpcs("declutter_retire_order")[0]?.args).toEqual({ p_order_id: ORDER, p_buyer: BUYER, p_session_id: "cs_live_dead" });
    expect(body.url).toBe("https://x/fresh");
  });

  it("a refusal from the SQL reaches the app as its code (an empty cart says nothing more)", async () => {
    const fn = await load();
    scenario.rpcErrors = { declutter_start_checkout: { message: "cart_empty", code: "55000" } };
    const res = await fn.fetch(payReq(fn));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("cart_empty");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("a page Stripe priced differently from the order is expired, never attached", async () => {
    const fn = await load();
    scenario.rpc.declutter_start_checkout = order();
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_bad", url: "https://x/bad", amount_total: 4599 });
    const res = await fn.fetch(payReq(fn));
    expect(res.status).toBe(500);
    expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith("cs_live_bad");
    expect(rpcs("declutter_attach_checkout_session")).toHaveLength(0);
  });

  it("works with the switch OFF for the buyer (row 62: an agreed sale finishes)", async () => {
    const fn = await load();
    scenario.rpc.feature_enabled_for_user = false;
    scenario.rpc.declutter_start_checkout = order();
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_new", url: "https://x/new", amount_total: 4600 });
    const res = await fn.fetch(payReq(fn));
    expect(res.status).toBe(200);
    expect(rpcs("feature_enabled_for_user")).toHaveLength(0);
  });
});

describe("declutter-checkout: Helpr delivery (slice 5)", () => {
  async function load() {
    env();
    scenario.authUser = { id: BUYER, email: "buyer@test.dev" };
    scenario.reads.declutter_orders ??= { rows: [{ setup_fee_cents: 0 }] };
    return loadEdgeFunction("declutter-checkout");
  }
  const geocoder = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify([
    { lat: "30.5412", lon: "-91.1543", address: { house_number: "900", road: "Far Rd", town: "Baker", state: "Louisiana" } },
  ]), { status: 200 }));
  beforeEach(() => { geocoder.mockClear(); vi.stubGlobal("fetch", geocoder); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const quoteReq = (fn: EdgeHarness, address: unknown = "900 Far Rd, Baker, LA 70714") =>
    fn.request({ headers: { Authorization: "Bearer buyer-jwt" }, body: { action: "delivery_quote", seller_id: SELLER, address } });

  it("geocodes the typed address ON THE SERVER, stores it as the service, and quotes AS THE BUYER", async () => {
    const fn = await load();
    scenario.rpc.feature_enabled_for_user = true;
    scenario.rpc.declutter_set_delivery_dropoff = null;
    scenario.rpc.declutter_delivery_quote = { road_miles: 12, size: "large", delivery_cents: 5400, base_cents: 1000, per_mile_cents: 2400, size_cents: 2000, dropoff_area: "Baker, LA" };
    const res = await fn.fetch(quoteReq(fn));
    expect(res.status).toBe(200);
    expect((await json(res)).quote.delivery_cents).toBe(5400);
    expect(String(geocoder.mock.calls[0]?.[0])).toContain("nominatim.openstreetmap.org/search");
    const set = rpcs("declutter_set_delivery_dropoff")[0];
    expect(set?.args).toEqual({ p_buyer: BUYER, p_seller: SELLER, p_address: "900 Far Rd, Baker, LA 70714", p_area_label: "Baker, LA", p_lat: 30.5412, p_lng: -91.1543 });
    expect(clientOf(set)?.key).toBe("service-key");
    const quote = rpcs("declutter_delivery_quote")[0];
    expect(clientOf(quote)?.key).toBe("anon-key");
  });

  // Q2413 (measured 2026-10-27): prod's Nominatim answers 403 to this server, so every quote failed.
  // With the MapKit key set (it is on prod: mapkit-token mints), the REAL quote path asks Apple Maps
  // with a token signed by that key, and Nominatim not at all.
  // @mutate supabase/functions/declutter-checkout/index.ts |   const point = await geocodeDropoff(address, fetch, appleMapsAccess()); |   const point = await geocodeDropoff(address);
  it("with the MapKit key set, the drop-off is looked up on Apple Maps with a signed token, never Nominatim (Q2413)", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const pem = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const fn = await load();
    env({ APPLE_MAPKIT_PRIVATE_KEY: pem, APPLE_MAPKIT_KEY_ID: "KEY1234567", APPLE_MAPKIT_TEAM_ID: "TEAM123456" });
    geocoder
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: "apple-access" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ coordinate: { latitude: 30.4441, longitude: -91.1484 },
        structuredAddress: { locality: "Baton Rouge", administrativeAreaCode: "LA" } }] }), { status: 200 }));
    scenario.rpc.feature_enabled_for_user = true;
    scenario.rpc.declutter_set_delivery_dropoff = null;
    scenario.rpc.declutter_delivery_quote = { delivery_cents: 1800 };
    const res = await fn.fetch(quoteReq(fn, "4000 Government St, Baton Rouge, LA 70806"));
    expect(res.status).toBe(200);
    const urls = geocoder.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe("https://maps-api.apple.com/v1/token");
    expect(urls[1]).toContain("https://maps-api.apple.com/v1/geocode");
    expect(urls.some((u) => u.includes("nominatim"))).toBe(false);
    const auth = String((geocoder.mock.calls[0]?.[1]?.headers as Record<string, string>)?.Authorization ?? "");
    const [h, p] = auth.replace(/^Bearer /, "").split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toMatchObject({ alg: "ES256", kid: "KEY1234567" });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toMatchObject({ iss: "TEAM123456" });
    expect(rpcs("declutter_set_delivery_dropoff")[0]?.args).toMatchObject({ p_area_label: "Baton Rouge, LA", p_lat: 30.4441, p_lng: -91.1484 });
  });

  it("never takes coordinates from the request", async () => {
    const fn = await load();
    scenario.rpc.feature_enabled_for_user = true;
    scenario.rpc.declutter_delivery_quote = { delivery_cents: 1200 };
    await fn.fetch(fn.request({ headers: { Authorization: "Bearer buyer-jwt" }, body: { action: "delivery_quote", seller_id: SELLER, address: "900 Far Rd, Baker", lat: 30.4512, lng: -91.1543 } }));
    expect(rpcs("declutter_set_delivery_dropoff")[0]?.args).toMatchObject({ p_lat: 30.5412, p_lng: -91.1543 });
  });

  it("is refused while the switch is off for the buyer (a delivery is new work)", async () => {
    const fn = await load();
    scenario.rpc.feature_enabled_for_user = false;
    const res = await fn.fetch(quoteReq(fn));
    expect(res.status).toBe(403);
    expect(geocoder).not.toHaveBeenCalled();
    expect(rpcs("declutter_set_delivery_dropoff")).toHaveLength(0);
  });

  it("an address that is not an address is refused before any lookup", async () => {
    const fn = await load();
    scenario.rpc.feature_enabled_for_user = true;
    for (const bad of ["", "   ", "abc", 42, "x".repeat(301), "no numbers here"]) {
      const res = await fn.fetch(quoteReq(fn, bad));
      expect(res.status).toBe(400);
    }
    expect(geocoder).not.toHaveBeenCalled();
  });

  it("an address the geocoder cannot find stores nothing (422)", async () => {
    const fn = await load();
    scenario.rpc.feature_enabled_for_user = true;
    geocoder.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    const res = await fn.fetch(quoteReq(fn));
    expect(res.status).toBe(422);
    expect((await json(res)).error).toBe("address_not_found");
    expect(rpcs("declutter_set_delivery_dropoff")).toHaveLength(0);
  });

  it("a geocoder that is rate-limiting or down is 'try again' (503), never 'address not found'; nothing stored (lh-silent-failure #1)", async () => {
    const fn = await load();
    scenario.rpc.feature_enabled_for_user = true;
    geocoder.mockResolvedValueOnce(new Response("Too Many Requests", { status: 429 }));
    const res = await fn.fetch(quoteReq(fn));
    expect(res.status).toBe(503);
    expect((await json(res)).error).toBe("geocode_unavailable");
    expect(rpcs("declutter_set_delivery_dropoff")).toHaveLength(0);
  });

  it("a quote the SQL refuses (items at two addresses) reaches the app as its code", async () => {
    const fn = await load();
    scenario.rpc.feature_enabled_for_user = true;
    scenario.rpcErrors = { declutter_delivery_quote: { message: "delivery_one_address", code: "22023" } };
    const res = await fn.fetch(quoteReq(fn));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("delivery_one_address");
  });

  it("pay with delivery puts the frozen delivery fee on its own line; the page totals exactly the order", async () => {
    const fn = await load();
    scenario.rpc.declutter_start_checkout = [{ order_id: ORDER, items_cents: 4000, premium_cents: 270, tax_cents: 0, total_cents: 6670,
      superseded_session_id: null, checkout_session_id: null, delivery_cents: 2400 }];
    scenario.rpc.declutter_attach_checkout_session = null;
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_dl", url: "https://x/dl", amount_total: 6670 });
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer buyer-jwt" }, body: { action: "pay", seller_id: SELLER, handover: "delivery" } }));
    expect(res.status).toBe(200);
    const [params] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params.line_items.map((l: any) => [l.price_data.product_data.name, l.price_data.unit_amount])).toEqual([
      ["Declutter purchase", 4270], ["Helpr delivery", 2400],
    ]);
    // Owner 2026-10-25 (issue #3672): the Stripe page a buyer reads names no fee; the one purchase line carries the
    // items and the premium together, so the page still totals exactly the order.
    // @mutate supabase/functions/declutter-checkout/index.ts | unit_amount: order.items_cents + order.premium_cents, | unit_amount: order.items_cents,
    expect(params.line_items.map((l: any) => l.price_data.product_data.name).join(" ")).not.toMatch(/fee|%|¢/i);
    expect(rpcs("declutter_start_checkout")[0]?.args).toEqual({ p_seller_id: SELLER, p_handover: "delivery" });
  });

  it("an order whose delivery fee does not match its handover is never put on a page", async () => {
    const fn = await load();
    scenario.rpc.declutter_start_checkout = [{ order_id: ORDER, items_cents: 4000, premium_cents: 270, tax_cents: 0, total_cents: 4270,
      superseded_session_id: null, checkout_session_id: null, delivery_cents: 0 }];
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer buyer-jwt" }, body: { action: "pay", seller_id: SELLER, handover: "delivery" } }));
    expect(res.status).toBe(500);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("a switch TO delivery the server would refuse keeps the open pickup page", async () => {
    const fn = await load();
    scenario.reads.declutter_orders = { rows: [{ id: ORDER, handover: "pickup_home", stripe_checkout_session_id: "cs_live_old" }] };
    stripeMock.checkout.sessions.retrieve.mockResolvedValue(page("cs_live_old", "open", "https://x/old"));
    scenario.rpcErrors = { declutter_delivery_quote: { message: "delivery_address_needed", code: "22023" } };
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer buyer-jwt" }, body: { action: "pay", seller_id: SELLER, handover: "delivery" } }));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("delivery_address_needed");
    expect(stripeMock.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(rpcs("declutter_start_checkout")).toHaveLength(0);
  });
});

describe("declutter-checkout: seller cancels", () => {
  it("cancels AS THE SELLER, then expires the page the buyer may have open", async () => {
    env();
    scenario.authUser = { id: SELLER, email: "seller@test.dev" };
    const fn = await loadEdgeFunction("declutter-checkout");
    scenario.rpc.declutter_seller_cancel_sale = 1;
    scenario.rpc.declutter_cancelled_sale_session = "cs_test_open";
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer seller-jwt" }, body: { action: "cancel_sale", item_id: ITEM } }));
    expect(res.status).toBe(200);
    const cancel = rpcs("declutter_seller_cancel_sale")[0];
    expect(clientOf(cancel)?.key).toBe("anon-key");
    expect(rpcs("declutter_cancelled_sale_session")[0]?.args).toEqual({ p_item_id: ITEM, p_seller: SELLER });
    expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith("cs_test_open");
    // The page's own mode decides the key (cs_test_ -> the test key).
    expect(stripeMock.__keys).toContain("sk_test_declutter");
  });
});

describe("declutter-card", () => {
  async function load() {
    env();
    scenario.authUser = { id: BUYER, email: "buyer@test.dev" };
    return loadEdgeFunction("declutter-card");
  }
  const req = (fn: EdgeHarness) => fn.request({ headers: { Authorization: "Bearer buyer-jwt" }, body: {} });

  it("is refused while the switch is off for the caller (saving a card starts something new)", async () => {
    const fn = await load();
    scenario.rpc.feature_enabled_for_user = false;
    const res = await fn.fetch(req(fn));
    expect(res.status).toBe(403);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("opens Stripe's card-saving page (setup mode: nothing is charged) on the member's ONE wallet customer, made and claimed once", async () => {
    const fn = await load();
    scenario.rpc.feature_enabled_for_user = true;
    scenario.reads.stripe_customers = { rows: [] };
    stripeMock.customers.create.mockResolvedValue({ id: "cus_new" });
    scenario.rpc.claim_stripe_customer = "cus_new";
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_setup", url: "https://x/setup" });
    const res = await fn.fetch(req(fn));
    expect(res.status).toBe(200);
    expect((await json(res)).url).toBe("https://x/setup");
    const [params] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params).toMatchObject({ mode: "setup", customer: "cus_new", client_reference_id: BUYER,
      metadata: { kind: "declutter_card", user_id: BUYER } });
    expect(params.line_items).toBeUndefined();
    const [created, opts] = stripeMock.customers.create.mock.calls[0];
    expect(opts).toEqual({ idempotencyKey: `lh-wallet-customer-${BUYER}-live` });
    expect(created.metadata).toEqual({ supabase_user_id: BUYER, wallet_mode: "live" });
    expect(rpcs("claim_stripe_customer")[0]?.args).toEqual({ p_user: BUYER, p_mode: "live", p_customer: "cus_new" });
    // Never looked up by email (a reused address would inherit someone's cards).
    expect(stripeMock.customers.list).not.toHaveBeenCalled();
    // The stored row was read for THIS member in THIS mode.
    const q = (scenario.readQueries ?? []).find((r) => r.table === "stripe_customers");
    expect(q?.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "eq", column: "user_id", value: BUYER }),
      expect.objectContaining({ op: "eq", column: "wallet_mode", value: "live" }),
    ]));
  });

  it("uses the customer another tap claimed first (first writer wins)", async () => {
    const fn = await load();
    scenario.rpc.feature_enabled_for_user = true;
    scenario.reads.stripe_customers = { rows: [] };
    stripeMock.customers.create.mockResolvedValue({ id: "cus_mine" });
    scenario.rpc.claim_stripe_customer = "cus_winner";
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_setup", url: "https://x/setup" });
    await fn.fetch(req(fn));
    expect(stripeMock.checkout.sessions.create.mock.calls[0][0].customer).toBe("cus_winner");
  });

  it("reuses the member's stored wallet customer (a card saved for Jobs or Declutter, one customer)", async () => {
    const fn = await load();
    scenario.rpc.feature_enabled_for_user = true;
    scenario.reads.stripe_customers = { rows: [{ stripe_customer_id: "cus_saved" }] };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_setup", url: "https://x/setup" });
    await fn.fetch(req(fn));
    expect(stripeMock.customers.create).not.toHaveBeenCalled();
    expect(rpcs("claim_stripe_customer")).toHaveLength(0);
    expect(stripeMock.checkout.sessions.create.mock.calls[0][0].customer).toBe("cus_saved");
  });

  it("fails closed when the wallet read fails: no customer is made, no page opens", async () => {
    const fn = await load();
    scenario.rpc.feature_enabled_for_user = true;
    scenario.reads.stripe_customers = { error: { message: "boom" } };
    const res = await fn.fetch(req(fn));
    expect(res.status).toBe(503);
    expect(stripeMock.customers.create).not.toHaveBeenCalled();
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });
});
