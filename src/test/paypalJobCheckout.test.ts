/**
 * PayPal phase 3: the job checkout state machine (supabase/functions/_shared/payments/
 * paypalJobCheckout.ts) against a fake PayPal that keeps PayPal's own idempotency (a reused
 * PayPal-Request-Id answers the original object) and an in-memory model of the phase-3 RPCs.
 * The RPCs' real SQL is proved on PGlite (src/test/pglite/paypalJobCheckout.pglite.mjs); this
 * file proves the module calls them in the right order and acts only on PayPal's re-read state.
 *
 * @mutate supabase/functions/_shared/payments/paypalJobCheckout.ts |   const claim = await call<{ ok: boolean; reason: string }>(ctx.db, "paypal_job_capture_claim", { p_payment_id: row.id });\n  if (!claim?.ok) { |   const claim = { ok: true, reason: "skipped" };\n  if (!claim?.ok) {
 * @mutate supabase/functions/_shared/payments/paypalJobCheckout.ts |   if (FUNDED_STATUSES.has(row.status)) return { kind: "funded", fresh: false };\n  // An orphan: PayPal holds | // An orphan: PayPal holds
 * @mutate supabase/functions/_shared/payments/paypalJobCheckout.ts |     cap = await ctx.provider.capture(captureKey(row.subject_id, row.provider_order_id), row.provider_order_id); |     cap = await ctx.provider.capture(`${captureKey(row.subject_id, row.provider_order_id)}:${Date.now()}:${Math.random()}`, row.provider_order_id);
 * @mutate supabase/functions/_shared/payments/paypalJobCheckout.ts |     if (isDecline(e)) return await failed(ctx, row, e.issue ?? "declined");\n    // Transport failure |     if (isDecline(e)) return { kind: "declined", reason: "x" };\n    // Transport failure
 * @mutate supabase/functions/_shared/payments/paypalJobCheckout.ts |         return { kind: "redirect", approveUrl: order.approveUrl, paymentId: current.id, settled }; |         void 0;
 * @mutate supabase/functions/_shared/payments/paypalJobCheckout.ts |     if (dead?.status === "COMPLETED" && dead.capture) return await record(ctx, row, dead.capture); |     void dead;
 * @mutate supabase/functions/_shared/payments/paypalJobCheckout.ts |   if (row.env !== ctx.env) throw | if (false) throw
 * @mutate supabase/functions/_shared/payments/paypalJobCheckout.ts |   if (row.status_reason?.startsWith("orphan:")) { |   if (false) {
 * @mutate supabase/functions/_shared/payments/paypalJobCheckout.ts |     if (row.provider_capture_id) {\n      // A capture exists |     if (false) {\n      // A capture exists
 * @mutate supabase/functions/_shared/payments/paypalJobCheckout.ts |     settled.push(s); |     void s;
 */
import { describe, expect, it } from "vitest";
import {
  captureKey,
  handleCaptureEvent,
  handleOrderApproved,
  openJobCheckout,
  settleJobPayment,
  type JobCheckoutCtx,
  type JobOrderBreakdown,
  type JobPaymentRow,
} from "../../supabase/functions/_shared/payments/paypalJobCheckout";
import { ProviderApiError, type CaptureResult, type OrderState, type PaymentProvider } from "../../supabase/functions/_shared/payments/types";

const JOB = "job-1";
const PAYER = "poster-1";
const bd = (o: Partial<JobOrderBreakdown> = {}): JobOrderBreakdown => ({
  budget: 100, urgent_fee: 0, is_urgent: false, category: "cleaning", helpers_needed: null, recurrence_days: null,
  job_price_cents: 10000, onboarding_fee_cents: 0, item_cents: 10000, tax_cents: 0, taxable_base_cents: 0,
  helper_fee_percent: 8, helper_fee_flat_cents: 70, ...o,
});

