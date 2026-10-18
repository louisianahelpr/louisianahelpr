/**
 * Shops M2 (migration 20261018184113_shops_handover_payout): the shop payout
 * step of supabase/functions/declutter-money. The amounts and the queue live in
 * SQL (src/test/pglite/shopsHandoverPayout.pglite.mjs); this file proves the
 * edge side runs the automatic finish, then moves exactly what the queue says,
 * once, from the order's own charge, on the order's Stripe mode, and records it.
 *
 * Runs the REAL function source through the edge harness; Stripe and Supabase
 * are doubled (Stripe is LIVE on prod: nothing here reaches it).
 *
 * Registered mutations - each turns this file RED on its own:
 * @mutate supabase/functions/declutter-money/index.ts |             { idempotencyKey: `shop-payout-${p.payout_id}` }, |             {},
 * @mutate supabase/functions/declutter-money/index.ts |           return meta.kind === "shop_payout" && meta.payout_id === p.payout_id && !t.reversed; |           return false;
 * @mutate supabase/functions/declutter-money/index.ts |       if (shopHold.kind === "held") { |       if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |       if ((p.seller_id && underReview.has(p.seller_id)) \|\| (p.buyer_id && underReview.has(p.buyer_id))) { |       if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |           if (byParties !== mode) throw new Error(`shop order says ${mode} but its parties are ${byParties}`); |
 * @mutate supabase/functions/declutter-money/index.ts |           const charge = await wholeCharge(stripe, p.payment_intent_id, 0); |           const charge = "ch_any";
 * @mutate supabase/functions/declutter-money/index.ts |     const finished = await admin.rpc("shop_handover_sweep", {}); |     const finished = { error: null, data: null };
 * @mutate supabase/functions/declutter-money/index.ts |         if (p.attempts + 1 >= 12) { |         if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |       if (!p.stripe_account_id) {\n        // Not a failed try: paid the run after the shop sets up payouts | if (false) {\n        // Not a failed try: paid the run after the shop sets up payouts
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";
import { resetEmailMocks } from "./mocks/email";

const BUYER = "0000000c-0000-4000-8000-000000000001";
const SHOP = "0000000c-0000-4000-8000-000000000002";
const ORDER = "0000000c-0000-4000-8000-0000000000aa";
const PAYOUT = "0000000c-0000-4000-8000-0000000000cc";

const shopPayoutRow = (over: Record<string, unknown> = {}) => ({
  payout_id: PAYOUT, order_id: ORDER, buyer_id: BUYER, seller_id: SHOP, amount_cents: 1800,
  stripe_account_id: "acct_shop1", payment_intent_id: "pi_shop1", livemode: false, checkout_session_id: "cs_test_shop1",
  attempts: 0, ...over,
});
const rpcs = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);

async function run(opts: { shopPayouts?: unknown[] } = {}) {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_shops",
    STRIPE_TEST_SECRET_KEY: "sk_test_shops",
  });
  scenario.rpc.declutter_payouts_due = [];
  scenario.rpc.declutter_refunds_due = [];
  scenario.rpc.helpr_task_payouts_due = [];
  scenario.rpc.declutter_delivery_refunds_due = [];
  scenario.rpc.shop_holds_to_release = [];
  scenario.rpc.shop_captures_due = [];
  scenario.rpc.shop_order_sweep = { no_answer: 0, page_unpaid: 0 };
  scenario.rpc.shop_handover_sweep = { auto_handed_over: 2 };
  scenario.rpc.shop_payouts_due = opts.shopPayouts ?? [];
  // Answers like the SQL: failed when told it failed.
  scenario.rpc.shop_payout_executed = (a: { p_succeeded?: boolean }) => (a?.p_succeeded ? "succeeded" : "failed");
  const fn = await loadEdgeFunction("declutter-money");
  const res = await fn.fetch(fn.request({
    url: "https://edge.test/declutter-money",
    headers: { Authorization: "Bearer service-key" },
    body: {},
  }));
  const text = await res.text();
  return { status: res.status, body: (text.startsWith("{") ? JSON.parse(text) : { text }) as Record<string, any> };
}

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
  resetEmailMocks();
  // Test-account parties: a test-mode order (cs_test_, livemode false) is paid on the TEST key only.
  scenario.reads.test_accounts = { rows: [{ user_id: BUYER }, { user_id: SHOP }] };
  scenario.reads.ban_settlement_queue = { rows: [] };
  scenario.reads.payout_holds = { rows: [] };
  scenario.reads.profiles = { rows: [{ user_id: BUYER, is_seed: true }, { user_id: SHOP, is_seed: true }] };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_shop1", status: "succeeded", latest_charge: { id: "ch_shop1", amount_refunded: 0, disputed: false },
  });
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_shop1", destination: "acct_shop1" });
});

describe("declutter-money: Shops M2 handovers and payouts", () => {
  it("runs the automatic finish every run and reports it", async () => {
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(rpcs("shop_handover_sweep")).toHaveLength(1);
    expect(body.shop_handed_over).toBe(2);
  });

  it("sends exactly the queued amount to the shop's account, grouped by order, funded by the order's charge, once, on the test key", async () => {
    const { status, body } = await run({ shopPayouts: [shopPayoutRow()] });
    expect(status).toBe(200);
    expect(body.shop_payouts_sent).toBe(1);
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    const [params, opts] = stripeMock.transfers.create.mock.calls[0];
    expect(params).toMatchObject({
      amount: 1800, currency: "usd", destination: "acct_shop1",
      transfer_group: `shop_order_${ORDER}`, source_transaction: "ch_shop1",
      metadata: { kind: "shop_payout", payout_id: PAYOUT, order_id: ORDER },
    });
    expect(opts).toEqual({ idempotencyKey: `shop-payout-${PAYOUT}` });
    expect(stripeMock.__keys).toContain("sk_test_shops");
    expect(stripeMock.__keys).not.toContain("sk_live_shops");
    expect(rpcs("shop_payout_executed")[0]?.args).toEqual({
      p_payout_id: PAYOUT, p_transfer_id: "tr_shop1", p_succeeded: true, p_error: null,
    });
  });

  it("reconciles: a transfer Stripe already holds for this payout is recorded, never sent twice", async () => {
    stripeMock.transfers.list.mockResolvedValue({ data: [{ id: "tr_old", reversed: false, metadata: { kind: "shop_payout", payout_id: PAYOUT } }] });
    const { body } = await run({ shopPayouts: [shopPayoutRow({ attempts: 2 })] });
    expect(stripeMock.transfers.list).toHaveBeenCalledWith({ transfer_group: `shop_order_${ORDER}`, limit: 100 });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(body.shop_payouts_reconciled).toBe(1);
    expect(rpcs("shop_payout_executed")[0]?.args).toMatchObject({ p_transfer_id: "tr_old", p_succeeded: true });
  });

  it("a shop on payout hold is not paid and nothing is recorded", async () => {
    scenario.reads.payout_holds = { rows: [{ helper_id: SHOP, reason: "under review", held_at: "2026-10-18T00:00:00Z", denied_at: null }] };
    const { body } = await run({ shopPayouts: [shopPayoutRow()] });
    expect(body.held).toBe(1);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(rpcs("shop_payout_executed")).toHaveLength(0);
  });

  it("an account under ban review is not paid (Q1415(c))", async () => {
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: SHOP }] };
    const { body } = await run({ shopPayouts: [shopPayoutRow()] });
    expect(body.ban_review).toBe(1);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("a shop with no payout account yet is skipped WITHOUT using up a try", async () => {
    const { body } = await run({ shopPayouts: [shopPayoutRow({ stripe_account_id: null })] });
    expect(body.no_payout_account).toBe(1);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(rpcs("shop_payout_executed")).toHaveLength(0);
  });

  it("never pays from a charge that was refunded or disputed: nothing moves, the try is recorded as failed", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_shop1", status: "succeeded", latest_charge: { id: "ch_shop1", amount_refunded: 100, disputed: false },
    });
    const { status } = await run({ shopPayouts: [shopPayoutRow()] });
    expect(status).toBe(500);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(rpcs("shop_payout_executed")[0]?.args).toMatchObject({ p_succeeded: false });
  });

  it("an order recorded in test mode whose parties are real is never paid (on either key)", async () => {
    scenario.reads.test_accounts = { rows: [] };
    await run({ shopPayouts: [shopPayoutRow()] });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("the 12th failed try pages ops", async () => {
    stripeMock.transfers.create.mockRejectedValue(new Error("account closed"));
    await run({ shopPayouts: [shopPayoutRow({ attempts: 11 })] });
    expect(slackAlerts.length).toBe(1);
    expect(JSON.stringify(slackAlerts[0])).toContain("Shops payout gave up");
  });
});
