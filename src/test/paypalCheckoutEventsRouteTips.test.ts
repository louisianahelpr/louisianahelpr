/**
 * PayPal phase 3: the checkout webhook handlers (supabase/functions/_shared/payments/webhook/
 * checkoutEvents.ts) route by the payment row's SUBJECT before anything else, and never
 * capture a tip as a job (contract with pp-tips, lead 2026-10-23).
 *
 *  - a tip order: handed to tipOrderEventHandler (webhook/tipEvents.ts, pp-tips) with the same
 *    event and context, and never captured here; retried (PayPal redelivers) while that handler
 *    is not installed yet.
 *  - an order that is not ours: final (processed, nothing to do).
 *  - a job order: settled by re-reading the order (PayPal GET), never from the event body.
 *
 * @mutate supabase/functions/_shared/payments/webhook/checkoutEvents.ts |     if (subject === "tip") { |     if (subject === "never") {
 * @mutate supabase/functions/_shared/payments/webhook/checkoutEvents.ts |       return await tipOrderEventHandler(event, ctx); |       throw new PayPalEventFinal("tip");
 * @mutate supabase/functions/_shared/payments/webhook/checkoutEvents.ts |     if (o.kind === "not_approved" && event.event_type === "CHECKOUT.ORDER.APPROVED") { |     if (false) {
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("../../supabase/functions/_shared/slack-alerts.ts", () => ({ postSlackOpsAlert: vi.fn(async () => true) }));

// Deno edge modules (Deno.env, npm: specifiers): loaded by computed path so the app typecheck does
// not compile them; vitest runs them as they are (Deno globals are only read when they post).
type Handler = (event: unknown, ctx: unknown) => Promise<string>;
const EDGE = "../../supabase/functions/_shared/payments";
const load = async <T>(rel: string): Promise<T> => (await import(/* @vite-ignore */ `${EDGE}/${rel}`)) as T;
const { CHECKOUT_EVENT_HANDLERS } = await load<{ CHECKOUT_EVENT_HANDLERS: Record<string, Handler> }>("webhook/checkoutEvents.ts");
const { PayPalEventFinal, PayPalEventRetry } = await load<{ PayPalEventFinal: new (m: string) => Error; PayPalEventRetry: new (m: string) => Error }>("webhook/eventTypes.ts");
const { dispatchPayPalEvent, PAYPAL_EVENT_HANDLERS } = await load<{
  dispatchPayPalEvent: (event: unknown, ctx: unknown) => Promise<{ kind: string; note?: string }>;
  PAYPAL_EVENT_HANDLERS: Record<string, Handler>;
}>("webhookHandlers.ts");

const ROOT = path.resolve(__dirname, "../..");