/** A fake PayPal: orders by id, idempotent by PayPal-Request-Id, one capture per order. */
function fakePayPal() {
  const orders = new Map<string, { status: string; amount: number; captureId?: string; captureStatus?: string }>();
  const byKey = new Map<string, unknown>();
  const calls: string[] = [];
  let n = 0;
  let stale = false;
  let nextCapture: "ok" | "pending" | "declined" | "transport" | "already" = "ok";
  const capture = (orderId: string): CaptureResult => {
    const o = orders.get(orderId)!;
    return { providerOrderId: orderId, providerCaptureId: o.captureId!, status: o.captureStatus === "PENDING" ? "PENDING" : "COMPLETED", settled: o.captureStatus === "COMPLETED", amountCents: o.amount, feeCents: 30, vaultId: null };
  };
  const provider: PaymentProvider = {
    id: "paypal_checkout",
    env: "sandbox",
    async createCheckout(i) {
      calls.push(`create:${i.idempotencyKey}`);
      if (byKey.has(i.idempotencyKey)) return byKey.get(i.idempotencyKey) as never;
      const id = `ORDER${++n}`;
      orders.set(id, { status: "PAYER_ACTION_REQUIRED", amount: i.amountCents });
      const out = { providerOrderId: id, approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${id}`, status: "PAYER_ACTION_REQUIRED" };
      byKey.set(i.idempotencyKey, out);
      return out;
    },
    async getOrder(id): Promise<OrderState> {
      calls.push(`get:${id}`);
      const o = orders.get(id);
      if (!o || o.status === "GONE") return { providerOrderId: id, status: "GONE", amountCents: null, approveUrl: null, capture: null };
      if (stale && o.status === "COMPLETED") {
        stale = false;
        return { providerOrderId: id, status: "APPROVED", amountCents: o.amount, approveUrl: null, capture: null };
      }
      if (o.status === "COMPLETED" && o.captureStatus === "DECLINED") {
        throw new ProviderApiError("declined", 200, "CAPTURE_NOT_SUCCESSFUL", "DECLINED", null);
      }
      return {
        providerOrderId: id, status: o.status, amountCents: o.amount,
        approveUrl: o.status === "COMPLETED" ? null : `https://www.sandbox.paypal.com/checkoutnow?token=${id}`,
        capture: o.status === "COMPLETED" ? capture(id) : null,
      };
    },
    async capture(key, id) {
      calls.push(`capture:${key}`);
      if (byKey.has(key)) return byKey.get(key) as CaptureResult;
      const o = orders.get(id)!;
      if (nextCapture === "transport") { nextCapture = "ok"; throw new ProviderApiError("transport", 0, null, null, null); }
      if (nextCapture === "declined") throw new ProviderApiError("declined", 422, "UNPROCESSABLE_ENTITY", "INSTRUMENT_DECLINED", null);
      if (o.status === "COMPLETED") throw new ProviderApiError("already", 422, "UNPROCESSABLE_ENTITY", "ORDER_ALREADY_CAPTURED", null);
      if (o.status !== "APPROVED") throw new ProviderApiError("not approved", 422, "UNPROCESSABLE_ENTITY", "ORDER_NOT_APPROVED", null);
      o.status = "COMPLETED";
      o.captureId = `CAP${id}`;
      o.captureStatus = nextCapture === "pending" ? "PENDING" : "COMPLETED";
      const out = capture(id);
      if (nextCapture !== "already") byKey.set(key, out);
      else byKey.clear(); // PayPal's key cache expired: the next call with the key is new to PayPal
      return out;
    },
    async chargeSaved() { throw new Error("not used"); },
    async refund() { throw new Error("not used"); },
  };
  return {
    provider, orders, calls,
    approve: (id: string) => { orders.get(id)!.status = "APPROVED"; },
    setNextCapture: (v: typeof nextCapture) => { nextCapture = v; },
    staleOnce: () => { stale = true; },
    captures: () => [...orders.values()].filter((o) => o.captureId).length,
  };
}

