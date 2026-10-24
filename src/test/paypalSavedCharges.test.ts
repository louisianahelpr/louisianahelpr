/**
 * PayPal phase 6: charging a member's SAVED PayPal method with nobody present (auto-tip, repeat
 * visits). Record before charge, one deterministic key that is also PayPal-Request-Id, no
 * re-send past PayPal's replay memory, the switch asked first, a token charged as the source it
 * came from; auto-tip keeps today's money shape (Helpr 100%) and is not charged when its payout
 * cannot be queued; a visit is created only once its money is in.
 *
 * @mutate supabase/functions/_shared/payments/paypalSavedCharge.ts | if (!(await deps.store.switchOnFor(input.payerId))) return { outcome: "switch_off" }; | void 0;
 * @mutate supabase/functions/_shared/payments/paypalSavedCharge.ts | if (now() - row.createdAtMs > PAYPAL_REPLAY_WINDOW_MS) { | if (false) {
 * @mutate supabase/functions/_shared/payments/paypalSavedCharge.ts | return `lh:pp:${i.subjectKind}:${i.subjectId}:amt${i.amountCents}:a${attempt}`; | return `lh:pp:${i.subjectKind}:${i.subjectId}:a${attempt}`;
 * @mutate supabase/functions/_shared/payments/paypalSavedCharge.ts | vaultSource: method.source, | vaultSource: "card",
 * @mutate supabase/functions/_shared/payments/paypalAutoTip.ts | if (!deps.queue.supports("auto_tip")) return { outcome: "payout_unsupported" }; | void 0;
 * @mutate supabase/functions/_shared/payments/paypalVisitFunding.ts | if (await deps.store.visitJobFor(i.parent.id, i.visitDate)) return { outcome: "exists" }; | void 0;
 * @mutate supabase/functions/_shared/payments/paypalCheckout.ts | payment_source: (input.vaultSource ?? "card") === "paypal" | payment_source: false
 */
import { describe, expect, it } from "vitest";
import {
  PAYPAL_REPLAY_WINDOW_MS,
  chargeSavedPayment,
  savedChargeKey,
  visitSubjectId,
  type SavedChargeStore,
  type SavedMethod,
  type SavedPaymentRow,
} from "../../supabase/functions/_shared/payments/paypalSavedCharge.ts";
import { chargePayPalAutoTip, retryOwedTipPayouts } from "../../supabase/functions/_shared/payments/paypalAutoTip.ts";
import { fundPayPalVisit, planPayPalVisitCharge, visitJobRow, type VisitStore } from "../../supabase/functions/_shared/payments/paypalVisitFunding.ts";
import type { ManualPayoutQueue, QueueManualPayoutInput } from "../../supabase/functions/_shared/payments/phase6PayoutDoors.ts";
import { PayPalClient } from "../../supabase/functions/_shared/payments/paypalClient.ts";
import { createPayPalCheckoutProvider } from "../../supabase/functions/_shared/payments/paypalCheckout.ts";
import { ProviderApiError, type CaptureResult } from "../../supabase/functions/_shared/payments/types.ts";
import { paypalTipChargeBreakdown } from "../../supabase/functions/_shared/tipFees.ts";

const POSTER = "c0000000-0000-4000-8000-000000000001";
const METHOD: SavedMethod = { id: "m1", userId: POSTER, env: "sandbox", vaultId: "VAULT1", source: "card" };

