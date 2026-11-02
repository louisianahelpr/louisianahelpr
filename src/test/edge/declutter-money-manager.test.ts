/**
 * Declutter manager mode phase 2b, the edge (owner 11-01: the share is paid to the manager's own Stripe payout
 * account): supabase/functions/declutter-money sends each declutter_manager_payouts_due row as a SEPARATE transfer
 * from the platform to the MANAGER's Connect account, from the order's own charge and transfer group, with the key
 * declutter-manager-payout-<id>, reconciled by metadata.payout_id ONLY. The seller's reconcile never adopts it.
 *
 * Runs the REAL function source through the edge harness; Stripe and Supabase are doubled (Stripe is LIVE on prod:
 * nothing here reaches it). The queue's gates are proven in SQL by src/test/pglite/declutterManagerPayoutKind.pglite.mjs.
 *
 * @mutate supabase/functions/declutter-money/index.ts |          { idempotencyKey: `declutter-manager-payout-${p.payout_id}` }, |          {},
 * @mutate supabase/functions/declutter-money/index.ts |        return meta.kind === "declutter_manager_payout" && meta.payout_id === p.payout_id && !t.reversed; |        return meta.kind === "declutter_manager_payout" && !t.reversed;
 * @mutate supabase/functions/declutter-money/index.ts |            metadata: { kind: "declutter_manager_payout", payout_id: p.payout_id, order_id: p.order_id }, |            metadata: { kind: "declutter_payout", payout_id: p.payout_id, order_id: p.order_id },
 * @mutate supabase/functions/declutter-money/index.ts |    const hold = await checkPayoutHold(admin, p.manager_id); |    const hold = await checkPayoutHold(admin, p.seller_id);
 * @mutate supabase/functions/declutter-money/index.ts |        if (!(await markSending("declutter_manager", p.payout_id, p.manager_id, p.amount_cents))) continue; |
 * @mutate supabase/functions/declutter-money/index.ts |    if ((managerRes.error as { code?: string }).code !== "PGRST202") defects.record( |    if (true) return cronError(FN, "x"); if (false) defects.record(
 * @mutate supabase/functions/declutter-money/index.ts |            source_transaction: charge,\n            metadata: { kind: "declutter_manager_payout" |            metadata: { kind: "declutter_manager_payout"
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";
import { resetEmailMocks } from "./mocks/email";

const BUYER = "0000000c-0000-4000-8000-000000000001";
const SELLER = "0000000c-0000-4000-8000-000000000002";
const MANAGER = "0000000c-0000-4000-8000-000000000003";
const ORDER = "0000000c-0000-4000-8000-0000000000aa";
const PAYOUT = "0000000c-0000-4000-8000-0000000000cc";
const MPAYOUT = "0000000c-0000-4000-8000-0000000000dd";

const sellerRow = (over: Record<string, unknown> = {}) => ({
  payout_id: PAYOUT, order_id: ORDER, buyer_id: BUYER, seller_id: SELLER, amount_cents: 3200,
  stripe_account_id: "acct_seller1", payment_intent_id: "pi_order1", attempts: 0, ...over,
});
const managerRow = (over: Record<string, unknown> = {}) => ({
  payout_id: MPAYOUT, order_id: ORDER, buyer_id: BUYER, seller_id: SELLER, manager_id: MANAGER, amount_cents: 800,
  stripe_account_id: "acct_manager1", payment_intent_id: "pi_order1", attempts: 0, refunds_recorded_cents: 0, ...over,
});
const rpcs = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);

async function run(opts: { payouts?: unknown[]; managerPayouts?: unknown[] } = {}) {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_declutter",
    STRIPE_TEST_SECRET_KEY: "sk_test_declutter",
  });
  scenario.rpc.declutter_payouts_due = opts.payouts ?? [];
  scenario.rpc.declutter_manager_payouts_due = opts.managerPayouts ?? [];
  scenario.rpc.declutter_refunds_due = [];
  scenario.rpc.helpr_task_payouts_due = [];
  scenario.rpc.declutter_delivery_refunds_due = [];
  scenario.rpc.declutter_payout_executed = (a: { p_succeeded?: boolean }) => (a?.p_succeeded ? "succeeded" : "failed");
  scenario.rpc.declutter_manager_payout_executed = (a: { p_succeeded?: boolean }) => (a?.p_succeeded ? "succeeded" : "failed");
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
  scenario.reads.test_accounts = { rows: [] };
  scenario.reads.ban_settlement_queue = { rows: [] };
  scenario.reads.payout_holds = { rows: [] };
  scenario.reads.profiles = { rows: [{ user_id: BUYER, email: "buyer@example.test" }] };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_order1", status: "succeeded", latest_charge: { id: "ch_order1", amount_refunded: 0, disputed: false },
  });
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_mgr1", destination: "acct_manager1" });
  stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_manager1", capabilities: { transfers: "active" }, payouts_enabled: true });
});

describe("declutter-money: the manager's share (manager mode phase 2b)", () => {
  it("sends the share to the MANAGER's account, from the order's charge and group, with its own key, once", async () => {
    const { status, body } = await run({ managerPayouts: [managerRow()] });
    expect(status).toBe(200);
    expect(body.manager_payouts_sent).toBe(1);
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    const [params, opts] = stripeMock.transfers.create.mock.calls[0];
    expect(params).toMatchObject({
      amount: 800, currency: "usd", destination: "acct_manager1",
      transfer_group: `declutter_order_${ORDER}`, source_transaction: "ch_order1",
      metadata: { kind: "declutter_manager_payout", payout_id: MPAYOUT, order_id: ORDER },
    });
    expect(opts).toEqual({ idempotencyKey: `declutter-manager-payout-${MPAYOUT}` });
    expect(rpcs("payout_mark_sending").map((c) => c.args)).toContainEqual({ p_kind: "declutter_manager", p_payout_id: MPAYOUT });
    expect(rpcs("declutter_manager_payout_executed")[0]?.args).toEqual({
      p_payout_id: MPAYOUT, p_transfer_id: "tr_mgr1", p_succeeded: true, p_error: null,
    });
  });

  it("reconciles by payout_id ONLY: the seller's transfer in the same group is never taken for the manager's", async () => {
    stripeMock.transfers.list.mockResolvedValue({ data: [
      { id: "tr_seller1", destination: "acct_manager1", reversed: false, metadata: { kind: "declutter_payout", payout_id: PAYOUT } },
      { id: "tr_other", destination: "acct_manager1", reversed: false, metadata: { kind: "declutter_manager_payout", payout_id: "someone-else" } },
    ] });
    const { body } = await run({ managerPayouts: [managerRow()] });
    expect(body.manager_payouts_reconciled).toBe(0);
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    expect(rpcs("declutter_manager_payout_executed")[0]?.args).toMatchObject({ p_transfer_id: "tr_mgr1" });
  });

  it("a manager transfer Stripe already holds for this payout is recorded, never sent twice", async () => {
    stripeMock.transfers.list.mockResolvedValue({ data: [
      { id: "tr_mgr_old", destination: "acct_manager1", reversed: false, metadata: { kind: "declutter_manager_payout", payout_id: MPAYOUT } },
    ] });
    const { body } = await run({ managerPayouts: [managerRow({ attempts: 2 })] });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(body.manager_payouts_reconciled).toBe(1);
    expect(rpcs("declutter_manager_payout_executed")[0]?.args).toMatchObject({ p_transfer_id: "tr_mgr_old", p_succeeded: true });
  });

  it("the seller's reconcile never adopts the manager's transfer (kind declutter_payout only)", async () => {
    stripeMock.transfers.list.mockResolvedValue({ data: [
      { id: "tr_mgr_old", destination: "acct_seller1", reversed: false, metadata: { kind: "declutter_manager_payout", payout_id: MPAYOUT } },
    ] });
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_seller1", capabilities: { transfers: "active" }, payouts_enabled: true });
    stripeMock.transfers.create.mockResolvedValue({ id: "tr_seller_new", destination: "acct_seller1" });
    const { body } = await run({ payouts: [sellerRow({ attempts: 1 })] });
    expect(body.payouts_reconciled).toBe(0);
    expect(rpcs("declutter_payout_executed")[0]?.args).toMatchObject({ p_transfer_id: "tr_seller_new" });
  });

  it("a manager on an admin payout hold is not paid; the row waits under the manager kind, no try used", async () => {
    scenario.reads.payout_holds = { rows: [{ helper_id: MANAGER, reason: "under review", held_at: "2026-11-01T00:00:00Z", denied_at: null }] };
    const { body } = await run({ managerPayouts: [managerRow()] });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(body.held).toBe(1);
    expect(rpcs("declutter_manager_payout_executed")).toHaveLength(0);
    expect(rpcs("payout_defer").map((c) => c.args)).toContainEqual({ p_kind: "declutter_manager", p_payout_id: MPAYOUT, p_minutes: 60 });
    // Caught by the up-front hold check on the MANAGER, before any Stripe call (not only by the last re-check).
    expect(stripeMock.transfers.list).not.toHaveBeenCalled();
    expect(rpcs("payout_payee_wait_seen").map((c) => c.args)).toContainEqual(expect.objectContaining({
      p_kind: "declutter_manager", p_payee: MANAGER, p_category: "held", p_reason: "the manager is on an admin payout hold",
    }));
  });

  it("a manager with no payout account yet waits (never paid to the seller), no try used", async () => {
    const { body } = await run({ managerPayouts: [managerRow({ stripe_account_id: null })] });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(body.manager_payouts_sent).toBe(0);
    expect(rpcs("payout_payee_wait_seen").map((c) => c.args)).toContainEqual(expect.objectContaining({
      p_kind: "declutter_manager", p_payout_id: MPAYOUT, p_payee: MANAGER, p_category: "no_account",
    }));
  });

  it("the manager queue not deployed yet (PGRST202) stops nothing else", async () => {
    scenario.rpcErrors = { declutter_manager_payouts_due: { message: "Could not find the function", code: "PGRST202" } };
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_seller1", capabilities: { transfers: "active" }, payouts_enabled: true });
    stripeMock.transfers.create.mockResolvedValue({ id: "tr_seller_new", destination: "acct_seller1" });
    const { status, body } = await run({ payouts: [sellerRow()] });
    expect(status).toBe(200);
    expect(body.payouts_sent).toBe(1);
  });
});
