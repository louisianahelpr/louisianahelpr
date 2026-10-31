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
 * @mutate supabase/functions/declutter-money/index.ts |    if (hold.kind === "held") {\n      out.held++;\n      await skipRow("declutter", | if (false) {\n      out.held++;\n      await skipRow("declutter",
 * @mutate supabase/functions/declutter-money/index.ts |     if ((p.seller_id && review.users.has(p.seller_id)) \|\| (p.buyer_id && review.users.has(p.buyer_id))) { |     if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |   const refused = verifyCronSecret(req);\n  if (refused) return refused; |
 * @mutate supabase/functions/declutter-money/index.ts |             destination: p.stripe_account_id as string,\n            transfer_group: group, |             destination: p.stripe_account_id as string,
 * @mutate supabase/functions/declutter-money/index.ts |   if (p.attempts + 1 < 12) return; |   return;
 * @mutate supabase/functions/declutter-money/index.ts |   if (gaveUp.error) defects.record(`declutter_refund_gave_up_check failed: ${gaveUp.error.message}`); |   if (gaveUp.error) void 0;
 * @mutate supabase/functions/declutter-money/index.ts |   if (gaveUp.error) defects.record(`declutter_refund_gave_up_check failed: ${gaveUp.error.message}`); |   if (gaveUp.error) return cronError(FN, `declutter_refund_gave_up_check failed: ${gaveUp.error.message}`);
 * @mutate supabase/functions/declutter-money/index.ts |       defects.record(`payout ${p.payout_id}: ${msg}`.slice(0, 200)); |
 * @mutate supabase/functions/declutter-money/index.ts |       const existing = mine.find((x) => tookIt(x.status)); |       const existing = mine[0];
 * @mutate supabase/functions/declutter-money/index.ts |   if (pi.status !== "succeeded" \|\| !ch \|\| ch.amount_refunded > known \|\| ch.disputed) { |   if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |   const known = Math.max(0, Number(refundsRecordedCents ?? 0)); |   const known = Number.MAX_SAFE_INTEGER;
 * @mutate supabase/functions/declutter-money/index.ts |              idempotencyKey: part.raiseId ? `helpr-task-payout-${h.payout_id}-raise-${part.raiseId}` |              noKey: part.raiseId ? `helpr-task-payout-${h.payout_id}-raise-${part.raiseId}`
 * @mutate supabase/functions/declutter-money/index.ts |        return meta.kind === "helpr_task_payout" && meta.payout_id === h.payout_id && !t.reversed |        return false
 * @mutate supabase/functions/declutter-money/index.ts |     const hold = await checkPayoutHold(admin, h.helpr_id); |     const hold = { kind: "ok" } as Awaited<ReturnType<typeof checkPayoutHold>>;
 * @mutate supabase/functions/declutter-money/index.ts |       const adopted = mine.find((x) => tookIt(x.status)); |       const adopted = undefined;
 * @mutate supabase/functions/declutter-money/index.ts |       return { stripe: modes.clientFor(mode) }; |       return await modes.clientForParties([r.buyer_id, r.seller_id]);
 * @mutate supabase/functions/declutter-money/index.ts |     if (!hasParties) return null; |
 * @mutate supabase/functions/declutter-money/index.ts |         if (byParties !== mode) throw new Error(`refund row says ${mode} but its parties are ${byParties}`); |
 * @mutate supabase/functions/declutter-money/index.ts |     const byPage = sessionIdMode(r.checkout_session_id); |     const byPage = null;
 * @mutate supabase/functions/declutter-money/index.ts |   const gaveUp = await admin.rpc("declutter_refund_gave_up_check", {}); |   const gaveUp = { error: null, data: 0 };
 * @mutate supabase/functions/declutter-money/index.ts |     message: /charge is not whole/.test(why) |     message: false
 * @mutate supabase/functions/declutter-money/index.ts |     if (recorded && byPage && recorded !== byPage) throw new Error(`refund row says ${recorded} but its order's page is ${byPage}`); |
 * @mutate supabase/functions/declutter-money/index.ts |         if (!(await payeeReadyNow(stripe, mode, "declutter", p.payout_id, p.seller_id, p.stripe_account_id as string, p.amount_cents))) continue; |
 * @mutate supabase/functions/declutter-money/index.ts |         if (!(await payeeReadyNow(stripe, mode, "helpr_task", h.payout_id, h.helpr_id, h.stripe_account_id as string, h.amount_cents))) continue; |
 * @mutate supabase/functions/_shared/connectReadiness.ts |   return account?.capabilities?.transfers === "active"; |   return !!account;
 * @mutate supabase/functions/_shared/connectReadiness.ts |       if (isUnusableConnectAccountError(e)) return { kind: "unusable", reason: `account_unusable: ${message}`.slice(0, 200) }; |       throw e;
 * @mutate supabase/functions/_shared/connectReadiness.ts |  return cache.get(cacheKey(mode, accountId)); |  return undefined;
 * @mutate supabase/functions/declutter-money/index.ts |      await skipRow(kind, payoutId, payeeId, amountCents, 15, "transient", r.message); |
 * @mutate supabase/functions/declutter-money/index.ts |    if (delivered === false) return; |    if (false) return;
 * @mutate supabase/functions/declutter-money/index.ts |    if (w?.page_due !== true) return; |    return;
 * @mutate supabase/functions/declutter-money/index.ts |      await skipRow("declutter", p.payout_id, p.seller_id, p.amount_cents, 60, "held", "the payee is on an admin payout hold"); |
 * @mutate supabase/functions/declutter-money/index.ts |      else out.payouts_sent++;\n      await clearWait("declutter", p.payout_id); |      else out.payouts_sent++;
 * @mutate supabase/functions/declutter-money/index.ts |    if (r.kind === "not_ready" && stripe && (await resyncGate(stripe, payeeId, r.account)) === "banned") { |    if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |    if ((error as { code?: string }).code === "PGRST202") {\n      if (!waitRpcMissing) defects.record(`${name}: | if (false) {\n      if (!waitRpcMissing) defects.record(`${name}:
 * @mutate supabase/functions/declutter-money/index.ts |  const maybeSent_declutter = (x: PayoutDue) => Number(x.attempts ?? 0) > 0 \|\| sellerMarked.has(x.payout_id); |  const maybeSent_declutter = (x: PayoutDue) => Number(x.attempts ?? 0) > 0;
 * @mutate supabase/functions/declutter-money/index.ts |        if (!(await markSending("declutter", p.payout_id, p.seller_id, p.amount_cents))) continue; |
 * @mutate supabase/functions/declutter-money/index.ts |        await skipRow("declutter_refund", r.refund_id, r.buyer_id, r.refund_cents, 1440, "data_defect", "no order and no recorded Stripe mode"); |
 * @mutate supabase/functions/_shared/connectReadiness.ts |    : transfers === "pending" ? "under_review" : "setup_unfinished"; |    : "setup_unfinished";
 * @mutate supabase/functions/declutter-money/index.ts |        if (await unpayableNow("declutter", p.payout_id, p.seller_id, p.stripe_account_id, p.amount_cents, mode)) continue; |
 * @mutate supabase/functions/declutter-money/index.ts |      if (beforeSend && transientBeforeSend(e)) {\n        // Nothing was sent: later, without using a try.\n        out.payout_retry_later++;\n        console.log(JSON.stringify({ event: "payout_deferred_transient", kind: "declutter" |      if (false) {\n        // Nothing was sent: later, without using a try.\n        out.payout_retry_later++;\n        console.log(JSON.stringify({ event: "payout_deferred_transient", kind: "declutter"
 * @mutate supabase/functions/declutter-money/index.ts |      if (p.attempts + 1 >= 12) await clearWait("declutter", p.payout_id); |
 * @mutate supabase/functions/declutter-money/index.ts |  await waitRpc("payout_payee_waits_prune", {}); |
 * @mutate supabase/functions/declutter-money/index.ts |  await waitRpc("payout_held_check", {}); |
 * @mutate supabase/functions/declutter-money/index.ts |      if (!r.accountSpecific) { |      if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |      kind: "payout_wait", severity: "warning", seed: w.payee_seed === true, oncePerDayKey: `payout-wait-${kind}-${payoutId}-${category}`, |      kind: "payout_wait", severity: "warning", seed: false, oncePerDayKey: `payout-wait-${kind}-${payoutId}-${category}`,
 * @mutate supabase/functions/declutter-money/index.ts |      if (refused.size >= 3 && stripe && !probedModes.has(mode)) { |      if (refused.size >= 1 && stripe && !probedModes.has(mode)) {
 * @mutate supabase/functions/declutter-money/index.ts |      else await skipRow(kind, payoutId, null, amountCents, 1440, "payee_deleted", "payee account deleted: money held, decide by hand"); |      else await skipRow(kind, payoutId, null, amountCents, 60, "no_account", "x");
 * @mutate supabase/functions/declutter-money/index.ts |        await skipRow("declutter", p.payout_id, p.seller_id, p.amount_cents, 15, "record_failed", `transfer ${transfer.id} not recorded`); |
 * @mutate supabase/functions/declutter-money/index.ts |    if (stuck) await waitRpc("payout_hold_for_review", { p_kind: kind, p_id: payoutId, p_category: category, p_reason: reason }); |    if (false) await waitRpc("payout_hold_for_review", { p_kind: kind, p_id: payoutId, p_category: category, p_reason: reason });
 * @mutate supabase/functions/declutter-money/index.ts |        if (!(await stillPayableNow("declutter", p.payout_id, p.seller_id, p.amount_cents))) continue; |
 * @mutate supabase/functions/declutter-money/index.ts |    if (h.source_kind !== "declutter_delivery" \|\| !h.transfer_group \|\| !h.payment_intent_id) { |    if (!h.transfer_group) {
 * @mutate supabase/functions/declutter-money/index.ts |      await skipRow("declutter_refund", r.refund_id, r.buyer_id, r.refund_cents, 60, "ban_review", "a party is under ban review"); |      await deferRow("declutter_refund", r.refund_id, 60);
 * @mutate supabase/functions/_shared/connectReadiness.ts |      if (status === 403 \|\| status === 401 \|\| code === "account_invalid" \|\| /does not have access/i.test(message)) { |      if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |      kind: "payout_wait", severity: "warning", | kind: "custom", severity: "warning",
 * @mutate supabase/functions/declutter-money/index.ts |    if ((category === "mixed_parties" \|\| category === "data_defect") && maybeSentRows.has(payoutId)) { |    if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |    if (suspendedUntil !== null && suspendedUntil > Date.now()) { |    if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |        if (keyBroken) { |        if (true) {
 * @mutate supabase/functions/_shared/connectReadiness.ts |      if (/does not have access to account/i.test(message) && /does not exist/i.test(message)) { |      if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |        await skipRow("declutter_refund", r.refund_id, r.buyer_id, r.refund_cents, 15, "record_failed", `refund ${refund.id} not recorded`); |
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";
import { emailRenders, queueEmail, queuedEmails, resetEmailMocks } from "./mocks/email";

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
const HELPR = "0000000b-0000-4000-8000-000000000003";
const TASK = "0000000b-0000-4000-8000-0000000000ee";
const HPAYOUT = "0000000b-0000-4000-8000-0000000000ff";
const DREFUND = "0000000b-0000-4000-8000-0000000000ab";
const helprRow = (over: Record<string, unknown> = {}) => ({
  payout_id: HPAYOUT, task_id: TASK, source_kind: "declutter_delivery", source_id: ORDER, helpr_id: HELPR,
  customer_id: BUYER, pickup_contact_id: SELLER, amount_cents: 1640, stripe_account_id: "acct_helpr1",
  payment_intent_id: "pi_order1", transfer_group: `declutter_order_${ORDER}`, refunds_recorded_cents: 0, attempts: 0, ...over,
});
const deliveryRefundRow = (over: Record<string, unknown> = {}) => ({
  delivery_refund_id: DREFUND, reason: "no_helpr", order_id: ORDER, buyer_id: BUYER, seller_id: SELLER,
  payment_intent_id: "pi_order1", refund_cents: 2400, attempts: 0, checkout_session_id: "cs_live_abc", ...over,
});
const rpcs = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);

async function run(opts: { payouts?: unknown[]; refunds?: unknown[]; helprPayouts?: unknown[]; deliveryRefunds?: unknown[]; bearer?: string } = {}) {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_declutter",
    STRIPE_TEST_SECRET_KEY: "sk_test_declutter",
  });
  scenario.rpc.declutter_payouts_due = opts.payouts ?? [];
  scenario.rpc.declutter_refunds_due = opts.refunds ?? [];
  scenario.rpc.helpr_task_payouts_due = opts.helprPayouts ?? [];
  scenario.rpc.declutter_delivery_refunds_due = opts.deliveryRefunds ?? [];
  scenario.rpc.helpr_task_payout_executed = (a: { p_succeeded?: boolean }) => (a?.p_succeeded ? "succeeded" : "failed");
  scenario.rpc.declutter_delivery_refund_executed = (a: { p_succeeded?: boolean }) => (a?.p_succeeded ? "succeeded" : "failed");
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
  stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_seller1", capabilities: { transfers: "active" }, payouts_enabled: true });
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

  // Deep audit #57: "Your payout is on its way", only once the transfer is recorded, with the amount sent and no fee words.
  // @mutate supabase/functions/declutter-money/index.ts |      await emailSeller(admin, p.seller_id, p.order_id, "payout_sent", p.amount_cents, |      if (false) await emailSeller(admin, p.seller_id, p.order_id, "payout_sent", p.amount_cents,
  // @mutate supabase/functions/_shared/declutterSellerEmail.ts |     subject: "Your payout is on its way", |     subject: "Payout update",
  it("the seller is emailed \"Your payout is on its way\" with the amount sent, once the transfer is recorded", async () => {
    scenario.rpc.declutter_order_items_named = '"Lamp"';
    scenario.reads.profiles = { rows: [{ user_id: BUYER, email: "buyer@example.test" }],
      eqOverrides: [{ column: "user_id", value: SELLER, result: { rows: [{ user_id: SELLER, email: "seller@example.test", ban_status: null, auto_suspended_until: null }] } }] };
    const { status } = await run({ payouts: [payoutRow()] });
    expect(status).toBe(200);
    const sent = queuedEmails.filter((e: any) => e.templateName === "declutter_payout_sent") as Array<Record<string, string>>;
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("seller@example.test");
    expect(sent[0].subject).toBe("Your payout is on its way");
    // AUD31-35: rendered from the branded notice email (the mock records the element).
    const r = (emailRenders as Array<{ type: { name: string }; props: Record<string, string> }>).find((e) => e.props.title === "Your payout is on its way");
    expect(r?.type.name).toBe("NotificationEmail");
    expect(r?.props.message).toMatch(/^Your \$38\.50 payout for "Lamp" was sent\. It lands in your bank on your usual payout schedule\./);
    expect(JSON.stringify({ sent: sent[0], message: r?.props.message })).not.toMatch(/fee|%/i);
  });
  it("a reconciled payout (sent earlier, recorded now) is emailed once; a failed or unrecorded one is not emailed", async () => {
    scenario.reads.profiles = { rows: [{ user_id: BUYER, email: "buyer@example.test" }],
      eqOverrides: [{ column: "user_id", value: SELLER, result: { rows: [{ user_id: SELLER, email: "seller@example.test", ban_status: null, auto_suspended_until: null }] } }] };
    stripeMock.transfers.list.mockResolvedValue({ data: [{ id: "tr_old1", destination: "acct_seller1", reversed: false, metadata: { kind: "declutter_payout", payout_id: PAYOUT } }] });
    await run({ payouts: [payoutRow({ attempts: 3 })] });
    expect(queuedEmails.filter((e: any) => e.templateName === "declutter_payout_sent")).toHaveLength(1);

    resetEmailMocks();
    stripeMock.transfers.list.mockResolvedValue({ data: [] });
    stripeMock.transfers.create.mockRejectedValue(new Error("insufficient funds"));
    await run({ payouts: [payoutRow()] });
    expect(queuedEmails.filter((e: any) => e.templateName === "declutter_payout_sent")).toHaveLength(0);

    resetEmailMocks();
    stripeMock.transfers.create.mockResolvedValue({ id: "tr_new1", destination: "acct_seller1" });
    scenario.rpcErrors = { declutter_payout_executed: { message: "db down", code: "57P01" } };
    await run({ payouts: [payoutRow()] });
    expect(queuedEmails.filter((e: any) => e.templateName === "declutter_payout_sent")).toHaveLength(0);
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

  it("a seller who started payout setup but has not finished it is skipped WITHOUT using up a try (declutter-proof 2026-10-19)", async () => {
    // Prod, measured: eli's test account acct_1URzEe3CI9eFJjCC, transfers "inactive". The old code sent the
    // transfer, Stripe refused it, and each refusal used one of the 12 tries; the 12th gave the row up.
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_seller1", capabilities: { transfers: "inactive" } });
    const { status, body } = await run({ payouts: [payoutRow()] });
    expect(status).toBe(200);
    expect(body.payout_account_not_ready).toBe(1);
    expect(body.payouts_failed).toBe(0);
    expect(stripeMock.accounts.retrieve).toHaveBeenCalledWith("acct_seller1");
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(rpcs("declutter_payout_executed")).toHaveLength(0);
    expect(slackAlerts).toHaveLength(0);
    // Pushed back (no starvation: it leaves the front of the queue) and the wait recorded.
    expect(rpcs("payout_defer")[0]?.args).toEqual({ p_kind: "declutter", p_payout_id: PAYOUT, p_minutes: 60 });
    expect(rpcs("payout_payee_wait_seen")[0]?.args).toMatchObject({ p_kind: "declutter", p_payout_id: PAYOUT, p_payee: SELLER, p_category: "setup_unfinished" });
  });

  it("transferReady is the TRANSFER rule: transfers active is enough even with bank payouts paused (payouts_enabled is the separate payout gate)", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_seller1", capabilities: { transfers: "active" }, payouts_enabled: false });
    const { body } = await run({ payouts: [payoutRow()] });
    expect(body.payout_account_not_ready).toBe(0);
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
  });

  it("an account read that throws a passing error uses NO try: deferred 15 minutes, retried later", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(Object.assign(new Error("Rate limit"), { statusCode: 429, type: "StripeRateLimitError" }));
    const { status, body } = await run({ payouts: [payoutRow({ attempts: 11 })] });
    expect(status).toBe(200);
    expect(body.payout_account_unreadable).toBe(1);
    expect(rpcs("declutter_payout_executed")).toHaveLength(0);
    expect(rpcs("payout_defer")[0]?.args).toEqual({ p_kind: "declutter", p_payout_id: PAYOUT, p_minutes: 15 });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(slackAlerts.some((a: any) => /gave up/i.test(String(a.title ?? "")))).toBe(false);
  });

  it("Stripe refusing our read of ONE account (403) is that payee's problem: no try, a payee wait, a per-ACCOUNT alert, no key-wide page", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(Object.assign(new Error("permission denied for acct_seller1"), { statusCode: 403 }));
    const { status, body } = await run({ payouts: [payoutRow(), payoutRow({ payout_id: "0000000b-0000-4000-8000-0000000000c4", order_id: "0000000b-0000-4000-8000-0000000000a4" })] });
    expect(status).toBe(200);
    expect(body.payout_account_unreadable).toBe(2);
    expect(rpcs("declutter_payout_executed")).toHaveLength(0);
    expect(rpcs("payout_defer").map((c: any) => c.args.p_minutes)).toEqual([60, 60]);
    expect(rpcs("payout_payee_wait_seen")[0]?.args).toMatchObject({ p_category: "unreadable" });
    const perAccount = slackAlerts.filter((a: any) => /could not be read/.test(String(a.title ?? "")));
    expect(new Set(perAccount.map((a: any) => a.oncePerDayKey))).toEqual(new Set(["connect-read-refused-live-acct_seller1"]));
    expect(slackAlerts.some((a: any) => /can't read Connect accounts/.test(String(a.title ?? "")))).toBe(false);
    expect(stripeMock.accounts.retrieve).toHaveBeenCalledTimes(1);
    // One refused account never probes the key.
    expect(stripeMock.balance.retrieve).not.toHaveBeenCalled();
  });

  it("three different accounts refused in one run is OUR key: one critical line per mode per day", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(Object.assign(new Error("permission denied"), { statusCode: 403 }));
    const row = (n: number) => payoutRow({ payout_id: `0000000b-0000-4000-8000-0000000000d${n}`, order_id: `0000000b-0000-4000-8000-0000000000e${n}`, stripe_account_id: `acct_s${n}` });
    stripeMock.accounts.retrieve.mockImplementation(async (id: string) => { throw Object.assign(new Error(`permission denied for ${id}`), { statusCode: 403 }); });
    stripeMock.balance.retrieve.mockRejectedValue(Object.assign(new Error("Invalid API Key"), { statusCode: 401 }));
    await run({ payouts: [row(1), row(2), row(3)] });
    const key = slackAlerts.filter((a: any) => /can't read Connect accounts/.test(String(a.title ?? "")));
    expect(key.length).toBeGreaterThan(0);
    expect((key[0] as any).oncePerDayKey).toBe("connect-read-refused-live");
  });

  it("three refused accounts while the platform's own balance reads fine is NOT our key (no critical line)", async () => {
    const row = (n: number) => payoutRow({ payout_id: `0000000b-0000-4000-8000-0000000000d${n}`, order_id: `0000000b-0000-4000-8000-0000000000e${n}`, stripe_account_id: `acct_s${n}` });
    stripeMock.accounts.retrieve.mockImplementation(async (id: string) => { throw Object.assign(new Error(`permission denied for ${id}`), { statusCode: 403 }); });
    stripeMock.balance.retrieve.mockResolvedValue({ available: [] });
    await run({ payouts: [row(1), row(2), row(3)] });
    expect(stripeMock.balance.retrieve).toHaveBeenCalledTimes(1);
    expect(slackAlerts.some((a: any) => /can't read Connect accounts/.test(String(a.title ?? "")))).toBe(false);
  });

  it("Stripe's 'does not have access to account … (or that account does not exist)' is that payee's account gone: unusable", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(Object.assign(new Error("The provided key 'sk_live_x' does not have access to account 'acct_seller1' (or that account does not exist). Application access may have been revoked."), { statusCode: 403, code: "account_invalid" }));
    await run({ payouts: [payoutRow()] });
    expect(rpcs("payout_payee_wait_seen")[0]?.args).toMatchObject({ p_category: "unusable" });
  });

  it("an error that names no account (a code bug, an invalid key) is NOT transient: the key-wide line at once, the payout waits", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(new TypeError("Cannot read properties of undefined"));
    const { body } = await run({ payouts: [payoutRow()] });
    expect(body.payout_account_unreadable).toBe(1);
    expect(slackAlerts.some((a: any) => /can't read Connect accounts/.test(String(a.title ?? "")))).toBe(true);
    expect(rpcs("payout_payee_wait_seen")[0]?.args).toMatchObject({ p_category: "unreadable" });
  });

  it("a passing read failure is bounded: recorded as transient (24-hour page) with one line a day per account", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(Object.assign(new Error("Rate limit"), { statusCode: 429, type: "StripeRateLimitError" }));
    await run({ payouts: [payoutRow()] });
    expect(rpcs("payout_payee_wait_seen")[0]?.args).toMatchObject({ p_category: "transient" });
    expect(slackAlerts.some((a: any) => a.oncePerDayKey === "connect-read-transient-live-acct_seller1")).toBe(true);
  });

  it("a payee who DELETED their account: paged at once as payee_deleted, retried only daily, no Stripe call", async () => {
    scenario.rpc.payout_payee_wait_seen = { page_due: true, reminded: false, waiting_since: "2026-10-19T00:00:00Z" };
    await run({ payouts: [payoutRow({ seller_id: null, stripe_account_id: null })] });
    expect(stripeMock.transfers.list).not.toHaveBeenCalled();
    expect(rpcs("payout_defer")[0]?.args).toEqual({ p_kind: "declutter", p_payout_id: PAYOUT, p_minutes: 1440 });
    expect(rpcs("payout_payee_wait_seen")[0]?.args).toMatchObject({ p_payee: null, p_category: "payee_deleted" });
    const page = slackAlerts.find((a: any) => /won't pay itself/.test(String(a.title ?? ""))) as { message?: string } | undefined;
    expect(String(page?.message)).toMatch(/pay by hand after checking/);
    expect(rpcs("payout_hold_for_review")[0]?.args).toMatchObject({ p_kind: "declutter", p_id: PAYOUT, p_category: "payee_deleted" });
  });

  it("a transfer Stripe took whose recording fails is deferred and bounded (record_failed), never left at the front", async () => {
    scenario.rpcErrors = { declutter_payout_executed: { message: "db down", code: "57P01" } };
    await run({ payouts: [payoutRow()] });
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    expect(rpcs("payout_defer")[0]?.args).toEqual({ p_kind: "declutter", p_payout_id: PAYOUT, p_minutes: 15 });
    expect(rpcs("payout_payee_wait_seen")[0]?.args).toMatchObject({ p_category: "record_failed" });
    expect(slackAlerts.some((a: any) => a.oncePerDayKey === `payout-unrecorded-declutter-${PAYOUT}`)).toBe(true);
  });

  it("Stripe reviewing the account (transfers pending) waits as under_review (its own reminder words)", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_seller1", capabilities: { transfers: "pending" } });
    await run({ payouts: [payoutRow()] });
    expect(rpcs("payout_payee_wait_seen")[0]?.args).toMatchObject({ p_category: "under_review" });
  });

  it("a test-account payee's page routes as seed and is a warning kind, not a page kind", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_seller1", capabilities: { transfers: "inactive" }, requirements: { disabled_reason: "rejected.fraud" } });
    scenario.rpc.payout_payee_wait_seen = { page_due: true, reminded: false, waiting_since: "2026-10-19T00:00:00Z", payee_seed: true };
    await run({ payouts: [payoutRow()] });
    expect(rpcs("payout_payee_wait_seen")[0]?.args).toMatchObject({ p_category: "rejected" });
    const page = slackAlerts.find((a: any) => /won't pay itself/.test(String(a.title ?? ""))) as { seed?: boolean; kind?: string } | undefined;
    expect(page?.seed).toBe(true);
    expect(page?.kind).toBe("payout_wait");
  });

  it("a payout a send was started for (marked) is reconciled first even with no try counted, never skipped blind", async () => {
    scenario.rpc.payout_send_marks_for = [PAYOUT];
    stripeMock.transfers.list.mockResolvedValue({ data: [{ id: "tr_marked", destination: "acct_old", reversed: false, metadata: { kind: "declutter_payout", payout_id: PAYOUT } }] });
    const { body } = await run({ payouts: [payoutRow({ stripe_account_id: null, attempts: 0 })] });
    expect(stripeMock.transfers.list).toHaveBeenCalledTimes(1);
    expect(body.payouts_reconciled).toBe(1);
    expect(rpcs("payout_payee_wait_seen")).toHaveLength(0);
  });

  it("the send is marked BEFORE the transfer; a mark that cannot be written sends nothing (deferred, no try)", async () => {
    let markedBeforeSend = false;
    stripeMock.transfers.create.mockImplementation(async () => {
      markedBeforeSend = rpcs("payout_mark_sending").length === 1;
      return { id: "tr_new1", destination: "acct_seller1" };
    });
    await run({ payouts: [payoutRow()] });
    expect(markedBeforeSend).toBe(true);
    expect(rpcs("payout_mark_sending")[0]?.args).toEqual({ p_kind: "declutter", p_payout_id: PAYOUT });
  });

  it("a send mark that fails stops the transfer", async () => {
    scenario.rpcErrors = { payout_mark_sending: { message: "db down", code: "57P01" } };
    await run({ payouts: [payoutRow()] });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(rpcs("declutter_payout_executed")).toHaveLength(0);
    expect(rpcs("payout_defer")[0]?.args).toEqual({ p_kind: "declutter", p_payout_id: PAYOUT, p_minutes: 15 });
  });

  it("a refund with no Stripe mode to run on (refund by hand) is deferred a day, never left at the front", async () => {
    await run({ refunds: [refundRow({ order_id: null, buyer_id: null, seller_id: null, livemode: null, checkout_session_id: null })] });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(rpcs("payout_defer").map((c: any) => c.args)).toContainEqual({ p_kind: "declutter_refund", p_payout_id: REFUND, p_minutes: 1440 });
  });

  it("an unusable account (gone, or a sandbox account under the live key) uses no try and pages ops once", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(Object.assign(new Error("No such account: 'acct_seller1'"), { statusCode: 404, code: "resource_missing" }));
    scenario.rpc.payout_payee_wait_seen = { page_due: true, reminded: true, waiting_since: "2026-10-19T00:00:00Z" };
    const { body } = await run({ payouts: [payoutRow()] });
    expect(rpcs("declutter_payout_executed")).toHaveLength(0);
    expect(rpcs("payout_payee_wait_seen")[0]?.args).toMatchObject({ p_category: "unusable" });
    expect(body.payee_setup_paged).toBe(1);
    const pages = slackAlerts.filter((a: any) => /won't pay itself/.test(String(a.title ?? "")));
    expect(pages).toHaveLength(1);
    // Once per payout and reason (an unusable account will not fix itself: the words say so).
    expect((pages[0] as any).oncePerDayKey).toBe(`payout-wait-declutter-${PAYOUT}-unusable`);
    expect(String((pages[0] as any).message)).toMatch(/HELD FOR REVIEW/);
    expect(String((pages[0] as any).message)).toMatch(/"Release to automatic"/);
    expect(String((pages[0] as any).message)).toMatch(/"Mark settled by hand"/);
    // Delivered: the row is held for review (out of every queue) and the page marked, in one call.
    expect(rpcs("payout_hold_for_review")[0]?.args).toMatchObject({ p_kind: "declutter", p_id: PAYOUT, p_category: "unusable" });
    expect(rpcs("payout_payee_paged")).toHaveLength(0);
  });

  it("a page Slack did not take is NOT marked paged (it is tried again next run)", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_seller1", capabilities: { transfers: "inactive" } });
    scenario.rpc.payout_payee_wait_seen = { page_due: true, reminded: false, waiting_since: "2026-10-01T00:00:00Z" };
    const shared = await import("./mocks/shared");
    shared.postSlackOpsAlert.mockImplementation(async (input: unknown) => { slackAlerts.push(input); return false as never; });
    const { body } = await run({ payouts: [payoutRow()] });
    expect(slackAlerts.some((a: any) => /waiting too long/.test(String(a.title ?? "")))).toBe(true);
    expect(rpcs("payout_payee_paged")).toHaveLength(0);
    expect(rpcs("payout_hold_for_review")).toHaveLength(0);
    expect(body.payee_setup_paged).toBe(0);
    shared.postSlackOpsAlert.mockImplementation(async (input: unknown) => { slackAlerts.push(input); });
  });

  it("one account read per account per run; a second payout of a payee already found not ready makes NO Stripe call", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_seller1", capabilities: { transfers: "inactive" }, payouts_enabled: false });
    await run({ payouts: [payoutRow(), payoutRow({ payout_id: "0000000b-0000-4000-8000-0000000000c1", order_id: "0000000b-0000-4000-8000-0000000000a1" })] });
    expect(stripeMock.accounts.retrieve).toHaveBeenCalledTimes(1);
    expect(stripeMock.transfers.list).toHaveBeenCalledTimes(1);
    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledTimes(1);
    expect(rpcs("payout_defer")).toHaveLength(2);
  });

  it("a refunded or disputed charge still fails LOUDLY when the payee is not ready (the charge is checked first)", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_order1", status: "succeeded", latest_charge: { id: "ch_order1", amount_refunded: 0, disputed: true },
    });
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_seller1", capabilities: { transfers: "inactive" } });
    await run({ payouts: [payoutRow({ attempts: 11 })] });
    expect(rpcs("declutter_payout_executed")[0]?.args).toMatchObject({ p_succeeded: false });
    expect(slackAlerts.some((a: any) => /Do NOT pay the seller by hand/.test(String(a.message ?? "")))).toBe(true);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("an account with no capabilities block at all is not ready either (never a guess that it is)", async () => {
    // (payouts_enabled missing too: not ready.)
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_seller1" });
    const { body } = await run({ payouts: [payoutRow()] });
    expect(body.payout_account_not_ready).toBe(1);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("a transfer already sent is still recorded when the account later stops being ready (reconcile first)", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_seller1", capabilities: { transfers: "inactive" } });
    stripeMock.transfers.list.mockResolvedValue({ data: [{ id: "tr_old1", destination: "acct_seller1", reversed: false, metadata: { kind: "declutter_payout", payout_id: PAYOUT } }] });
    const { body } = await run({ payouts: [payoutRow()] });
    expect(body.payouts_reconciled).toBe(1);
    expect(body.payout_account_not_ready).toBe(0);
    expect(rpcs("declutter_payout_executed")[0]?.args).toMatchObject({ p_transfer_id: "tr_old1", p_succeeded: true });
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


describe("declutter-money: a known partial refund (slice 5)", () => {
  it("pays the seller when the charge gave back exactly the delivery fee the order recorded", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_order1", status: "succeeded", latest_charge: { id: "ch_order1", amount_refunded: 2400, disputed: false },
    });
    const { status, body } = await run({ payouts: [payoutRow({ refunds_recorded_cents: 2400 })] });
    expect(status).toBe(200);
    expect(body.payouts_sent).toBe(1);
  });

  it("still moves nothing when the charge gave back MORE than the order recorded", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_order1", status: "succeeded", latest_charge: { id: "ch_order1", amount_refunded: 2401, disputed: false },
    });
    const { status } = await run({ payouts: [payoutRow({ refunds_recorded_cents: 2400 })] });
    expect(status).toBe(500);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });
});

describe("declutter-money: Helpr delivery payouts (slice 5, row 42)", () => {
  it("sends the queued take-home to the Helpr's account from the order's own charge, once", async () => {
    const { status, body } = await run({ helprPayouts: [helprRow()] });
    expect(status).toBe(200);
    expect(body.helpr_payouts_sent).toBe(1);
    const [params, opts] = stripeMock.transfers.create.mock.calls[0];
    expect(params).toMatchObject({
      amount: 1640, currency: "usd", destination: "acct_helpr1", transfer_group: `declutter_order_${ORDER}`,
      source_transaction: "ch_order1", metadata: { kind: "helpr_task_payout", payout_id: HPAYOUT, task_id: TASK },
    });
    expect(opts).toEqual({ idempotencyKey: `helpr-task-payout-${HPAYOUT}` });
    expect(rpcs("helpr_task_payout_executed")[0]?.args).toEqual({
      p_payout_id: HPAYOUT, p_transfer_id: "tr_new1", p_succeeded: true, p_error: null,
    });
  });

  it("reconciles by payout id: a transfer already sent for this row is recorded, not sent again", async () => {
    stripeMock.transfers.list.mockResolvedValue({ data: [
      // The SELLER's payout in the same group is not the Helpr's.
      { id: "tr_seller", destination: "acct_seller1", reversed: false, metadata: { kind: "declutter_payout", payout_id: PAYOUT } },
      { id: "tr_h_old", destination: "acct_helpr1", reversed: false, metadata: { kind: "helpr_task_payout", payout_id: HPAYOUT } },
    ] });
    const { body } = await run({ helprPayouts: [helprRow({ attempts: 2 })] });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(body.helpr_payouts_reconciled).toBe(1);
    expect(rpcs("helpr_task_payout_executed")[0]?.args).toMatchObject({ p_transfer_id: "tr_h_old", p_succeeded: true });
  });

  it("the seller's transfer in the same group is never taken for the Helpr's", async () => {
    stripeMock.transfers.list.mockResolvedValue({ data: [
      { id: "tr_seller", destination: "acct_seller1", reversed: false, metadata: { kind: "declutter_payout", payout_id: PAYOUT } },
    ] });
    const { body } = await run({ helprPayouts: [helprRow()] });
    expect(body.helpr_payouts_sent).toBe(1);
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
  });

  it("a Helpr on payout hold is not paid and nothing is recorded", async () => {
    scenario.reads.payout_holds = { rows: [{ helper_id: HELPR, reason: "under review", held_at: "2026-10-15T00:00:00Z", denied_at: null }] };
    const { body } = await run({ helprPayouts: [helprRow()] });
    expect(body.held).toBe(1);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(rpcs("helpr_task_payout_executed")).toHaveLength(0);
  });

  it("a Helpr under ban review is not paid", async () => {
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: HELPR }] };
    const { body } = await run({ helprPayouts: [helprRow()] });
    expect(body.ban_review).toBe(1);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("a Helpr with no payout account is skipped without using a try", async () => {
    const { body } = await run({ helprPayouts: [helprRow({ stripe_account_id: null })] });
    expect(body.no_payout_account).toBe(1);
    expect(rpcs("helpr_task_payout_executed")).toHaveLength(0);
  });

  it("a Helpr whose payout setup is unfinished is skipped without using a try", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_helpr1", capabilities: { transfers: "pending" } });
    const { body } = await run({ helprPayouts: [helprRow()] });
    expect(body.payout_account_not_ready).toBe(1);
    expect(body.helpr_payouts_failed).toBe(0);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(rpcs("helpr_task_payout_executed")).toHaveLength(0);
  });

  it("a charge refunded beyond what was recorded pays no Helpr; the failure is recorded", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_order1", status: "succeeded", latest_charge: { id: "ch_order1", amount_refunded: 9000, disputed: false },
    });
    const { status } = await run({ helprPayouts: [helprRow()] });
    expect(status).toBe(500);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(rpcs("helpr_task_payout_executed")[0]?.args).toMatchObject({ p_succeeded: false });
  });

  it("the 12th failure pages and says not to pay by hand when the charge is not whole", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_order1", status: "succeeded", latest_charge: { id: "ch_order1", amount_refunded: 0, disputed: true },
    });
    await run({ helprPayouts: [helprRow({ attempts: 11 })] });
    expect(slackAlerts.length).toBe(1);
    expect(JSON.stringify(slackAlerts[0])).toContain("Do NOT pay the Helpr by hand");
  });
});

describe("declutter-money: delivery-fee refunds (slice 5, row 40)", () => {
  it("refunds exactly the delivery fee under its own key and records it", async () => {
    const { status, body } = await run({ deliveryRefunds: [deliveryRefundRow()] });
    expect(status).toBe(200);
    expect(body.delivery_refunds_sent).toBe(1);
    const [params, opts] = stripeMock.refunds.create.mock.calls[0];
    expect(params).toEqual({
      payment_intent: "pi_order1", amount: 2400,
      metadata: { kind: "declutter_refund", delivery_refund_id: DREFUND, reason: "no_helpr", order_id: ORDER },
    });
    expect(opts).toEqual({ idempotencyKey: `declutter-delivery-refund-${DREFUND}` });
    expect(rpcs("declutter_delivery_refund_executed")[0]?.args).toMatchObject({ p_id: DREFUND, p_stripe_refund_id: "re_new1", p_succeeded: true });
    expect(queuedEmails.length).toBe(1);
  });

  it("reconciles: a refund Stripe already took for this row is recorded, not sent twice", async () => {
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_old", status: "succeeded", metadata: { delivery_refund_id: DREFUND } }] });
    const { body } = await run({ deliveryRefunds: [deliveryRefundRow({ attempts: 3 })] });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(body.delivery_refunds_reconciled).toBe(1);
  });

  it("an ORDER refund on the same payment is not mistaken for the delivery refund", async () => {
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_order", status: "succeeded", metadata: { refund_id: REFUND } }] });
    const { body } = await run({ deliveryRefunds: [deliveryRefundRow()] });
    expect(body.delivery_refunds_sent).toBe(1);
  });

  it("a refund Stripe failed is recorded as a failed try and pages", async () => {
    stripeMock.refunds.create.mockResolvedValue({ id: "re_bad", status: "failed" });
    const { body } = await run({ deliveryRefunds: [deliveryRefundRow()] });
    expect(body.delivery_refunds_failed).toBe(1);
    expect(rpcs("declutter_delivery_refund_executed")[0]?.args).toMatchObject({ p_succeeded: false });
    expect(slackAlerts.length).toBe(1);
  });

  it("runs on the key of the page that took the payment", async () => {
    scenario.reads.test_accounts = { rows: [{ user_id: BUYER }, { user_id: SELLER }] };
    scenario.reads.profiles = { rows: [{ user_id: BUYER, is_seed: true, email: "b@x.test" }, { user_id: SELLER, is_seed: true }] };
    await run({ deliveryRefunds: [deliveryRefundRow({ checkout_session_id: "cs_test_abc" })] });
    expect(stripeMock.__key).toBe("sk_test_declutter");
  });
});


describe("declutter-money: skipped payouts never starve the queue (/code-review of f6551863a)", () => {
  it("a sent-but-unrecorded transfer is RECONCILED even when the payee now reads not ready: recorded once, never paged or sent again", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_seller1", capabilities: { transfers: "inactive" }, payouts_enabled: false });
    stripeMock.transfers.list.mockResolvedValue({ data: [{ id: "tr_sent1", destination: "acct_seller1", reversed: false, metadata: { kind: "declutter_payout", payout_id: PAYOUT } }] });
    const { body } = await run({ payouts: [payoutRow()] });
    expect(body.payouts_reconciled).toBe(1);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
    expect(rpcs("payout_payee_wait_seen")).toHaveLength(0);
    expect(rpcs("payout_defer")).toHaveLength(0);
    expect(rpcs("payout_payee_wait_cleared")[0]?.args).toEqual({ p_kind: "declutter", p_payout_id: PAYOUT });
  });

  it("a seller with no payout account and no try used: NO Stripe call at all, deferred, wait recorded", async () => {
    const { body } = await run({ payouts: [payoutRow({ stripe_account_id: null })] });
    expect(body.no_payout_account).toBe(1);
    expect(stripeMock.transfers.list).not.toHaveBeenCalled();
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
    expect(rpcs("declutter_payout_executed")).toHaveLength(0);
    expect(rpcs("payout_defer")[0]?.args).toEqual({ p_kind: "declutter", p_payout_id: PAYOUT, p_minutes: 60 });
    expect(rpcs("payout_payee_wait_seen")[0]?.args).toMatchObject({ p_category: "no_account" });
  });

  it("a seller with no payout account who HAS used a try is reconciled (a transfer may exist), then deferred before the charge check", async () => {
    stripeMock.transfers.list.mockResolvedValue({ data: [] });
    const { body } = await run({ payouts: [payoutRow({ stripe_account_id: null, attempts: 2 })] });
    expect(body.no_payout_account).toBe(1);
    expect(stripeMock.transfers.list).toHaveBeenCalledTimes(1);
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(rpcs("declutter_payout_executed")).toHaveLength(0);
  });

  it("a passing Stripe failure BEFORE the transfer (reconcile or charge read) is deferred, never a failed try", async () => {
    stripeMock.transfers.list.mockRejectedValue(Object.assign(new Error("api_error"), { statusCode: 503, type: "StripeAPIError" }));
    const first = await run({ payouts: [payoutRow({ attempts: 11 })] });
    expect(first.body.payout_retry_later).toBe(1);
    expect(rpcs("declutter_payout_executed")).toHaveLength(0);
    expect(rpcs("payout_defer")[0]?.args).toEqual({ p_kind: "declutter", p_payout_id: PAYOUT, p_minutes: 15 });
    expect(slackAlerts.some((a: any) => /gave up/i.test(String(a.title ?? "")))).toBe(false);
  });

  it("a passing failure reading the order's charge is deferred too", async () => {
    stripeMock.paymentIntents.retrieve.mockRejectedValue(Object.assign(new Error("connection reset"), { type: "StripeConnectionError" }));
    const { body } = await run({ payouts: [payoutRow()] });
    expect(body.payout_retry_later).toBe(1);
    expect(rpcs("declutter_payout_executed")).toHaveLength(0);
  });

  it("the 12th failed try clears the payee wait (any end starts a later wait fresh)", async () => {
    stripeMock.transfers.create.mockRejectedValue(Object.assign(new Error("invalid destination"), { statusCode: 400, type: "StripeInvalidRequestError" }));
    await run({ payouts: [payoutRow({ attempts: 11 })] });
    expect(rpcs("declutter_payout_executed")[0]?.args).toMatchObject({ p_succeeded: false });
    expect(rpcs("payout_payee_wait_cleared")[0]?.args).toEqual({ p_kind: "declutter", p_payout_id: PAYOUT });
  });

  it("every run prunes the waits of payouts that ended any other way, and re-raises held rows", async () => {
    await run({});
    expect(rpcs("payout_payee_waits_prune")).toHaveLength(1);
    expect(rpcs("payout_held_check")).toHaveLength(1);
  });

  it("a refund skipped under ban review is deferred too (refunds never starve)", async () => {
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: BUYER }] };
    await run({ refunds: [refundRow()] });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(rpcs("payout_defer").map((c: any) => c.args)).toContainEqual({ p_kind: "declutter_refund", p_payout_id: REFUND, p_minutes: 60 });
  });

  it("held, under ban review and a failed hold read all DEFER the row (it leaves the front of the queue) and are bounded", async () => {
    scenario.reads.payout_holds = { rows: [{ helper_id: SELLER, reason: "review" }] };
    await run({ payouts: [payoutRow()] });
    expect(rpcs("payout_defer")[0]?.args).toEqual({ p_kind: "declutter", p_payout_id: PAYOUT, p_minutes: 60 });
    expect(rpcs("payout_payee_wait_seen")[0]?.args).toMatchObject({ p_category: "held" });
    // Held before any Stripe call (not only by the re-check right before the transfer).
    expect(stripeMock.transfers.list).not.toHaveBeenCalled();
  });

  it("a payee whose cached gate is stale is re-synced ONCE per run, however many payouts they have", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_seller1", capabilities: { transfers: "inactive" }, payouts_enabled: false,
      charges_enabled: false, requirements: { currently_due: ["external_account"], eventually_due: [], past_due: [], errors: [] } });
    scenario.reads.profiles = { rows: [{ user_id: SELLER, stripe_account_id: "acct_seller1", stripe_identity_verified: true,
      stripe_charges_enabled: true, stripe_payouts_enabled: true, email: "seller@example.test" }] };
    scenario.reads.payment_method_fingerprints = { rows: [] };
    await run({ payouts: [payoutRow(), payoutRow({ payout_id: "0000000b-0000-4000-8000-0000000000c2", order_id: "0000000b-0000-4000-8000-0000000000a2" })] });
    const writes = scenario.writes.filter((w: any) => w.table === "profiles" && w.op === "update");
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toMatchObject({ stripe_payouts_enabled: false });
  });

  it("the migration not deployed yet (PGRST202) is ONE defect a run, and the payout still moves no money", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_seller1", capabilities: { transfers: "inactive" }, payouts_enabled: false });
    scenario.rpcErrors = { payout_defer: { message: "Could not find the function", code: "PGRST202" },
      payout_payee_wait_seen: { message: "Could not find the function", code: "PGRST202" } };
    const { status, body } = await run({ payouts: [payoutRow(), payoutRow({ payout_id: "0000000b-0000-4000-8000-0000000000c3", order_id: "0000000b-0000-4000-8000-0000000000a3" })] });
    // The missing migration is a defect (the run reports it once), never a try or a transfer.
    expect(status).toBe(500);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(rpcs("declutter_payout_executed")).toHaveLength(0);
    expect(JSON.stringify(body).match(/PGRST202/g)?.length).toBe(1);
  });

  it("a paid-after-waiting payout pages nobody and clears its wait", async () => {
    const { body } = await run({ payouts: [payoutRow()] });
    expect(body.payouts_sent).toBe(1);
    expect(rpcs("payout_payee_wait_cleared")[0]?.args).toEqual({ p_kind: "declutter", p_payout_id: PAYOUT });
    expect(slackAlerts).toHaveLength(0);
  });
});