function store(opts: { switchOn?: boolean; method?: SavedMethod | null; rows?: SavedPaymentRow[] } = {}) {
  const rows: Array<SavedPaymentRow & { subjectId: string }> = (opts.rows ?? []).map((r) => ({ ...r, subjectId: "x" }));
  const s: SavedChargeStore = {
    async switchOnFor() { return opts.switchOn ?? true; },
    async activeMethod() { return opts.method === undefined ? METHOD : opts.method; },
    async paymentByKey(k) { return rows.find((r) => r.idempotencyKey === k) ?? null; },
    async insertPayment(r) {
      const dup = rows.find((x) => x.idempotencyKey === r.idempotencyKey);
      if (dup) return dup;
      const row = { id: `P${rows.length + 1}`, idempotencyKey: r.idempotencyKey, status: "created", amountCents: r.amountCents, providerOrderId: `pending:${r.idempotencyKey}`, providerCaptureId: null as string | null, createdAtMs: 1_000, subjectId: r.subjectId };
      rows.push(row);
      return row;
    },
    async markCaptured(id, c) { const r = rows.find((x) => x.id === id)!; r.status = c.status; r.providerCaptureId = c.providerCaptureId; r.providerOrderId = c.providerOrderId; },
    async markFailed(id) { rows.find((x) => x.id === id)!.status = "failed"; },
  };
  return { s, rows };
}
function provider(results: Array<"ok" | "pending" | "timeout" | "declined">) {
  const calls: Array<{ idempotencyKey: string; vaultId: string; amountCents: number; vaultSource?: string }> = [];
  return {
    calls,
    chargeSaved: async (i: { idempotencyKey: string; referenceId: string; vaultId: string; amountCents: number; vaultSource?: "card" | "paypal" }): Promise<CaptureResult> => {
      calls.push({ idempotencyKey: i.idempotencyKey, vaultId: i.vaultId, amountCents: i.amountCents, vaultSource: i.vaultSource });
      const r = results.shift() ?? "ok";
      if (r === "timeout") throw new ProviderApiError("transport", 0, null, null, null);
      if (r === "declined") throw new ProviderApiError("declined", 200, "CAPTURE_NOT_SUCCESSFUL", "DECLINED", null);
      return { providerOrderId: "ORD1", providerCaptureId: "CAP1", status: r === "pending" ? "PENDING" : "COMPLETED", settled: r !== "pending", amountCents: i.amountCents, feeCents: 30, vaultId: null };
    },
  };
}

describe("chargeSavedPayment", () => {
  const input = { subjectKind: "tip" as const, subjectId: "t0000000-0000-4000-8000-000000000001", payerId: POSTER, amountCents: 538 };
  it("writes the 'created' row BEFORE the charge, charges the saved token with the row's key, records the capture", async () => {
    const st = store(); const p = provider(["ok"]);
    const out = await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, input);
    expect(out).toEqual({ outcome: "charged", paymentId: "P1", orderId: "ORD1", captureId: "CAP1", amountCents: 538 });
    expect(p.calls).toEqual([{ idempotencyKey: "lh:pp:tip:t0000000-0000-4000-8000-000000000001:amt538:a1", vaultId: "VAULT1", amountCents: 538, vaultSource: "card" }]);
    expect(st.rows[0]).toMatchObject({ status: "captured", providerCaptureId: "CAP1" });
  });
  it("the key names the amount (a re-price is a new order, never an old one replayed) and the attempt", () => {
    expect(savedChargeKey({ ...input })).not.toBe(savedChargeKey({ ...input, amountCents: 539 }));
    expect(savedChargeKey({ ...input, attempt: 2 })).toMatch(/:amt538:a2$/);
    expect(() => savedChargeKey({ ...input, amountCents: 0 })).toThrow();
  });
  it("a second run after success charges nothing", async () => {
    const st = store(); const p = provider(["ok"]);
    await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, input);
    expect((await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, input)).outcome).toBe("charged");
    expect(p.calls).toHaveLength(1);
  });
  it("an unknown outcome is replayed with the SAME key inside PayPal's replay memory, and never after it", async () => {
    const st = store(); const p = provider(["timeout", "ok"]);
    let t = 1_000;
    const deps = { store: st.s, provider: p, env: "sandbox" as const, now: () => t };
    expect((await chargeSavedPayment(deps, input)).outcome).toBe("retry");
    t = 1_000 + PAYPAL_REPLAY_WINDOW_MS - 1;
    expect((await chargeSavedPayment(deps, input)).outcome).toBe("charged");
    expect(p.calls.map((c) => c.idempotencyKey)).toEqual([p.calls[0].idempotencyKey, p.calls[0].idempotencyKey]);

    const late = store(); const lp = provider(["timeout"]);
    t = 1_000;
    await chargeSavedPayment({ store: late.s, provider: lp, env: "sandbox", now: () => t }, input);
    t = 1_000 + PAYPAL_REPLAY_WINDOW_MS + 1;
    expect((await chargeSavedPayment({ store: late.s, provider: lp, env: "sandbox", now: () => t }, input)).outcome).toBe("needs_review");
    expect(lp.calls).toHaveLength(1);
  });
  it("a decline is recorded failed and never retried under the same attempt", async () => {
    const st = store(); const p = provider(["declined"]);
    expect((await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, input)).outcome).toBe("declined");
    expect(st.rows[0].status).toBe("failed");
    expect((await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, input)).outcome).toBe("declined");
    expect(p.calls).toHaveLength(1);
  });
  it("PENDING money is not 'charged' (not funded)", async () => {
    const st = store(); const p = provider(["pending"]);
    expect((await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, input)).outcome).toBe("pending");
    expect(st.rows[0].status).toBe("capture_pending");
  });
  it("switch off or no saved method: no row, no charge", async () => {
    for (const st of [store({ switchOn: false }), store({ method: null })]) {
      const p = provider([]);
      const out = await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, input);
      expect(["switch_off", "no_saved_method"]).toContain(out.outcome);
      expect(st.rows).toEqual([]);
      expect(p.calls).toEqual([]);
    }
  });
  it("a PayPal-wallet token is charged as a PayPal-wallet token", async () => {
    const st = store({ method: { ...METHOD, source: "paypal" } }); const p = provider(["ok"]);
    await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, input);
    expect(p.calls[0].vaultSource).toBe("paypal");
  });
});

