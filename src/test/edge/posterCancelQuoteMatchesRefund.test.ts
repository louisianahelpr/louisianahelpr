/**
 * Boards 66/172 slice 2: the poster's "Back to you $X" (create-payment
 * cancel_quote) IS the money void-cancelled-payments sends back, for the same
 * job, the same charge and the same moment, because both call ONE function,
 * _shared/posterCancelSplit.ts.
 *
 * Each case runs the REAL create-payment source (the quote, as the poster,
 * before the cancel) and then the REAL void-cancelled-payments source (the
 * hourly sweep, after poster_cancel_job recorded cancelled_at at that same
 * moment) against the same Stripe charge, and compares the quote with what the
 * sweep actually asked Stripe for: the refund amount on a captured charge, the
 * part of a hold it did not capture on a hold.
 *
 * Cases cover a late fee on a captured legacy charge with sales tax and a
 * first job's setup fee, a free cancel on a poster-fee job, and a late fee on
 * an uncaptured hold. A quote must never show a number where the sweep would
 * price the refund another way: a gift on the job and an earlier refund on the
 * charge are answered with no amount.
 *
 * @mutate supabase/functions/void-cancelled-payments/index.ts | const voidSplit = capturedSplit.split; | const voidSplit = { ...capturedSplit.split, refundCents: capturedSplit.split.refundCents + 1 };
 * @mutate supabase/functions/create-payment/index.ts | back_to_you_cents: capturedSplit.backCents, | back_to_you_cents: capturedSplit.split.ceilingCents + capturedSplit.split.taxKeptCents,
 * @mutate supabase/functions/create-payment/index.ts | back_to_you_cents: holdSplit.backCents, | back_to_you_cents: Number(qPi.amount ?? 0),
 * @mutate supabase/functions/_shared/posterCancelSplit.ts |       backCents: Math.max(0, cents(i.charge.amountCents) - captureCents), |       backCents: cents(i.charge.amountCents),
 * @mutate supabase/functions/create-payment/index.ts |       if ((qGift?.length ?? 0) > 0) return unquoted("gift", feeCents); |
 * @mutate supabase/functions/create-payment/index.ts |         if (alreadyRefundedCents > 0) return unquoted("earlier_refund", feeCents); |
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret-quote";
const POSTER = { id: "poster-1", email: "poster@test.com" };
// 2026-10-21 15:00Z is 10:00 in Louisiana (CDT); a 16:00 start is 6 h out (the 25% tier).
const NOW = new Date("2026-10-21T15:00:00.000Z");

type Job = Record<string, unknown>;
const baseJob = (over: Job = {}): Job => ({
  id: "job-q", title: "Mow the lawn", customer_id: POSTER.id, helper_id: "helper-1", helper_confirmed_at: "2026-10-20T12:00:00Z",
  status: "accepted", payment_status: "escrow", budget: 100, date_needed: "2026-10-21", start_time: "16:00:00",
  // A flat-model stamp, so the sweep prices the Helpr's share without a tier read.
  helper_fee_percent: 5, helper_fee_flat_cents: 70, helper_completed_at: null, is_group_job: false,
  stripe_payment_intent_id: "pi_q", stripe_session_id: null, customer_fee_amount: 10, poster_fee_flat_cents: null,
  onboarding_fee_amount: null, parent_job_id: null, recurrence_days: null, cancellation_fee: 0, cancelled_at: null,
  ...over,
});

function resetAll() {
  resetEnv();
  resetSupabaseMock();
  resetStripeMock();
  resetSharedMocks();
}

async function quote(job: Job, pi: Record<string, unknown>, opts: { taxCents?: number; gift?: boolean } = {}) {
  resetAll();
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_quote" });
  scenario.authUser = POSTER;
  scenario.reads.jobs = { rows: [job] };
  if (opts.gift) scenario.reads.gift_cards = { rows: [{ id: "gift-1" }] };
  stripeMock.paymentIntents.retrieve.mockResolvedValue(pi);
  stripeMock.checkout.sessions.list.mockResolvedValue({ data: [{ total_details: { amount_tax: opts.taxCents ?? 0 } }] });
  const fn = await loadEdgeFunction("create-payment");
  const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer test-jwt" }, body: { action: "cancel_quote", jobId: "job-q" } }));
  expect(res.status).toBe(200);
  // Read only: nothing written, nothing moved.
  expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  expect(stripeMock.paymentIntents.capture).not.toHaveBeenCalled();
  expect(stripeMock.paymentIntents.cancel).not.toHaveBeenCalled();
  expect(scenario.writes).toHaveLength(0);
  return JSON.parse(await res.text()) as { can_cancel: boolean; fee_cents: number | null; back_to_you_cents: number | null; unquoted_reason: string | null; charge_state: string | null };
}

/** The sweep on the same job once poster_cancel_job recorded it at NOW with the quoted fee. */
async function sweep(job: Job, pi: Record<string, unknown>, feeCents: number, opts: { taxCents?: number } = {}) {
  resetAll();
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_quote", CRON_SECRET });
  const cancelled = { ...job, status: "cancelled", cancelled_at: NOW.toISOString(), cancellation_fee: feeCents / 100, cancellation_fee_status: feeCents > 0 ? "pending" : null };
  scenario.reads.jobs = { selectOverrides: [{ includes: "cancellation_fee", result: { rows: [cancelled] } }], rows: [] };
  stripeMock.paymentIntents.retrieve.mockResolvedValue(pi);
  stripeMock.paymentIntents.capture.mockResolvedValue({ ...pi, status: "succeeded" });
  stripeMock.paymentIntents.cancel.mockResolvedValue({ ...pi, status: "canceled" });
  stripeMock.refunds.create.mockImplementation(async (p: { amount: number }) => ({ id: "re_q", amount: p.amount, currency: "usd" }));
  stripeMock.checkout.sessions.list.mockResolvedValue({ data: [{ total_details: { amount_tax: opts.taxCents ?? 0 } }] });
  const fn = await loadEdgeFunction("void-cancelled-payments");
  await fn.fetch(new Request("https://x/functions/v1/void-cancelled-payments", { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
}

const captured = (amount: number, feeCents: number, refunded = 0) => ({
  id: "pi_q", status: "succeeded", amount, amount_received: amount,
  latest_charge: { id: "ch_q", amount_refunded: refunded, balance_transaction: { fee: feeCents } },
});

describe("cancel_quote == the sweep's refund (posterCancelSplit, called from both places)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    resetAll();
  });

  it("a late cancel on a captured legacy charge with tax and a first job's setup fee", async () => {
    // $100 budget + $10 card-cost fee + $2 setup fee + $8.96 tax = $120.96 captured; Stripe kept $3.81.
    const job = baseJob({ onboarding_fee_amount: 2 });
    const pi = captured(12096, 381);
    const q = await quote(job, pi, { taxCents: 896 });
    expect(q).toMatchObject({ can_cancel: true, fee_cents: 2500, charge_state: "captured", unquoted_reason: null });
    expect(q.back_to_you_cents).toBeGreaterThan(0);
    await sweep(job, pi, q.fee_cents ?? -1, { taxCents: 896 });
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create.mock.calls[0][0].amount).toBe(q.back_to_you_cents);
  });

  it("a free cancel (48 h out) on a poster-fee job: only Stripe's real fee is kept", async () => {
    const job = baseJob({ date_needed: "2026-10-23", start_time: "10:00:00", customer_fee_amount: 5.7, poster_fee_flat_cents: 70 });
    const pi = captured(10570, 337);
    const q = await quote(job, pi);
    expect(q).toMatchObject({ fee_cents: 0, charge_state: "captured" });
    expect(q.back_to_you_cents).toBe(10570 - 337);
    await sweep(job, pi, 0);
    expect(stripeMock.refunds.create.mock.calls[0]?.[0]?.amount).toBe(q.back_to_you_cents);
  });

  it("a late cancel on an uncaptured hold: back to you is the part of the hold the sweep does not capture", async () => {
    const job = baseJob();
    const pi = { id: "pi_q", status: "requires_capture", amount: 11000, amount_capturable: 11000, latest_charge: null };
    const q = await quote(job, pi);
    expect(q).toMatchObject({ fee_cents: 2500, charge_state: "hold", back_to_you_cents: 8500 });
    await sweep(job, pi, q.fee_cents ?? -1);
    expect(stripeMock.paymentIntents.capture).toHaveBeenCalledTimes(1);
    expect(11000 - stripeMock.paymentIntents.capture.mock.calls[0][1].amount_to_capture).toBe(q.back_to_you_cents);
  });

  it("shows no number for a job a gift paid toward (the sweep settles the gift its own way)", async () => {
    const q = await quote(baseJob(), captured(11000, 349), { gift: true });
    expect(q).toMatchObject({ can_cancel: true, fee_cents: 2500, back_to_you_cents: null, unquoted_reason: "gift" });
  });

  it("shows no number when an earlier refund already went back on the charge", async () => {
    const q = await quote(baseJob(), captured(11000, 349, 200));
    expect(q).toMatchObject({ back_to_you_cents: null, unquoted_reason: "earlier_refund" });
  });

  it("answers a stranger with nothing about the job", async () => {
    resetAll();
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_quote" });
    scenario.authUser = { id: "someone-else", email: "x@test.com" };
    scenario.reads.jobs = { rows: [baseJob()] };
    const fn = await loadEdgeFunction("create-payment");
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer test-jwt" }, body: { action: "cancel_quote", jobId: "job-q" } }));
    expect(res.status).toBe(404);
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
  });
});