function ctxFor(subject: string | null, opts: { row?: Record<string, unknown> } = {}) {
  const rpcCalls: string[] = [];
  const requests: string[] = [];
  const supabase = {
    rpc: vi.fn(async (fn: string) => {
      rpcCalls.push(fn);
      if (fn === "paypal_payment_subject_by_order") return { data: subject, error: null };
      if (fn === "paypal_job_payment_by_order") return { data: opts.row ?? null, error: null };
      return { data: null, error: null };
    }),
    functions: { invoke: vi.fn(async () => ({ error: null })) },
  };
  const client = {
    env: "sandbox",
    request: vi.fn(async (method: string, p: string) => {
      requests.push(`${method} ${p}`);
      return { id: "ORDER1", status: "PAYER_ACTION_REQUIRED", purchase_units: [{ amount: { currency_code: "USD", value: "100.00" } }], links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1" }] };
    }),
  };
  return { ctx: { supabase, client, env: "sandbox" } as never, rpcCalls, requests };
}

const ev = (type: string, resource: Record<string, unknown>) => ({ event_id: "WH-1", event_type: type, resource_type: null, resource_id: null, payload: { resource } });
const ORDER_TYPES = ["CHECKOUT.ORDER.APPROVED"];
const CAPTURE_TYPES = ["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.PENDING", "PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.DECLINED"];
const resourceFor = (type: string) => type.startsWith("CHECKOUT.") ? { id: "ORDER1" } : { id: "CAP1", supplementary_data: { related_ids: { order_id: "ORDER1" } } };

describe("checkout webhook handlers route by the payment's subject", () => {
  it("claims exactly the order and capture events (floor), and they are in the dispatch table", () => {
    expect(Object.keys(CHECKOUT_EVENT_HANDLERS).length).toBeGreaterThan(4);
    expect(Object.keys(CHECKOUT_EVENT_HANDLERS).sort()).toEqual([...ORDER_TYPES, ...CAPTURE_TYPES].sort());
    for (const t of [...ORDER_TYPES, ...CAPTURE_TYPES]) expect(PAYPAL_EVENT_HANDLERS[t]).toBe(CHECKOUT_EVENT_HANDLERS[t]);
  });

  it.each([...ORDER_TYPES, ...CAPTURE_TYPES])("%s for a TIP order is retried and never captured", async (type) => {
    const { ctx, rpcCalls, requests } = ctxFor("tip");
    await expect(CHECKOUT_EVENT_HANDLERS[type](ev(type, resourceFor(type)), ctx)).rejects.toBeInstanceOf(PayPalEventRetry);
    expect(rpcCalls).toEqual(["paypal_payment_subject_by_order"]);
    expect(requests).toEqual([]);
    expect((await dispatchPayPalEvent(ev(type, resourceFor(type)), ctx)).kind).toBe("retry");
  });

  it.each([...ORDER_TYPES, ...CAPTURE_TYPES])("%s for an order that is not ours is final", async (type) => {
    const { ctx, requests } = ctxFor(null);
    await expect(CHECKOUT_EVENT_HANDLERS[type](ev(type, resourceFor(type)), ctx)).rejects.toBeInstanceOf(PayPalEventFinal);
    expect(requests).toEqual([]);
  });

  it("a job order is settled by RE-READING the order from PayPal", async () => {
    const row = { id: "pp1", subject_id: "job-1", payer_id: "u1", env: "sandbox", status: "created", provider_order_id: "ORDER1", provider_capture_id: null, amount_cents: 10000, idempotency_key: "k", breakdown: null };
    const { ctx, requests } = ctxFor("job", { row });
    // The event body says APPROVED; PayPal says it still waits for the payer: nothing is captured,
    // and the event is retried rather than closed on the stale read.
    await expect(CHECKOUT_EVENT_HANDLERS["CHECKOUT.ORDER.APPROVED"](ev("CHECKOUT.ORDER.APPROVED", { id: "ORDER1", status: "APPROVED" }), ctx)).rejects.toBeInstanceOf(PayPalEventRetry);
    expect(requests).toEqual(["GET /v2/checkout/orders/ORDER1"]);
  });

  it("an APPROVED event whose order PayPal still reads as not approved is retried, never closed", async () => {
    const row = { id: "pp1", subject_id: "job-1", payer_id: "u1", env: "sandbox", status: "created", provider_order_id: "ORDER1", provider_capture_id: null, amount_cents: 10000, idempotency_key: "k", breakdown: null };
    const { ctx } = ctxFor("job", { row });
    expect((await dispatchPayPalEvent(ev("CHECKOUT.ORDER.APPROVED", { id: "ORDER1" }), ctx)).kind).toBe("retry");
  });

  it("the delegation reads tipOrderEventHandler from webhook/tipEvents.ts (source)", () => {
    const checkout = blankComments(readFileSync(path.join(ROOT, "supabase/functions/_shared/payments/webhook/checkoutEvents.ts"), "utf8"));
    expect(checkout).toMatch(/import \* as tipEvents from "\.\/tipEvents\.ts";/);
    expect(checkout).toMatch(/if \(subject === "tip"\) \{[\s\S]*?return await tipOrderEventHandler\(event, ctx\);/);
  });
});

describe("with the tips handler installed (pp-tips), a tip order is handed to it", () => {
  it.each([...ORDER_TYPES, ...CAPTURE_TYPES])("%s for a tip order -> tipOrderEventHandler(event, ctx), no job settle", async (type) => {
    vi.resetModules();
    const tipOrderEventHandler = vi.fn(async () => "tip settled");
    vi.doMock(`${EDGE}/webhook/tipEvents.ts`, () => ({ TIP_EVENT_HANDLERS: {}, tipOrderEventHandler }));
    const mod = await load<{ CHECKOUT_EVENT_HANDLERS: Record<string, Handler> }>("webhook/checkoutEvents.ts");
    const { ctx, rpcCalls, requests } = ctxFor("tip");
    const event = ev(type, resourceFor(type));
    expect(await mod.CHECKOUT_EVENT_HANDLERS[type](event, ctx)).toBe("tip settled");
    expect(tipOrderEventHandler).toHaveBeenCalledWith(event, ctx);
    expect(rpcCalls).toEqual(["paypal_payment_subject_by_order"]);
    expect(requests).toEqual([]);
    vi.doUnmock(`${EDGE}/webhook/tipEvents.ts`);
  });
});
