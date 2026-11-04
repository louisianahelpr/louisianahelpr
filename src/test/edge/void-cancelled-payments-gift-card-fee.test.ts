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
 * ledger. Q2000 (owner, 2026-10-17, option A): when the gift can NEVER pay
 * (its donation was reversed, or it was already given back) on a single-Helpr
 * job, the fee is capped at what the card covered and the job settles.
 *
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if (holdSplit.feesExceedHold) { | if (false) {
 * @mutate supabase/functions/_shared/posterCancelSplit.ts | const captureCents = feesCents > 0 ? Math.min(feesCents, holdCents) : 0; | const captureCents = feesCents;
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if (cardShortCents > 0 && !feesFitCard) { | if (false) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if (cardShortCents > 0 && !feesFitCard) { | if (cardShortCents > 0) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts | blockFeeCents - (capturedCents - Math.max(0, chargeRefundedCents)))) | blockFeeCents - capturedCents))
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if (!cardGift && !cardGiftGone && chargeRefundedCents > voidSplit.ceilingCents + 1) { | if (!cardGiftGone && chargeRefundedCents > voidSplit.ceilingCents + 1) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if ((cardGift \|\| cardGiftGone) && !refundFeeOnLedger) { | if (false) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if (funding.donationReversed \|\| funding.cents < shortCents) { | if (funding.cents < shortCents) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if (funding.donationReversed \|\| funding.cents < shortCents) { | if (funding.donationReversed) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts | Math.max(0, cardNonRefundableCents(captureCents, actualOrEstimatedFeeCents(captured, captureCents)) + owedCents - captureCents) | Math.max(0, actualOrEstimatedFeeCents(captured, captureCents) + owedCents - captureCents)
 * @mutate supabase/functions/void-cancelled-payments/index.ts | }, "fee capture", holdGiftKeptCents, | }, "fee capture", 0,
 * @mutate supabase/functions/void-cancelled-payments/index.ts | }, "refund", cardGiftKeptCents, | }, "refund", 0,
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if ((funding.donationReversed \|\| funding.restored) && !crewShares && blockFeeRows.length === 0) { | if (false) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if ((funding.donationReversed \|\| funding.restored) && !crewShares && blockFeeRows.length === 0) { | if (!crewShares && blockFeeRows.length === 0) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts | cancellationFee = Math.min(feeOwedCents, cardLeftCents + cardGift.cents) / 100; | cancellationFee = feeOwedCents / 100;
 * @mutate supabase/functions/void-cancelled-payments/index.ts | cancellationFee = Math.min(Math.round(cancellationFee * 100), cardLeftCents + holdGiftKeptOnlyCents) / 100; | cancellationFee = cancellationFee;
 * @mutate supabase/functions/void-cancelled-payments/index.ts | ...(cardGiftGone \|\| crewShareReturned ? { cancellation_fee: cancellationFee } : {}), | ...(crewShareReturned ? { cancellation_fee: cancellationFee } : {}),
 * @mutate supabase/functions/void-cancelled-payments/index.ts | } else if (cardGift \|\| cardGiftGone) { | } else if (cardGift) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts | }, "refund", cardGiftKeptCents, giftKeptBreakdown( | }, "refund", cardGiftKeptCents, undefined && giftKeptBreakdown(
 * @mutate supabase/functions/void-cancelled-payments/index.ts | }, "fee capture", holdGiftKeptCents, giftKeptBreakdown( | }, "fee capture", holdGiftKeptCents, undefined && giftKeptBreakdown(
 * @mutate supabase/functions/void-cancelled-payments/index.ts | const costs = Math.max(0, total - feeCents - blockCents); | const costs = 0;
 * @mutate supabase/functions/_shared/money.ts | return total <= chargeCents ? chargeId : undefined; | return chargeId;
 * @mutate supabase/functions/_shared/money.ts | const total = linked + | const total = 0 +
 * @mutate supabase/functions/_shared/money.ts | const chargeCents = Math.min(...figures) - Math.max(0, Math.round(Number(charge?.amount_refunded ?? 0))); | const chargeCents = Math.min(...figures);
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock, PAYABLE_CONNECT_ACCOUNT } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { sourceChargeFor } from "../../../supabase/functions/_shared/money.ts";

const CRON_SECRET = "cron-secret-void-gift-card-fee";

async function load(extraEnv: Record<string, string> = {}): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_void",
    CRON_SECRET,
    ...extraEnv,
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
    const a = (args ?? {}) as { p_dry_run?: boolean; p_share_bps?: number; p_restore_cents?: number };
    if (a.p_dry_run) return dryOutcome;
    const bps = a.p_share_bps ?? 10000;
    // Q1914: exact cents when given (capped to the gift), else the basis-point share.
    const cents = a.p_restore_cents !== undefined ? Math.min(Math.max(a.p_restore_cents, 0), GIFT) : Math.floor((GIFT * bps) / 10000);
    return { outcome: "restored", credit_id: "gift-2", recipient_id: "poster-1", applied_cents: GIFT, restore_cents: cents };
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
/** A PaymentIntent's job-site tax metadata, built apart from the PI literal (fixtureSchemaContract read a PI mock
 * carrying tax_calculation_id as a recurring_visit_payments row). */
const siteTaxMd = (calc: string, taxCents: number, extra: Record<string, string> = {}) => ({ tax_calculation_id: calc, job_tax_cents: String(taxCents), ...extra });
const heldPi = () => ({ id: "pi_1", status: "requires_capture", amount: CARD, amount_capturable: CARD, latest_charge: "ch_1" });

/** The spent gift row, reversed: it is the root of its tree, so it carries the donor's PaymentIntent. */
const reversedGift = () => {
  scenario.reads.gift_cards = { rows: [{ id: "gift-spent", payment_status: "refunded", parent_credit_id: null, stripe_payment_intent_id: "pi_gift" }] };
};
const restoreCalls = () =>
  (scenario.rpcCalls ?? []).filter((c) => c.name === "restore_gift_card_for_job").map((c) => c.args as Record<string, unknown>);
