/**
 * paypal-webhook handlers owned by phase 3 (see ../webhookHandlers.ts for the rules).
 * Only this phase edits this file.
 *
 * Job checkouts (PayPal Plan A, phase 3): an approved order is captured here as well as on
 * the return page, whichever comes first, and a capture's later state (PENDING cleared,
 * DENIED, DECLINED) is brought in. Every handler re-reads the ORDER from PayPal and settles
 * the job's provider_payments row from that (../paypalJobCheckout.ts settleJobPayment), so
 * a redelivered, late or out-of-order event can only bring the row to PayPal's current
 * state, and every caller together makes at most one capture.
 *
 * REFUNDED / REVERSED captures belong to refunds (phase 5, refundEvents.ts) and disputes
 * (phase 7).
 */
import { PayPalEventFinal, PayPalEventRetry, type PayPalEventContext, type PayPalEventHandler, type PayPalEventHandlers, type StoredPayPalEvent } from "./eventTypes.ts";
import { createPayPalCheckoutProvider } from "../paypalCheckout.ts";
import { handleCaptureEvent, handleOrderApproved, type EventSettle, type JobCheckoutCtx, type PayPalEvent } from "../paypalJobCheckout.ts";
import { followUpJobSettle } from "../jobSettleFollowUp.ts";
import { postSlackOpsAlert } from "../../slack-alerts.ts";
// The tips lane (wip/pp-tips) exports tipOrderEventHandler from tipEvents.ts; read off the module
// namespace so this file works before and after that lands (lead 2026-10-23: phase 3's handlers
// hand every tip order to it, and never capture a tip themselves).
import * as tipEvents from "./tipEvents.ts";

const tipOrderEventHandler = (tipEvents as unknown as { tipOrderEventHandler?: PayPalEventHandler }).tipOrderEventHandler;

function jobCtx(ctx: PayPalEventContext): JobCheckoutCtx {
  return { db: ctx.supabase, provider: createPayPalCheckoutProvider(ctx.client), env: ctx.env };
}

function asEvent(event: StoredPayPalEvent): PayPalEvent {
  const p = (event.payload ?? {}) as PayPalEvent;
  return { id: event.event_id, event_type: event.event_type, resource: p.resource };
}


/** The order id an event is about: the resource for CHECKOUT.ORDER.*, the capture's related order for PAYMENT.CAPTURE.*. */
function orderIdOf(kind: "order" | "capture", e: PayPalEvent): string | null {
  const id = kind === "order" ? e.resource?.id : e.resource?.supplementary_data?.related_ids?.order_id;
  return typeof id === "string" && /^[A-Z0-9]+$/.test(id) ? id : null;
}

function handler(kind: "order" | "capture"): PayPalEventHandler {
  return async (event, ctx) => {
    const e = asEvent(event);
    const orderId = orderIdOf(kind, e);
    if (!orderId) throw new PayPalEventFinal(`${event.event_type}: no order id`);
    // Contract with pp-tips (lead 2026-10-23): a tip is an ordinary PayPal order, so its events
    // arrive here. Route by the row's subject FIRST and never capture a tip as a job.
    const { data: subject, error } = await ctx.supabase.rpc("paypal_payment_subject_by_order", { p_order_id: orderId });
    if (error) throw new PayPalEventRetry(`${event.event_type}: subject lookup failed: ${error.message}`);
    if (subject === "tip") {
      // Until the tips handler is installed: retry, so PayPal redelivers (for 3 days) and the tip
      // event is never marked done here.
      if (!tipOrderEventHandler) throw new PayPalEventRetry(`${event.event_type}: tip order ${orderId}; the tips handler is not installed yet`);
      return await tipOrderEventHandler(event, ctx);
    }
    if (subject !== "job") throw new PayPalEventFinal(`${event.event_type}: order ${orderId} is not ours (${subject ?? "no row"})`);
    const jc = jobCtx(ctx);
    // Any throw from here (PayPal or the database unreachable) is a retry: the claim and the
    // capture key make the next delivery safe.
    const settled: EventSettle | null = kind === "order" ? await handleOrderApproved(jc, e) : await handleCaptureEvent(jc, e);
    // Not one of our job orders (another product's order, or one we never recorded): nothing to do, ever.
    if (!settled) throw new PayPalEventFinal(`${event.event_type}: not a job order`);
    await followUpJobSettle(ctx.supabase, settled.jobId, settled.outcome, "webhook", postSlackOpsAlert);
    const o = settled.outcome;
    if (o.kind === "not_approved" && event.event_type === "CHECKOUT.ORDER.APPROVED") {
      // PayPal says approved but its order read does not yet: never close the event on a stale read.
      throw new PayPalEventRetry(`order ${orderId} reads not approved after CHECKOUT.ORDER.APPROVED`);
    }
    return `${event.event_type} job ${settled.jobId}: ${o.kind}${"reason" in o ? ` (${o.reason})` : ""}`;
  };
}

const onCapture = handler("capture");

export const CHECKOUT_EVENT_HANDLERS: PayPalEventHandlers = {
  "CHECKOUT.ORDER.APPROVED": handler("order"),
  "PAYMENT.CAPTURE.COMPLETED": onCapture,
  "PAYMENT.CAPTURE.PENDING": onCapture,
  "PAYMENT.CAPTURE.DENIED": onCapture,
  "PAYMENT.CAPTURE.DECLINED": onCapture,
};
