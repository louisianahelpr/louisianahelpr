/**
 * paypal-webhook handlers owned by phase tips (see ../webhookHandlers.ts for the rules).
 * Only this phase edits this file.
 *
 * A tip is an ordinary PayPal order, so its events arrive as CHECKOUT.ORDER.APPROVED and
 * PAYMENT.CAPTURE.COMPLETED/PENDING/DENIED/DECLINED: event types phase 3's checkoutEvents.ts owns
 * (one type, one file). So TIP_EVENT_HANDLERS claims no type, and phase 3's handlers for those
 * types hand a tip order to tipOrderEventHandler (lead 2026-10-23: "phase 3's checkout handlers
 * delegate when subject_kind='tip'").
 */
import { createPayPalCheckoutProvider } from "../paypalCheckout.ts";
import { alertIfTipOwedWithoutDestination, settlePayPalTip, type TipSettleDb } from "../tipSettle.ts";
import { PayPalEventFinal, PayPalEventRetry, type PayPalEventHandler, type PayPalEventHandlers, type StoredPayPalEvent } from "./eventTypes.ts";

export const TIP_EVENT_HANDLERS: PayPalEventHandlers = {};

/** The event types a tip order produces (handled through phase 3's handlers for them). */
export const TIP_ORDER_EVENT_TYPES: readonly string[] = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.DECLINED",
];

/** The PayPal order an event is about: an order event names it; a capture event names it in related_ids. */
export function orderIdOfEvent(event: Pick<StoredPayPalEvent, "event_type" | "payload">): string | null {
  const resource = (event.payload as { resource?: { id?: unknown; supplementary_data?: { related_ids?: { order_id?: unknown } } } } | null)?.resource;
  const id = event.event_type.startsWith("CHECKOUT.ORDER.") ? resource?.id : resource?.supplementary_data?.related_ids?.order_id;
  return typeof id === "string" && /^[A-Z0-9]{5,40}$/.test(id) ? id : null;
}

/**
 * Settle a tip order from PayPal's CURRENT state (never the event body). Idempotent: the return
 * page and every redelivery converge on one capture, one 'paid' tip, one payout.
 *   not a tip order / not ours      -> PayPalEventFinal (200, nothing to do)
 *   database or PayPal unreachable  -> PayPalEventRetry (503, PayPal redelivers)
 */
export const tipOrderEventHandler: PayPalEventHandler = async (event, ctx) => {
  if (!TIP_ORDER_EVENT_TYPES.includes(event.event_type)) throw new PayPalEventFinal(`not a tip order event: ${event.event_type}`);
  const orderId = orderIdOfEvent(event);
  if (!orderId) throw new PayPalEventFinal(`${event.event_type} ${event.event_id} names no order id`);
  // UNIQUE (provider, provider_order_id); paypal_checkout is provider_payments' only provider.
  const { data: row, error } = await ctx.supabase.from("provider_payments")
    .select("id, subject_kind, env").eq("provider", "paypal_checkout").eq("provider_order_id", orderId).maybeSingle();
  if (error) throw new PayPalEventRetry(`provider_payments read failed for order ${orderId}: ${error.message}`);
  if (!row) throw new PayPalEventFinal(`no payment of ours for order ${orderId}`);
  if (row.subject_kind !== "tip") throw new PayPalEventFinal(`order ${orderId} is a ${row.subject_kind} payment, not a tip`);
  if (row.env !== ctx.env) {
    // Crossed configuration (a sandbox row under live keys or the reverse): never acted on. Retry so it alerts.
    throw new PayPalEventRetry(`paypal_env_mismatch: order ${orderId} is ${row.env}, webhook is ${ctx.env}`);
  }
  let outcome;
  try {
    outcome = await settlePayPalTip(ctx.supabase as unknown as TipSettleDb, createPayPalCheckoutProvider(ctx.client), ctx.client, row.id);
  } catch (e) {
    throw new PayPalEventRetry(`tip ${row.id} not settled: ${e instanceof Error ? e.message : String(e)}`);
  }
  await alertIfTipOwedWithoutDestination(outcome);
  if (outcome.state === "recorded") {
    const r = outcome.record;
    return `tip ${r.tip_id}: payment ${r.payment_status}, tip ${r.tip_status}, payout ${r.payout_status ?? "none"} (${r.payout_reason})`;
  }
  return `tip payment ${row.id}: ${outcome.state}`;
};
