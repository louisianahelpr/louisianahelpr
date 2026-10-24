/**
 * PayPal phase 6: charging a member's SAVED PayPal method with nobody present (repeat visits,
 * auto-tip). Record before charge; every row of the subject read before any charge (a funded row
 * adopted, an open one at another price stops); no re-send past PayPal's replay memory; the
 * switch asked first and an unreadable switch never read as "off"; a decline stands until a new
 * method is saved; a token charged as the source it came from; a mismatched capture never
 * funded. Auto-tip: claim row first, the switch right before the charge, the tips lane's tip shape
 * (paypal_open_tip takes the claim over, settlePayPalTip queues by tip_id), the fee at the saved
 * method's own rate. A visit is created only once its money is in, its link to the money can't be
 * quietly lost, and a duplicate is refunded only when other money funds the date.
 *
 * @mutate supabase/functions/_shared/payments/paypalSavedCharge.ts | if (!sw) return { outcome: "switch_off" }; | void 0;
 * @mutate supabase/functions/_shared/payments/paypalSavedCharge.ts | if (now() - open.createdAtMs > PAYPAL_REPLAY_WINDOW_MS) { | if (false) {
 * @mutate supabase/functions/_shared/payments/paypalSavedCharge.ts | return `lh:pp:${i.subjectKind}:${i.subjectId}:amt${i.amountCents}:a${attempt}`; | return `lh:pp:${i.subjectKind}:${i.subjectId}:a${attempt}`;
 * @mutate supabase/functions/_shared/payments/paypalSavedCharge.ts | vaultSource: method.source, | vaultSource: "card",
 * @mutate supabase/functions/_shared/payments/paypalSavedCharge.ts | if (open.amountCents !== input.amountCents) { | if (false) {
 * @mutate supabase/functions/_shared/payments/paypalSavedCharge.ts | if (dead.length > 0 && !(method.createdAtMs > lastDeadMs)) { | if (false) {
 * @mutate supabase/functions/_shared/payments/paypalSavedCharge.ts | await deps.store.markCaptureMismatch(row.id, { providerOrderId: cap.providerOrderId, providerCaptureId: cap.providerCaptureId }); | await deps.store.markCaptured(row.id, { providerOrderId: cap.providerOrderId, providerCaptureId: cap.providerCaptureId, status: "captured" });
 * @mutate supabase/functions/_shared/payments/paypalAutoTip.ts | if (!sw) return { outcome: "give_up", reason: "paypal_switch_off" | if (false) return { outcome: "give_up", reason: "paypal_switch_off"
 * @mutate supabase/functions/_shared/payments/paypalAutoTip.ts | return source === "card" ? "card_standard" : "paypal_checkout"; | return "paypal_checkout";
 * @mutate supabase/functions/_shared/payments/paypalVisitFunding.ts | if (!winner.stripePaymentIntentId && !winner.fundedByPaymentId) return await link(winner.id); | void 0;
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
import { autoTipChargeKey, chargePayPalAutoTip, type PayPalAutoTipDeps } from "../../supabase/functions/_shared/payments/paypalAutoTip.ts";
import { fundPayPalVisit, planPayPalVisitCharge, visitJobRow, type VisitStore } from "../../supabase/functions/_shared/payments/paypalVisitFunding.ts";
import { PayPalClient } from "../../supabase/functions/_shared/payments/paypalClient.ts";
import { createPayPalCheckoutProvider } from "../../supabase/functions/_shared/payments/paypalCheckout.ts";
import { ProviderApiError, type CaptureResult } from "../../supabase/functions/_shared/payments/types.ts";
import { paypalTipChargeBreakdown } from "../../supabase/functions/_shared/tipFees.ts";

const POSTER = "c0000000-0000-4000-8000-000000000001";
const METHOD: SavedMethod = { id: "m1", userId: POSTER, env: "sandbox", vaultId: "VAULT1", source: "card", createdAtMs: 500 };

type Row = SavedPaymentRow & { subjectId: string };
function store(opts: { switchOn?: boolean | Error; method?: SavedMethod | null; rows?: Row[] } = {}) {
  const rows: Row[] = opts.rows ?? [];
  let t = 1_000;
  const s: SavedChargeStore = {
    async switchOnFor() { return opts.switchOn ?? true; },
    async activeMethod() { return opts.method === undefined ? METHOD : opts.method; },
    async paymentsForSubject(_k, id) { return rows.filter((r) => r.subjectId === id); },
    async insertPayment(r) {
      const dup = rows.find((x) => x.idempotencyKey === r.idempotencyKey);
      if (dup) return dup;
      const row: Row = { id: `P${rows.length + 1}`, idempotencyKey: r.idempotencyKey, status: "created", amountCents: r.amountCents, providerOrderId: `pending:${r.idempotencyKey}`, providerCaptureId: null, createdAtMs: t, updatedAtMs: t, subjectId: r.subjectId };
      rows.push(row);
      return row;
    },
    async markCaptured(id, c) { const r = rows.find((x) => x.id === id)!; r.status = c.status; r.providerCaptureId = c.providerCaptureId; r.providerOrderId = c.providerOrderId; r.updatedAtMs = ++t; },
    async markCaptureMismatch(id, c) { const r = rows.find((x) => x.id === id)!; r.providerCaptureId = c.providerCaptureId; r.providerOrderId = c.providerOrderId; },
    async markFailed(id) { const r = rows.find((x) => x.id === id)!; r.status = "failed"; r.updatedAtMs = ++t; },
  };
  return { s, rows };
}
type Result = "ok" | "pending" | "timeout" | "declined" | "short" | "dupinvoice";
function provider(results: Result[]) {
  const calls: Array<{ idempotencyKey: string; referenceId: string; vaultId: string; amountCents: number; vaultSource?: string }> = [];
  return {
    calls,
    chargeSaved: async (i: { idempotencyKey: string; referenceId: string; vaultId: string; amountCents: number; vaultSource?: "card" | "paypal" }): Promise<CaptureResult> => {
      calls.push({ idempotencyKey: i.idempotencyKey, referenceId: i.referenceId, vaultId: i.vaultId, amountCents: i.amountCents, vaultSource: i.vaultSource });
      const r = results.shift() ?? "ok";
      if (r === "timeout") throw new ProviderApiError("transport", 0, null, null, null);
      if (r === "declined") throw new ProviderApiError("declined", 200, "CAPTURE_NOT_SUCCESSFUL", "DECLINED", null);
      if (r === "dupinvoice") throw new ProviderApiError("dup", 422, "UNPROCESSABLE_ENTITY", "DUPLICATE_INVOICE_ID", null);
      return { providerOrderId: "ORD1", providerCaptureId: "CAP1", status: r === "pending" ? "PENDING" : "COMPLETED", settled: r !== "pending", amountCents: r === "short" ? i.amountCents - 1 : i.amountCents, feeCents: 30, vaultId: null };
    },
  };
}
const SUBJ = "e0000000-0000-4000-8000-000000000001";
const input = { subjectKind: "recurring_visit" as const, subjectId: SUBJ, payerId: POSTER, amountCents: 8000 };

describe("chargeSavedPayment", () => {
  it("writes the 'created' row BEFORE the charge; charges with the row's key and the row id as PayPal's invoice; records the capture", async () => {
    const st = store(); const p = provider(["ok"]);
    const out = await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, input);
    expect(out).toEqual({ outcome: "charged", paymentId: "P1", orderId: "ORD1", captureId: "CAP1", amountCents: 8000 });
    expect(p.calls).toEqual([{ idempotencyKey: `lh:pp:recurring_visit:${SUBJ}:amt8000:a1`, referenceId: "P1", vaultId: "VAULT1", amountCents: 8000, vaultSource: "card" }]);
    expect(st.rows[0]).toMatchObject({ status: "captured", providerCaptureId: "CAP1", providerOrderId: "ORD1" });
  });
  it("the key names the amount and the attempt", () => {
    expect(savedChargeKey({ ...input })).not.toBe(savedChargeKey({ ...input, amountCents: 8001 }));
    expect(savedChargeKey({ ...input, attempt: 2 })).toMatch(/:amt8000:a2$/);
    expect(() => savedChargeKey({ ...input, amountCents: 0 })).toThrow();
  });
  it("a funded row is adopted on the next run, never charged again; a funded row at ANOTHER price stops for a person (re-price)", async () => {
    const st = store(); const p = provider(["ok"]);
    await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, input);
    expect((await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, input)).outcome).toBe("charged");
    expect(await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, { ...input, amountCents: 9000 })).toMatchObject({ outcome: "needs_review" });
    expect(p.calls).toHaveLength(1);
  });
  it("an unknown outcome is replayed with the SAME key inside PayPal's replay memory, never after it, and never beside a re-price", async () => {
    const st = store(); const p = provider(["timeout", "ok"]);
    let t = 1_000;
    const deps = { store: st.s, provider: p, env: "sandbox" as const, now: () => t };
    expect((await chargeSavedPayment(deps, input)).outcome).toBe("retry");
    // The parent's budget changed meanwhile: no second order beside the open one.
    expect(await chargeSavedPayment(deps, { ...input, amountCents: 9000 })).toMatchObject({ outcome: "needs_review", reason: expect.stringMatching(/^open_charge_at_other_amount/) });
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
  it("a decline is fresh once, then stands (told once) until the member saves a NEW method; then one new attempt", async () => {
    const st = store(); const p = provider(["declined", "ok"]);
    expect(await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, input)).toMatchObject({ outcome: "declined", fresh: true });
    expect(await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, input)).toMatchObject({ outcome: "declined", fresh: false });
    expect(p.calls).toHaveLength(1);
    const fixed = { ...st, s: { ...st.s, activeMethod: async () => ({ ...METHOD, id: "m2", vaultId: "VAULT2", createdAtMs: 99_999 }) } };
    expect((await chargeSavedPayment({ store: fixed.s, provider: p, env: "sandbox" }, input)).outcome).toBe("charged");
    expect(p.calls[1]).toMatchObject({ idempotencyKey: `lh:pp:recurring_visit:${SUBJ}:amt8000:a2`, vaultId: "VAULT2" });
  });
  it("PayPal capturing a different amount is recorded but NEVER funded: every later run stops for a person", async () => {
    const st = store(); const p = provider(["short"]);
    expect(await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, input)).toMatchObject({ outcome: "needs_review", reason: expect.stringMatching(/^captured_amount_mismatch/) });
    expect(st.rows[0]).toMatchObject({ status: "created", providerCaptureId: "CAP1" });
    expect(await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, input)).toMatchObject({ outcome: "needs_review", reason: expect.stringMatching(/^captured_amount_mismatch_recorded/) });
    expect(p.calls).toHaveLength(1);
  });
  it("PayPal's DUPLICATE_INVOICE_ID is never read as a decline (an order for this row exists)", async () => {
    const st = store(); const p = provider(["dupinvoice"]);
    expect(await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, input)).toMatchObject({ outcome: "needs_review", reason: expect.stringMatching(/^duplicate_invoice/) });
    expect(st.rows[0].status).toBe("created");
  });
  it("PENDING money is not 'charged' (not funded)", async () => {
    const st = store(); const p = provider(["pending"]);
    expect((await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, input)).outcome).toBe("pending");
    expect(st.rows[0].status).toBe("capture_pending");
  });
  it("switch off, no saved method, or an unreadable switch: no row, no charge (unreadable is never 'off')", async () => {
    for (const [st, want] of [[store({ switchOn: false }), "switch_off"], [store({ method: null }), "no_saved_method"], [store({ switchOn: new Error("timeout") }), "unreadable"]] as const) {
      const p = provider([]);
      expect((await chargeSavedPayment({ store: st.s, provider: p, env: "sandbox" }, input)).outcome).toBe(want);
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

describe("the adapter sends the token as the source it came from, with the row as invoice", () => {
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
  it("card (default): payment_source.card.vault_id with the merchant-initiated stored-credential flags; invoice_id = reference", async () => {
    const c = client();
    await c.prov.chargeSaved({ idempotencyKey: "k:amt538", referenceId: "r", vaultId: "V", amountCents: 538 });
    const b = c.bodies[0] as { payment_source: unknown; purchase_units: Array<{ invoice_id: string }> };
    expect(b.payment_source).toEqual({ card: { vault_id: "V", stored_credential: { payment_initiator: "MERCHANT", payment_type: "UNSCHEDULED", usage: "SUBSEQUENT" } } });
    expect(b.purchase_units[0].invoice_id).toBe("r");
  });
  it("paypal: payment_source.paypal.vault_id", async () => {
    const c = client();
    await c.prov.chargeSaved({ idempotencyKey: "k:amt538", referenceId: "r", vaultId: "V", amountCents: 538, vaultSource: "paypal" });
    expect((c.bodies[0] as { payment_source: unknown }).payment_source).toEqual({ paypal: { vault_id: "V" } });
    await expect(c.prov.chargeSaved({ idempotencyKey: "k:amt538", referenceId: "r", vaultId: "V", amountCents: 538, vaultSource: "venmo" as never })).rejects.toThrow(/unknown vault source/);
  });
});

describe("auto-tip through PayPal (the tips lane's tip shape)", () => {
  const TIP = "d0000000-0000-4000-8000-000000000009";
  const tip = { tipId: TIP, jobId: "j1", posterId: POSTER, helperId: "h1", tipCents: 500 };
  function deps(over: Partial<PayPalAutoTipDeps> & { results?: Result[] } = {}) {
    const order: string[] = [];
    const p = provider(over.results ?? ["ok"]);
    const opened: unknown[] = [];
    const d: PayPalAutoTipDeps = {
      provider: { chargeSaved: async (i) => { order.push("charge"); return p.chargeSaved(i); } },
      env: "sandbox",
      jobStateNow: async () => "chargeable",
      switchOnFor: async () => { order.push("switch"); return true; },
      activeMethod: async () => ({ vaultId: "VAULT1", source: "card" }),
      openTip: async (a) => { order.push("open"); opened.push(a); return { providerPaymentId: "PP1" }; },
      settle: async () => { order.push("settle"); return { state: "recorded", payoutId: "PO1", payoutReason: "queued", paymentStatus: "captured" }; },
      ...over,
    };
    return { d, p, order, opened };
  }
  it("switch (for the poster) right before the charge, then the charge keyed to the claim row, then paypal_open_tip takes the claim over, then settle", async () => {
    const x = deps();
    const out = await chargePayPalAutoTip(x.d, tip);
    const quote = paypalTipChargeBreakdown(500, "card_standard");
    expect(out).toEqual({ outcome: "charged", paymentId: "PP1", quote, payoutId: "PO1", payoutReason: "queued" });
    expect(x.order).toEqual(["switch", "charge", "open", "settle"]);
    expect(x.p.calls).toEqual([{ idempotencyKey: autoTipChargeKey(TIP, quote.chargeCents), referenceId: TIP, vaultId: "VAULT1", amountCents: quote.chargeCents, vaultSource: "card" }]);
    expect(x.opened).toEqual([{ jobId: "j1", tipperId: POSTER, helperId: "h1", tipCents: 500, chargeCents: quote.chargeCents, env: "sandbox", idempotencyKey: `lh:autotip:${TIP}:charge:amt${quote.chargeCents}:a1`, orderId: "ORD1", tipId: TIP }]);
  });
  it("the fee is the saved method's own PayPal rate: card 2.99% + 49c, PayPal wallet 3.49% + 49c; the Helpr gets 100%", async () => {
    const card = paypalTipChargeBreakdown(500, "card_standard");
    const wallet = paypalTipChargeBreakdown(500, "paypal_checkout");
    expect(card.helperCents).toBe(500);
    expect(wallet.chargeCents).toBeGreaterThan(card.chargeCents);
    const x = deps({ activeMethod: async () => ({ vaultId: "W", source: "paypal" }) });
    expect(await chargePayPalAutoTip(x.d, tip)).toMatchObject({ outcome: "charged", quote: wallet });
  });
  it("re-reads the job's state; a closed job or an unreadable read charges nothing", async () => {
    for (const [state, want] of [["closed", "state_changed"], [new Error("down"), "unreadable"]] as const) {
      const x = deps({ jobStateNow: async () => state });
      expect((await chargePayPalAutoTip(x.d, tip)).outcome).toBe(want);
      expect(x.p.calls).toEqual([]);
    }
  });
  it("never silent, never charged: switch off, no method -> give up with words; unreadable switch -> released, not 'off'", async () => {
    expect(await chargePayPalAutoTip(deps({ switchOnFor: async () => false }).d, tip)).toMatchObject({ outcome: "give_up", reason: "paypal_switch_off" });
    expect(await chargePayPalAutoTip(deps({ activeMethod: async () => null }).d, tip)).toMatchObject({ outcome: "give_up", reason: "no_saved_paypal_method" });
    const x = deps({ switchOnFor: async () => new Error("rpc timeout") });
    expect(await chargePayPalAutoTip(x.d, tip)).toMatchObject({ outcome: "unreadable" });
    expect(x.p.calls).toEqual([]);
  });
  it("a decline gives up; an unknown charge, a refused record, or a failed settle is ambiguous (claim kept pending, paged)", async () => {
    expect(await chargePayPalAutoTip(deps({ results: ["declined"] }).d, tip)).toMatchObject({ outcome: "give_up", reason: "paypal_declined: DECLINED" });
    expect(await chargePayPalAutoTip(deps({ results: ["timeout"] }).d, tip)).toMatchObject({ outcome: "ambiguous" });
    expect(await chargePayPalAutoTip(deps({ results: ["dupinvoice"] }).d, tip)).toMatchObject({ outcome: "ambiguous", reason: expect.stringMatching(/^duplicate_invoice/) });
    expect(await chargePayPalAutoTip(deps({ openTip: async () => { throw new Error("tip_key_reused"); } }).d, tip)).toMatchObject({ outcome: "ambiguous", reason: expect.stringMatching(/^CHARGED but not recorded/) });
    expect(await chargePayPalAutoTip(deps({ settle: async () => { throw new Error("rpc down"); } }).d, tip)).toMatchObject({ outcome: "ambiguous" });
    expect(await chargePayPalAutoTip(deps({ results: ["short"] }).d, tip)).toMatchObject({ outcome: "ambiguous", reason: expect.stringMatching(/^captured_amount_mismatch/) });
  });
  it("a capture still pending is recorded, not called paid", async () => {
    const x = deps({ settle: async () => ({ state: "recorded", payoutId: null, payoutReason: "not_settled", paymentStatus: "capture_pending" }) });
    expect(await chargePayPalAutoTip(x.d, tip)).toMatchObject({ outcome: "capture_pending", paymentId: "PP1" });
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
  type Winner = { id: string; stripePaymentIntentId: string | null; fundedByPaymentId: string | null };
  function visitStore(opts: { existing?: Winner | null; insert?: "ok" | "dup" | "ended" | "err"; winner?: Winner; linkFails?: boolean } = {}) {
    const log: string[] = [];
    let child: Winner | null = opts.existing ?? null;
    const funds = new Map<string, string>();
    const vs: VisitStore = {
      async visitJobFor() { return child; },
      async insertVisitJob(row) {
        log.push(`insert ${row.payment_status} ${row.date_needed} helper=${row.helper_id}`);
        if (opts.insert === "dup") { child = opts.winner ?? { id: "OTHER", stripePaymentIntentId: "pi_x", fundedByPaymentId: null }; return { ok: false, code: "23505", message: "dup" }; }
        if (opts.insert === "ended") return { ok: false, code: "P0001", message: "series_ended: the series ended" };
        if (opts.insert === "err") return { ok: false, code: "P0001", message: "boom" };
        child = { id: "CHILD1", stripePaymentIntentId: null, fundedByPaymentId: null }; return { ok: true, id: "CHILD1" };
      },
      async linkPaymentToJob(p, j) { if (opts.linkFails) throw new Error("matched 0 rows"); funds.set(p, j); log.push(`link ${p}->${j}`); },
      async jobFundedBy(p) { return funds.get(p) ?? null; },
      async insertRefund(p, k, a) { log.push(`refund-row ${k} ${a}`); return { id: "RF", status: "pending", providerRefundId: null }; },
      async markRefund(_id, s) { log.push(`refund ${s}`); },
      async setPaymentStatus(p, s) { log.push(`payment ${p} ${s}`); },
      async captureIdOf() { return "CAP1"; },
    };
    return { vs, log };
  }
  const refunder = () => { const calls: number[] = []; return { calls, refund: async (i: { amountCents: number }) => { calls.push(i.amountCents); return { providerRefundId: "R", status: "COMPLETED" as const, settled: true, amountCents: i.amountCents }; } }; };
  const run = (st: ReturnType<typeof store>, p: ReturnType<typeof provider>, v: ReturnType<typeof visitStore>, r = refunder(), fee: number | null = 328) =>
    fundPayPalVisit({ charge: { store: st.s, provider: p, env: "sandbox" }, store: v.vs, provider: r, readCaptureFeeCents: async () => fee }, { parent: PARENT, visitDate: "2026-11-10", holderId: "h1" });
  it("charge first, then the visit row (accepted, the date's holder, escrow), then the payment names it; booked for the parties", async () => {
    const st = store(); const p = provider(["ok"]); const v = visitStore();
    expect(await run(st, p, v)).toEqual({ outcome: "funded", childJobId: "CHILD1", paymentId: "P1", totalCents: 8000, booked: true });
    expect(p.calls[0].idempotencyKey).toMatch(/^lh:pp:recurring_visit:[0-9a-f-]{36}:amt8000:a1$/);
    expect(v.log).toEqual(["insert escrow 2026-11-10 helper=h1", "link P1->CHILD1"]);
  });
  it("a date that already has its visit is never charged", async () => {
    const st = store(); const p = provider([]);
    expect(await run(st, p, visitStore({ existing: { id: "E", stripePaymentIntentId: null, fundedByPaymentId: "PX" } }))).toEqual({ outcome: "exists" });
    expect(p.calls).toEqual([]);
  });
  it("a failed charge makes no visit; a lost link after booking is a page, not a quiet retry", async () => {
    const v = visitStore();
    expect((await run(store(), provider(["declined"]), v)).outcome).toBe("declined");
    expect(v.log).toEqual([]);
    expect(await run(store(), provider(["ok"]), visitStore({ linkFails: true }))).toMatchObject({ outcome: "needs_review", reason: expect.stringMatching(/booked but payment P1 not linked/) });
  });
  it("23505: a date another payment funds -> this charge is refunded IN FULL; one nothing funds -> it is OURS (linked, never refunded); one this payment funds -> adopted", async () => {
    const r1 = refunder(); const v1 = visitStore({ insert: "dup", winner: { id: "W", stripePaymentIntentId: "pi_1", fundedByPaymentId: null } });
    expect(await run(store(), provider(["ok"]), v1, r1)).toMatchObject({ outcome: "refunded_duplicate", refundCents: 8000, winnerJobId: "W" });
    expect(r1.calls).toEqual([8000]);
    expect(v1.log).toContain("payment P1 refunded");
    const r2 = refunder(); const v2 = visitStore({ insert: "dup", winner: { id: "W", stripePaymentIntentId: null, fundedByPaymentId: null } });
    expect(await run(store(), provider(["ok"]), v2, r2)).toMatchObject({ outcome: "funded", childJobId: "W", booked: true });
    expect(r2.calls).toEqual([]);
    const r3 = refunder(); const v3 = visitStore({ insert: "dup", winner: { id: "W", stripePaymentIntentId: null, fundedByPaymentId: "P1" } });
    expect(await run(store(), provider(["ok"]), v3, r3)).toMatchObject({ outcome: "funded", childJobId: "W", booked: false });
    expect(r3.calls).toEqual([]);
  });
  it("a visit that can't be booked after its charge (series ended mid-run) is refunded less PayPal's fee (today's rule), and said so", async () => {
    const r = refunder();
    expect(await run(store(), provider(["ok"]), visitStore({ insert: "ended" }), r, 328)).toMatchObject({ outcome: "refunded_unbooked", refundCents: 7672, keptCents: 328 });
    expect(r.calls).toEqual([7672]);
    expect((await run(store(), provider(["ok"]), visitStore({ insert: "ended" }), refunder(), null)).outcome).toBe("retry");
  });
  it("the visit row copies today's fields and carries no Stripe id", () => {
    const plan = planPayPalVisitCharge(PARENT);
    if (plan.kind !== "plan") throw new Error();
    const row = visitJobRow(PARENT, "2026-11-10", "h1", plan, "2026-11-07T06:00:00Z");
    expect(row).toMatchObject({ parent_job_id: PARENT.id, status: "accepted", payment_status: "escrow", helper_id: "h1", budget: 80, helper_fee_flat_cents: 70, helper_fee_percent: 8, platform_fee_amount: 7.1, customer_fee_amount: 0, sales_tax_amount: 0 });
    expect(Object.keys(row).filter((k) => k.startsWith("stripe"))).toEqual([]);
  });
});
