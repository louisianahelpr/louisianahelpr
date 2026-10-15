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
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     \|\| (typeof charge.transfer_group === "string" && charge.transfer_group.startsWith("declutter_order_")) |
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     if (why) { |     if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |   if (await handleDeclutterHandRefundFailed(refund, { supabase })) return; |
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     if ((error as { code?: string }).code === "PGRST202") return false; |
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   if (refund.refund_status === "succeeded") return "already"; |
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   const paidAt = new Date((facts.chargedAt ?? event.created) * 1000).toISOString(); |   const paidAt = new Date().toISOString();
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |   if (isDeclutterSession(session)) { |   if (false) {
 * @mutate supabase/functions/declutter-checkout/index.ts |   if (row!.superseded_session_id) await expirePage(stripeOf(row!.superseded_session_id), row!.superseded_session_id); |
 * @mutate supabase/functions/declutter-checkout/index.ts |     { idempotencyKey: `declutter-order-${order.order_id}-${expiresAt}` }, |     {},
 * @mutate supabase/functions/declutter-checkout/index.ts |     if (page.status === "complete") return json({ paid: true, order_id: open.id }); |
 * @mutate supabase/functions/declutter-checkout/index.ts |     if (page.status === "open" && open.handover !== handover) { |     if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   if (parties && (parties.buyer_id !== meta.buyer_id \|\| parties.seller_id !== meta.seller_id)) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   if (refunded === "sent") { |   if (true) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |   if (allRefunds.length > 0 && allRefunds.every((r) => (r?.metadata as Record<string, string> \| null)?.kind === "declutter_refund")) { |   if (false) {
 * @mutate supabase/functions/declutter-checkout/index.ts |     payer_id: user.id, |
 * @mutate supabase/functions/declutter-card/index.ts |   const refused = await requireFeature(admin, "declutter", user, corsHeaders);\n  if (refused) return refused; |
 * @mutate supabase/functions/_shared/stripeMode.ts |   if (session.mode === "setup") return meta.kind === "declutter_card"; |   if (session.mode === "setup") return false;
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     p_livemode: event.livemode === true, |     p_livemode: false,
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   if (modeErr) throw new Error(`declutter_refund_set_mode failed: ${modeErr.message}`); |
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |   if (meta.kind === "declutter_refund") { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |     const gaveUp = reopened === "gave_up"; |     const gaveUp = false;
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts | order_id: refund.order_id ?? "" }, | order_id: orderId },
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";
import { queuedEmails, resetEmailMocks } from "./mocks/email";
import { isRoutedTestCheckout } from "../../../supabase/functions/_shared/stripeMode";

const BUYER = "0000000a-0000-4000-8000-000000000001";
const SELLER = "0000000a-0000-4000-8000-000000000002";
const ORDER = "0000000a-0000-4000-8000-0000000000aa";
const ITEM = "0000000a-0000-4000-8000-0000000000bb";

function env() {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_declutter",
    STRIPE_TEST_SECRET_KEY: "sk_test_declutter",
    STRIPE_WEBHOOK_SECRET: "whsec_live",
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
});

describe("stripe-webhook: Declutter order paid", () => {
  async function deliver(answer: unknown, opts: { created?: number; fee?: number | null; chargedAt?: number } = {}) {
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
        metadata: { kind: "declutter_order", order_id: ORDER, buyer_id: BUYER, payer_id: BUYER, seller_id: SELLER },
      } },
    });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_dc", latest_charge: { created: opts.chargedAt, balance_transaction: { fee: opts.fee === undefined ? 163 : opts.fee } },
    });
    scenario.rpc.declutter_mark_order_paid = answer;
    scenario.reads.profiles = { rows: [{ email: "buyer@test.dev", user_id: BUYER }] };
    scenario.reads.declutter_orders = { rows: [{ buyer_id: BUYER, seller_id: SELLER }] };
    const res = await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
    return res;
  }

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

  it("opens Stripe's card-saving page (setup mode: nothing is charged) for the caller", async () => {
    const fn = await load();
    scenario.rpc.feature_enabled_for_user = true;
    scenario.reads.declutter_buyer_cards = { rows: [] };
    stripeMock.customers.create.mockResolvedValue({ id: "cus_new" });
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_setup", url: "https://x/setup" });
    const res = await fn.fetch(req(fn));
    expect(res.status).toBe(200);
    expect((await json(res)).url).toBe("https://x/setup");
    const [params] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params).toMatchObject({ mode: "setup", customer: "cus_new", client_reference_id: BUYER,
      metadata: { kind: "declutter_card", user_id: BUYER } });
    expect(params.line_items).toBeUndefined();
    expect(stripeMock.customers.create.mock.calls[0][1]).toEqual({ idempotencyKey: `declutter-customer-${BUYER}-live` });
  });

  it("reuses the saved card's customer in the same mode", async () => {
    const fn = await load();
    scenario.rpc.feature_enabled_for_user = true;
    scenario.reads.declutter_buyer_cards = { rows: [{ stripe_customer_id: "cus_saved", card_mode: "live" }] };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_setup", url: "https://x/setup" });
    await fn.fetch(req(fn));
    expect(stripeMock.customers.create).not.toHaveBeenCalled();
    expect(stripeMock.checkout.sessions.create.mock.calls[0][0].customer).toBe("cus_saved");
  });
});
