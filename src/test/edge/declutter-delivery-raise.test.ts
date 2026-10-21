/**
 * Q1929 (spec row 40): the buyer raises a Declutter delivery's Helpr pay.
 * The amounts, the "only a paid raise counts" rule and the refunds live in
 * SQL and are proven by src/test/pglite/declutterDeliveryRaise.pglite.mjs;
 * this file runs the REAL edge sources through the harness (Stripe and
 * Supabase doubled: Stripe is LIVE on prod, nothing here reaches it) and
 * proves each edge step moves exactly what the SQL says, once:
 *   - declutter-checkout raise_pay: a second page tied to the order, for the
 *     raise + its card fee only, kind declutter_raise, the order's transfer group;
 *   - stripe-webhook: only a PAID raise page reaches declutter_delivery_raise_paid;
 *   - declutter-money: a raised payout is funded per charge (the raise part from
 *     the raise's own charge), and a raise to give back is refunded once on its
 *     own charge.
 *
 * Registered mutations - each turns this file RED on its own:
 * @mutate supabase/functions/declutter-money/index.ts |               source_transaction: charges[i] as string, |               source_transaction: charges[0] as string,
 * @mutate supabase/functions/declutter-money/index.ts |          && (meta.raise_id ?? "") === (part.raiseId ?? ""); |          ;
 * @mutate supabase/functions/declutter-money/index.ts |        { idempotencyKey: mine.length === 0 ? `declutter-raise-refund-${x.raise_id}` : `declutter-raise-refund-${x.raise_id}-r${mine.length}` }, |        {},
 * @mutate supabase/functions/declutter-money/index.ts |      const xRefund = adopted ?? await stripe.refunds.create( |      const xRefund = await stripe.refunds.create(
 * @mutate supabase/functions/_shared/helprPayoutParts.ts |  if (raised !== Number(raisedCents ?? 0)) { |  if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |  if (session.payment_status !== "paid") {\n    // Card only: an unpaid completion is logged and changes nothing. |  if (false) {\n    // Card only: an unpaid completion is logged and changes nothing.
 * @mutate supabase/functions/declutter-checkout/index.ts |  if (!parties \|\| parties.buyer_id !== user.id) return json({ error: "item_not_found" }, 404); |
 * @mutate supabase/functions/declutter-checkout/index.ts |  if (error?.code === "PGRST202") return json({ error: "raise_unavailable" }, 503); |
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";
import { resetEmailMocks } from "./mocks/email";
import { helprPayoutParts } from "../../../supabase/functions/_shared/helprPayoutParts";
import { isRoutedTestCheckout } from "../../../supabase/functions/_shared/stripeMode";

const BUYER = "0000000c-0000-4000-8000-000000000001";
const SELLER = "0000000c-0000-4000-8000-000000000002";
const HELPR = "0000000c-0000-4000-8000-000000000003";
const ORDER = "0000000c-0000-4000-8000-0000000000aa";
const TASK = "0000000c-0000-4000-8000-0000000000bb";
const HPAYOUT = "0000000c-0000-4000-8000-0000000000cc";
const RAISE = "0000000c-0000-4000-8000-0000000000dd";
const RAISE2 = "0000000c-0000-4000-8000-0000000000ee";

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
const rpcs = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
  resetEmailMocks();
  scenario.reads.test_accounts = { rows: [] };
  scenario.reads.ban_settlement_queue = { rows: [] };
  scenario.reads.payout_holds = { rows: [] };
});

describe("helprPayoutParts", () => {
  it("no raise: one part, the whole payout, from the order's charge (what was sent before raises)", () => {
    expect(helprPayoutParts(1830, "pi_order", 0, [])).toEqual([{ raiseId: null, paymentIntentId: "pi_order", amountCents: 1830 }]);
    expect(helprPayoutParts(1830, "pi_order", null, null)).toHaveLength(1);
  });
  it("a raise is its own part from its own charge; the fee comes out of the order part", () => {
    expect(helprPayoutParts(3730, "pi_order", 2000, [{ raise_id: RAISE, payment_intent_id: "pi_raise", cents: 2000 }])).toEqual([
      { raiseId: null, paymentIntentId: "pi_order", amountCents: 1730 },
      { raiseId: RAISE, paymentIntentId: "pi_raise", amountCents: 2000 },
    ]);
  });
  it("parts that do not add up to the stamp, malformed parts, or raises above the payout are refused (never a guess)", () => {
    expect(() => helprPayoutParts(3730, "pi_order", 1000, [{ raise_id: RAISE, payment_intent_id: "pi_raise", cents: 2000 }])).toThrow(/add up/);
    expect(() => helprPayoutParts(3730, "pi_order", 2000, [{ raise_id: RAISE, payment_intent_id: "ch_x", cents: 2000 }])).toThrow(/malformed/);
    expect(() => helprPayoutParts(1000, "pi_order", 2000, [{ raise_id: RAISE, payment_intent_id: "pi_raise", cents: 2000 }])).toThrow(/more than the payout/);
    expect(() => helprPayoutParts(1000, "pi_order", 0, "nope")).toThrow(/not a list/);
  });
});

describe("declutter-money: a raised delivery's payout and its raise refunds", () => {
  const helprRow = (over: Record<string, unknown> = {}) => ({
    payout_id: HPAYOUT, task_id: TASK, source_kind: "declutter_delivery", source_id: ORDER, helpr_id: HELPR,
    customer_id: BUYER, pickup_contact_id: SELLER, amount_cents: 3730, stripe_account_id: "acct_helpr1",
    payment_intent_id: "pi_order1", transfer_group: `declutter_order_${ORDER}`, refunds_recorded_cents: 0, attempts: 0,
    raised_cents: 2000, raise_parts: [{ raise_id: RAISE, payment_intent_id: "pi_raise1", cents: 2000 }], ...over,
  });
  const raiseRefund = (over: Record<string, unknown> = {}) => ({
    raise_id: RAISE2, reason: "no_helpr", order_id: ORDER, buyer_id: BUYER, seller_id: SELLER, payment_intent_id: "pi_raise2",
    refund_cents: 1061, attempts: 0, livemode: true, checkout_session_id: "cs_live_r2", ...over,
  });
  async function run(opts: { helprPayouts?: unknown[]; raiseRefunds?: unknown[]; profiles?: unknown[] } = {}) {
    env();
    scenario.rpc.declutter_payouts_due = [];
    scenario.rpc.declutter_refunds_due = [];
    scenario.rpc.declutter_delivery_refunds_due = [];
    scenario.rpc.helpr_task_payouts_due = opts.helprPayouts ?? [];
    scenario.rpc.declutter_delivery_raise_refunds_due = opts.raiseRefunds ?? [];
    scenario.rpc.helpr_task_payout_executed = (a: { p_succeeded?: boolean }) => (a?.p_succeeded ? "succeeded" : "failed");
    scenario.rpc.declutter_delivery_raise_refund_executed = (a: { p_succeeded?: boolean }) => (a?.p_succeeded ? "refunded" : "refunding");
    scenario.rpc.declutter_delivery_raise_payout_sent = "recorded";
    // A test may name the parties' profiles (is_seed decides test vs real mode); run() never overwrites them.
    scenario.reads.profiles = { rows: opts.profiles ?? [{ user_id: BUYER, email: "buyer@example.test" }] };
    stripeMock.paymentIntents.retrieve.mockImplementation(async (id: string) => ({
      id, status: "succeeded", latest_charge: { id: id === "pi_raise1" ? "ch_raise1" : "ch_order1", amount_refunded: 0, disputed: false },
    }));
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_helpr1", capabilities: { transfers: "active" }, payouts_enabled: true });
    let n = 0;
    stripeMock.transfers.create.mockImplementation(async () => ({ id: `tr_new${++n}`, destination: "acct_helpr1" }));
    stripeMock.refunds.create.mockResolvedValue({ id: "re_raise2", status: "succeeded" });
    const fn = await loadEdgeFunction("declutter-money");
    const res = await fn.fetch(fn.request({ url: "https://edge.test/declutter-money", headers: { Authorization: "Bearer service-key" }, body: {} }));
    return { status: res.status, body: JSON.parse(await res.text()) as Record<string, any> };
  }

  it("pays the raised pay minus the fee as two transfers: the order part from the order's charge, the raise from its own", async () => {
    const { status, body } = await run({ helprPayouts: [helprRow()] });
    expect(status).toBe(200);
    expect(body.helpr_payouts_sent).toBe(1);
    const calls = stripeMock.transfers.create.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatchObject({ amount: 1730, source_transaction: "ch_order1", destination: "acct_helpr1",
      transfer_group: `declutter_order_${ORDER}`, metadata: { kind: "helpr_task_payout", payout_id: HPAYOUT } });
    expect(calls[0][0].metadata.raise_id).toBeUndefined();
    expect(calls[0][1]).toEqual({ idempotencyKey: `helpr-task-payout-${HPAYOUT}` });
    expect(calls[1][0]).toMatchObject({ amount: 2000, source_transaction: "ch_raise1", metadata: { raise_id: RAISE, payout_id: HPAYOUT } });
    expect(calls[1][1]).toEqual({ idempotencyKey: `helpr-task-payout-${HPAYOUT}-raise-${RAISE}` });
    expect(calls[0][0].amount + calls[1][0].amount).toBe(3730);
    expect(rpcs("helpr_task_payout_executed")[0]?.args).toEqual({ p_payout_id: HPAYOUT, p_transfer_id: "tr_new1", p_succeeded: true, p_error: null });
    // The raise part's transfer is recorded on its raise (restore check, settle-by-hand), before the payout row.
    expect(rpcs("declutter_delivery_raise_payout_sent")[0]?.args).toEqual({ p_raise_id: RAISE, p_transfer_id: "tr_new2" });
  });

  it("a raise transfer that cannot be recorded leaves the payout unrecorded (reconciled next run, never re-sent)", async () => {
    scenario.rpcErrors = { declutter_delivery_raise_payout_sent: { message: "boom" } };
    const { body } = await run({ helprPayouts: [helprRow()] });
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(2);
    expect(rpcs("helpr_task_payout_executed")).toHaveLength(0);
    expect(JSON.stringify(body)).toMatch(/raise transfer tr_new2 not recorded/);
  });

  it("part sent, part not: nothing more is sent automatically; held for a person naming what went (no double pay by hand)", async () => {
    stripeMock.transfers.list.mockResolvedValue({ data: [
      { id: "tr_h_old", destination: "acct_helpr1", reversed: false, metadata: { kind: "helpr_task_payout", payout_id: HPAYOUT } },
    ] });
    const { body } = await run({ helprPayouts: [helprRow({ attempts: 1 })] });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(rpcs("helpr_task_payout_executed")).toHaveLength(0);
    const wait = rpcs("payout_payee_wait_seen")[0]?.args as { p_category?: string; p_reason?: string } | undefined;
    expect(wait?.p_category).toBe("needs_reconcile");
    expect(wait?.p_reason).toMatch(/tr_h_old went; \$20\.00 from raise charges did not/);
    expect(JSON.stringify(body)).toMatch(/partly sent/);
  });

  it("both parts already sent: reconciled, nothing sent", async () => {
    stripeMock.transfers.list.mockResolvedValue({ data: [
      { id: "tr_h_old", reversed: false, metadata: { kind: "helpr_task_payout", payout_id: HPAYOUT } },
      { id: "tr_h_raise", reversed: false, metadata: { kind: "helpr_task_payout", payout_id: HPAYOUT, raise_id: RAISE } },
    ] });
    const { body } = await run({ helprPayouts: [helprRow({ attempts: 2 })] });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(body.helpr_payouts_reconciled).toBe(1);
  });

  it("raise parts that do not match the task's stamp move nothing (a data defect, held)", async () => {
    const { body } = await run({ helprPayouts: [helprRow({ raised_cents: 1500 })] });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(rpcs("helpr_task_payout_executed")).toHaveLength(0);
    expect(JSON.stringify(body)).toMatch(/do not add up/);
  });

  it("a raise refund goes back once, in full, on the raise's OWN charge, and is recorded", async () => {
    const { body } = await run({ raiseRefunds: [raiseRefund()] });
    expect(body.raise_refunds_sent).toBe(1);
    const [params, opts] = stripeMock.refunds.create.mock.calls[0];
    expect(params).toEqual({ payment_intent: "pi_raise2", amount: 1061,
      metadata: { kind: "declutter_refund", raise_id: RAISE2, reason: "no_helpr", order_id: ORDER } });
    expect(opts).toEqual({ idempotencyKey: `declutter-raise-refund-${RAISE2}` });
    expect(stripeMock.__key).toBe("sk_live_declutter");
    expect(rpcs("declutter_delivery_raise_refund_executed")[0]?.args).toEqual({
      p_raise_id: RAISE2, p_stripe_refund_id: "re_raise2", p_succeeded: true, p_error: null });
  });

  it("a raise refund Stripe already holds is adopted, never sent twice", async () => {
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_old", status: "succeeded", metadata: { raise_id: RAISE2 } }] });
    const { body } = await run({ raiseRefunds: [raiseRefund({ attempts: 1 })] });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(body.raise_refunds_reconciled).toBe(1);
    expect(rpcs("declutter_delivery_raise_refund_executed")[0]?.args).toMatchObject({ p_stripe_refund_id: "re_old", p_succeeded: true });
  });

  it("a buyer under ban review: the raise refund waits (deferred, no try), nothing moves", async () => {
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: BUYER }] };
    const { body } = await run({ raiseRefunds: [raiseRefund()] });
    expect(body.ban_review).toBe(1);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(rpcs("declutter_delivery_raise_refund_defer")[0]?.args).toEqual({ p_raise_id: RAISE2, p_minutes: 60 });
    expect(slackAlerts).toHaveLength(0);
  });

  it("a raise refund that cannot run (mixed test and real parties) waits AND pages a person once a day", async () => {
    scenario.reads.test_accounts = { rows: [{ user_id: SELLER }] };
    const { body } = await run({
      raiseRefunds: [raiseRefund({ livemode: null, checkout_session_id: null })],
      profiles: [{ user_id: BUYER, email: "buyer@example.test" }, { user_id: SELLER, is_seed: true }],
    });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(rpcs("declutter_delivery_raise_refund_defer")[0]?.args).toMatchObject({ p_raise_id: RAISE2, p_minutes: 1440 });
    expect(slackAlerts.some((a) => /delivery-raise refund is waiting on a person/.test(String(a.title)))).toBe(true);
    expect(body.mixed_parties).toBe(1);
  });

  it("before the migration is deployed (PGRST202) the rest of the run still moves money", async () => {
    scenario.rpcErrors = { declutter_delivery_raise_refunds_due: { message: "not found", code: "PGRST202" } };
    const { body } = await run({ helprPayouts: [helprRow({ raised_cents: 0, raise_parts: [], amount_cents: 1830 })] });
    // Reported as one defect (the run says so), and the Helpr is still paid.
    expect(JSON.stringify(body)).toMatch(/not deployed yet \(PGRST202\)/);
    expect(body.helpr_payouts_sent).toBe(1);
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
  });
});

describe("stripe-webhook: a delivery raise page completed", () => {
  async function deliver(session: Record<string, unknown>, answer: unknown = { result: "applied", raise_id: RAISE }) {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_raise_1", type: "checkout.session.completed", livemode: true, created: 1_760_000_000,
      data: { object: {
        id: "cs_live_raise", mode: "payment", payment_status: "paid", payment_intent: "pi_raise", amount_total: 1061,
        client_reference_id: ORDER,
        metadata: { kind: "declutter_raise", raise_id: RAISE, order_id: ORDER, buyer_id: BUYER, payer_id: BUYER, seller_id: SELLER },
        ...session,
      } },
    });
    scenario.rpc.declutter_delivery_raise_paid = answer;
    scenario.reads.declutter_orders = { rows: [{ buyer_id: BUYER }] };
    scenario.reads.profiles = { rows: [{ email: "buyer@test.dev", user_id: BUYER }] };
    return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
  }

  it("a PAID page: the raise is applied by SQL with the page, the payment and the amount Stripe took", async () => {
    const res = await deliver({});
    expect(res.status).toBe(200);
    expect(rpcs("declutter_delivery_raise_paid")[0]?.args).toEqual({
      p_raise_id: RAISE, p_order_id: ORDER, p_session_id: "cs_live_raise", p_payment_intent_id: "pi_raise", p_amount_cents: 1061, p_livemode: true,
    });
    expect(rpcs("declutter_mark_order_paid")).toHaveLength(0);
  });

  it("an UNPAID completion changes nothing", async () => {
    const res = await deliver({ payment_status: "unpaid" });
    expect(res.status).toBe(200);
    expect(rpcs("declutter_delivery_raise_paid")).toHaveLength(0);
  });

  it("a page whose buyer is not the order's is never applied: ops are paged", async () => {
    const res = await deliver({ metadata: { kind: "declutter_raise", raise_id: RAISE, order_id: ORDER, buyer_id: SELLER } });
    expect(res.status).toBe(200);
    expect(rpcs("declutter_delivery_raise_paid")).toHaveLength(0);
    expect(slackAlerts.some((a) => /raise paid but not applied/.test(String(a.title)))).toBe(true);
  });

  it("a replay is answered 'already' by SQL and pages nobody", async () => {
    const res = await deliver({}, { result: "already", status: "applied", raise_id: RAISE });
    expect(res.status).toBe(200);
    expect(slackAlerts).toHaveLength(0);
  });

  it("a page SQL cannot tie to its raise pages ops (refund by hand)", async () => {
    await deliver({}, { result: "session_mismatch", raise_id: RAISE });
    expect(slackAlerts.some((a) => /another Stripe page/.test(String(a.message)))).toBe(true);
  });

  it("a page whose metadata names another order than its raise row is never applied", async () => {
    await deliver({}, { result: "order_mismatch", raise_id: RAISE });
    expect(slackAlerts.some((a) => /belongs to another order/.test(String(a.message)))).toBe(true);
  });

  it("a TEST-mode raise page is routed (test accounts pay raises on the test key)", () => {
    expect(isRoutedTestCheckout({ mode: "payment", metadata: { kind: "declutter_raise", raise_id: RAISE, order_id: ORDER } })).toBe(true);
  });
});

describe("stripe-webhook: a raise refund Stripe later failed", () => {
  it("reopens the raise's own row (never the delivery-fee row or an order refund) and pages ops", async () => {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_ru_raise", type: "charge.refund.updated",
      data: { object: { id: "re_raise2", status: "failed", amount: 1061, payment_intent: "pi_raise2", charge: "ch_raise2",
        failure_reason: "lost_or_stolen_card", metadata: { kind: "declutter_refund", raise_id: RAISE2, reason: "no_helpr", order_id: ORDER } } },
    });
    scenario.rpc.declutter_delivery_raise_refund_reversed = "reopened";
    const res = await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
    expect(res.status).toBe(200);
    expect(rpcs("declutter_delivery_raise_refund_reversed")[0]?.args).toEqual({
      p_raise_id: RAISE2, p_stripe_refund_id: "re_raise2", p_why: "failed: lost_or_stolen_card" });
    expect(rpcs("declutter_delivery_refund_reversed")).toHaveLength(0);
    expect(rpcs("declutter_refund_reversed")).toHaveLength(0);
    expect(slackAlerts.some((a) => /delivery-raise refund failed after Stripe took it: retrying/.test(String(a.title)))).toBe(true);
  });
});

describe("declutter-checkout: raise_pay", () => {
  async function call(body: Record<string, unknown>) {
    env();
    scenario.authUser = { id: BUYER, email: "buyer@test.dev" };
    const fn = await loadEdgeFunction("declutter-checkout");
    return fn.fetch(fn.request({ headers: { Authorization: "Bearer buyer-jwt" }, body: { action: "raise_pay", ...body } }));
  }
  const started = [{ raise_id: RAISE, raise_cents: 1000, card_fee_cents: 61, total_cents: 1061, superseded_session_id: null }];

  it("opens a second page tied to the order for the raise and its card fee only", async () => {
    scenario.rpc.feature_enabled_for_user = true;
    scenario.reads.declutter_orders = { rows: [{ buyer_id: BUYER, seller_id: SELLER }] };
    scenario.reads.declutter_delivery_raises = { rows: [] };
    scenario.rpc.declutter_delivery_raise_start = started;
    scenario.rpc.declutter_delivery_raise_attach = null;
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_raise", url: "https://checkout.stripe.test/raise", amount_total: 1061 });
    const res = await call({ order_id: ORDER, raise_cents: 1000 });
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text()).url).toBe("https://checkout.stripe.test/raise");
    expect(rpcs("declutter_delivery_raise_start")[0]?.args).toEqual({ p_order_id: ORDER, p_raise_cents: 1000 });
    const [params, opts] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params.line_items.map((l: any) => l.price_data.unit_amount)).toEqual([1000, 61]);
    expect(params.line_items.map((l: any) => l.price_data.product_data.name)).toEqual(["Higher Helpr delivery pay", "Card fee"]);
    expect(params.metadata).toMatchObject({ kind: "declutter_raise", raise_id: RAISE, order_id: ORDER, buyer_id: BUYER, payer_id: BUYER });
    expect(params.payment_intent_data.transfer_group).toBe(`declutter_order_${ORDER}`);
    expect(params.payment_intent_data.transfer_data).toBeUndefined();
    expect(opts).toEqual({ idempotencyKey: `declutter-raise-${RAISE}` });
    expect(rpcs("declutter_delivery_raise_attach")[0]?.args).toEqual({ p_raise_id: RAISE, p_session_id: "cs_live_raise" });
  });

  it("anyone but the order's buyer gets item_not_found and no page", async () => {
    scenario.rpc.feature_enabled_for_user = true;
    scenario.reads.declutter_orders = { rows: [{ buyer_id: SELLER, seller_id: BUYER }] };
    const res = await call({ order_id: ORDER, raise_cents: 1000 });
    expect(res.status).toBe(404);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(rpcs("declutter_delivery_raise_start")).toHaveLength(0);
  });

  it("the hidden switch off: refused before anything is read", async () => {
    scenario.rpc.feature_enabled_for_user = false;
    const res = await call({ order_id: ORDER, raise_cents: 1000 });
    expect(res.status).toBe(403);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("an open page is closed only AFTER the SQL accepted the new raise (a refusal keeps it)", async () => {
    scenario.rpc.feature_enabled_for_user = true;
    scenario.reads.declutter_orders = { rows: [{ buyer_id: BUYER, seller_id: SELLER }] };
    scenario.reads.declutter_delivery_raises = { rows: [{ id: RAISE2, stripe_checkout_session_id: "cs_live_old" }] };
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({ id: "cs_live_old", status: "open", url: "https://x/old" });
    scenario.rpcErrors = { declutter_delivery_raise_start: { message: "raise_limit", code: "22023" } };
    const refusedRes = await call({ order_id: ORDER, raise_cents: 1000 });
    expect(refusedRes.status).toBe(400);
    expect(stripeMock.checkout.sessions.expire).not.toHaveBeenCalled();
    scenario.rpcErrors = {};
    scenario.rpc.declutter_delivery_raise_start = [{ ...started[0], superseded_session_id: "cs_live_old" }];
    scenario.rpc.declutter_delivery_raise_attach = null;
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_raise", url: "https://x/raise", amount_total: 1061 });
    const okRes = await call({ order_id: ORDER, raise_cents: 1000 });
    expect(okRes.status).toBe(200);
    expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith("cs_live_old");
  });

  it("an open raise page that was already paid replaces nothing", async () => {
    scenario.rpc.feature_enabled_for_user = true;
    scenario.reads.declutter_orders = { rows: [{ buyer_id: BUYER, seller_id: SELLER }] };
    scenario.reads.declutter_delivery_raises = { rows: [{ id: RAISE2, stripe_checkout_session_id: "cs_live_old" }] };
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({ id: "cs_live_old", status: "complete" });
    const res = await call({ order_id: ORDER, raise_cents: 1000 });
    expect(JSON.parse(await res.text())).toMatchObject({ paid: true });
    expect(rpcs("declutter_delivery_raise_start")).toHaveLength(0);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("before the migration is deployed (PGRST202): not available yet, no page", async () => {
    scenario.rpc.feature_enabled_for_user = true;
    scenario.reads.declutter_orders = { rows: [{ buyer_id: BUYER, seller_id: SELLER }] };
    scenario.reads.declutter_delivery_raises = { rows: [] };
    scenario.rpcErrors = { declutter_delivery_raise_start: { message: "Could not find the function", code: "PGRST202" } };
    const res = await call({ order_id: ORDER, raise_cents: 1000 });
    expect(res.status).toBe(503);
    expect(JSON.parse(await res.text()).error).toBe("raise_unavailable");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("a SQL refusal is passed on as its code (e.g. the delivery was taken)", async () => {
    scenario.rpc.feature_enabled_for_user = true;
    scenario.reads.declutter_orders = { rows: [{ buyer_id: BUYER, seller_id: SELLER }] };
    scenario.reads.declutter_delivery_raises = { rows: [] };
    scenario.rpcErrors = { declutter_delivery_raise_start: { message: "delivery_not_waiting", code: "55000" } };
    const res = await call({ order_id: ORDER, raise_cents: 1000 });
    expect(res.status).toBe(409);
    expect(JSON.parse(await res.text()).error).toBe("delivery_not_waiting");
  });
});