describe("the adapter sends the token as the source it came from", () => {
  const order = { id: "O1", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "C1", status: "COMPLETED", amount: { currency_code: "USD", value: "5.38" } }] } }] };
  function client() {
    const bodies: unknown[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "t", expires_in: 30000 }), { status: 200 });
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(order), { status: 201 });
    }) as unknown as typeof fetch;
    return { bodies, prov: createPayPalCheckoutProvider(new PayPalClient({ env: "sandbox", clientId: "i", clientSecret: "s", fetchImpl })) };
  }
  it("card (default): payment_source.card.vault_id with the merchant-initiated stored-credential flags", async () => {
    const c = client();
    await c.prov.chargeSaved({ idempotencyKey: "k:amt538", referenceId: "r", vaultId: "V", amountCents: 538 });
    expect((c.bodies[0] as { payment_source: unknown }).payment_source).toEqual({ card: { vault_id: "V", stored_credential: { payment_initiator: "MERCHANT", payment_type: "UNSCHEDULED", usage: "SUBSEQUENT" } } });
  });
  it("paypal: payment_source.paypal.vault_id", async () => {
    const c = client();
    await c.prov.chargeSaved({ idempotencyKey: "k:amt538", referenceId: "r", vaultId: "V", amountCents: 538, vaultSource: "paypal" });
    expect((c.bodies[0] as { payment_source: unknown }).payment_source).toEqual({ paypal: { vault_id: "V" } });
    await expect(c.prov.chargeSaved({ idempotencyKey: "k:amt538", referenceId: "r", vaultId: "V", amountCents: 538, vaultSource: "venmo" as never })).rejects.toThrow(/unknown vault source/);
  });
});

function queue(supports: boolean, answer: "queued" | "refused" = "queued") {
  const calls: QueueManualPayoutInput[] = [];
  const q: ManualPayoutQueue = {
    supports: () => supports,
    async queue(i) { calls.push(i); return answer === "queued" ? { outcome: "queued", reason: null, payoutId: "PO", recorded: true } : { outcome: "refused", reason: "x", payoutId: null, recorded: false }; },
  };
  return { q, calls };
}

