/**
 * Q1806, the mixed half: a job paid PARTLY by gift and partly by card,
 * cancelled late, whose card payment is smaller than the late-cancellation fee
 * plus the card fee the platform keeps.
 *
 * Before the fix (origin/main a9e69a677) void-cancelled-payments took the
 * whole fee from the card leg and restored the WHOLE gift:
 *   - captured card leg: the refund is $0, the Helpr's fee transfer linked the
 *     $50 charge as source_transaction although the transfer is larger than
 *     it (Stripe: "the amount of the transfer must not exceed the amount of
 *     the source charge", and the SUM of linked transfers must not either),
 *     and the gift came back whole, so the fee was not covered by the
 *     poster's money (never absorb a fee);
 *   - uncaptured hold: it asked Stripe to capture the whole fee from a
 *     smaller hold, which Stripe refuses, every hour.
 * Now (lh-money-escrow design review of Q1806, 2026-10-17): the card pays
 * first; the gift keeps only what the fees owed plus the card's kept fees
 * (card fee, setup fee) exceed what the card still holds; a hold is captured
 * only up to what it allows, priced by the SAME formula as a captured charge;
 * a fee transfer links the charge only while it fits; and the job stays in
 * escrow (paged) when the gift cannot cover the gap or the fee is not on its
 * ledger.
 *
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if (feeCents > holdCents) { | if (false) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts | const captureCents = Math.min(feeCents, holdCents); | const captureCents = feeCents;
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if (cardShortCents > 0) { | if (false) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts | blockFeeCents - (capturedCents - Math.max(0, chargeRefundedCents)))) | blockFeeCents - capturedCents))
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if (!cardGift && chargeRefundedCents > voidSplit.ceilingCents + 1) { | if (chargeRefundedCents > voidSplit.ceilingCents + 1) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if (cardGift && !refundFeeOnLedger) { | if (false) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if (funding.donationReversed \|\| funding.cents < shortCents) { | if (funding.cents < shortCents) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if (funding.donationReversed \|\| funding.cents < shortCents) { | if (funding.donationReversed) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts | Math.max(0, cardNonRefundableCents(captureCents, actualOrEstimatedFeeCents(captured, captureCents)) + owedCents - captureCents) | Math.max(0, actualOrEstimatedFeeCents(captured, captureCents) + owedCents - captureCents)
 * @mutate supabase/functions/void-cancelled-payments/index.ts | }, "fee capture", holdGiftKeptCents, | }, "fee capture", 0,
 * @mutate supabase/functions/void-cancelled-payments/index.ts | }, "refund", cardGiftKeptCents, | }, "refund", 0,
 * @mutate supabase/functions/_shared/money.ts | return total <= chargeCents ? chargeId : undefined; | return chargeId;
 * @mutate supabase/functions/_shared/money.ts | const total = linked + | const total = 0 +
 * @mutate supabase/functions/_shared/money.ts | const chargeCents = Math.min(...figures) - Math.max(0, Math.round(Number(charge?.amount_refunded ?? 0))); | const chargeCents = Math.min(...figures);
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { sourceChargeFor } from "../../../supabase/functions/_shared/money.ts";

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

function giftRpc(dryOutcome: Record<string, unknown> = { outcome: "would_restore", credit_id: "gift-1", applied_cents: GIFT, restore_cents: GIFT }) {
  scenario.rpc.restore_gift_card_for_job = (args?: unknown) => {
    const a = (args ?? {}) as { p_dry_run?: boolean; p_share_bps?: number };
    if (a.p_dry_run) return dryOutcome;
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

const capturedPi = (over: Record<string, unknown> = {}) => ({
  id: "pi_1", status: "succeeded", amount: CARD, amount_received: CARD,
  latest_charge: { id: "ch_1", amount: CARD, amount_refunded: 0, balance_transaction: { fee: CARD_FEE }, ...over },
});
const heldPi = () => ({ id: "pi_1", status: "requires_capture", amount: CARD, amount_capturable: CARD, latest_charge: "ch_1" });

const restoreCalls = () =>
  (scenario.rpcCalls ?? []).filter((c) => c.name === "restore_gift_card_for_job").map((c) => c.args as Record<string, unknown>);
const restoredCents = () => {
  const m = restoreCalls().filter((c) => !c.p_dry_run)[0];
  return m ? Math.floor((GIFT * Number(m.p_share_bps ?? 10000)) / 10000) : null;
};
const feeTransferCalls = () =>
  stripeMock.transfers.create.mock.calls.filter(([p]) => (p as { metadata?: { type?: string } }).metadata?.type === "cancellation_fee");
const jobFlips = () =>
  scenario.writes.filter((w) => w.table === "jobs" && w.op === "update" && (w.payload as { payment_status?: string }).payment_status);
const shortfallPaged = () =>
  (slackAlerts as Array<{ title?: string }>).some((a) => /owes more in fees than its card and gift paid/.test(String(a.title)));

function reset() {
  resetEnv();
  resetSupabaseMock();
  resetStripeMock();
  resetSharedMocks();
}

describe("void-cancelled-payments: a gift-plus-card job whose card share is smaller than the late fee (Q1806, mixed half)", () => {
  beforeEach(reset);

  it("captured card leg: the gift keeps the fee's shortfall, the fee transfer links no charge it does not fit in, no card refund", async () => {
    seed();
    stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
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
    expect(jobFlips()).toHaveLength(1);
    // Expected, not an ops page: the $0-refund alert stays quiet.
    expect((slackAlerts as Array<{ title?: string }>).some((a) => /\$0 refund/.test(String(a.title)))).toBe(false);
  });

  it("uncaptured hold: captures only what the hold allows, and the gift keeps the rest of the fee", async () => {
    seed();
    stripeMock.paymentIntents.retrieve.mockResolvedValueOnce(heldPi());
    stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
    const h = await load();
    await h.fetch(cronReq());

    const captures = stripeMock.paymentIntents.capture.mock.calls;
    expect(captures).toHaveLength(1);
    const asked = (captures[0][1] as { amount_to_capture?: number } | undefined)?.amount_to_capture;
    expect(asked).toBe(CARD);
    expect(feeTransferCalls()[0][0]).not.toHaveProperty("source_transaction");
    const restored = restoredCents();
    expect(restored).not.toBeNull();
    expect(restored!).toBeLessThanOrEqual(GIFT - SHORT);
    expect(restored!).toBeGreaterThan(GIFT - SHORT - 5);
  });

  it("review #1: the hold path and the captured path price the same shortfall (card fee above Stripe's, a kept setup fee)", async () => {
    // A $3 card-cost fee (more than Stripe's 175c) and a first job's $2 setup fee: both kept from the card.
    const job = mixedJob({ customer_fee_amount: 3, onboarding_fee_amount: 2 });
    const want = 300 + 200 + FEE - CARD;
    const run = async (hold: boolean) => {
      reset();
      seed(job);
      if (hold) stripeMock.paymentIntents.retrieve.mockResolvedValueOnce(heldPi());
      stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
      const h = await load();
      await h.fetch(cronReq());
      return restoredCents();
    };
    const viaHold = await run(true);
    const viaCaptured = await run(false);
    expect(viaHold).not.toBeNull();
    expect(viaHold).toBe(viaCaptured);
    expect(viaHold!).toBeLessThanOrEqual(GIFT - want);
    expect(viaHold!).toBeGreaterThan(GIFT - want - 5);
  });

  it("review #2: an earlier refund on the card (the duplicate $2 setup fee) is covered by the gift and does not stop the settlement", async () => {
    seed();
    stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi({ amount_refunded: 200 }));
    const h = await load();
    await h.fetch(cronReq());

    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    const restored = restoredCents();
    expect(restored).not.toBeNull();
    expect(restored!).toBeLessThanOrEqual(GIFT - SHORT - 200);
    expect(restored!).toBeGreaterThan(GIFT - SHORT - 205);
    expect(jobFlips()).toHaveLength(1);
  });

  it("review #4: a fee that never reached its ledger keeps nothing from the gift and leaves the job in escrow", async () => {
    seed();
    scenario.writeErrors.cancellation_fee_transfers = { message: "claim insert failed" };
    stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
    const h = await load();
    await h.fetch(cronReq());

    expect(feeTransferCalls()).toHaveLength(0);
    expect(restoreCalls().filter((c) => !c.p_dry_run)).toHaveLength(0);
    expect(jobFlips()).toHaveLength(0);
  });

  it("no gift behind the shortfall: no money moves, the job stays in escrow, and a person is paged (never absorb a fee)", async () => {
    for (const hold of [false, true]) {
      reset();
      seed();
      giftRpc({ outcome: "no_credit" });
      if (hold) stripeMock.paymentIntents.retrieve.mockResolvedValueOnce(heldPi());
      stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
      const h = await load();
      await h.fetch(cronReq());
      expect(stripeMock.paymentIntents.capture).not.toHaveBeenCalled();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(jobFlips()).toHaveLength(0);
      expect(shortfallPaged()).toBe(true);
    }
  });

  it("a gift whose donation was reversed funds nothing: no money moves and a person is paged", async () => {
    seed();
    scenario.reads.gift_cards = { rows: [{ payment_status: "refunded" }] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
    const h = await load();
    await h.fetch(cronReq());

    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(jobFlips()).toHaveLength(0);
    expect(shortfallPaged()).toBe(true);
  });

  it("an ordinary card-only job still links its fee to its charge", async () => {
    seed(mixedJob({ budget: 300 }));
    giftRpc({ outcome: "no_credit" });
    stripeMock.refunds.create.mockResolvedValue({ id: "re_1", amount: 14500 });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_1", status: "succeeded", amount: 30000, amount_received: 30000,
      latest_charge: { id: "ch_1", amount: 30000, amount_refunded: 0, balance_transaction: { fee: 900 } },
    });
    const h = await load();
    await h.fetch(cronReq());

    expect((feeTransferCalls()[0][0] as { source_transaction?: string }).source_transaction).toBe("ch_1");
    expect(shortfallPaged()).toBe(false);
  });
});

describe("sourceChargeFor: a transfer is linked to a charge only while the transfers on it fit (Stripe)", () => {
  const pi = { amount: 10000, amount_received: 10000, latest_charge: { id: "ch_1", amount: 10000, amount_refunded: 0 } };

  it("links a transfer that fits, refuses one that does not", () => {
    expect(sourceChargeFor(pi, 10000)).toBe("ch_1");
    expect(sourceChargeFor(pi, 10001)).toBeUndefined();
  });

  it("counts what is already linked to the charge, reversed transfers included, and nothing linked elsewhere", () => {
    const prior = [
      { amount: 6000, source_transaction: "ch_1" },
      { amount: 3000, source_transaction: { id: "ch_1" }, reversed: true },
      { amount: 9000, source_transaction: "ch_other" },
    ];
    expect(sourceChargeFor(pi, 1000, prior)).toBe("ch_1");
    expect(sourceChargeFor(pi, 1001, prior)).toBeUndefined();
    expect(sourceChargeFor(pi, 500, prior, 600)).toBeUndefined();
  });

  it("takes the smallest captured figure, less what was refunded, and links nothing without a charge", () => {
    expect(sourceChargeFor({ amount: 10000, amount_received: 4000, latest_charge: "ch_1" }, 4001)).toBeUndefined();
    expect(sourceChargeFor({ amount: 10000, amount_received: 4000, latest_charge: "ch_1" }, 4000)).toBe("ch_1");
    expect(sourceChargeFor({ ...pi, latest_charge: { ...pi.latest_charge, amount_refunded: 2500 } }, 7501)).toBeUndefined();
    expect(sourceChargeFor({ amount: 10000, latest_charge: null }, 1)).toBeUndefined();
    expect(sourceChargeFor(null, 1)).toBeUndefined();
  });
});