/** The phase-3 RPCs, modelled in memory (their SQL is proved on PGlite). */
function fakeDb(job: { price: number; status?: string; paymentStatus?: string; switchOn?: boolean } = { price: 100 }) {
  const rows: JobPaymentRow[] = [];
  const j = { budget: job.price, status: job.status ?? "open", payment_status: job.paymentStatus ?? "unpaid", switchOn: job.switchOn ?? true };
  const rpcLog: string[] = [];
  const find = (id: unknown) => rows.find((r) => r.id === id)!;
  const fns: Record<string, (a: Record<string, unknown>) => unknown> = {
    paypal_job_payment_state: () => ({ attempts: rows.length, current: [...rows].reverse().find((r) => !["voided", "failed"].includes(r.status)) ?? null }),
    paypal_job_payment_by_order: (a) => rows.find((r) => r.provider_order_id === a.p_order_id) ?? null,
    paypal_job_order_open: (a) => {
      const existing = rows.find((r) => r.idempotency_key === a.p_idempotency_key);
      if (existing) return existing;
      if (rows.some((r) => ["created", "approved"].includes(r.status))) throw new Error('duplicate key value violates unique constraint "provider_payments_one_open_per_subject"');
      const row: JobPaymentRow = { id: `pp${rows.length + 1}`, subject_id: String(a.p_job_id), payer_id: String(a.p_payer_id), env: "sandbox", status: "created", provider_order_id: String(a.p_order_id), provider_capture_id: null, amount_cents: Number(a.p_amount_cents), idempotency_key: String(a.p_idempotency_key), breakdown: a.p_breakdown as JobOrderBreakdown };
      rows.push(row);
      return row;
    },
    paypal_job_order_void: (a) => { const r = find(a.p_payment_id); if (r.status !== "created") return false; r.status = "voided"; return true; },
    paypal_job_capture_claim: (a) => {
      const r = find(a.p_payment_id);
      if (r.status === "approved") return { ok: true, reason: "already_claimed" };
      if (r.status !== "created") return { ok: false, reason: r.status };
      if (!j.switchOn) return { ok: false, reason: "feature_disabled" };
      if (Number(r.breakdown?.budget) !== j.budget) { r.status = "voided"; return { ok: false, reason: "price_changed" }; }
      r.status = "approved";
      return { ok: true, reason: "claimed" };
    },
    paypal_job_capture_record: (a) => {
      const r = find(a.p_payment_id);
      if (r.provider_capture_id && r.provider_capture_id !== a.p_capture_id) return { outcome: "capture_id_mismatch" };
      if (Number(a.p_amount_cents) !== r.amount_cents) return { outcome: "amount_mismatch" };
      if (["captured"].includes(r.status)) return { outcome: "already_funded" };
      if (r.status_reason?.startsWith("orphan:")) return { outcome: "orphan", status: r.status_reason };
      let why: string | null = ["voided", "failed", "created"].includes(r.status) ? `orphan:${r.status === "created" ? "unclaimed" : r.status}` : null;
      if (!why && a.p_settled) {
        if (j.status !== "open") why = "orphan:job_closed";
        else if (j.payment_status !== "unpaid" && j.payment_status !== "failed") why = "orphan:second_capture";
        else if (Number(r.breakdown?.budget) !== j.budget) why = "orphan:price_changed";
      }
      if (why) { r.status = "voided"; r.provider_capture_id = String(a.p_capture_id); r.status_reason = why; return { outcome: "orphan", status: why }; }
      r.provider_capture_id = String(a.p_capture_id);
      if (!a.p_settled) { r.status = "capture_pending"; return { outcome: "pending" }; }
      r.status = "captured";
      j.payment_status = "escrow";
      return { outcome: "funded", onboarding_fee_duplicate: false };
    },
    paypal_job_capture_failed: (a) => {
      const r = find(a.p_payment_id);
      if (!["created", "approved", "capture_pending"].includes(r.status)) return false;
      r.status = "failed";
      if (j.payment_status === "unpaid") j.payment_status = "failed";
      return true;
    },
  };
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcLog.push(fn);
      try { return { data: fns[fn](args), error: null }; } catch (e) { return { data: null, error: { message: (e as Error).message } }; }
    },
  };
  return { db, rows, job: j, rpcLog };
}

const input = (o: Partial<JobOrderBreakdown> = {}) => ({
  jobId: JOB, payerId: PAYER, breakdown: bd(o), description: "Helpr Job: test",
  returnUrl: "https://app.test/payment-success?job_id=job-1&provider=paypal", cancelUrl: "https://app.test/post-job",
});

function setup(job?: Parameters<typeof fakeDb>[0]) {
  const pp = fakePayPal();
  const d = fakeDb(job);
  const ctx: JobCheckoutCtx = { db: d.db, provider: pp.provider, env: "sandbox" };
  return { pp, d, ctx };
}

