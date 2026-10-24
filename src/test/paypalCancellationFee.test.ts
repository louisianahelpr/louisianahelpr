/**
 * PayPal phase 6: a poster's late cancellation on a PayPal job is a PARTIAL REFUND of the
 * capture plus the Helpr's fee share queued for the owner to pay by hand. The tiers and the
 * split are today's (cancellationFee.ts, posterCancelSplit.ts, helprFlatFee.ts, money.ts);
 * every tier is pinned here in exact cents, and the settlement is proved resumable.
 *
 * @mutate supabase/functions/_shared/payments/paypalCancellation.ts | const feeDollars = i.sellerFault \|\| refundsSeriesVisitInFull(job) ? 0 : computeCancellationFee(job); | const feeDollars = computeCancellationFee(job);
 * @mutate supabase/functions/_shared/payments/paypalCancellation.ts | const helprPayoutCents = Math.max(0, roundPayoutDownCents(feeCents - platformCutCents)); | const helprPayoutCents = Math.max(0, feeCents - platformCutCents);
 * @mutate supabase/functions/_shared/payments/paypalCancellation.ts | actualFeeCents: i.providerFeeCents, | actualFeeCents: 0,
 * @mutate supabase/functions/_shared/payments/paypalCancellation.ts | if (!split.feesFitCard) return { kind: "refuse", reason: "fee_exceeds_payment" }; | if (false) return { kind: "refuse", reason: "fee_exceeds_payment" };
 * @mutate supabase/functions/_shared/payments/paypalCancellation.ts | if (own && own.amountCents !== plan.refundCents) { | if (false) {
 * @mutate supabase/functions/_shared/payments/paypalCancellation.ts | const own = refunds.find((r) => r.idempotencyKey === key) ?? null; | const own = null as RefundRow \| null;
 * @mutate supabase/functions/_shared/payments/paypalCancellation.ts | if (payment.env !== deps.env) return | if (false) return
 * @mutate supabase/functions/_shared/payments/phase6PayoutDoors.ts | const recorded = (outcome === "queued" \|\| outcome === "queued_held" \|\| outcome === "already_queued") && payoutId !== null; | const recorded = outcome !== "refused";
 * @mutate supabase/functions/_shared/payments/phase6PayoutDoors.ts | if (input.source === "auto_tip") return await recordTip(db, input); | void recordTip;
 * @mutate supabase/functions/_shared/payments/phase6PayoutDoors.ts | return { outcome, reason, payoutId, recorded: true }; | return { outcome, reason, payoutId, recorded: payoutId === "never" };
 */
import { describe, expect, it } from "vitest";
import {
  cancelRefundKey,
  planPayPalCancellation,
  settlePayPalCancellation,
  type CancellationStore,
  type FundedPayment,
  type PayPalCancelJob,
  type RefundRow,
} from "../../supabase/functions/_shared/payments/paypalCancellation.ts";
import { parseQueueAnswer, parseTipRecord, rpcManualPayoutQueue, type ManualPayoutQueue, type QueueManualPayoutInput } from "../../supabase/functions/_shared/payments/phase6PayoutDoors.ts";
import { ProviderApiError } from "../../supabase/functions/_shared/payments/types.ts";
import { computeCancellationFee } from "../../supabase/functions/_shared/cancellationFee.ts";

// A $100 job on the PayPal stamp (8% + 70c, phase 5), starting 2026-11-10 18:00 Central (CST,
// UTC-6) = 2026-11-11T00:00:00Z.
const START_UTC = Date.parse("2026-11-11T00:00:00Z");
const hoursBefore = (h: number) => new Date(START_UTC - h * 3600_000).toISOString();
function job(over: Partial<PayPalCancelJob> = {}): PayPalCancelJob {
  return {
    id: "a0000000-0000-4000-8000-000000000001",
    customer_id: "c0000000-0000-4000-8000-000000000001",
    budget: 100,
    date_needed: "2026-11-10",
    start_time: "18:00:00",
    cancelled_at: hoursBefore(10),
    helper_id: "h0000000-0000-4000-8000-000000000001",
    helper_confirmed_at: "2026-11-01T12:00:00Z",
    helper_fee_flat_cents: 70,
    helper_fee_percent: 8,
    customer_fee_amount: 0,
    poster_fee_flat_cents: null,
    onboarding_fee_amount: 0,
    sales_tax_amount: 0,
    is_group_job: false,
    parent_job_id: null,
    recurrence_days: null,
    series_ban_cancelled_at: null,
    ...over,
  };
}
const PAYPAL_FEE = 398; // 3.49% + 49c on $100.00 (PayPal's US rate); the test pins the arithmetic, not the rate.
const plan = (j: PayPalCancelJob, extra: Partial<{ captured: number; fee: number; refunded: number; sellerFault: boolean }> = {}) =>
  planPayPalCancellation({ job: j, sellerFault: extra.sellerFault ?? false, capturedCents: extra.captured ?? 10000, providerFeeCents: extra.fee ?? PAYPAL_FEE, alreadyRefundedCents: extra.refunded ?? 0 });

