/**
 * Q1806, the open half (WIP: red on main, fix not built): a job paid PARTLY by
 * gift and partly by card, cancelled late, whose card payment is smaller than
 * the late-cancellation fee plus the card fee the platform keeps.
 *
 * On origin/main (a9e69a677) void-cancelled-payments takes the whole fee from
 * the card leg and restores the WHOLE gift (settleCancelledJob with no
 * withhold):
 *   - captured card leg: the refund is $0, the Helpr's fee transfer links the
 *     $50 charge as source_transaction although the transfer is larger than
 *     it (Stripe: "the amount of the transfer must not exceed the amount of
 *     the source charge"), and the gift comes back whole, so the fee is not
 *     covered by the poster's money (never absorb a fee);
 *   - uncaptured hold: it asks Stripe to capture the whole fee from a smaller
 *     hold, which Stripe refuses, every hour.
 * Wanted (lh-money-escrow design review of Q1806, 2026-10-17, "gift plus
 * card"): the fee comes from the card first; withhold from the gift only the
 * amount by which fee + block fees + the kept card fee exceed the card
 * capture; capture what the hold allows; send the fee without a source charge
 * it does not fit in.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret-void-gift-card-fee";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_void",
    CRON_SECRET,
  });
  return loadEdgeFunction("void-cancelled-payments");
}

const cronReq = () =>
  new Request("https://x/functions/v1/void-cancelled-payments", {
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });

/** $300 single-Helpr job: a $250 gift plus a $50 card payment, cancelled 1 hour before a 10:00 Central start: 50%, a $150 fee. */
const mixedJob = (over: Record<string, unknown> = {}) => ({
  id: "job-1",
  title: "Mow the lawn",
  stripe_session_id: "cs_1",
  stripe_payment_intent_id: "pi_1",
  budget: 300,
  customer_fee_amount: 0,
  platform_fee_percent: 0,
  cancellation_fee: 150,
  date_needed: "2024-06-25",
  start_time: "10:00:00",
  cancelled_at: "2024-06-25T14:00:00Z",
  helper_id: "helper-1",
  helper_confirmed_at: "2024-06-20T00:00:00Z",
  customer_id: "poster-1",
  helper_fee_percent: 10,
  is_group_job: false,
  helpers_needed: 1,
  parent_job_id: null,
  recurrence_days: null,
  ...over,
});

const GIFT = 25000;
const CARD = 5000;
const FEE = 15000;
/** Stripe's fee on the $50 card charge (2.9% + 30c). */
const CARD_FEE = 175;
/** What the gift must keep: fee + kept card fee - card capture. */
const SHORT = FEE + CARD_FEE - CARD;

function giftRpc() {
  scenario.rpc.restore_gift_card_for_job = (args?: unknown) => {
    const a = (args ?? {}) as { p_dry_run?: boolean; p_share_bps?: number };
    if (a.p_dry_run) return { outcome: "would_restore", credit_id: "gift-1", applied_cents: GIFT, restore_cents: GIFT };
    const bps = a.p_share_bps ?? 10000;
    return { outcome: "restored", credit_id: "gift-2", recipient_id: "poster-1", applied_cents: GIFT, restore_cents: Math.floor((GIFT * bps) / 10000) };
  };
}

function seed(job = mixedJob()) {
  scenario.reads.jobs = {
    selectOverrides: [
      { includes: "cancelled_at", result: { rows: [job] } },
      { includes: "cancellation_fee_status", result: { rows: [] } },
    ],
    rows: [],
  };
  scenario.reads.cancellation_fee_transfers = {
    selectOverrides: [
      { includes: "job_id, helper_id, fee_amount", result: { rows: [] } },
      { includes: "commission_percent", result: { rows: [] } },
    ],
    rows: [],
  };
  scenario.writeSelectRows["cancellation_fee_transfers:insert"] = [{
    id: "fee-1", job_id: "job-1", helper_id: "helper-1", status: "pending", stripe_transfer_id: null,
    created_at: new Date().toISOString(), fee_amount: 150, commission_percent: 12, platform_cut: 18, helper_amount: 132,
  }];
  scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper", subscription_tier: null }] };
  scenario.reads.payment_refunds = { rows: [] };
  scenario.reads.gift_cards = { rows: [{ payment_status: "paid" }] };
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_fee" });
  stripeMock.refunds.create.mockResolvedValue({ id: "re_1", amount: 0 });
  giftRpc();
}

const restoreCalls = () =>
  (scenario.rpcCalls ?? []).filter((c) => c.name === "restore_gift_card_for_job").map((c) => c.args as Record<string, unknown>);
const restoredCents = () => {
  const m = restoreCalls().filter((c) => !c.p_dry_run)[0];
  return m ? Math.floor((GIFT * Number(m.p_share_bps ?? 10000)) / 10000) : null;
};
const feeTransferCalls = () =>
  stripeMock.transfers.create.mock.calls.filter(([p]) => (p as { metadata?: { type?: string } }).metadata?.type === "cancellation_fee");

describe("void-cancelled-payments: a gift-plus-card job whose card share is smaller than the late fee (Q1806, open half)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  it("captured card leg: the gift keeps the fee's shortfall, the fee transfer links no charge it does not fit in, no card refund", async () => {
    seed();
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_1", status: "succeeded", amount: CARD, amount_received: CARD,
      latest_charge: { id: "ch_1", amount: CARD, amount_refunded: 0, balance_transaction: { fee: CARD_FEE } },
    });
    const h = await load();
    await h.fetch(cronReq());

    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    const calls = feeTransferCalls();
    expect(calls).toHaveLength(1);
    const params = calls[0][0] as { amount: number; source_transaction?: string };
    expect(params.amount).toBe(13200);
    // A $132 transfer cannot draw on a $50 charge.
    expect(params.source_transaction).toBeUndefined();
    // The gift comes back less what the card could not cover.
    const restored = restoredCents();
    expect(restored).not.toBeNull();
    expect(restored!).toBeLessThanOrEqual(GIFT - SHORT);
    expect(restored!).toBeGreaterThan(GIFT - SHORT - 5);
  });

  it("uncaptured hold: captures only what the hold allows, and the gift keeps the rest of the fee", async () => {
    seed();
    stripeMock.paymentIntents.retrieve.mockResolvedValueOnce({
      id: "pi_1", status: "requires_capture", amount: CARD, amount_capturable: CARD, latest_charge: "ch_1",
    });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_1", status: "succeeded", amount: CARD, amount_received: CARD,
      latest_charge: { id: "ch_1", amount: CARD, amount_refunded: 0, balance_transaction: { fee: CARD_FEE } },
    });
    const h = await load();
    await h.fetch(cronReq());

    const captures = stripeMock.paymentIntents.capture.mock.calls;
    expect(captures).toHaveLength(1);
    const asked = (captures[0][1] as { amount_to_capture?: number } | undefined)?.amount_to_capture;
    expect(asked).toBeLessThanOrEqual(CARD);
    const restored = restoredCents();
    expect(restored).not.toBeNull();
    expect(restored!).toBeLessThanOrEqual(GIFT - SHORT);
    expect(restored!).toBeGreaterThan(GIFT - SHORT - 5);
  });
});