describe("PayPal job checkout: open", () => {
  it("opens an order keyed by job, amount and attempt, and returns the approve link", async () => {
    const { pp, d, ctx } = setup();
    const out = await openJobCheckout(ctx, input());
    expect(out).toMatchObject({ kind: "redirect", approveUrl: expect.stringContaining("token=ORDER1") });
    expect(pp.calls).toEqual(["create:lh:job:job-1:checkout:amt10000:a1"]);
    expect(d.rows).toHaveLength(1);
  });

  it("a double-tap or a return visit at the same price reuses the open order (no second order)", async () => {
    const { pp, d, ctx } = setup();
    await openJobCheckout(ctx, input());
    const again = await openJobCheckout(ctx, input());
    expect(again).toMatchObject({ kind: "redirect", approveUrl: expect.stringContaining("token=ORDER1") });
    expect(pp.calls.filter((c) => c.startsWith("create:"))).toHaveLength(1);
    expect(d.rows).toHaveLength(1);
  });

  it("a re-priced job retires the old order and opens attempt 2", async () => {
    const { pp, d, ctx } = setup();
    await openJobCheckout(ctx, input());
    d.job.budget = 120;
    const out = await openJobCheckout(ctx, input({ budget: 120, job_price_cents: 12000, item_cents: 12000 }));
    expect(out).toMatchObject({ kind: "redirect", approveUrl: expect.stringContaining("token=ORDER2") });
    expect(d.rows.map((r) => r.status)).toEqual(["voided", "created"]);
    expect(pp.calls).toContain("create:lh:job:job-1:checkout:amt12000:a2");
  });

  it("an order the poster already approved is captured, never replaced", async () => {
    const { pp, ctx } = setup();
    await openJobCheckout(ctx, input());
    pp.approve("ORDER1");
    expect(await openJobCheckout(ctx, input())).toMatchObject({ kind: "funded", settled: [{ kind: "funded", fresh: true }] });
    expect(pp.captures()).toBe(1);
    expect(pp.calls.filter((c) => c.startsWith("create:"))).toHaveLength(1);
  });

  it("an expired order is retired and a new one opened", async () => {
    const { pp, d, ctx } = setup();
    await openJobCheckout(ctx, input());
    pp.orders.get("ORDER1")!.status = "GONE";
    const out = await openJobCheckout(ctx, input());
    expect(out).toMatchObject({ kind: "redirect", approveUrl: expect.stringContaining("ORDER2") });
    expect(d.rows[0].status).toBe("voided");
  });
});