describe("declutter-money: HELD FOR REVIEW and the last checks before a transfer (v6)", () => {
  it("a key 'does not have access' to an account is an ACCESS error (unreadable), never 'unusable'", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(Object.assign(new Error("The provided key 'rk_live_x' does not have access to account 'acct_seller1'"), { code: "account_invalid" }));
    await run({ payouts: [payoutRow()] });
    expect(rpcs("payout_payee_wait_seen")[0]?.args).toMatchObject({ p_category: "unreadable" });
    expect(rpcs("payout_hold_for_review")).toHaveLength(0);
  });

  it("only a 404 'No such account' is unusable", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(Object.assign(new Error("No such account: 'acct_seller1'"), { statusCode: 404, code: "resource_missing" }));
    await run({ payouts: [payoutRow()] });
    expect(rpcs("payout_payee_wait_seen")[0]?.args).toMatchObject({ p_category: "unusable" });
  });

  it("a payee banned since the queue was read is never sent the transfer: held for review as banned", async () => {
    scenario.reads.profiles = { rows: [{ user_id: SELLER, ban_status: "banned", auto_suspended_until: null }] };
    scenario.rpc.payout_payee_wait_seen = { page_due: true, reminded: false, waiting_since: "2026-10-19T00:00:00Z" };
    await run({ payouts: [payoutRow()] });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(rpcs("payout_payee_wait_seen")[0]?.args).toMatchObject({ p_category: "banned" });
    expect(rpcs("payout_hold_for_review")[0]?.args).toMatchObject({ p_category: "banned" });
  });

  it("a Helpr payout whose source is not a Declutter delivery is a data defect: held at once, never 'pays itself'", async () => {
    scenario.rpc.payout_payee_wait_seen = { page_due: true, reminded: false, waiting_since: "2026-10-19T00:00:00Z" };
    await run({ helprPayouts: [helprRow({ source_kind: "job", payment_intent_id: null, transfer_group: "job_x" })] });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(rpcs("helpr_task_payout_executed")).toHaveLength(0);
    expect(rpcs("payout_defer")[0]?.args).toMatchObject({ p_kind: "helpr_task", p_minutes: 1440 });
    expect(rpcs("payout_hold_for_review")[0]?.args).toMatchObject({ p_kind: "helpr_task", p_category: "data_defect" });
  });

  it("a refund under ban review is recorded and bounded like a payout (never silent, never the front)", async () => {
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: BUYER }] };
    await run({ refunds: [refundRow()] });
    expect(rpcs("payout_payee_wait_seen")[0]?.args).toMatchObject({ p_kind: "declutter_refund", p_payout_id: REFUND, p_category: "ban_review" });
  });

  it("a refund with no Stripe mode is a data defect: held for review once the page goes out", async () => {
    scenario.rpc.payout_payee_wait_seen = { page_due: true, reminded: false, waiting_since: "2026-10-19T00:00:00Z" };
    await run({ refunds: [refundRow({ order_id: null, buyer_id: null, seller_id: null, livemode: null, checkout_session_id: null, attempts: 0 })] });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(rpcs("payout_hold_for_review")[0]?.args).toMatchObject({ p_kind: "declutter_refund", p_id: REFUND, p_category: "data_defect" });
  });
});