describe("every tier, exact cents ($100 PayPal job, 8% + 70c stamp, PayPal fee 398c)", () => {
  it("24 h or more before the start: 0%, everything but PayPal's fee goes back, nothing to the Helpr", () => {
    expect(plan(job({ cancelled_at: hoursBefore(48) }))).toEqual({
      kind: "plan", feeCents: 0, feePercent: 0, refundCents: 9602, helprPayoutCents: 0, platformKeepsOfFeeCents: 0,
      providerFeeKeptCents: 398, setupFeeKeptCents: 0, taxKeptCents: 0,
    });
  });
  it("exactly 24 h before: still 0% (the ladder's boundary is < 24)", () => {
    expect(plan(job({ cancelled_at: hoursBefore(24) }))).toMatchObject({ feeCents: 0, feePercent: 0, refundCents: 9602 });
  });
  it("under 24 h: 25% = 2500c; Helpr 2200c (2500 - 270, rounded down to whole dollars); platform keeps 300c; refund 7102c", () => {
    expect(plan(job({ cancelled_at: hoursBefore(10) }))).toEqual({
      kind: "plan", feeCents: 2500, feePercent: 25, refundCents: 7102, helprPayoutCents: 2200, platformKeepsOfFeeCents: 300,
      providerFeeKeptCents: 398, setupFeeKeptCents: 0, taxKeptCents: 0,
    });
  });
  it("exactly 2 h before: 25% (the 50% tier is < 2)", () => {
    expect(plan(job({ cancelled_at: hoursBefore(2) }))).toMatchObject({ feeCents: 2500, feePercent: 25 });
  });
  it("under 2 h: 50% = 5000c; Helpr 4500c (5000 - 470 = 4530, rounded down); platform keeps 500c; refund 4602c", () => {
    expect(plan(job({ cancelled_at: hoursBefore(1) }))).toEqual({
      kind: "plan", feeCents: 5000, feePercent: 50, refundCents: 4602, helprPayoutCents: 4500, platformKeepsOfFeeCents: 500,
      providerFeeKeptCents: 398, setupFeeKeptCents: 0, taxKeptCents: 0,
    });
  });
  it("a Helpr offered but not yet confirmed: 0% even at 1 h (helperIsCommitted)", () => {
    expect(plan(job({ cancelled_at: hoursBefore(1), helper_confirmed_at: null }))).toMatchObject({ feeCents: 0, refundCents: 9602, helprPayoutCents: 0 });
  });
  it("no Helpr at all: 0%", () => {
    expect(plan(job({ cancelled_at: hoursBefore(1), helper_id: null, helper_confirmed_at: null }))).toMatchObject({ feeCents: 0, helprPayoutCents: 0 });
  });
  it("odd budget $10.01 at 50%: 501c (halves round up, as poster_cancel_job); Helpr 300c (501 - 110 = 391, down); refund 1001 - 84 - 501 = 416c", () => {
    expect(computeCancellationFee(job({ budget: 10.01, cancelled_at: hoursBefore(1) }))).toBe(5.01);
    expect(plan(job({ budget: 10.01, cancelled_at: hoursBefore(1) }), { captured: 1001, fee: 84 })).toMatchObject({
      feeCents: 501, helprPayoutCents: 300, platformKeepsOfFeeCents: 201, refundCents: 416,
    });
  });
  it("a fee under $1 after the platform's cut pays the Helpr 0 and keeps it all (whole-dollar payouts, Q236)", () => {
    // $4.00 at 25% = 100c; cut = 8 + 70 = 78c; 22c rounds down to 0.
    expect(plan(job({ budget: 4, cancelled_at: hoursBefore(10) }), { captured: 400, fee: 63 })).toMatchObject({
      feeCents: 100, helprPayoutCents: 0, platformKeepsOfFeeCents: 100, refundCents: 237,
    });
  });
  it("tax inside the capture: the tax on what is kept is kept too (Q2082 (a)): 25% of $100 with $9 tax", () => {
    // kept = 398 + 2500 = 2898; tax kept = ceil(2898 * 900 / 10000) = 261; refund 10900 - 2898 - 261 = 7741.
    expect(plan(job({ sales_tax_amount: 9 }), { captured: 10900 })).toMatchObject({ feeCents: 2500, taxKeptCents: 261, refundCents: 7741, helprPayoutCents: 2200 });
  });
  it("a first job's one-time setup fee is kept (Q1674)", () => {
    expect(plan(job({ onboarding_fee_amount: 2 }), { captured: 10200 })).toMatchObject({ setupFeeKeptCents: 200, refundCents: 7102 });
  });
  it("earlier refunds by another path come off what goes back", () => {
    expect(plan(job(), { refunded: 1000 })).toMatchObject({ refundCents: 6102, helprPayoutCents: 2200 });
  });
  it("an unfilled or ban-ended series visit, or a Declutter seller's fault: no fee", () => {
    expect(plan(job({ parent_job_id: "p0000000-0000-4000-8000-000000000001", series_ban_cancelled_at: "2026-11-10T00:00:00Z", cancelled_at: hoursBefore(1) }))).toMatchObject({ feeCents: 0 });
    expect(plan(job({ cancelled_at: hoursBefore(1) }), { sellerFault: true })).toMatchObject({ feeCents: 0, providerFeeKeptCents: 0, refundCents: 10000 });
  });
  it("refuses what PayPal does not do yet: a crew, an unstamped fee model, a fee bigger than what is left", () => {
    expect(plan(job({ is_group_job: true }))).toEqual({ kind: "refuse", reason: "crew_job_not_on_paypal" });
    expect(plan(job({ helper_fee_flat_cents: null, helper_fee_percent: 10 }))).toEqual({ kind: "refuse", reason: "fee_model_unstamped" });
    expect(plan(job({ cancelled_at: hoursBefore(1) }), { refunded: 6000 })).toEqual({ kind: "refuse", reason: "fee_exceeds_payment" });
    expect(plan(job(), { fee: -1 })).toEqual({ kind: "refuse", reason: "provider_fee_unknown" });
  });
  it("the refund plus the Helpr's payout never exceed the capture (the database rule, every tier)", () => {
    for (const h of [48, 23.9, 10, 2, 1.99, 0.5]) {
      const p = plan(job({ cancelled_at: hoursBefore(h) }));
      if (p.kind !== "plan") throw new Error("refused");
      expect(p.refundCents + p.helprPayoutCents + p.platformKeepsOfFeeCents + p.providerFeeKeptCents).toBe(10000);
    }
  });
});

