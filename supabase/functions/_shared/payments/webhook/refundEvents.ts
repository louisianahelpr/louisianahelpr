/**
 * paypal-webhook handlers owned by phase 5 (refunds); see ../webhookHandlers.ts for the rules.
 * Only this phase edits this file.
 *
 * PAYMENT.CAPTURE.REFUNDED (and PAYMENT.REFUND.PENDING / COMPLETED / FAILED / CANCELLED, the same
 * refund changing state; all in the sandbox event catalogue, design #16):
 * the event names a refund. Re-read it from PayPal (status, amount, its capture), never trusting
 * the body, and hand that to paypal_refund_reconcile, which records it exactly once:
 *   already / updated   a refund we made; PayPal's newer status recorded.
 *   attached            our claim whose PayPal answer was lost (timeout) takes PayPal's id.
 *   recorded_outside    made in the PayPal dashboard: the ledger records it.
 *   outside_refund_refused  made in the dashboard while a payout of the same money was queued or
 *                       sent: the guard refuses to record it, the queued payouts go on hold, and
 *                       ops is paged (money may now be paid twice).
 *   unknown_capture     not one of our payments: final, nothing to do.
 */
import { postSlackOpsAlert } from "../../slack-alerts.ts";
import { readRefund } from "../paypalReads.ts";
import { PayPalEventFinal, PayPalEventRetry, type PayPalEventHandler, type PayPalEventHandlers } from "./eventTypes.ts";

const REFUND_ID_RE = /^[A-Z0-9]+$/;

export const handleRefundEvent: PayPalEventHandler = async (event, ctx) => {
  const refundId = event.resource_id;
  if (!refundId || !REFUND_ID_RE.test(refundId)) throw new PayPalEventFinal(`${event.event_type} without a refund id`);
  let refund;
  try {
    refund = await readRefund(ctx.client, refundId);
  } catch (e) {
    // 404: not a refund on our account; anything else may pass on a redelivery.
    const status = (e as { httpStatus?: number }).httpStatus;
    if (status === 404) throw new PayPalEventFinal(`refund ${refundId} not found at PayPal`);
    throw new PayPalEventRetry(`refund ${refundId} re-read failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const { data, error } = await ctx.supabase.rpc("paypal_refund_reconcile", {
    p_env: ctx.env,
    p_capture_id: refund.captureId,
    p_provider_refund_id: refund.id,
    p_status: refund.status,
    p_amount_cents: refund.amountCents,
    p_refund_row_hint: refund.customId,
  });
  if (error) throw new PayPalEventRetry(`reconcile ${refund.id}: ${error.message}`);
  const out = data as { outcome?: string; reason?: string; payouts_held?: number; payment_id?: string; payment_status?: string };
  if (out?.outcome === "unknown_capture") throw new PayPalEventFinal(`refund ${refund.id} is on capture ${refund.captureId}, not one of ours`);
  if (out?.outcome === "outside_refund_refused") {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "PayPal refund made outside the app while a payout was queued",
      message: `Refund ${refund.id} (${refund.amountCents} cents) on capture ${refund.captureId} was made in PayPal, but a Helpr payout of the same payment is queued or sent, so the ledger refused it (${out.reason ?? "guard"}). ${out.payouts_held ?? 0} queued payout(s) put on hold. Decide by hand: cancel the payout, or recover the refund.`,
      fields: { refund_id: refund.id, capture_id: refund.captureId, payment_id: out.payment_id ?? null },
    });
    // Recorded as final: the hold is in place and a human is paged; a redelivery would change nothing.
    throw new PayPalEventFinal(`outside refund refused by the ledger; ${out.payouts_held ?? 0} payout(s) held`);
  }
  return `refund ${refund.id} ${refund.status}: ${out?.outcome ?? "?"} (payment ${out?.payment_status ?? "?"})`;
};

export const REFUND_EVENT_HANDLERS: PayPalEventHandlers = {
  "PAYMENT.CAPTURE.REFUNDED": handleRefundEvent,
  "PAYMENT.REFUND.PENDING": handleRefundEvent,
  "PAYMENT.REFUND.COMPLETED": handleRefundEvent,
  "PAYMENT.REFUND.FAILED": handleRefundEvent,
  "PAYMENT.REFUND.CANCELLED": handleRefundEvent,
};