describe("auto-tip through PayPal", () => {
  const tip = { tipId: "t0000000-0000-4000-8000-000000000009", jobId: "j1", posterId: POSTER, helperId: "h1", quote: paypalTipChargeBreakdown(500) };
  it("today's money shape on PayPal's rate: the saved method is charged tip + PayPal's fee; the Helpr's 100% goes to the tips lane's recorder", async () => {
    const st = store(); const p = provider(["ok"]); const q = queue(true);
    const out = await chargePayPalAutoTip({ charge: { store: st.s, provider: p, env: "sandbox" }, queue: q.q, jobStateNow: async () => "chargeable" }, tip);
    expect(out).toEqual({ outcome: "charged", paymentId: "P1", payoutQueued: true, payoutReason: null });
    expect(p.calls[0].amountCents).toBe(tip.quote.chargeCents);
    expect(tip.quote.chargeCents).toBe(569); // $5 tip + 69c: the smallest fee covering 3.49% + 49c of the whole charge
    expect(q.calls).toEqual([{ jobId: "j1", helperId: "h1", amountCents: 500, platformFeeCents: 0, source: "auto_tip", providerPaymentId: "P1",
      tipCapture: { providerOrderId: "ORD1", providerCaptureId: "CAP1", amountCents: 569, settled: true } }]);
  });
  it("not charged when the queue cannot record a tip payout", async () => {
    const st = store(); const p = provider([]); const q = queue(false);
    expect(await chargePayPalAutoTip({ charge: { store: st.s, provider: p, env: "sandbox" }, queue: q.q, jobStateNow: async () => "chargeable" }, tip)).toEqual({ outcome: "payout_unsupported" });
    expect(p.calls).toEqual([]);
    expect(st.rows).toEqual([]);
  });
  it("re-reads the job's state right before the charge (a refund or dispute since the candidate list)", async () => {
    const st = store(); const p = provider([]); const q = queue(true);
    expect(await chargePayPalAutoTip({ charge: { store: st.s, provider: p, env: "sandbox" }, queue: q.q, jobStateNow: async () => "closed" }, tip)).toEqual({ outcome: "state_changed", state: "closed" });
    expect(await chargePayPalAutoTip({ charge: { store: st.s, provider: p, env: "sandbox" }, queue: q.q, jobStateNow: async () => new Error("down") }, tip)).toEqual({ outcome: "state_unreadable", message: "down" });
    expect(p.calls).toEqual([]);
  });
  it("never silent: no method / decline -> give up with words for the poster; unknown -> ambiguous", async () => {
    const mk = (s: ReturnType<typeof store>, r: Array<"ok" | "timeout" | "declined">) => chargePayPalAutoTip({ charge: { store: s.s, provider: provider(r), env: "sandbox" }, queue: queue(true).q, jobStateNow: async () => "chargeable" }, tip);
    expect(await mk(store({ method: null }), [])).toMatchObject({ outcome: "give_up", reason: "no_saved_paypal_method" });
    expect(await mk(store(), ["declined"])).toMatchObject({ outcome: "give_up", reason: "paypal_declined: DECLINED" });
    expect(await mk(store(), ["timeout"])).toMatchObject({ outcome: "ambiguous" });
  });
  it("a charged tip whose payout did not queue is retried until it does", async () => {
    const owed = [{ paymentId: "P1", tipId: "t", jobId: "j1", helperId: "h1", tipCents: 500, providerOrderId: "O", providerCaptureId: "C", chargedCents: 570 }];
    expect(await retryOwedTipPayouts(queue(true, "refused").q, owed)).toEqual(owed);
    expect(await retryOwedTipPayouts(queue(true).q, owed)).toEqual([]);
  });
});

