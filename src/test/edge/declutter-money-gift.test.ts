/**
 * Q2106 S2 (Declutter gift cards, the payout side): supabase/functions/declutter-money pays EVERY payee of a gift-paid
 * order (the seller, the manager, the Helpr's delivery pay) exactly once, from the platform balance (no
 * source_transaction: the card paid less than the order, or nothing at all), and ONLY while everything the order's own
 * money has sent plus this transfer stays within card charge (less refunds) + gift (giftCovers). A transfer without
 * source_transaction draws on the LIVE platform balance, so the guard is the point of this file. A card-only order is
 * unchanged (every transfer from the order's own charge).
 *
 * Runs the REAL function source through the edge harness; Stripe and Supabase are doubled (Stripe is LIVE on prod:
 * nothing here reaches it). The transfer double is stateful: a transfer created in the run is listed by its group, so
 * the guard sees what the run already sent. The queues' gift_cents column is proven by
 * src/test/pglite/declutterGiftPayoutsDue.pglite.mjs.
 *
 * Registered mutations - each turns this file RED on its own:
 * @mutate supabase/functions/declutter-money/index.ts |  if (sent + o.amountCents > cardNet + o.giftCents) { |  if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |    if (t.reversed \|\| meta.raise_id \|\| meta.tip_id) return sum; |    return sum;
 * @mutate supabase/functions/declutter-money/index.ts |  if (listed.has_more) throw | if (false) throw
 * @mutate supabase/functions/declutter-money/index.ts |  const cardNet = ch ? Math.max(0, Number(ch.amount ?? 0) - Number(ch.amount_refunded ?? 0)) : 0; |  const cardNet = ch ? Number(ch.amount ?? 0) : 0;
 * @mutate supabase/functions/declutter-money/index.ts |            ...(fromPlatform ? {} : { source_transaction: charge as string }), |            ...({}),
 * @mutate supabase/functions/declutter-money/index.ts |            ...(giftCents > 0 ? {} : { source_transaction: charge as string }), |            source_transaction: charge as string,
 * @mutate supabase/functions/declutter-money/index.ts |              ...(part === giftPart ? {} : { source_transaction: charges[i] as string }), |              source_transaction: charges[i] as string,
 * @mutate supabase/functions/declutter-money/index.ts |        if (giftCents > 0) {\n          await giftCovers(stripe, { group: managerGroup, | if (false) {\n          await giftCovers(stripe, { group: managerGroup,
 * @mutate supabase/functions/declutter-money/index.ts |        if (giftPart) {\n          await giftCovers( | if (false) {\n          await giftCovers(
 * @mutate supabase/functions/declutter-money/index.ts |        if (giftCents > 0) {\n          await giftCovers(stripe, { group, | if (false) {\n          await giftCovers(stripe, { group,
 * @mutate supabase/functions/declutter-money/index.ts |    if (h.source_kind !== "declutter_delivery" \|\| !h.transfer_group \|\| (!h.payment_intent_id && !(hGiftCents > 0))) { |    if (h.source_kind !== "declutter_delivery" \|\| !h.transfer_group \|\| !h.payment_intent_id) {
 * Q2106 S3b (the refund side): the gift share is restored FIRST under the row's key, only the card part goes to Stripe,
 * a gift-only row never reaches Stripe, and a failed card refund retries without a second gift credit.
 * @mutate supabase/functions/declutter-money/index.ts |      const cardCents = Math.max(0, r.refund_cents); |      const cardCents = Math.max(0, r.refund_cents) + giftCents;
 * @mutate supabase/functions/declutter-money/index.ts |      if (!(await restoreGift())) continue;\n      // Reconcile first | // Reconcile first
 * @mutate supabase/functions/declutter-money/index.ts |          p_order_id: r.order_id, p_refund_key: `declutter_refund:${r.refund_id}`, p_cents: giftCents, |          p_order_id: r.order_id, p_refund_key: `declutter_refund:${r.refund_id}:${r.attempts}`, p_cents: giftCents,
 * @mutate supabase/functions/declutter-money/index.ts |        if (outcome !== "restored" && outcome !== "already_restored") { |        if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |      if (cardCents <= 0 \|\| !r.payment_intent_id) { |      if (!r.payment_intent_id) {
 * @mutate supabase/functions/declutter-money/index.ts |        if (gErr) throw new Error(`gift restore failed: ${gErr.message}`); |        if (gErr) return true;
 * @mutate supabase/functions/declutter-money/index.ts |    const giftLine = giftCents > 0 ? | const giftLine = false ?
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";
import { resetEmailMocks, queuedEmails } from "./mocks/email";

const BUYER = "0000000d-0000-4000-8000-000000000001";
const SELLER = "0000000d-0000-4000-8000-000000000002";
const MANAGER = "0000000d-0000-4000-8000-000000000003";
const HELPR = "0000000d-0000-4000-8000-000000000004";
const ORDER = "0000000d-0000-4000-8000-0000000000aa";
const PAYOUT = "0000000d-0000-4000-8000-0000000000cc";
const MPAYOUT = "0000000d-0000-4000-8000-0000000000dd";
const HPAYOUT = "0000000d-0000-4000-8000-0000000000ee";
const TASK = "0000000d-0000-4000-8000-0000000000ff";
const GROUP = `declutter_order_${ORDER}`;

// One order: 4000 in all (gift + card). Seller 2800 + manager 400 + Helpr 640 = 3840 (the platform keeps 160).
const sellerRow = (o: Record<string, unknown> = {}) => ({
  payout_id: PAYOUT, order_id: ORDER, buyer_id: BUYER, seller_id: SELLER, amount_cents: 2800,
  stripe_account_id: "acct_seller", payment_intent_id: "pi_order1", attempts: 0, refunds_recorded_cents: 0, gift_cents: 0, ...o,
});
const managerRow = (o: Record<string, unknown> = {}) => ({
  payout_id: MPAYOUT, order_id: ORDER, buyer_id: BUYER, seller_id: SELLER, manager_id: MANAGER, amount_cents: 400,
  stripe_account_id: "acct_manager", payment_intent_id: "pi_order1", attempts: 0, refunds_recorded_cents: 0, gift_cents: 0, ...o,
});
const helprRow = (o: Record<string, unknown> = {}) => ({
  payout_id: HPAYOUT, task_id: TASK, source_kind: "declutter_delivery", source_id: ORDER, helpr_id: HELPR,
  customer_id: BUYER, pickup_contact_id: SELLER, amount_cents: 640, stripe_account_id: "acct_helpr",
  payment_intent_id: "pi_order1", transfer_group: GROUP, refunds_recorded_cents: 0, attempts: 0, gift_cents: 0, ...o,
});
const allThree = (o: Record<string, unknown>) => ({ payouts: [sellerRow(o)], managerPayouts: [managerRow(o)], helprPayouts: [helprRow(o)] });
const rpcs = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);

type Tr = { id: string; amount: number; amount_reversed: number; reversed: boolean; transfer_group: string; destination: string; metadata: Record<string, string> };
let ledger: Tr[] = [];
const charge = (amount: number, refunded = 0) =>
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_order1", status: "succeeded", latest_charge: { id: "ch_order1", amount, amount_refunded: refunded, disputed: false },
  });
const created = () => stripeMock.transfers.create.mock.calls.map(([params, opts]) => ({ params, opts }));
const total = () => created().reduce((s, c) => s + Number(c.params.amount), 0);

async function run(opts: { payouts?: unknown[]; managerPayouts?: unknown[]; helprPayouts?: unknown[]; refunds?: unknown[] } = {}) {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_declutter",
    STRIPE_TEST_SECRET_KEY: "sk_test_declutter",
  });
  scenario.rpc.declutter_payouts_due = opts.payouts ?? [];
  scenario.rpc.declutter_manager_payouts_due = opts.managerPayouts ?? [];
  scenario.rpc.helpr_task_payouts_due = opts.helprPayouts ?? [];
  scenario.rpc.declutter_refunds_due = opts.refunds ?? [];
  scenario.rpc.declutter_delivery_refunds_due = [];
  scenario.rpc.declutter_payout_executed = (a: { p_succeeded?: boolean }) => (a?.p_succeeded ? "succeeded" : "failed");
  scenario.rpc.declutter_manager_payout_executed = (a: { p_succeeded?: boolean }) => (a?.p_succeeded ? "succeeded" : "failed");
  scenario.rpc.helpr_task_payout_executed = (a: { p_succeeded?: boolean }) => (a?.p_succeeded ? "succeeded" : "failed");
  const fn = await loadEdgeFunction("declutter-money");
  const res = await fn.fetch(fn.request({ url: "https://edge.test/declutter-money", headers: { Authorization: "Bearer service-key" }, body: {} }));
  const text = await res.text();
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
  scenario.reads.declutter_refunds = { rows: [] };
  scenario.reads.profiles = { rows: [{ user_id: BUYER, email: "buyer@example.test" }] };
  ledger = [];
  charge(4000);
  let n = 0;
  stripeMock.transfers.create.mockImplementation(async (p: Record<string, any>) => {
    const t: Tr = { id: `tr_${++n}`, amount: p.amount, amount_reversed: 0, reversed: false, transfer_group: p.transfer_group, destination: p.destination, metadata: p.metadata };
    ledger.push(t);
    return t;
  });
  stripeMock.transfers.list.mockImplementation(async (q: { transfer_group: string }) => ({
    data: ledger.filter((t) => t.transfer_group === q.transfer_group), has_more: false,
  }));
  stripeMock.accounts.retrieve.mockImplementation(async (id: string) => ({ id, capabilities: { transfers: "active" }, payouts_enabled: true }));
});

describe("declutter-money: a gift-paid order's payouts (Q2106 S2)", () => {
  it("card-only order (gift 0): every payee from the order's own charge, unchanged", async () => {
    const { status } = await run(allThree({}));
    expect(status).toBe(200);
    expect(created()).toHaveLength(3);
    for (const c of created()) expect(c.params.source_transaction).toBe("ch_order1");
  });

  it("mixed order (card 1500 + gift 2500): each payee paid exactly once, from the platform balance, total within card + gift", async () => {
    charge(1500);
    const { status, body } = await run(allThree({ gift_cents: 2500 }));
    expect(status).toBe(200);
    expect(created().map((c) => c.params.destination).sort()).toEqual(["acct_helpr", "acct_manager", "acct_seller"]);
    for (const c of created()) expect(c.params).not.toHaveProperty("source_transaction");
    expect(new Set(created().map((c) => c.opts?.idempotencyKey)).size).toBe(3);
    expect(total()).toBe(3840);
    expect(total()).toBeLessThanOrEqual(1500 + 2500);
    expect(body.payouts_sent).toBe(1);
    expect(body.manager_payouts_sent).toBe(1);
    // The card's charge is still read and must be whole.
    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalled();
  });

  it("gift-only order (no PaymentIntent): all three are paid, nothing reads a charge, total within the gift", async () => {
    const { status } = await run(allThree({ gift_cents: 4000, payment_intent_id: null }));
    expect(status).toBe(200);
    expect(created()).toHaveLength(3);
    for (const c of created()) expect(c.params).not.toHaveProperty("source_transaction");
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(total()).toBe(3840);
    expect(rpcs("payout_hold_for_review")).toHaveLength(0);
  });

  it("a second run sends nothing more: each payee is reconciled, never paid twice", async () => {
    await run(allThree({ gift_cents: 4000, payment_intent_id: null }));
    const first = created().length;
    await run(allThree({ gift_cents: 4000, payment_intent_id: null, attempts: 1 }));
    expect(created().length).toBe(first);
    expect(ledger.reduce((s, t) => s + t.amount, 0)).toBe(3840);
  });

  it("the guard: a payee the order's money no longer covers is HELD (data defect), never sent from the platform", async () => {
    // Gift-only 3000: seller 2800 fits; the manager's 400 would make 3200 > 3000.
    const { status } = await run({ payouts: [sellerRow({ gift_cents: 3000, payment_intent_id: null })], managerPayouts: [managerRow({ gift_cents: 3000, payment_intent_id: null })] });
    expect(status).toBe(500);
    expect(created().map((c) => c.params.destination)).toEqual(["acct_seller"]);
    expect(total()).toBeLessThanOrEqual(3000);
    expect(rpcs("payout_mark_sending").map((c) => (c.args as { p_kind: string }).p_kind)).toEqual(["declutter"]);
    expect(rpcs("declutter_manager_payout_executed")).toHaveLength(0);
  });

  it("the guard counts what was sent before this run (another payee's transfer in the group)", async () => {
    ledger.push({ id: "tr_old", amount: 2800, amount_reversed: 0, reversed: false, transfer_group: GROUP, destination: "acct_seller", metadata: { kind: "declutter_payout", payout_id: PAYOUT } });
    await run({ helprPayouts: [helprRow({ gift_cents: 3000, payment_intent_id: null })] });
    expect(created()).toHaveLength(0);
    expect(rpcs("helpr_task_payout_executed")).toHaveLength(0);
  });

  it("the guard does not count a raise's or a tip's transfer (funded by its own charge), nor a reversed one", async () => {
    ledger.push(
      { id: "tr_raise", amount: 2000, amount_reversed: 0, reversed: false, transfer_group: GROUP, destination: "acct_helpr", metadata: { kind: "helpr_task_payout", raise_id: "r1" } },
      { id: "tr_tip", amount: 900, amount_reversed: 0, reversed: false, transfer_group: GROUP, destination: "acct_helpr", metadata: { kind: "helpr_task_payout", tip_id: "t1" } },
      { id: "tr_rev", amount: 3000, amount_reversed: 3000, reversed: true, transfer_group: GROUP, destination: "acct_seller", metadata: { kind: "declutter_payout", payout_id: "old" } },
    );
    await run({ payouts: [sellerRow({ gift_cents: 3000, payment_intent_id: null })] });
    expect(created().map((c) => c.params.amount)).toEqual([2800]);
  });

  it("the card's refund lowers what the order covers", async () => {
    // Card 1500 with 1000 refunded (recorded): card + gift = 500 + 2500 = 3000 < seller 2800 + manager 400.
    charge(1500, 1000);
    await run({ payouts: [sellerRow({ gift_cents: 2500, refunds_recorded_cents: 1000 })], managerPayouts: [managerRow({ gift_cents: 2500, refunds_recorded_cents: 1000 })] });
    expect(created().map((c) => c.params.destination)).toEqual(["acct_seller"]);
    expect(total()).toBeLessThanOrEqual(500 + 2500);
  });

  it("a mixed order whose card charge is not whole (an unrecorded refund) sends nothing from the platform", async () => {
    charge(1500, 1500);
    await run(allThree({ gift_cents: 2500 }));
    expect(created()).toHaveLength(0);
  });

  it("an unbounded transfer list (more than 100) is not summed and sends nothing", async () => {
    stripeMock.transfers.list.mockImplementation(async () => ({ data: [], has_more: true }));
    await run({ payouts: [sellerRow({ gift_cents: 4000, payment_intent_id: null })] });
    expect(created()).toHaveLength(0);
  });

  it("a raise on a gift-paid delivery still goes from the raise's own charge", async () => {
    stripeMock.paymentIntents.retrieve.mockImplementation(async (id: string) => ({
      id, status: "succeeded", latest_charge: { id: id === "pi_raise1" ? "ch_raise1" : "ch_order1", amount: 4000, amount_refunded: 0, disputed: false },
    }));
    await run({ helprPayouts: [helprRow({
      gift_cents: 4000, payment_intent_id: null, amount_cents: 1140, raised_cents: 500,
      raise_parts: [{ raise_id: "r1", payment_intent_id: "pi_raise1", cents: 500 }],
    })] });
    const byAmount = Object.fromEntries(created().map((c) => [c.params.amount, c.params.source_transaction ?? null]));
    expect(byAmount).toEqual({ 640: null, 500: "ch_raise1" });
  });
});

describe("declutter-money: a gift-paid order's refunds (Q2106 S3b)", () => {
  const REFUND = "0000000d-0000-4000-8000-0000000000bb";
  const refundRow = (o: Record<string, unknown> = {}) => ({
    refund_id: REFUND, reason: "seller_no_show", order_id: ORDER, buyer_id: BUYER, seller_id: SELLER,
    // refund_cents is the queue's CARD part (declutter_refunds_due: r.refund_cents - r.gift_refund_cents).
    payment_intent_id: "pi_order1", refund_cents: 4000, gift_refund_cents: 0, attempts: 0, livemode: true,
    checkout_session_id: "cs_live_1", ...o,
  });
  // A stateful gift ledger: restore_gift_card_for_declutter_order is idempotent by key, as the SQL is
  // (PGlite: declutterGiftCards.pglite.mjs).
  let restored: Map<string, number>;
  beforeEach(() => {
    restored = new Map();
    scenario.rpc.restore_gift_card_for_declutter_order = (a: { p_refund_key: string; p_cents: number }) => {
      if (restored.has(a.p_refund_key)) return { outcome: "already_restored", restore_cents: restored.get(a.p_refund_key) };
      restored.set(a.p_refund_key, a.p_cents);
      return { outcome: "restored", restore_cents: a.p_cents };
    };
    scenario.rpc.declutter_refund_executed = (a: { p_succeeded?: boolean }) => (a?.p_succeeded ? "succeeded" : "failed");
    stripeMock.refunds.list.mockResolvedValue({ data: [] });
    stripeMock.refunds.create.mockResolvedValue({ id: "re_card1", status: "succeeded" });
  });
  const refundEmails = () => queuedEmails.filter((e: any) => e.templateName === "declutter_refund") as Array<Record<string, string>>;

  it("card-only row: the whole amount to the card, no gift restore (unchanged)", async () => {
    const { body } = await run({ refunds: [refundRow()] });
    expect(body.refunds_sent).toBe(1);
    expect(stripeMock.refunds.create.mock.calls[0][0]).toMatchObject({ amount: 4000 });
    expect(rpcs("restore_gift_card_for_declutter_order")).toHaveLength(0);
  });

  it("mixed row (4000 = 1500 card + 2500 gift): the gift is restored first under the row's key, then only 1500 to the card", async () => {
    const { body } = await run({ refunds: [refundRow({ refund_cents: 1500, gift_refund_cents: 2500 })] });
    expect(body.refunds_sent).toBe(1);
    expect(rpcs("restore_gift_card_for_declutter_order").map((c) => c.args)).toEqual([
      { p_order_id: ORDER, p_refund_key: `declutter_refund:${REFUND}`, p_cents: 2500 },
    ]);
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create.mock.calls[0][0]).toMatchObject({ payment_intent: "pi_order1", amount: 1500 });
    const order = (scenario.rpcCalls ?? []).map((c) => c.name).filter((n) => n === "restore_gift_card_for_declutter_order" || n === "declutter_refund_executed");
    expect(order).toEqual(["restore_gift_card_for_declutter_order", "declutter_refund_executed"]);
    expect(rpcs("declutter_refund_executed")[0]?.args).toEqual({ p_refund_id: REFUND, p_stripe_refund_id: "re_card1", p_succeeded: true });
    const mail = refundEmails();
    expect(mail).toHaveLength(1);
    expect(mail[0].text).toContain("$15.00 is on its way back to your card");
    expect(mail[0].text).toContain("$25.00 is back on your gift card balance");
  });

  it("gift-only row (no payment intent): restored, executed with no Stripe ref, Stripe never called", async () => {
    const { body } = await run({ refunds: [refundRow({ payment_intent_id: null, refund_cents: 0, gift_refund_cents: 4000, livemode: null, checkout_session_id: null })] });
    expect(body.refunds_sent).toBe(1);
    expect(stripeMock.refunds.list).not.toHaveBeenCalled();
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(rpcs("restore_gift_card_for_declutter_order")[0]?.args).toMatchObject({ p_cents: 4000 });
    expect(rpcs("declutter_refund_executed")[0]?.args).toEqual({ p_refund_id: REFUND, p_stripe_refund_id: null, p_succeeded: true });
    const mail = refundEmails();
    expect(mail).toHaveLength(1);
    expect(mail[0].text).toContain("$40.00 is back on your gift card balance");
    expect(mail[0].text).not.toContain("your card. Card refunds");
  });

  it("a row on a card payment whose whole refund is gift (card part 0): restored, never sent to Stripe", async () => {
    const { body } = await run({ refunds: [refundRow({ refund_cents: 0, gift_refund_cents: 1200 })] });
    expect(body.refunds_sent).toBe(1);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(rpcs("declutter_refund_executed")[0]?.args).toEqual({ p_refund_id: REFUND, p_stripe_refund_id: null, p_succeeded: true });
  });

  it("LEAD RULE: gift restored, card refund fails -> row failed (retried), never done; the retry reuses the key and the gift is restored once", async () => {
    stripeMock.refunds.create.mockRejectedValueOnce(new Error("card_declined"));
    const first = await run({ refunds: [refundRow({ refund_cents: 1500, gift_refund_cents: 2500 })] });
    expect(first.body.refunds_failed).toBe(1);
    expect(rpcs("declutter_refund_executed").map((c) => c.args)).toEqual([{ p_refund_id: REFUND, p_stripe_refund_id: null, p_succeeded: false }]);
    expect(refundEmails()).toHaveLength(0);
    expect([...restored.entries()]).toEqual([[`declutter_refund:${REFUND}`, 2500]]);

    // The retry (the row is offered again with attempts 1): same key, already_restored, no second credit.
    resetSupabaseMock();
    scenario.reads.test_accounts = { rows: [] };
    scenario.reads.ban_settlement_queue = { rows: [] };
    scenario.reads.payout_holds = { rows: [] };
    scenario.reads.declutter_refunds = { rows: [] };
    scenario.reads.profiles = { rows: [{ user_id: BUYER, email: "buyer@example.test" }] };
    scenario.rpc.restore_gift_card_for_declutter_order = (a: { p_refund_key: string; p_cents: number }) =>
      restored.has(a.p_refund_key) ? { outcome: "already_restored", restore_cents: restored.get(a.p_refund_key) }
        : (restored.set(a.p_refund_key, a.p_cents), { outcome: "restored", restore_cents: a.p_cents });
    scenario.rpc.declutter_refund_executed = (a: { p_succeeded?: boolean }) => (a?.p_succeeded ? "succeeded" : "failed");
    stripeMock.refunds.create.mockResolvedValue({ id: "re_card2", status: "succeeded" });
    const second = await run({ refunds: [refundRow({ refund_cents: 1500, gift_refund_cents: 2500, attempts: 1 })] });
    expect(second.body.refunds_sent).toBe(1);
    expect(rpcs("restore_gift_card_for_declutter_order")[0]?.args).toMatchObject({ p_refund_key: `declutter_refund:${REFUND}` });
    expect(restored.size).toBe(1);
    expect(stripeMock.refunds.create.mock.calls.at(-1)?.[0]).toMatchObject({ amount: 1500 });
    expect(rpcs("declutter_refund_executed").map((c) => c.args)).toEqual([{ p_refund_id: REFUND, p_stripe_refund_id: "re_card2", p_succeeded: true }]);
  });

  it("the gift restore errors -> no card refund, the row is recorded failed and retried", async () => {
    scenario.rpcErrors = { restore_gift_card_for_declutter_order: { message: "boom" } };
    const { body } = await run({ refunds: [refundRow({ refund_cents: 1500, gift_refund_cents: 2500 })] });
    expect(body.refunds_failed).toBe(1);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(rpcs("declutter_refund_executed")[0]?.args).toMatchObject({ p_succeeded: false });
  });

  it("the gift cannot be restored (no_credit) -> nothing to the card, held for a person, never marked done", async () => {
    scenario.rpc.restore_gift_card_for_declutter_order = { outcome: "no_credit" };
    await run({ refunds: [refundRow({ refund_cents: 1500, gift_refund_cents: 2500 })] });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(rpcs("declutter_refund_executed")).toHaveLength(0);
  });
});