const restoredCents = () => {
  const m = restoreCalls().filter((c) => !c.p_dry_run)[0];
  if (!m) return null;
  if (m.p_restore_cents !== undefined) return Math.min(Math.max(Number(m.p_restore_cents), 0), GIFT);
  return Math.floor((GIFT * Number(m.p_share_bps ?? 10000)) / 10000);
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
  resetStripeMock(); stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT);
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

  // Review fix (lh-money-escrow on aa8869511 #3, Q1728 option A): the gift paid the whole job and the card
  // paid the $10 job-site sales tax alone. Fees never come out of the tax: the gift keeps the $150 fee and the
  // card fee, and the card gets its whole $10 tax back (charge.refunded then reverses it in full).
  // @mutate supabase/functions/void-cancelled-payments/index.ts |           const capturedCents = chargeCapturedCents - siteTaxOnCardCents; |           const capturedCents = chargeCapturedCents;
  // Re-review of 49a8653d81 (B): the fees the gift kept keep their tax (at the job's rate, job_taxable_cents);
  // only the rest of the tax goes back.
  // @mutate supabase/functions/void-cancelled-payments/index.ts |             ? voidSplit.refundCents + siteTaxBackCents - siteTaxOnGiftKeptCents |             ? voidSplit.refundCents
  // @mutate supabase/functions/void-cancelled-payments/index.ts |             ? voidSplit.refundCents + siteTaxBackCents - siteTaxOnGiftKeptCents |             ? voidSplit.refundCents + siteTaxBackCents
  it("tax-only card charge: the gift keeps every fee, and the tax goes back less the tax on those fees", async () => {
    seed();
    const TAX = 1000;
    const TAXABLE = 30000;
    const TAX_CARD_FEE = 59;
    stripeMock.refunds.create.mockResolvedValue({ id: "re_tax", amount: TAX });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_1", status: "succeeded", amount: TAX, amount_received: TAX,
      metadata: siteTaxMd("taxcalc_gift", TAX, { job_taxable_cents: String(TAXABLE) }),
      latest_charge: { id: "ch_1", amount: TAX, amount_refunded: 0, balance_transaction: { fee: TAX_CARD_FEE } },
    });
    const h = await load();
    await h.fetch(cronReq());

    const refunds = stripeMock.refunds.create.mock.calls.map(([p]) => (p as { amount?: number }).amount);
    const restored = restoredCents();
    expect(restored).not.toBeNull();
    // What the gift kept (the $150 fee + the card fee) keeps its tax: ceil(kept x $10 / $300).
    const giftKept = GIFT - restored!;
    expect(giftKept).toBeGreaterThan(FEE);
    expect(refunds).toEqual([TAX - Math.ceil((giftKept * TAX) / TAXABLE)]);
    expect(restored!).toBeLessThanOrEqual(GIFT - FEE - TAX_CARD_FEE);
    expect(restored!).toBeGreaterThan(GIFT - FEE - TAX_CARD_FEE - 5);
    expect(jobFlips()).toHaveLength(1);
  });

  // Q2719: a FREE cancel on a tax-only card charge still has the gift keep the card fee and the setup fee
  // (owner rule: never absorb a fee); before, feesFitCard read 0 <= 0 and the whole tax went back.
  // @mutate supabase/functions/void-cancelled-payments/index.ts |           const feesFitCard = (siteTaxOnCardCents > 0 ? keptOfCard : 0) + feeOwedCents | const feesFitCard = feeOwedCents
  it("free cancel on a tax-only card charge: the gift keeps the card fee and the setup fee (Q2719)", async () => {
    seed(mixedJob({ cancellation_fee: 0, cancelled_at: "2024-06-18T14:00:00Z", onboarding_fee_amount: 2 }));
    const TAX = 1000;
    const TAXABLE = 30000;
    const TAX_CARD_FEE = 59;
    const SETUP = 200;
    stripeMock.refunds.create.mockResolvedValue({ id: "re_tax", amount: TAX });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_1", status: "succeeded", amount: TAX, amount_received: TAX,
      metadata: siteTaxMd("taxcalc_gift", TAX, { job_taxable_cents: String(TAXABLE) }),
      latest_charge: { id: "ch_1", amount: TAX, amount_refunded: 0, balance_transaction: { fee: TAX_CARD_FEE } },
    });
    const h = await load();
    await h.fetch(cronReq());

    expect(feeTransferCalls()).toHaveLength(0);
    const restored = restoredCents();
    expect(restored).not.toBeNull();
    const giftKept = GIFT - restored!;
    // The gift keeps the card fee and the $2 setup fee (never the platform), within a few cents of rounding.
    expect(giftKept).toBeGreaterThanOrEqual(TAX_CARD_FEE + SETUP);
    expect(giftKept).toBeLessThan(TAX_CARD_FEE + SETUP + 5);
    // The tax goes back less the tax on what the gift kept.
    const refunds = stripeMock.refunds.create.mock.calls.map(([p]) => (p as { amount?: number }).amount);
    expect(refunds).toEqual([TAX - Math.ceil((giftKept * TAX) / TAXABLE)]);
    expect(jobFlips()).toHaveLength(1);
  });

  // Q2719 review: the same free cancel whose gift's donation was charged back (single Helpr): settled, the
  // platform keeps nothing it cannot collect, and the warning names the card + setup fee, not a late cancel.
  // @mutate supabase/functions/void-cancelled-payments/index.ts |           : "cancelled with no late fee. The card paid only the sales tax, less than the card fee and setup fee a cancel keeps"; |           : "cancelled late. The card paid less than the fee";
  it("free cancel on a tax-only charge whose gift's donation was reversed: settles and warns about the card + setup fee (Q2719)", async () => {
    seed(mixedJob({ cancellation_fee: 0, cancelled_at: "2024-06-18T14:00:00Z", onboarding_fee_amount: 2 }));
    reversedGift();
    const TAX = 1000;
    stripeMock.refunds.create.mockResolvedValue({ id: "re_tax", amount: TAX });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_1", status: "succeeded", amount: TAX, amount_received: TAX,
      metadata: siteTaxMd("taxcalc_gift", TAX, { job_taxable_cents: "30000" }),
      latest_charge: { id: "ch_1", amount: TAX, amount_refunded: 0, balance_transaction: { fee: 59 } },
    });
    const h = await load();
    await h.fetch(cronReq());
    const alerts = slackAlerts as Array<{ title?: string; message?: string }>;
    const capped = alerts.filter((a) => a.title === "Cancellation fee capped at what the card paid");
    expect(capped).toHaveLength(1);
    expect(capped[0].message).toContain("cancelled with no late fee");
    expect(capped[0].message).not.toContain("cancelled late");
    expect(feeTransferCalls()).toHaveLength(0);
    expect(jobFlips()).toHaveLength(1);
  });

  // Q2718 (lead 2026-11-04): a NEAR-tax-only charge (card $4.00 = $3.00 labor + $1.00 tax; card fee $1.50 + setup
  // $2.00 = $3.50 kept) is priced by the same rule as a tax-only one: the card keeps its $3.00 non-tax part, the
  // gift keeps the other $0.50, and the tax goes back less the tax on all $3.50 kept (job rate). Before, the sweep
  // read it as an ordinary charge: the card kept $3.50 (50c of it out of the tax) and the gift came back whole.
  // @mutate supabase/functions/void-cancelled-payments/index.ts |             ? Math.min(chargeCapturedCents, piSiteTaxCents)\n            : 0; |             ? 0\n            : 0;
  // @mutate supabase/functions/void-cancelled-payments/index.ts |               keptCents: Math.max(0, capturedCents - Math.max(0, chargeRefundedCents) - voidSplit.refundCents) + cardGiftKeptCents, |               keptCents: cardGiftKeptCents,
  const NEAR = { CARD: 400, TAX: 100, TAXABLE: 30000, CARD_FEE: 150, SETUP: 200 };
  const nearTaxPi = (refunded = 0) => ({
    id: "pi_1", status: "succeeded", amount: NEAR.CARD, amount_received: NEAR.CARD,
    metadata: siteTaxMd("taxcalc_near", NEAR.TAX, { job_taxable_cents: String(NEAR.TAXABLE) }),
    latest_charge: { id: "ch_1", amount: NEAR.CARD, amount_refunded: refunded, balance_transaction: { fee: NEAR.CARD_FEE } },
  });
  const nearKept = NEAR.CARD_FEE + NEAR.SETUP;
  const nearGiftKept = nearKept - (NEAR.CARD - NEAR.TAX);
  const nearTaxBack = NEAR.TAX - Math.ceil((nearKept * NEAR.TAX) / NEAR.TAXABLE);
  const freeCancelJob = (over: Record<string, unknown> = {}) =>
    mixedJob({ cancellation_fee: 0, cancelled_at: "2024-06-18T14:00:00Z", onboarding_fee_amount: 2, ...over });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | const jobTaxBackMetadata = jobTaxBackCents !== null ? | const jobTaxBackMetadata = false ?
  // @mutate supabase/functions/void-cancelled-payments/index.ts |               ? Math.max(0, piSiteTaxCents - voidSplit.taxKeptCents) |               ? Math.max(0, piSiteTaxCents)
  it("near-tax-only charge: the gift keeps what the non-tax part misses, the tax goes back less the tax on all kept (Q2718)", async () => {
    seed(freeCancelJob());
    stripeMock.refunds.create.mockResolvedValue({ id: "re_near", amount: nearTaxBack });
    stripeMock.paymentIntents.retrieve.mockResolvedValue(nearTaxPi());
    const h = await load();
    await h.fetch(cronReq());

    const restored = restoredCents();
    expect(restored).not.toBeNull();
    expect(GIFT - restored!).toBe(nearGiftKept);
    const refunds = stripeMock.refunds.create.mock.calls.map(([p]) => (p as { amount?: number }).amount);
    expect(refunds).toEqual([nearTaxBack]);
    // Q2717: the refund carries the tax it returns, for an exact Stripe Tax reversal.
    expect((stripeMock.refunds.create.mock.calls[0][0] as { metadata?: Record<string, string> }).metadata).toEqual({ job_tax_back_cents: String(nearTaxBack) });
    expect(jobFlips()).toHaveLength(1);
    expect((slackAlerts as Array<{ title?: string }>).some((a) => a.title === "Cancelled job's fees would come out of its sales tax")).toBe(false);
  });

  it("an ordinary taxed charge whose non-tax part holds the kept fees settles as before: gift back whole (Q2718 control)", async () => {
    seed(freeCancelJob());
    const CARD1 = 1000;
    stripeMock.refunds.create.mockResolvedValue({ id: "re_ord", amount: 0 });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      ...nearTaxPi(), amount: CARD1, amount_received: CARD1,
      latest_charge: { id: "ch_1", amount: CARD1, amount_refunded: 0, balance_transaction: { fee: NEAR.CARD_FEE } },
    });
    const h = await load();
    await h.fetch(cronReq());
    expect(restoredCents()).toBe(GIFT);
    const refunds = stripeMock.refunds.create.mock.calls.map(([p]) => (p as { amount?: number }).amount);
    expect(refunds).toEqual([CARD1 - nearKept - Math.ceil((nearKept * NEAR.TAX) / NEAR.TAXABLE)]);
    // Q2717: an ordinary taxed charge with no earlier refund stamps the tax less the tax kept.
    expect((stripeMock.refunds.create.mock.calls[0][0] as { metadata?: Record<string, string> }).metadata).toEqual({ job_tax_back_cents: String(NEAR.TAX - Math.ceil((nearKept * NEAR.TAX) / NEAR.TAXABLE)) });
  });

  // Q2718: the gift cannot pay (its donation was charged back): the rest is not taken from the tax, and the
  // "fees would come out of its sales tax" page tells a person to look.
  // @mutate supabase/functions/void-cancelled-payments/index.ts |               if (siteTaxOnCardCents > 0 && keptOfCard > cardRoomCents) { |               if (false) {
  it("near-tax-only charge whose gift cannot pay: settles without touching the tax and pages (Q2718)", async () => {
    seed(freeCancelJob());
    reversedGift();
    stripeMock.refunds.create.mockResolvedValue({ id: "re_near", amount: 0 });
    stripeMock.paymentIntents.retrieve.mockResolvedValue(nearTaxPi());
    const h = await load();
    await h.fetch(cronReq());
    const alerts = slackAlerts as Array<{ title?: string; message?: string }>;
    expect(alerts.filter((a) => a.title === "Cancelled job's fees would come out of its sales tax")).toHaveLength(1);
    // The card keeps only its $3.00 non-tax part; the tax goes back less the tax on that.
    const refunds = stripeMock.refunds.create.mock.calls.map(([p]) => (p as { amount?: number }).amount);
    expect(refunds).toEqual([NEAR.TAX - Math.ceil(((NEAR.CARD - NEAR.TAX) * NEAR.TAX) / NEAR.TAXABLE)]);
    expect(jobFlips()).toHaveLength(1);
  });

  // Q2718 end to end: cancel_escrow hands the near-tax-only job to the sweep (no money moved), and the sweep
  // then settles it by the rule above.
  it("cancel_escrow -> sweep on a near-tax-only charge: handed off, then the gift keeps 50c and the tax goes back (Q2718)", async () => {
    // 1) the poster cancels an unhired, escrowed job.
    scenario.authUser = { id: "poster-1", email: "poster@test.com" };
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_existing" }] });
    scenario.reads.jobs = {
      rows: [{ id: "job-1", customer_id: "poster-1", status: "open", payment_status: "escrow", stripe_payment_intent_id: "pi_1", budget: 300, customer_fee_amount: 0, onboarding_fee_amount: 2 }],
    };
    scenario.writeSelectRows.jobs = [{ id: "job-1" }];
    stripeMock.paymentIntents.retrieve.mockResolvedValue(nearTaxPi());
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_abc123" });
    const cp = await loadEdgeFunction("create-payment");
    const res = await cp.fetch(cp.request({ headers: { Authorization: "Bearer test-jwt" }, body: { action: "cancel_escrow", jobId: "job-1" } }));
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text())).toMatchObject({ settlesLater: true });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    const hand = scenario.writes.filter((w) => w.table === "jobs" && w.op === "update").pop();
    expect(hand?.payload).toMatchObject({ status: "cancelled", payment_status: "escrow" });

    // 2) the hourly sweep finds it (cancelled + escrow) and settles it.
    reset();
    seed(freeCancelJob({ helper_id: null, helper_confirmed_at: null, cancelled_at: (hand!.payload as { cancelled_at: string }).cancelled_at }));
    stripeMock.refunds.create.mockResolvedValue({ id: "re_near", amount: nearTaxBack });
    stripeMock.paymentIntents.retrieve.mockResolvedValue(nearTaxPi());
    const h = await load();
    await h.fetch(cronReq());
    expect(GIFT - restoredCents()!).toBe(nearGiftKept);
    const refunds = stripeMock.refunds.create.mock.calls.map(([p]) => (p as { amount?: number }).amount);
    expect(refunds).toEqual([nearTaxBack]);
    expect(jobFlips()).toHaveLength(1);
  });

  // Q2719 crew variant (B89 left it untested): a crew's free cancel on a tax-only charge whose gift's donation was
  // reversed is never capped (a crew cannot settle on the card alone): it pages "owes more in fees" naming the free
  // cancel, moves no money and stays in escrow for a person.
  // @mutate supabase/functions/void-cancelled-payments/index.ts | if ((funding.donationReversed \|\| funding.restored) && !crewShares && blockFeeRows.length === 0) { | if ((funding.donationReversed \|\| funding.restored) && blockFeeRows.length === 0) {
  it("crew free cancel on a tax-only charge whose gift's donation was reversed: pages and waits (Q2719)", async () => {
    seed(mixedJob({ cancellation_fee: 0, cancelled_at: "2024-06-18T14:00:00Z", onboarding_fee_amount: 2, is_group_job: true, helpers_needed: 3, helper_id: null, helper_confirmed_at: null }));
    scenario.reads.crew_cancellation_fee_shares = { rows: [] };
    reversedGift();
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_1", status: "succeeded", amount: 1000, amount_received: 1000,
      metadata: siteTaxMd("taxcalc_gift", 1000, { job_taxable_cents: "30000" }),
      latest_charge: { id: "ch_1", amount: 1000, amount_refunded: 0, balance_transaction: { fee: 59 } },
    });
    const h = await load();
    await h.fetch(cronReq());
    expect(shortfallPaged()).toBe(true);
    const page = (slackAlerts as Array<{ title?: string; message?: string }>).find((a) => /owes more in fees/.test(String(a.title)));
    expect(page?.message).toContain("cancelled with no late fee");
    expect((slackAlerts as Array<{ title?: string }>).some((a) => a.title === "Cancellation fee capped at what the card paid")).toBe(false);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(restoreCalls().filter((c) => !c.p_dry_run)).toHaveLength(0);
    expect(jobFlips()).toHaveLength(0);
  });

  // Re-review of 49a8653d81 (D): a hold of no more than its job-site tax pages ops; an ordinary hold does not.
  // @mutate supabase/functions/void-cancelled-payments/index.ts |           if (holdSiteTaxCents > 0 && Math.round(Number(pi.amount ?? 0)) <= holdSiteTaxCents) { |           if (false) {
  it("a hold that holds only its job-site tax pages ops", async () => {
    seed();
    stripeMock.paymentIntents.retrieve.mockResolvedValueOnce({ ...heldPi(), metadata: siteTaxMd("taxcalc_h", CARD) });
    stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
    const h = await load();
    await h.fetch(cronReq());
    const titles = (slackAlerts as Array<{ title?: string }>).map((a) => String(a.title));
    expect(titles).toContain("Cancelled job's card hold holds only its sales tax");
  });

  it("a hold larger than its job-site tax does not page", async () => {
    seed();
    stripeMock.paymentIntents.retrieve.mockResolvedValueOnce({ ...heldPi(), metadata: siteTaxMd("taxcalc_h", CARD - 1) });
    stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
    const h = await load();
    await h.fetch(cronReq());
    const titles = (slackAlerts as Array<{ title?: string }>).map((a) => String(a.title));
    expect(titles).not.toContain("Cancelled job's card hold holds only its sales tax");
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

  // Q2095: the poster's one notice states the fee the cancel dialog showed,
  // the card costs a refund never returns, and what came from the card and
  // what from the gift ($150 fee on a $50 card + $250 gift job).
  for (const [label, held] of [["captured card leg", false], ["uncaptured hold", true]] as const) {
    it(`Q2095 (${label}): the gift notice gives the fee, the card costs, the card part and the gift part`, async () => {
      seed();
      if (held) stripeMock.paymentIntents.retrieve.mockResolvedValueOnce(heldPi());
      stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
      const h = await load();
      await h.fetch(cronReq());

      const notes = scenario.writes.filter((w) => w.table === "notifications" && (w.payload as { title?: string }).title === "Your gift is back");
      expect(notes, label).toHaveLength(1);
      const msg = String((notes[0].payload as { message?: string }).message);
      const kept = GIFT - (restoredCents() ?? GIFT);
      expect(kept).toBeGreaterThan(0);
      // formatExactDollars: whole dollars carry no cents.
      const usd = (c: number) => (c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`);
      expect(msg).toContain(`The cancellation kept ${usd(CARD + kept)}: ${usd(FEE)} for your Helpr's time and ${usd(CARD + kept - FEE)} in card and setup costs a refund can't return.`);
      expect(msg).toContain(`${usd(CARD)} of it came from your card and ${usd(kept)} from the gift.`);
      // The old wording folded the card fee into "the cancellation fee".
      expect(msg).not.toMatch(/paid your Helpr/);
    });
  }

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

  // Q2097 (1) (lh-money-escrow@e03e43b8b#5): the hold pre-check estimated the
  // card fee at Klarna's 5.99% + 30c, but Afterpay costs 6% + 30c. A gift that
  // covers the 5.99% shortfall exactly passed the check, the hold was captured,
  // and the real fee left the gift a few cents short (the platform's cents).
  // The pre-check now takes the highest Pay-in-4 rate, so that gift is found
  // short BEFORE any money moves.
  // @mutate supabase/functions/_shared/stripeFees.ts |   return Math.round(amountCents * Math.max(...Object.values(STRIPE_BNPL_PCT))) + STRIPE_FLAT_CENTS; |   return Math.round(amountCents * 0.0599) + STRIPE_FLAT_CENTS;
  it("Q2097: an Afterpay hold is priced at Afterpay's 6% before capture: a gift short by the rate gap moves no money", async () => {
    const HOLD = 20000;
    /** 5.99% of the hold + 30c: what the old pre-check asked for. */
    const OLD_EST = Math.round(HOLD * 0.0599) + 30;
    /** Afterpay's real fee on the hold: 6% + 30c. */
    const AFTERPAY_FEE = Math.round(HOLD * 0.06) + 30;
    expect(AFTERPAY_FEE).toBeGreaterThan(OLD_EST);
    const fee = 50000;
    seed(mixedJob({ budget: 1000, cancellation_fee: fee / 100 }));
    // The gift paid exactly the old estimate's shortfall.
    const giftPaid = OLD_EST + fee - HOLD;
    giftRpc({ outcome: "would_restore", credit_id: "gift-1", applied_cents: giftPaid, restore_cents: giftPaid });
    stripeMock.paymentIntents.retrieve.mockResolvedValueOnce({
      id: "pi_1", status: "requires_capture", amount: HOLD, amount_capturable: HOLD, latest_charge: "ch_1",
      payment_method_types: ["afterpay_clearpay"],
    });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_1", status: "succeeded", amount: HOLD, amount_received: HOLD,
      latest_charge: { id: "ch_1", amount: HOLD, amount_refunded: 0, balance_transaction: { fee: AFTERPAY_FEE }, payment_method_details: { type: "afterpay_clearpay" } },
    });
    const h = await load();
    const res = await h.fetch(cronReq());
    const body = JSON.parse(await res.text());
    expect(stripeMock.paymentIntents.capture, JSON.stringify(body)).not.toHaveBeenCalled();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(jobFlips()).toHaveLength(0);
    expect(shortfallPaged()).toBe(true);
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

  // Q2000 (owner, 2026-10-17, option A): a gift that can NEVER pay its part
  // (donation reversed, or already given back) no longer parks the job in
  // escrow with a daily page. The Helpr gets the part of the fee the card
  // covered: the $50 card less its kept $1.75 card fee = $48.25. The gift's
  // part is not paid, by anyone (never absorb a fee).
  const CAPPED_FEE = (CARD - CARD_FEE) / 100;
  const cappedClaim = () => {
    scenario.writeSelectRows["cancellation_fee_transfers:insert"] = [{
      id: "fee-1", job_id: "job-1", helper_id: "helper-1", status: "pending", stripe_transfer_id: null,
      created_at: new Date().toISOString(), fee_amount: CAPPED_FEE, commission_percent: 12, platform_cut: 5.79, helper_amount: 42.46,
    }];
  };
  const feeClaims = () =>
    scenario.writes.filter((w) => w.table === "cancellation_fee_transfers" && w.op === "insert").map((w) => w.payload as Record<string, unknown>);
  const cappedPaged = () =>
    (slackAlerts as Array<{ title?: string }>).some((a) => /Cancellation fee capped at what the card paid/.test(String(a.title)));
  const giftWithheld = () => restoreCalls().filter((c) => !c.p_dry_run)
    .some((c) => (c.p_restore_cents !== undefined ? Number(c.p_restore_cents) < GIFT : Number(c.p_share_bps ?? 10000) < 10000));

  for (const [label, gone] of [
    ["the donation behind it was reversed", () => { reversedGift(); }],
    ["an earlier run already gave it back whole", () => { giftRpc({ outcome: "already_restored", credit_id: "gift-2", applied_cents: GIFT, restore_cents: GIFT }); }],
  ] as const) {
    it(`Q2000: a gift that can never pay (${label}): the card's part of the fee goes to the Helpr, the job settles, no daily page`, async () => {
      seed();
      gone();
      cappedClaim();
      stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
      const h = await load();
      await h.fetch(cronReq());

      // The fee is claimed at what the card covered, never the $150 ladder.
      expect(feeClaims().map((c) => Number(c.fee_amount))).toEqual([CAPPED_FEE]);
      const calls = feeTransferCalls();
      expect(calls).toHaveLength(1);
      // It fits in the $50 charge, so it draws on it.
      expect((calls[0][0] as { amount: number; source_transaction?: string }).amount).toBeLessThanOrEqual(CARD - CARD_FEE);
      expect((calls[0][0] as { source_transaction?: string }).source_transaction).toBe("ch_1");
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(giftWithheld()).toBe(false);
      // Settled, stamped with the fee actually paid (Q1345's stamp).
      expect(jobFlips().map((w) => w.payload)).toEqual([
        expect.objectContaining({ payment_status: "refunded", cancellation_fee_status: "charged", cancellation_fee: CAPPED_FEE }),
      ]);
      expect(shortfallPaged()).toBe(false);
      expect(cappedPaged()).toBe(true);
      // The card going wholly to the capped fee is expected, not a "$0 refund" alarm.
      expect((slackAlerts as Array<{ title?: string }>).some((a) => /\$0 refund/.test(String(a.title)))).toBe(false);
    });
  }

  // Q1806 review of 8354ebb0e #3: a capped fee that never reached its ledger
  // is not settled as 'charged' (Part E would have no row to pay); the job
  // stays in escrow and the next run prices the same cap.
  // @mutate supabase/functions/void-cancelled-payments/index.ts | if ((cardGift \|\| cardGiftGone) && !refundFeeOnLedger) { | if (cardGift && !refundFeeOnLedger) {
  it("Q2000: a capped fee whose ledger claim fails settles nothing", async () => {
    seed();
    reversedGift();
    scenario.writeErrors.cancellation_fee_transfers = { message: "claim insert failed" };
    stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(0);
    expect(jobFlips()).toHaveLength(0);
  });

  it("Q2000: on an uncaptured hold the whole hold is captured and the fee is capped at what it covered (same as the captured retry)", async () => {
    seed();
    reversedGift();
    cappedClaim();
    stripeMock.paymentIntents.retrieve.mockResolvedValueOnce(heldPi());
    stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
    const h = await load();
    await h.fetch(cronReq());

    const captures = stripeMock.paymentIntents.capture.mock.calls;
    expect(captures).toHaveLength(1);
    expect((captures[0][1] as { amount_to_capture?: number }).amount_to_capture).toBe(CARD);
    expect(feeClaims().map((c) => Number(c.fee_amount))).toEqual([CAPPED_FEE]);
    expect(giftWithheld()).toBe(false);
    expect(jobFlips().map((w) => w.payload)).toEqual([
      expect.objectContaining({ payment_status: "refunded", cancellation_fee_status: "charged", cancellation_fee: CAPPED_FEE }),
    ]);
    expect(shortfallPaged()).toBe(false);
  });

  it("Q2000 is only for a gift that can never pay: a would-restore gift smaller than the gap still parks the job and pages", async () => {
    seed();
    giftRpc({ outcome: "would_restore", credit_id: "gift-1", applied_cents: 100, restore_cents: 100 });
    stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
    const h = await load();
    await h.fetch(cronReq());

    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(jobFlips()).toHaveLength(0);
    expect(shortfallPaged()).toBe(true);
    expect(cappedPaged()).toBe(false);
  });

  // Build review of e03e43b8b #1: a card-only hold captured fee-only (an
  // earlier run died before settling) holds the fee but not also the card
  // fee. It settles as origin/main did; it is not parked in escrow and paged.
  it("a card-only hold captured fee-only on an earlier run settles on the retry, with no gift asked and no page", async () => {
    seed(mixedJob({ budget: 300 }));
    giftRpc({ outcome: "no_credit" });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_1", status: "succeeded", amount: 30900, amount_received: 15000,
      latest_charge: { id: "ch_1", amount: 30900, amount_captured: 15000, amount_refunded: 0, balance_transaction: { fee: 465 } },
    });
    const h = await load();
    await h.fetch(cronReq());

    expect(shortfallPaged()).toBe(false);
    expect(jobFlips().map((w) => w.payload)).toEqual([
      expect.objectContaining({ payment_status: "refunded", cancellation_fee_status: "charged" }),
    ]);
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

  // Review of 8354ebb0e #1: revoke_gift_card_for_refund stamps the gift
  // 'refunded' when a chargeback OPENS, and a won one is never flipped back by
  // itself. Option A's cap is for a FINAL loss only: a chargeback still open
  // (or won, gift not restored) on a captured charge waits in escrow; an
  // uncaptured hold (it expires) is capped now and the alert says what the
  // Helpr is owed if it is won. A plain refund or a lost dispute is final.
  const waitsPaged = () =>
    (slackAlerts as Array<{ title?: string }>).some((a) => /Cancellation fee waits for a chargeback on its gift/.test(String(a.title)));
  const cappedAlert = () =>
    (slackAlerts as Array<{ title?: string; message?: string; fields?: Record<string, unknown> }>).find((a) => /Cancellation fee capped at what the card paid/.test(String(a.title)));

  // @mutate supabase/functions/void-cancelled-payments/index.ts | if (funding.disputeOpen && !onHold) { | if (false) {
  // @mutate supabase/functions/void-cancelled-payments/index.ts | "warning_under_review", "won"]); | "warning_under_review"]);
  for (const status of ["needs_response", "under_review", "won"]) {
    it(`review #1: a chargeback on the gift's donation that is ${status} keeps a captured job in escrow: no fee, no refund, no cap`, async () => {
      seed();
      reversedGift();
      stripeMock.disputes.list.mockResolvedValue({ data: [{ id: "dp_1", status }] });
      stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
      const h = await load();
      await h.fetch(cronReq());

      expect(stripeMock.disputes.list).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: "pi_gift" }));
      expect(feeTransferCalls()).toHaveLength(0);
      expect(feeClaims()).toHaveLength(0);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(jobFlips()).toHaveLength(0);
      expect(cappedPaged()).toBe(false);
      expect(waitsPaged()).toBe(true);
      // Delta re-review #3: the alert names the row a person flips back.
      const waits = (slackAlerts as Array<{ title?: string; fields?: Record<string, unknown> }>).find((a) => /waits for a chargeback/.test(String(a.title)));
      expect(waits?.fields?.spent_gift_id).toBe("gift-spent");
    });
  }

  // @mutate supabase/functions/void-cancelled-payments/index.ts | const disputeOpen = disputes.some((d) => GIFT_DISPUTE_NOT_FINAL.has(String(d.status ?? ""))); | const disputeOpen = disputes.length > 0;
  it("review #1: a LOST chargeback is final: the fee is capped at the card and the job settles", async () => {
    seed();
    reversedGift();
    cappedClaim();
    stripeMock.disputes.list.mockResolvedValue({ data: [{ id: "dp_1", status: "lost" }] });
    stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
    const h = await load();
    await h.fetch(cronReq());

    expect(feeClaims().map((c) => Number(c.fee_amount))).toEqual([CAPPED_FEE]);
    expect(jobFlips()).toHaveLength(1);
    expect(waitsPaged()).toBe(false);
    expect(cappedAlert()?.fields?.dispute_open).toBe("no");
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | if (funding.disputeOpen && !onHold) { | if (funding.disputeOpen) {
  it("review #1: on an uncaptured hold an open chargeback cannot be waited for: the hold is captured, the fee capped, and the alert says what is owed if it is won", async () => {
    seed();
    reversedGift();
    cappedClaim();
    stripeMock.disputes.list.mockResolvedValue({ data: [{ id: "dp_1", status: "needs_response" }] });
    stripeMock.paymentIntents.retrieve.mockResolvedValueOnce(heldPi());
    stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
    const h = await load();
    await h.fetch(cronReq());

    expect((stripeMock.paymentIntents.capture.mock.calls[0]?.[1] as { amount_to_capture?: number } | undefined)?.amount_to_capture).toBe(CARD);
    expect(feeClaims().map((c) => Number(c.fee_amount))).toEqual([CAPPED_FEE]);
    expect(jobFlips()).toHaveLength(1);
    const alert = cappedAlert();
    expect(alert?.fields?.dispute_open).toBe("yes");
    expect(String(alert?.message)).toMatch(/If the platform wins it/);
    expect(waitsPaged()).toBe(false);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | for (let hop = 0; !node.stripe_payment_intent_id && node.parent_credit_id && hop < 20; hop++) { | for (let hop = 0; false; hop++) {
  it("review #1: a leftover gift asks Stripe about its ROOT's donation", async () => {
    seed();
    scenario.reads.gift_cards = {
      selectOverrides: [
        { includes: "payment_status, parent_credit_id", result: { rows: [{ payment_status: "refunded", parent_credit_id: "gift-root", stripe_payment_intent_id: null }] } },
        { includes: "parent_credit_id, stripe_payment_intent_id", result: { rows: [{ parent_credit_id: null, stripe_payment_intent_id: "pi_root" }] } },
      ],
      rows: [],
    };
    stripeMock.disputes.list.mockResolvedValue({ data: [{ id: "dp_1", status: "under_review" }] });
    stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
    const h = await load();
    await h.fetch(cronReq());

    expect(stripeMock.disputes.list).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: "pi_root" }));
    expect(jobFlips()).toHaveLength(0);
    expect(waitsPaged()).toBe(true);
  });

  it("review #1: disputes that cannot be read settle nothing this run (fails closed)", async () => {
    seed();
    reversedGift();
    stripeMock.disputes.list.mockRejectedValue(new Error("stripe down"));
    stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
    const h = await load();
    await h.fetch(cronReq());

    expect(feeTransferCalls()).toHaveLength(0);
    expect(jobFlips()).toHaveLength(0);
    expect(cappedPaged()).toBe(false);
  });

  // Review of 8354ebb0e #2: an earlier run restored the gift KEEPING 10.00 of
  // it for the fee, then its status flip failed. That kept part is still the
  // gift's money: the fee is capped at the card's part PLUS it, not the card alone.
  // @mutate supabase/functions/void-cancelled-payments/index.ts | const keptCents = funding.donationReversed ? 0 : funding.cents; | const keptCents = 0;
  it("review #2: a gift an earlier run restored while keeping part of it pays that part: fee = the card's part + the kept part", async () => {
    seed();
    const KEPT = 1000;
    const want = (CARD - CARD_FEE + KEPT) / 100;
    giftRpc({ outcome: "already_restored", credit_id: "gift-2", applied_cents: GIFT, restore_cents: GIFT - KEPT });
    scenario.writeSelectRows["cancellation_fee_transfers:insert"] = [{
      id: "fee-1", job_id: "job-1", helper_id: "helper-1", status: "pending", stripe_transfer_id: null,
      created_at: new Date().toISOString(), fee_amount: want, commission_percent: 12, platform_cut: 6.99, helper_amount: 51.26,
    }];
    stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
    const h = await load();
    await h.fetch(cronReq());

    expect(feeClaims().map((c) => Number(c.fee_amount))).toEqual([want]);
    expect(jobFlips().map((w) => w.payload)).toEqual([
      expect.objectContaining({ payment_status: "refunded", cancellation_fee_status: "charged", cancellation_fee: want }),
    ]);
    expect(cappedAlert()?.fields?.gift_kept_cents).toBe(KEPT);
  });

  // Delta re-review #1: with a kept part K of the gift AND an earlier refund
  // R on the card, the capped fee (card left after R + K) leaves a refund
  // ceiling below R. The gift pays K, so that is not money refunded past the
  // kept fees: the job settles, no daily "refunded past" page.
  // @mutate supabase/functions/void-cancelled-payments/index.ts | if (!cardGift && !cardGiftGone && chargeRefundedCents > voidSplit.ceilingCents + 1) { | if (!cardGift && chargeRefundedCents > voidSplit.ceilingCents + 1) {
  it("delta #1: a kept gift part plus an earlier card refund settles at card-left + kept, with no refunded-past page", async () => {
    seed();
    const KEPT = 1000;
    const R = 200;
    const want = (CARD - R - CARD_FEE + KEPT) / 100;
    giftRpc({ outcome: "already_restored", credit_id: "gift-2", applied_cents: GIFT, restore_cents: GIFT - KEPT });
    scenario.writeSelectRows["cancellation_fee_transfers:insert"] = [{
      id: "fee-1", job_id: "job-1", helper_id: "helper-1", status: "pending", stripe_transfer_id: null,
      created_at: new Date().toISOString(), fee_amount: want, commission_percent: 12, platform_cut: 6.75, helper_amount: 49.50,
    }];
    stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi({ amount_refunded: R }));
    const h = await load();
    await h.fetch(cronReq());

    expect(feeClaims().map((c) => Number(c.fee_amount))).toEqual([want]);
    expect(jobFlips().map((w) => w.payload)).toEqual([
      expect.objectContaining({ payment_status: "refunded", cancellation_fee_status: "charged", cancellation_fee: want }),
    ]);
    expect((slackAlerts as Array<{ severity?: string }>).filter((a) => a.severity === "critical")).toEqual([]);
  });

  // Q2097 (owner, 2026-11-03, option A): a gift-plus-card job whose $200 card
  // held every fee this cancel keeps ($150 fee + $6.10 card fee), until an
  // EARLIER refund on it left it short. Before: the gift was never asked (the
  // card was not short on its own), and the job paged "refunded past kept
  // fees" and sat in escrow. Now the gift keeps exactly the gap and the job
  // settles. Two refunds: one that leaves the card short of the fee itself
  // (feesFitCard false) and one that leaves it short only of the card fee.
  // @mutate supabase/functions/void-cancelled-payments/index.ts | } else if (cardShortCents === 0 && chargeRefundedCents > 0) { | } else if (false) {
  // @mutate supabase/functions/void-cancelled-payments/index.ts | if (giftOnJob && (giftOnJob.cents > 0 \|\| giftOnJob.restored)) giftAskCents = refundGapCents; | giftAskCents = refundGapCents;
  const BIG_CARD = 20000;
  const BIG_CARD_FEE = 610;
  const bigCardPi = (refunded: number) => ({
    id: "pi_1", status: "succeeded", amount: BIG_CARD, amount_received: BIG_CARD,
    latest_charge: { id: "ch_1", amount: BIG_CARD, amount_refunded: refunded, balance_transaction: { fee: BIG_CARD_FEE } },
  });
  const refundedPastPaged = () =>
    (slackAlerts as Array<{ title?: string }>).some((a) => /already refunded past what the cancel keeps/.test(String(a.title)));
  for (const R of [6000, 4500]) {
    it(`Q2097 A: a gap that comes only from an earlier $${(R / 100).toFixed(2)} card refund is kept from the gift, exactly, and the job settles with no page`, async () => {
      seed();
      stripeMock.paymentIntents.retrieve.mockResolvedValue(bigCardPi(R));
      const h = await load();
      await h.fetch(cronReq());

      const gap = FEE + BIG_CARD_FEE - (BIG_CARD - R);
      expect(gap).toBeGreaterThan(0);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(restoredCents()).toBe(GIFT - gap);
      expect(feeClaims().map((c) => Number(c.fee_amount))).toEqual([FEE / 100]);
      expect(jobFlips().map((w) => w.payload)).toEqual([
        expect.objectContaining({ payment_status: "refunded", cancellation_fee_status: "charged" }),
      ]);
      expect(refundedPastPaged()).toBe(false);
      expect(shortfallPaged()).toBe(false);
    });
  }
  it("Q2097 A: the card-only twin (no gift) keeps today's rule: no settlement, the refunded-past page", async () => {
    seed();
    giftRpc({ outcome: "no_credit" });
    stripeMock.paymentIntents.retrieve.mockResolvedValue(bigCardPi(6000));
    const h = await load();
    await h.fetch(cronReq());

    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(restoreCalls().filter((c) => !c.p_dry_run)).toHaveLength(0);
    expect(jobFlips()).toHaveLength(0);
    expect(refundedPastPaged()).toBe(true);
    expect(shortfallPaged()).toBe(false);
  });

  // Delta re-review #2: a live gift can fund a test-mode job, so the
  // donation is read in the mode whose Stripe knows its PaymentIntent.
  // @mutate supabase/functions/void-cancelled-payments/index.ts | if ((e as { code?: string } \| null)?.code === "resource_missing") continue; | if ((e as { code?: string } \| null)?.code === "resource_missing") return null;
  it("delta #2: the donation's PaymentIntent unknown in one mode is looked up in the other", async () => {
    seed();
    reversedGift();
    let giftReads = 0;
    stripeMock.paymentIntents.retrieve.mockImplementation(async (id: string) => {
      if (id === "pi_gift") {
        giftReads++;
        if (giftReads === 1) throw Object.assign(new Error("No such payment_intent: 'pi_gift'"), { code: "resource_missing" });
        return { id: "pi_gift", status: "succeeded" };
      }
      return capturedPi();
    });
    stripeMock.disputes.list.mockResolvedValue({ data: [{ id: "dp_1", status: "needs_response" }] });
    const h = await load({ STRIPE_TEST_SECRET_KEY: "sk_test_gift_mode" });
    await h.fetch(cronReq());

    expect(giftReads).toBe(2);
    expect(stripeMock.disputes.list).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: "pi_gift" }));
    expect(jobFlips()).toHaveLength(0);
    expect(waitsPaged()).toBe(true);
  });

  it("delta #2: a donation unknown in every mode settles nothing (fails closed)", async () => {
    seed();
    reversedGift();
    stripeMock.paymentIntents.retrieve.mockImplementation(async (id: string) => {
      if (id === "pi_gift") throw Object.assign(new Error("No such payment_intent"), { code: "resource_missing" });
      return capturedPi();
    });
    const h = await load();
    await h.fetch(cronReq());

    expect(feeTransferCalls()).toHaveLength(0);
    expect(jobFlips()).toHaveLength(0);
    expect(cappedPaged()).toBe(false);
  });

  // Review of 8354ebb0e #4: a reversed gift comes back minted 'refunded' and
  // cannot be spent, so the recipient is not told it is "available again".
  // @mutate supabase/functions/void-cancelled-payments/index.ts | const reversedCopy = result?.payment_status != null && result.payment_status !== "paid"; | const reversedCopy = false;
  it("review #4: a restored copy of a reversed gift sends no 'Your gift is back' notice", async () => {
    seed();
    reversedGift();
    cappedClaim();
    scenario.rpc.restore_gift_card_for_job = (args?: unknown) => {
      const a = (args ?? {}) as { p_dry_run?: boolean };
      if (a.p_dry_run) return { outcome: "would_restore", credit_id: "gift-1", applied_cents: GIFT, restore_cents: GIFT };
      return { outcome: "restored", credit_id: "gift-2", recipient_id: "poster-1", applied_cents: GIFT, restore_cents: GIFT, payment_status: "refunded" };
    };
    stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
    const h = await load();
    await h.fetch(cronReq());

    expect(restoreCalls().filter((c) => !c.p_dry_run)).toHaveLength(1);
    expect(scenario.writes.filter((w) => w.table === "notifications" && (w.payload as { title?: string }).title === "Your gift is back")).toHaveLength(0);
  });

  it("review #4: a restored copy of a live gift still tells the poster", async () => {
    seed();
    cappedClaim();
    scenario.rpc.restore_gift_card_for_job = (args?: unknown) => {
      const a = (args ?? {}) as { p_dry_run?: boolean };
      if (a.p_dry_run) return { outcome: "would_restore", credit_id: "gift-1", applied_cents: GIFT, restore_cents: GIFT };
      return { outcome: "restored", credit_id: "gift-2", recipient_id: "poster-1", applied_cents: GIFT, restore_cents: GIFT - SHORT, payment_status: "paid" };
    };
    stripeMock.paymentIntents.retrieve.mockResolvedValue(capturedPi());
    const h = await load();
    await h.fetch(cronReq());

    expect(scenario.writes.filter((w) => w.table === "notifications" && (w.payload as { title?: string }).title === "Your gift is back")).toHaveLength(1);
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
