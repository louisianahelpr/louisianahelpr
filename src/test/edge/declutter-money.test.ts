/**
 * Declutter slice 4, the money cron (docs/specs/declutter-auctions.md rows 22,
 * 67, 93, 99; B53, B57): supabase/functions/declutter-money sends due seller
 * payouts and retries/reconciles refunds the webhook did not finish.
 *
 * Runs the REAL function source through the edge harness; Stripe and Supabase
 * are doubled (Stripe is LIVE on prod: nothing here reaches it). The amounts
 * and the queues live in SQL and are proven by
 * src/test/pglite/declutterSlice4.pglite.mjs; this file proves the edge side
 * moves exactly what the queue says, once, and records it.
 *
 * Registered mutations - each turns this file RED on its own:
 * @mutate supabase/functions/declutter-money/index.ts |         { idempotencyKey: retries === 0 ? `declutter-refund-${r.refund_id}` : `declutter-refund-${r.refund_id}-r${retries}` }, |         {},
 * @mutate supabase/functions/declutter-money/index.ts |       const refund = existing ?? await stripe.refunds.create( |       const refund = await stripe.refunds.create(
 * @mutate supabase/functions/declutter-money/index.ts |           { idempotencyKey: `declutter-payout-${p.payout_id}` }, |           {},
 * @mutate supabase/functions/declutter-money/index.ts |       let transfer = existing; |       let transfer = undefined as typeof existing;
 * @mutate supabase/functions/declutter-money/index.ts |     if (hold.kind === "held") { |     if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |     if ((p.seller_id && review.users.has(p.seller_id)) \|\| (p.buyer_id && review.users.has(p.buyer_id))) { |     if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |   const refused = verifyCronSecret(req);\n  if (refused) return refused; |
 * @mutate supabase/functions/declutter-money/index.ts |             destination: p.stripe_account_id,\n            transfer_group: group, |             destination: p.stripe_account_id,
 * @mutate supabase/functions/declutter-money/index.ts |   if (p.attempts + 1 < 12) return; |   return;
 * @mutate supabase/functions/declutter-money/index.ts |   if (gaveUp.error) defects.record(`declutter_refund_gave_up_check failed: ${gaveUp.error.message}`); |   if (gaveUp.error) void 0;
 * @mutate supabase/functions/declutter-money/index.ts |   if (gaveUp.error) defects.record(`declutter_refund_gave_up_check failed: ${gaveUp.error.message}`); |   if (gaveUp.error) return cronError(FN, `declutter_refund_gave_up_check failed: ${gaveUp.error.message}`);
 * @mutate supabase/functions/declutter-money/index.ts |       defects.record(`payout ${p.payout_id}: ${msg}`.slice(0, 200)); |
 * @mutate supabase/functions/declutter-money/index.ts |       const existing = mine.find((x) => tookIt(x.status)); |       const existing = mine[0];
 * @mutate supabase/functions/declutter-money/index.ts |         if (pi.status !== "succeeded" \|\| !ch \|\| ch.amount_refunded > 0 \|\| ch.disputed) { |         if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |       return { stripe: modes.clientFor(mode) }; |       return await modes.clientForParties([r.buyer_id, r.seller_id]);
 * @mutate supabase/functions/declutter-money/index.ts |     if (!hasParties) return null; |
 * @mutate supabase/functions/declutter-money/index.ts |         if (byParties !== mode) throw new Error(`refund row says ${mode} but its parties are ${byParties}`); |
 * @mutate supabase/functions/declutter-money/index.ts |     const byPage = sessionIdMode(r.checkout_session_id); |     const byPage = null;
 * @mutate supabase/functions/declutter-money/index.ts |   const gaveUp = await admin.rpc("declutter_refund_gave_up_check", {}); |   const gaveUp = { error: null, data: 0 };
 * @mutate supabase/functions/declutter-money/index.ts |     message: /charge is not whole/.test(why) |     message: false
 * @mutate supabase/functions/declutter-money/index.ts |     if (recorded && byPage && recorded !== byPage) throw new Error(`refund row says ${recorded} but its order's page is ${byPage}`); |
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";
import { queueEmail, queuedEmails, resetEmailMocks } from "./mocks/email";

const BUYER = "0000000b-0000-4000-8000-000000000001";
const SELLER = "0000000b-0000-4000-8000-000000000002";
const ORDER = "0000000b-0000-4000-8000-0000000000aa";
const PAYOUT = "0000000b-0000-4000-8000-0000000000cc";
const REFUND = "0000000b-0000-4000-8000-0000000000dd";

const payoutRow = (over: Record<string, unknown> = {}) => ({
  payout_id: PAYOUT, order_id: ORDER, buyer_id: BUYER, seller_id: SELLER, amount_cents: 3850,
  stripe_account_id: "acct_seller1", payment_intent_id: "pi_order1", attempts: 0, ...over,
});
const refundRow = (over: Record<string, unknown> = {}) => ({
  refund_id: REFUND, reason: "seller_no_show", order_id: ORDER, buyer_id: BUYER, seller_id: SELLER, payment_intent_id: "pi_order1",
  refund_cents: 4000, attempts: 1, ...over,
});
const rpcs = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);

async function run(opts: { payouts?: unknown[]; refunds?: unknown[]; bearer?: string } = {}) {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_declutter",
    STRIPE_TEST_SECRET_KEY: "sk_test_declutter",
  });
  scenario.rpc.declutter_payouts_due = opts.payouts ?? [];
  scenario.rpc.declutter_refunds_due = opts.refunds ?? [];
  // The mocks answer like the SQL: failed when told it failed (review: a constant "succeeded" hid a missing defect).
  scenario.rpc.declutter_payout_executed = (a: { p_succeeded?: boolean }) => (a?.p_succeeded ? "succeeded" : "failed");
  scenario.rpc.declutter_refund_executed = (a: { p_succeeded?: boolean }) => (a?.p_succeeded ? "succeeded" : "failed");
  const fn = await loadEdgeFunction("declutter-money");
  const res = await fn.fetch(fn.request({
    url: "https://edge.test/declutter-money",
    headers: { Authorization: `Bearer ${opts.bearer ?? "service-key"}` },
    body: {},
  }));
  const text = await res.text();
  // verifyCronSecret answers a plain "Unauthorized"; every run answers JSON.
  return { status: res.status, body: (text.startsWith("{") ? JSON.parse(text) : { text }) as Record<string, any> };
}

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
  resetEmailMocks();
  scenario.reads.test_accounts = { rows: [] };
  scenario.reads.ban_settlement_queue = { rows: [] };
  scenario.reads.payout_holds = { rows: [] };
  scenario.reads.profiles = { rows: [{ user_id: BUYER, email: "buyer@example.test" }] };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_order1", status: "succeeded", latest_charge: { id: "ch_order1", amount_refunded: 0, disputed: false },
  });
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_new1", destination: "acct_seller1" });
  stripeMock.refunds.create.mockResolvedValue({ id: "re_new1", status: "succeeded" });
});

describe("declutter-money: who may call it", () => {
  it("refuses a caller without the cron secret and moves nothing", async () => {
    const { status } = await run({ payouts: [payoutRow()], bearer: "buyer-jwt" });
    expect(status).toBe(401);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(rpcs("declutter_payouts_due")).toHaveLength(0);
  });
});

describe("declutter-money: seller payouts (B53)", () => {
  it("sends exactly the queued amount to the seller's account, grouped by order, funded by the order's charge, once", async () => {
    const { status, body } = await run({ payouts: [payoutRow()] });
    expect(status).toBe(200);
    expect(body.payouts_sent).toBe(1);
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    const [params, opts] = stripeMock.transfers.create.mock.calls[0];
    expect(params).toMatchObject({
      amount: 3850, currency: "usd", destination: "acct_seller1",
      transfer_group: `declutter_order_${ORDER}`, source_transaction: "ch_order1",
      metadata: { kind: "declutter_payout", payout_id: PAYOUT, order_id: ORDER },
    });
    expect(opts).toEqual({ idempotencyKey: `declutter-payout-${PAYOUT}` });
    expect(stripeMock.__key).toBe("sk_live_declutter");
    expect(rpcs("declutter_payout_executed")[0]?.args).toEqual({
      p_payout_id: PAYOUT, p_transfer_id: "tr_new1", p_succeeded: true, p_error: null,
    });
  });

  it("reconciles: a transfer Stripe already holds for this order is recorded, never sent twice", async () => {
    stripeMock.transfers.list.mockResolvedValue({ data: [{ id: "tr_old1", destination: "acct_seller1", reversed: false, metadata: { kind: "declutter_payout", payout_id: PAYOUT } }] });
    const { body } = await run({ payouts: [payoutRow({ attempts: 3 })] });
    expect(stripeMock.transfers.list).toHaveBeenCalledWith({ transfer_group: `declutter_order_${ORDER}`, limit: 100 });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(body.payouts_reconciled).toBe(1);
    expect(rpcs("declutter_payout_executed")[0]?.args).toMatchObject({ p_transfer_id: "tr_old1", p_succeeded: true });
  });

  it("a seller on payout hold is not paid (and nothing is recorded as failed)", async () => {
    scenario.reads.payout_holds = { rows: [{ helper_id: SELLER, reason: "under review", held_at: "2026-10-15T00:00:00Z", denied_at: null }] };
    const { status, body } = await run({ payouts: [payoutRow()] });
    expect(status).toBe(200);
    expect(body.held).toBe(1);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(rpcs("declutter_payout_executed")).toHaveLength(0);
  });

  it("an unreadable hold moves no money (fail closed, 500)", async () => {
    scenario.reads.payout_holds = { error: { message: "connection reset", code: "08006" } };
    const { status } = await run({ payouts: [payoutRow()] });
    expect(status).toBe(500);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("an account under ban review is not paid (Q1415(c))", async () => {
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: SELLER }] };
    const { body } = await run({ payouts: [payoutRow()] });
    expect(body.ban_review).toBe(1);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("a seller with no payout account yet is skipped WITHOUT using up a try (paid once they set one up)", async () => {
    const { status, body } = await run({ payouts: [payoutRow({ stripe_account_id: null })] });
    expect(status).toBe(200);
    expect(body.no_payout_account).toBe(1);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(rpcs("declutter_payout_executed")).toHaveLength(0);
  });

  it("never pays from anything but the order's own whole charge (refunded or disputed: nothing moves)", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_order1", status: "succeeded", latest_charge: { id: "ch_order1", amount_refunded: 500, disputed: false },
    });
    const { status } = await run({ payouts: [payoutRow()] });
    expect(status).toBe(500);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("the 12th failed try pages (the queue stops offering the row after it)", async () => {
    stripeMock.transfers.create.mockRejectedValue(new Error("account closed"));
    await run({ payouts: [payoutRow({ attempts: 11 })] });
    expect(slackAlerts.length).toBe(1);
    expect(JSON.stringify(slackAlerts[0])).toContain("gave up");
  });

  it("a Stripe failure is recorded as a failed attempt (SQL backs off) and the run reports the defect", async () => {
    stripeMock.transfers.create.mockRejectedValue(new Error("insufficient funds"));
    const { status, body } = await run({ payouts: [payoutRow()] });
    expect(status).toBe(500);
    expect(body.payouts_failed).toBe(1);
    expect(rpcs("declutter_payout_executed")[0]?.args).toMatchObject({ p_succeeded: false, p_error: "insufficient funds" });
  });

  it("test accounts run on the test key", async () => {
    scenario.reads.test_accounts = { rows: [{ user_id: BUYER }, { user_id: SELLER }] };
    scenario.reads.profiles = { rows: [{ user_id: BUYER, is_seed: true }, { user_id: SELLER, is_seed: true }] };
    await run({ payouts: [payoutRow()] });
    expect(stripeMock.__key).toBe("sk_test_declutter");
    expect(stripeMock.__keys).not.toContain("sk_live_declutter");
  });
});

describe("declutter-money: refund retry and reconcile (3b money review #7, B57)", () => {
  it("creates the refund with the webhook's key, records it, and tells the buyer once", async () => {
    const { body } = await run({ refunds: [refundRow()] });
    expect(body.refunds_sent).toBe(1);
    const [params, opts] = stripeMock.refunds.create.mock.calls[0];
    expect(params).toMatchObject({ payment_intent: "pi_order1", amount: 4000, metadata: { kind: "declutter_refund", refund_id: REFUND, reason: "seller_no_show", order_id: ORDER } });
    expect(opts).toEqual({ idempotencyKey: `declutter-refund-${REFUND}` });
    expect(rpcs("declutter_refund_executed")[0]?.args).toEqual({ p_refund_id: REFUND, p_stripe_refund_id: "re_new1", p_succeeded: true });
    expect(queuedEmails.filter((e: any) => e.templateName === "declutter_refund")).toHaveLength(1);
    // Through the real _shared/resend.ts queueEmail (the gated queue), not a direct send.
    expect(queueEmail.mock.calls[queueEmail.mock.calls.length - 1]?.[1]).toMatchObject({ templateName: "declutter_refund", subject: "Your Declutter refund" });
  });

  it("a refund Stripe failed is not adopted: the retry is a NEW refund under a new key", async () => {
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_failed1", status: "failed", metadata: { refund_id: REFUND } }] });
    await run({ refunds: [refundRow({ attempts: 2 })] });
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create.mock.calls[0][1]).toEqual({ idempotencyKey: `declutter-refund-${REFUND}-r1` });
  });

  it("reconciles: a refund Stripe already holds for this row is recorded, not created again (keys expire after 24 h)", async () => {
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_old1", status: "succeeded", metadata: { refund_id: REFUND } }] });
    const { body } = await run({ refunds: [refundRow({ attempts: 5 })] });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(body.refunds_reconciled).toBe(1);
    expect(rpcs("declutter_refund_executed")[0]?.args).toMatchObject({ p_stripe_refund_id: "re_old1", p_succeeded: true });
  });

  it("a refund Stripe answers 'failed' is recorded as failed and pages", async () => {
    stripeMock.refunds.create.mockResolvedValue({ id: "re_bad1", status: "failed" });
    const { body } = await run({ refunds: [refundRow()] });
    expect(body.refunds_failed).toBe(1);
    expect(rpcs("declutter_refund_executed")[0]?.args).toMatchObject({ p_succeeded: false });
    expect(slackAlerts.length).toBe(1);
    expect(queuedEmails).toHaveLength(0);
  });

  it("money review 3.6: an orderless refund row runs on the mode its payment was made in (test), never the live key", async () => {
    await run({ refunds: [refundRow({ order_id: null, buyer_id: null, seller_id: null, reason: "order_missing", livemode: false })] });
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.__keys).toContain("sk_test_declutter");
    expect(stripeMock.__keys).not.toContain("sk_live_declutter");
  });

  it("an orderless refund row with no recorded mode is not guessed: nothing moves, a person is told", async () => {
    const { body } = await run({ refunds: [refundRow({ order_id: null, buyer_id: null, seller_id: null, reason: "order_missing", livemode: null })] });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(rpcs("declutter_refund_executed")).toHaveLength(0);
    expect(body.defects).toBe(1);
  });

  // lh-money-escrow re-review should-fix 4: the recorded mode is checked against the parties, and a mismatch moves nothing.
  it("a recorded mode that disagrees with the parties is refused: nothing moves, the run reports it", async () => {
    scenario.reads.test_accounts = { rows: [{ user_id: BUYER }, { user_id: SELLER }] };
    scenario.reads.profiles = { rows: [{ user_id: BUYER, is_seed: true }, { user_id: SELLER, is_seed: true }] };
    const { body } = await run({ refunds: [refundRow({ livemode: true })] });
    expect(stripeMock.refunds.list).not.toHaveBeenCalled();
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(body.refunds_sent).toBe(0);
    expect(body.refunds_failed).toBe(1);
    expect(rpcs("declutter_refund_executed")[0]?.args).toMatchObject({ p_stripe_refund_id: null, p_succeeded: false });
  });

  // Should-fix 3: a row written by SQL has no recorded mode; the order's Checkout Session id prefix names it, and
  // must agree with the parties (fail closed), and with a recorded mode when there is one.
  it("no recorded mode: the order's page decides (a test page with test parties refunds on the test key)", async () => {
    scenario.reads.test_accounts = { rows: [{ user_id: BUYER }, { user_id: SELLER }] };
    scenario.reads.profiles = { rows: [{ user_id: BUYER, is_seed: true }, { user_id: SELLER, is_seed: true }] };
    const { body } = await run({ refunds: [refundRow({ livemode: null, checkout_session_id: "cs_test_dm1" })] });
    expect(body.refunds_sent).toBe(1);
    expect(stripeMock.__keys).toContain("sk_test_declutter");
    expect(stripeMock.__keys).not.toContain("sk_live_declutter");
  });

  it("no recorded mode: a test page whose parties are real is refused, never refunded on the live key", async () => {
    const { body } = await run({ refunds: [refundRow({ livemode: null, checkout_session_id: "cs_test_dm2" })] });
    expect(stripeMock.refunds.list).not.toHaveBeenCalled();
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(body.refunds_failed).toBe(1);
  });

  it("a recorded mode that disagrees with the order's page is refused: nothing moves", async () => {
    const { body } = await run({ refunds: [refundRow({ livemode: true, checkout_session_id: "cs_test_dm3" })] });
    expect(stripeMock.refunds.list).not.toHaveBeenCalled();
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(body.refunds_failed).toBe(1);
  });

  // lh-money-escrow should-fix (a): every run asks the SQL to raise the gave-up alert (ops ledger, once a day per
  // row) and tell the buyer once, even on a run with nothing due; a failed check is a defect, never a 500.
  // lh-money-escrow review of lane J, should-fix 3: a payout over a refunded charge is never "pay it by hand".
  it("a payout that gave up because the charge was refunded says do NOT pay by hand", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_order1", status: "succeeded", latest_charge: { id: "ch_order1", amount_refunded: 500, disputed: false },
    });
    await run({ payouts: [{
      payout_id: "po-last", order_id: ORDER, buyer_id: BUYER, seller_id: SELLER, amount_cents: 4000,
      stripe_account_id: "acct_seller1", payment_intent_id: "pi_order1", attempts: 11,
    }] });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    const page = slackAlerts.find((a: any) => /gave up/.test(a.title)) as any;
    expect(page?.message).toMatch(/Do NOT pay the seller by hand/);
    expect(page?.message).not.toMatch(/\. Pay it by hand\./);
  });

  it("every run asks for the gave-up refunds alert, even with nothing due", async () => {
    scenario.rpc.declutter_refund_gave_up_check = 2;
    const { status, body } = await run();
    expect(status).toBe(200);
    expect((scenario.rpcCalls ?? []).filter((c) => c.name === "declutter_refund_gave_up_check")).toHaveLength(1);
    expect(JSON.stringify(body)).toMatch(/"refunds_gave_up":2/);
  });
  it("a failed gave-up check is reported as a defect and still moves the money that is due", async () => {
    scenario.rpcErrors = { declutter_refund_gave_up_check: { message: "boom" } };
    const { status, body } = await run({ refunds: [{
      refund_id: "rf-g", reason: "superseded", order_id: ORDER, buyer_id: BUYER, seller_id: SELLER,
      payment_intent_id: "pi_order1", refund_cents: 4600, attempts: 0, livemode: true, checkout_session_id: "cs_live_x",
    }] });
    // A defect is answered with status 500, the cron-result convention (_shared/cron-result.ts: the
    // watcher pages on non-2xx); the money that is due still moves in the same run.
    expect(status).toBe(500);
    expect(body.defects).toBeGreaterThan(0);
    expect(JSON.stringify(body.defectReasons)).toMatch(/declutter_refund_gave_up_check failed: boom/);
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(body.refunds_sent).toBe(1);
    expect(rpcs("declutter_refund_executed").map((c) => (c.args as { p_succeeded?: boolean }).p_succeeded)).toEqual([true]);
  });

  it("nothing due: a clean, quiet run", async () => {
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body.defects).toBe(0);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });
});