// ── The settlement ──────────────────────────────────────────────────────────

function memStore(payment: FundedPayment | null) {
  const refunds: Array<RefundRow & { paymentId: string }> = [];
  const jobs = new Map<string, string>([["a0000000-0000-4000-8000-000000000001", "escrow"]]);
  const log: string[] = [];
  const store: CancellationStore = {
    async fundedPaymentForJob() { return payment; },
    async refundsFor(id) { return refunds.filter((r) => r.paymentId === id); },
    async insertRefund(r) {
      const dup = refunds.find((x) => x.idempotencyKey === r.idempotencyKey);
      if (dup) return dup;
      const row = { id: `R${refunds.length + 1}`, idempotencyKey: r.idempotencyKey, amountCents: r.amountCents, status: "pending" as const, providerRefundId: null, paymentId: r.paymentId };
      refunds.push(row);
      log.push(`insertRefund ${r.amountCents}`);
      return row;
    },
    async markRefund(id, p) { const r = refunds.find((x) => x.id === id)!; r.status = p.status; if (p.providerRefundId) r.providerRefundId = p.providerRefundId; log.push(`markRefund ${p.status}`); },
    async setPaymentStatus(_id, s) { if (payment) payment.status = s; log.push(`payment ${s}`); },
    async settleJob(id, patch) { if (jobs.get(id) !== "escrow") return false; jobs.set(id, patch.payment_status); log.push(`job ${patch.payment_status} fee=${patch.cancellation_fee_status}`); return true; },
  };
  return { store, refunds, jobs, log };
}
const PAYMENT = (): FundedPayment => ({ id: "p1", env: "sandbox", amountCents: 10000, providerCaptureId: "CAP1", status: "captured" });
function queue(answers: Array<"queued" | "refused">) {
  const calls: QueueManualPayoutInput[] = [];
  const q: ManualPayoutQueue = {
    supports: () => true,
    async queue(i) {
      calls.push(i);
      const a = answers.shift() ?? "queued";
      return a === "queued" ? { outcome: "queued", reason: null, payoutId: "PO1", recorded: true } : { outcome: "refused", reason: "job_not_approved", payoutId: null, recorded: false };
    },
  };
  return { q, calls };
}
function provider(results: Array<"ok" | "timeout" | "refused">) {
  const calls: Array<{ idempotencyKey: string; amountCents: number }> = [];
  return {
    calls,
    refund: async (i: { idempotencyKey: string; providerCaptureId: string; amountCents: number }) => {
      calls.push({ idempotencyKey: i.idempotencyKey, amountCents: i.amountCents });
      const r = results.shift() ?? "ok";
      if (r === "timeout") throw new ProviderApiError("transport failure", 0, null, null, null);
      if (r === "refused") throw new ProviderApiError("422", 422, "UNPROCESSABLE_ENTITY", "REFUND_AMOUNT_EXCEEDED", "d");
      return { providerRefundId: "RF1", status: "COMPLETED" as const, settled: true, amountCents: i.amountCents };
    },
  };
}
const deps = (s: ReturnType<typeof memStore>, p: ReturnType<typeof provider>, q: ReturnType<typeof queue>, fee: number | null = PAYPAL_FEE) =>
  ({ store: s.store, provider: p, queue: q.q, readCaptureFeeCents: async () => fee, env: "sandbox" as const });