describe("repeat visits through PayPal", () => {
  const PARENT = {
    id: "p0000000-0000-4000-8000-000000000001", customer_id: POSTER, category: "cleaning", budget: 80, title: "Weekly clean",
    helper_fee_flat_cents: 70, helper_fee_percent: 8, poster_fee_flat_cents: null, platform_fee_percent: 0, start_time: "09:00:00",
  };
  it("price: the visit's budget only on the PayPal stamp; Helpr's provisional fee 8% + 70c", () => {
    expect(planPayPalVisitCharge(PARENT)).toEqual({ kind: "plan", budgetCents: 8000, feeCents: 0, taxCents: 0, totalCents: 8000, helperFeePercent: 8, helperFeeAmount: 7.1 });
  });
  it("refuses what is not on PayPal yet: legacy fee model, poster-fee model, taxable labor, $300+ (parked for on-session today)", () => {
    expect(planPayPalVisitCharge({ ...PARENT, helper_fee_flat_cents: null })).toMatchObject({ reason: "series_fee_model_not_on_paypal" });
    expect(planPayPalVisitCharge({ ...PARENT, poster_fee_flat_cents: 70 })).toMatchObject({ reason: "poster_fee_series_not_on_paypal" });
    expect(planPayPalVisitCharge({ ...PARENT, category: "assembly" })).toMatchObject({ reason: "taxable_visit_not_on_paypal" });
    expect(planPayPalVisitCharge({ ...PARENT, budget: 300 })).toMatchObject({ reason: "visit_needs_on_session_payment_not_on_paypal" });
    expect(planPayPalVisitCharge({ ...PARENT, budget: 299.99 })).toMatchObject({ kind: "plan", totalCents: 29999 });
  });
  it("one stable subject per (series, date)", async () => {
    const a = await visitSubjectId(PARENT.id, "2026-11-10");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await visitSubjectId(PARENT.id, "2026-11-10")).toBe(a);
    expect(await visitSubjectId(PARENT.id, "2026-11-17")).not.toBe(a);
  });
  function visitStore(existing: string | null = null, insert: "ok" | "dup" | "err" = "ok") {
    const log: string[] = [];
    let child: string | null = existing;
    const funds = new Map<string, string>();
    const vs: VisitStore = {
      async visitJobFor() { return child ? { id: child } : null; },
      async insertVisitJob(row) {
        log.push(`insert ${row.payment_status} ${row.date_needed} helper=${row.helper_id}`);
        if (insert === "dup") { child = "OTHER"; return { ok: false, code: "23505", message: "dup" }; }
        if (insert === "err") return { ok: false, code: "P0001", message: "series_ended: x" };
        child = "CHILD1"; return { ok: true, id: "CHILD1" };
      },
      async linkPaymentToJob(p, j) { funds.set(p, j); log.push(`link ${p}->${j}`); },
      async jobFundedBy(p) { return funds.get(p) ?? null; },
      async insertRefund(p, k, a) { log.push(`refund-row ${k} ${a}`); return { id: "RF", status: "pending", providerRefundId: null }; },
      async markRefund(_id, s) { log.push(`refund ${s}`); },
      async captureIdOf() { return "CAP1"; },
    };
    return { vs, log };
  }
  const refunder = () => { const calls: number[] = []; return { calls, refund: async (i: { amountCents: number }) => { calls.push(i.amountCents); return { providerRefundId: "R", status: "COMPLETED" as const, settled: true, amountCents: i.amountCents }; } }; };
  it("charge first, then the visit row (accepted, the date's holder, escrow), then the payment names it", async () => {
    const st = store(); const p = provider(["ok"]); const v = visitStore(); const r = refunder();
    const out = await fundPayPalVisit({ charge: { store: st.s, provider: p, env: "sandbox" }, store: v.vs, provider: r }, { parent: PARENT, visitDate: "2026-11-10", holderId: "h1" });
    expect(out).toEqual({ outcome: "funded", childJobId: "CHILD1", paymentId: "P1", totalCents: 8000 });
    expect(p.calls[0].idempotencyKey).toMatch(/^lh:pp:recurring_visit:[0-9a-f-]{36}:amt8000:a1$/);
    expect(v.log).toEqual(["insert escrow 2026-11-10 helper=h1", "link P1->CHILD1"]);
  });
  it("a date that already has its visit is never charged", async () => {
    const st = store(); const p = provider([]); const v = visitStore("EXISTING");
    expect(await fundPayPalVisit({ charge: { store: st.s, provider: p, env: "sandbox" }, store: v.vs, provider: refunder() }, { parent: PARENT, visitDate: "2026-11-10", holderId: "h1" })).toEqual({ outcome: "exists" });
    expect(p.calls).toEqual([]);
  });
  it("a failed charge makes no visit", async () => {
    const st = store(); const p = provider(["declined"]); const v = visitStore();
    expect((await fundPayPalVisit({ charge: { store: st.s, provider: p, env: "sandbox" }, store: v.vs, provider: refunder() }, { parent: PARENT, visitDate: "2026-11-10", holderId: "h1" })).outcome).toBe("declined");
    expect(v.log).toEqual([]);
  });
  it("a race that charged twice refunds the duplicate IN FULL (our own mistake)", async () => {
    const st = store(); const p = provider(["ok"]); const v = visitStore(null, "dup"); const r = refunder();
    const out = await fundPayPalVisit({ charge: { store: st.s, provider: p, env: "sandbox" }, store: v.vs, provider: r }, { parent: PARENT, visitDate: "2026-11-10", holderId: "h1" });
    expect(out.outcome).toBe("needs_review");
    expect(r.calls).toEqual([8000]);
  });
  it("the visit row copies today's fields and carries no Stripe id", () => {
    const plan = planPayPalVisitCharge(PARENT);
    if (plan.kind !== "plan") throw new Error();
    const row = visitJobRow(PARENT, "2026-11-10", "h1", plan, "2026-11-07T06:00:00Z");
    expect(row).toMatchObject({ parent_job_id: PARENT.id, status: "accepted", payment_status: "escrow", helper_id: "h1", budget: 80, helper_fee_flat_cents: 70, helper_fee_percent: 8, platform_fee_amount: 7.1, customer_fee_amount: 0, sales_tax_amount: 0 });
    expect(Object.keys(row).filter((k) => k.startsWith("stripe"))).toEqual([]);
  });
});