describe("PayPal job checkout: settle (return page + webhook)", () => {
  async function opened() {
    const s = setup();
    await openJobCheckout(s.ctx, input());
    return { ...s, row: () => s.d.rows[s.d.rows.length - 1] };
  }

  it("not approved yet: nothing is captured", async () => {
    const { pp, ctx, row } = await opened();
    expect((await settleJobPayment(ctx, row())).kind).toBe("not_approved");
    expect(pp.captures()).toBe(0);
  });

  it("approved: claimed, captured with the order's one key, recorded as funded", async () => {
    const { pp, d, ctx, row } = await opened();
    pp.approve("ORDER1");
    expect(await settleJobPayment(ctx, row())).toEqual({ kind: "funded", fresh: true, onboardingFeeDuplicate: false });
    expect(pp.calls).toContain(`capture:${captureKey(JOB, "ORDER1")}`);
    expect(d.rpcLog.indexOf("paypal_job_capture_claim")).toBeLessThan(d.rpcLog.indexOf("paypal_job_capture_record"));
    expect(d.job.payment_status).toBe("escrow");
  });

  it("the return page plus the webhook replayed 3x make ONE capture and fund the job once", async () => {
    const { pp, d, ctx, row } = await opened();
    pp.approve("ORDER1");
    const ev = { id: "WH-1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "ORDER1" } };
    const outs = await Promise.all([
      settleJobPayment(ctx, { ...row() }),
      handleOrderApproved(ctx, ev),
      handleOrderApproved(ctx, ev),
      handleOrderApproved(ctx, ev),
    ]);
    const kinds = outs.map((o) => (o && "outcome" in o ? o.outcome : o));
    expect(kinds.every((o) => o?.kind === "funded")).toBe(true);
    expect(kinds.filter((o) => o?.kind === "funded" && o.fresh)).toHaveLength(1);
    expect(pp.captures()).toBe(1);
    expect(new Set(pp.calls.filter((c) => c.startsWith("capture:")))).toEqual(new Set([`capture:${captureKey(JOB, "ORDER1")}`]));
    expect(d.rows.filter((r) => r.status === "captured")).toHaveLength(1);
  });

  it("a capture event is settled by re-reading its order (event order does not matter)", async () => {
    const { pp, ctx } = await opened();
    pp.approve("ORDER1");
    const out = await handleCaptureEvent(ctx, { id: "WH-2", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "ANY", supplementary_data: { related_ids: { order_id: "ORDER1" } } } });
    expect(out?.outcome.kind).toBe("funded");
    expect(out?.jobId).toBe(JOB);
    expect(pp.captures()).toBe(1);
  });

  it("events for orders that are not ours do nothing", async () => {
    const { pp, ctx } = await opened();
    expect(await handleOrderApproved(ctx, { id: "x", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "NOTOURS" } })).toBeNull();
    expect(await handleCaptureEvent(ctx, { id: "y", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "C" } })).toBeNull();
    expect(pp.captures()).toBe(0);
  });

  it("a pending capture funds nothing; its COMPLETED event later does", async () => {
    const { pp, d, ctx, row } = await opened();
    pp.approve("ORDER1");
    pp.setNextCapture("pending");
    expect((await settleJobPayment(ctx, row())).kind).toBe("pending");
    expect(d.job.payment_status).toBe("unpaid");
    pp.orders.get("ORDER1")!.captureStatus = "COMPLETED";
    const out = await handleCaptureEvent(ctx, { id: "WH-3", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { supplementary_data: { related_ids: { order_id: "ORDER1" } } } });
    expect(out?.outcome.kind).toBe("funded");
    expect(d.job.payment_status).toBe("escrow");
  });

  it("a declined capture marks the payment failed (the poster can pay again)", async () => {
    const { pp, d, ctx, row } = await opened();
    pp.approve("ORDER1");
    pp.setNextCapture("declined");
    expect(await settleJobPayment(ctx, row())).toEqual({ kind: "declined", reason: "INSTRUMENT_DECLINED" });
    expect(d.job.payment_status).toBe("failed");
  });

  it("a transport failure keeps the claim; the retry uses the same key and captures once", async () => {
    const { pp, ctx, row } = await opened();
    pp.approve("ORDER1");
    pp.setNextCapture("transport");
    await expect(settleJobPayment(ctx, row())).rejects.toThrow(/transport/);
    expect(row().status).toBe("approved");
    expect((await settleJobPayment(ctx, row())).kind).toBe("funded");
    expect(pp.captures()).toBe(1);
  });

  it("ORDER_ALREADY_CAPTURED (PayPal forgot the key): reads the existing capture instead of capturing again", async () => {
    const { pp, d, ctx, row } = await opened();
    pp.approve("ORDER1");
    pp.setNextCapture("already"); // the capture happens, then PayPal forgets the key
    // ...and our record of it is lost (the database was unreachable for that one call).
    const realRpc = d.db.rpc;
    let lost = false;
    d.db.rpc = async (fn: string, args: Record<string, unknown>) => {
      if (fn === "paypal_job_capture_record" && !lost) { lost = true; return { data: null, error: { message: "db unreachable" } }; }
      return realRpc(fn, args);
    };
    await expect(settleJobPayment(ctx, row())).rejects.toThrow(/db unreachable/);
    expect(row().status).toBe("approved");
    pp.staleOnce(); // PayPal's next order read still says APPROVED: the retry tries to capture again
    const out = await settleJobPayment(ctx, row());
    expect(out.kind).toBe("funded");
    expect(pp.captures()).toBe(1);
    expect(pp.calls.filter((c) => c.startsWith("capture:"))).toEqual([`capture:${captureKey(JOB, "ORDER1")}`, `capture:${captureKey(JOB, "ORDER1")}`]);
  });

  it("a re-priced job's approved order is refused at the claim and never captured", async () => {
    const { pp, d, ctx, row } = await opened();
    pp.approve("ORDER1");
    d.job.budget = 150;
    expect(await settleJobPayment(ctx, row())).toEqual({ kind: "retired", reason: "price_changed" });
    expect(pp.captures()).toBe(0);
  });

  it("with the switch turned off, an approved order is not captured", async () => {
    const { pp, d, ctx, row } = await opened();
    pp.approve("ORDER1");
    d.job.switchOn = false;
    expect(await settleJobPayment(ctx, row())).toEqual({ kind: "refused", reason: "feature_disabled" });
    expect(pp.captures()).toBe(0);
  });

  it("a funded row is answered from the database: no PayPal call at all", async () => {
    const { pp, ctx, row } = await opened();
    pp.approve("ORDER1");
    await settleJobPayment(ctx, row());
    const before = pp.calls.length;
    expect(await settleJobPayment(ctx, row())).toEqual({ kind: "funded", fresh: false });
    expect(pp.calls.length).toBe(before);
  });

  it("a job closed under the capture: the capture is an ORPHAN, the job is not funded, and every later read reports it", async () => {
    const { pp, d, ctx, row } = await opened();
    pp.approve("ORDER1");
    // claimed first, then the job closes before the capture is recorded
    const realRecord = d.db.rpc;
    let closed = false;
    d.db.rpc = async (fn: string, args: Record<string, unknown>) => {
      if (fn === "paypal_job_capture_record" && !closed) { closed = true; d.job.status = "cancelled"; }
      return realRecord(fn, args);
    };
    const first = await settleJobPayment(ctx, row());
    expect(first).toMatchObject({ kind: "money_at_risk", reason: "orphan (orphan:job_closed)" });
    expect(d.job.payment_status).toBe("unpaid");
    expect(row()).toMatchObject({ status: "voided", status_reason: "orphan:job_closed", provider_capture_id: "CAPORDER1" });
    const before = pp.calls.length;
    expect(await settleJobPayment(ctx, row())).toEqual({ kind: "money_at_risk", reason: "orphan:job_closed", captureId: "CAPORDER1" });
    expect(pp.calls.length).toBe(before);
  });

  it("a pending capture whose order PayPal no longer shows is reported, never assumed to be nothing", async () => {
    const { pp, ctx, row } = await opened();
    pp.approve("ORDER1");
    pp.setNextCapture("pending");
    await settleJobPayment(ctx, row());
    pp.orders.get("ORDER1")!.status = "GONE";
    expect(await settleJobPayment(ctx, row())).toMatchObject({ kind: "money_at_risk", captureId: "CAPORDER1" });
    expect(row().status).toBe("capture_pending");
  });

  it("checkout on an already-approved order hands back the settle it made (for the fan-out and alerts)", async () => {
    const { pp, ctx } = await opened();
    pp.approve("ORDER1");
    const out = await openJobCheckout(ctx, input());
    expect(out.settled).toEqual([{ kind: "funded", fresh: true, onboardingFeeDuplicate: false }]);
  });

  it("a capture that lands on a row retired meanwhile is recorded as an orphan and reported, never closed quietly", async () => {
    const { pp, d, ctx, row } = await opened();
    pp.approve("ORDER1");
    // the capture goes through at PayPal, but before it is recorded the row is failed (a re-claim found the job closed)
    await ctx.provider.capture(captureKey(JOB, "ORDER1"), "ORDER1");
    row().status = "failed";
    const out = await settleJobPayment(ctx, row());
    expect(out).toMatchObject({ kind: "money_at_risk", captureId: "CAPORDER1" });
    expect(row()).toMatchObject({ status: "voided", status_reason: "orphan:failed" });
    expect(d.job.payment_status).toBe("unpaid");
  });

  it("a retired row whose order never completed stays retired (one PayPal read, no alert)", async () => {
    const { pp, ctx, row } = await opened();
    row().status = "voided";
    expect(await settleJobPayment(ctx, row())).toEqual({ kind: "retired", reason: "voided" });
    expect(pp.captures()).toBe(0);
  });

  it("a sandbox row is never acted on under another env", async () => {
    const { pp, ctx, row } = await opened();
    pp.approve("ORDER1");
    await expect(settleJobPayment({ ...ctx, env: "live" }, row())).rejects.toThrow(/paypal_env_mismatch/);
    expect(pp.captures()).toBe(0);
  });

  it("an order total that is not the row's is never captured", async () => {
    const { pp, ctx, row } = await opened();
    pp.approve("ORDER1");
    pp.orders.get("ORDER1")!.amount = 1;
    expect((await settleJobPayment(ctx, row())).kind).toBe("refused");
    expect(pp.captures()).toBe(0);
  });
});