describe("settlePayPalCancellation", () => {
  it("25%: one partial refund of 7102c keyed to its row, then the Helpr's 2200c on the pay queue, then the job leaves escrow", async () => {
    const s = memStore(PAYMENT()); const p = provider([]); const q = queue([]);
    const out = await settlePayPalCancellation(deps(s, p, q), job(), false);
    expect(out.outcome).toBe("settled");
    expect(p.calls).toEqual([{ idempotencyKey: "lh:refund:R1", amountCents: 7102 }]);
    expect(s.refunds[0]).toMatchObject({ idempotencyKey: cancelRefundKey("p1"), status: "completed", providerRefundId: "RF1" });
    expect(q.calls).toEqual([{ jobId: job().id, helperId: job().helper_id, amountCents: 2200, platformFeeCents: 300, source: "cancellation_fee", providerPaymentId: "p1" }]);
    expect(s.log).toEqual(["insertRefund 7102", "markRefund completed", "payment partially_refunded", "job refunded fee=charged"]);
  });
  it("refund BEFORE payout (the database refuses a refund while a payout is queued)", async () => {
    const s = memStore(PAYMENT()); const p = provider([]); const order: string[] = [];
    const q: ManualPayoutQueue = { supports: () => true, async queue() { order.push("queue"); return { outcome: "queued", reason: null, payoutId: "PO1", recorded: true }; } };
    const pp = { refund: async (i: Parameters<typeof p.refund>[0]) => { order.push("refund"); return p.refund(i); } };
    await settlePayPalCancellation({ store: s.store, provider: pp, queue: q, readCaptureFeeCents: async () => PAYPAL_FEE, env: "sandbox" }, job(), false);
    expect(order).toEqual(["refund", "queue"]);
  });
  it("0%: refund only, no payout, cancellation_fee_status null", async () => {
    const s = memStore(PAYMENT()); const p = provider([]); const q = queue([]);
    const out = await settlePayPalCancellation(deps(s, p, q), job({ cancelled_at: hoursBefore(48) }), false);
    expect(out.outcome).toBe("settled");
    expect(p.calls.map((c) => c.amountCents)).toEqual([9602]);
    expect(q.calls).toEqual([]);
    expect(s.log[s.log.length - 1]).toBe("job refunded fee=null");
  });
  it("a payout the queue refuses: the refund is out, the job stays in escrow; the next run does NOT refund again", async () => {
    const s = memStore(PAYMENT()); const p = provider([]); const q = queue(["refused", "queued"]);
    const first = await settlePayPalCancellation(deps(s, p, q), job(), false);
    expect(first).toEqual({ outcome: "retry", reason: "fee_payout_refused: job_not_approved" });
    expect(s.jobs.get(job().id)).toBe("escrow");
    const second = await settlePayPalCancellation(deps(s, p, q), job(), false);
    expect(second.outcome).toBe("settled");
    expect(p.calls).toHaveLength(1);
    expect(q.calls).toHaveLength(2);
  });
  it("an unknown refund outcome leaves the row pending and the next run replays the SAME key", async () => {
    const s = memStore(PAYMENT()); const p = provider(["timeout", "ok"]); const q = queue([]);
    expect((await settlePayPalCancellation(deps(s, p, q), job(), false)).outcome).toBe("retry");
    expect(s.refunds[0].status).toBe("pending");
    expect(q.calls).toEqual([]);
    expect((await settlePayPalCancellation(deps(s, p, q), job(), false)).outcome).toBe("settled");
    expect(p.calls.map((c) => c.idempotencyKey)).toEqual(["lh:refund:R1", "lh:refund:R1"]);
  });
  it("PayPal refusing the refund marks it failed and stops for a person: no payout, no flip, never re-sent", async () => {
    const s = memStore(PAYMENT()); const p = provider(["refused"]); const q = queue([]);
    const out = await settlePayPalCancellation(deps(s, p, q), job(), false);
    expect(out.outcome).toBe("needs_review");
    expect(s.refunds[0].status).toBe("failed");
    expect(q.calls).toEqual([]);
    expect((await settlePayPalCancellation(deps(s, p, q), job(), false)).outcome).toBe("needs_review");
    expect(p.calls).toHaveLength(1);
  });
  it("a resumed run whose plan no longer matches what was sent stops (never a second, different refund)", async () => {
    const s = memStore(PAYMENT()); const p = provider(["timeout"]); const q = queue([]);
    await settlePayPalCancellation(deps(s, p, q), job(), false);
    const out = await settlePayPalCancellation(deps(s, p, q), job({ cancelled_at: hoursBefore(1) }), false);
    expect(out).toMatchObject({ outcome: "needs_review" });
    expect(p.calls).toHaveLength(1);
  });
  it("touches nothing when: not a PayPal job, the other env, a dispute, unsettled money, PayPal's fee unreadable", async () => {
    for (const [pay, fee, want] of [
      [null, PAYPAL_FEE, "not_paypal"],
      [{ ...PAYMENT(), env: "live" as const }, PAYPAL_FEE, "needs_review"],
      [{ ...PAYMENT(), status: "disputed" }, PAYPAL_FEE, "retry"],
      [{ ...PAYMENT(), status: "capture_pending" }, PAYPAL_FEE, "retry"],
      [PAYMENT(), null, "retry"],
    ] as const) {
      const s = memStore(pay ? { ...pay } : null); const p = provider([]); const q = queue([]);
      expect((await settlePayPalCancellation(deps(s, p, q, fee), job(), false)).outcome).toBe(want);
      expect(p.calls).toEqual([]);
      expect(q.calls).toEqual([]);
      expect(s.jobs.get(job().id)).toBe("escrow");
    }
  });
});