describe("declutter-money: v7 (suspensions, reconcile before hold)", () => {
  it("a TEMPORARY suspension is a bounded wait that resumes on its own, never held for review", async () => {
    const until = new Date(Date.now() + 3 * 3600_000).toISOString();
    scenario.reads.profiles = { rows: [{ user_id: SELLER, ban_status: "temp_banned", auto_suspended_until: until }] };
    await run({ payouts: [payoutRow()] });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(rpcs("payout_payee_wait_seen")[0]?.args).toMatchObject({ p_category: "suspended" });
    expect(rpcs("payout_hold_for_review")).toHaveLength(0);
    expect(Number((rpcs("payout_defer")[0]?.args as { p_minutes?: number } | undefined)?.p_minutes)).toBeGreaterThanOrEqual(170);
  });

  it("a data defect on a row a transfer may exist for is held as needs_reconcile (search Stripe first), never as data_defect", async () => {
    scenario.rpc.payout_payee_wait_seen = { page_due: true, reminded: false, waiting_since: "2026-10-19T00:00:00Z" };
    await run({ helprPayouts: [helprRow({ source_kind: "job", payment_intent_id: null, transfer_group: null, attempts: 2 })] });
    expect(rpcs("payout_payee_wait_seen")[0]?.args).toMatchObject({ p_category: "needs_reconcile" });
    expect(rpcs("payout_hold_for_review")[0]?.args).toMatchObject({ p_category: "needs_reconcile" });
    const page = slackAlerts.find((a: any) => /held for review/.test(String(a.title ?? ""))) as { message?: string } | undefined;
    expect(String(page?.message)).toMatch(/search Stripe for it by its payout metadata/);
    expect(String(page?.message)).toMatch(/never another payout of the same payee/);
  });

  it("a refund whose recording fails is recorded and bounded (record_failed)", async () => {
    scenario.rpcErrors = { declutter_refund_executed: { message: "db down", code: "57P01" } };
    stripeMock.refunds.create.mockResolvedValue({ id: "re_new1", status: "succeeded" });
    await run({ refunds: [refundRow({ livemode: true, checkout_session_id: "cs_live_x" })] });
    expect(rpcs("payout_payee_wait_seen").map((c: any) => c.args)).toContainEqual(expect.objectContaining({ p_kind: "declutter_refund", p_category: "record_failed" }));
  });

  it("the held page names the real Stripe group of the row", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(Object.assign(new Error("No such account: 'acct_seller1'"), { statusCode: 404, code: "resource_missing" }));
    scenario.rpc.payout_payee_wait_seen = { page_due: true, reminded: false, waiting_since: "2026-10-19T00:00:00Z" };
    await run({ payouts: [payoutRow()] });
    const page = slackAlerts.find((a: any) => /held for review/.test(String(a.title ?? ""))) as { message?: string } | undefined;
    expect(String(page?.message)).toContain(`declutter_order_${ORDER}`);
  });

});