describe("the pay-queue doors (phase 4's paypal_queue_manual_payout; the tips lane's recorder)", () => {
  it("reads 'recorded' only when a payout row is named", () => {
    expect(parseQueueAnswer({ outcome: "queued", payout_id: "x" }).recorded).toBe(true);
    expect(parseQueueAnswer({ outcome: "already_queued", payout_id: "x" }).recorded).toBe(true);
    expect(parseQueueAnswer({ outcome: "already_queued", reason: "concurrent_claim" }).recorded).toBe(false);
    expect(parseQueueAnswer({ outcome: "held", reason: "payout_held" }).recorded).toBe(false);
    expect(parseQueueAnswer({ outcome: "queued_held", payout_id: "x", reason: "destination_changed_since_hire" }).recorded).toBe(true);
    expect(parseQueueAnswer({ outcome: "refused", reason: "job_not_cancelled_with_held_money" })).toMatchObject({ recorded: false, reason: "job_not_cancelled_with_held_money" });
    expect(parseQueueAnswer({ outcome: "waiting_for_payee" }).recorded).toBe(false);
    expect(parseQueueAnswer({ outcome: "refused" }).recorded).toBe(false);
    expect(parseQueueAnswer({ outcome: "sent!" })).toMatchObject({ outcome: "refused", recorded: false });
    expect(parseQueueAnswer(null)).toMatchObject({ outcome: "refused", recorded: false });
  });
  it("calls the RPC with the contract's arguments; a missing RPC is refused, never queued", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const ok = rpcManualPayoutQueue({ rpc: async (fn, args) => { calls.push([fn, args]); return { data: { outcome: "queued", payout_id: "PO" }, error: null }; } });
    expect(await ok.queue({ jobId: "j", helperId: "h", amountCents: 2200, platformFeeCents: 300, source: "cancellation_fee", providerPaymentId: "p" })).toMatchObject({ recorded: true });
    expect(calls).toEqual([["paypal_queue_manual_payout", { p_job_id: "j", p_helper_id: "h", p_amount_cents: 2200, p_platform_fee_cents: 300, p_initiated_by: "system", p_initiated_by_user_id: null, p_source: "cancellation_fee" }]]);
    const missing = rpcManualPayoutQueue({ rpc: async () => ({ data: null, error: { message: "not found", code: "PGRST202" } }) });
    expect(await missing.queue({ jobId: "j", helperId: "h", amountCents: 1, platformFeeCents: 0, source: "cancellation_fee", providerPaymentId: "p" })).toMatchObject({ outcome: "refused", reason: "queue_writer_not_deployed", recorded: false });
  });
  it("an auto-tip goes to the tips lane's recorder (never phase 4's writer, whose already_queued names the JOB's payout)", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const q = rpcManualPayoutQueue({ rpc: async (fn, args) => { calls.push([fn, args]); return { data: { payout_id: "PT", payout_status: "pending", payout_reason: "queued" }, error: null }; } });
    expect(q.supports("auto_tip")).toBe(true);
    const tip = { jobId: "j", helperId: "h", amountCents: 500, platformFeeCents: 0, source: "auto_tip" as const, providerPaymentId: "tip-pay" };
    expect(await q.queue({ ...tip, tipCapture: { providerOrderId: "O1", providerCaptureId: "C1", amountCents: 570, settled: true } })).toMatchObject({ outcome: "queued", payoutId: "PT", recorded: true });
    expect(calls).toEqual([["paypal_record_tip_capture", { p_provider_payment_id: "tip-pay", p_order_id: "O1", p_outcome: "completed", p_capture_id: "C1", p_amount_cents: 570 }]]);
    // No capture, or a platform cut on a tip: refused without a call.
    expect(await q.queue(tip)).toMatchObject({ recorded: false, reason: "tip_capture_missing" });
    expect(await q.queue({ ...tip, platformFeeCents: 1, tipCapture: { providerOrderId: "O1", providerCaptureId: "C1", amountCents: 570, settled: true } })).toMatchObject({ recorded: false });
    expect(calls).toHaveLength(1);
  });
  it("reads the tips recorder's answer: recorded only with a payout row", () => {
    expect(parseTipRecord({ payout_id: "x", payout_status: "pending", payout_reason: "queued" })).toMatchObject({ outcome: "queued", recorded: true });
    expect(parseTipRecord({ payout_id: "x", payout_status: "held", payout_reason: "held" })).toMatchObject({ outcome: "held", recorded: true });
    expect(parseTipRecord({ payout_id: "x", payout_status: "pending", payout_reason: "already_queued" })).toMatchObject({ outcome: "already_queued", recorded: true });
    expect(parseTipRecord({ payout_id: null, payout_reason: "no_payable_destination" })).toMatchObject({ outcome: "waiting_for_payee", recorded: false });
    expect(parseTipRecord({ payout_id: null, payout_reason: "not_settled" })).toMatchObject({ outcome: "refused", recorded: false });
    expect(parseTipRecord(null)).toMatchObject({ recorded: false });
  });
});
