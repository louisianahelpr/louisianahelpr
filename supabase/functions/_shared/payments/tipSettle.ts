/**
 * settlePayPalTip — the ONE path that turns an approved PayPal tip order into a
 * captured payment, a paid tip and a queued manual payout (PayPal tips; design
 * ~/.lh-wt/paypal-design.md §6a). Called from two places, any number of times,
 * in any order:
 *   - paypal-tip "capture", when the poster returns from PayPal;
 *   - the webhook processor, for CHECKOUT.ORDER.APPROVED / PAYMENT.CAPTURE.*
 *     (tipWebhookHandlers below; the dispatcher in _shared/payments/
 *     webhookHandlers.ts is pp-phase5's, lead 2026-10-23).
 *
 * Idempotent end to end:
 *   - PayPal: the capture always carries PayPal-Request-Id `lh:pp:<id>:capture`,
 *     so a second capture call returns the first capture. An order already
 *     captured is READ (GET the order), never captured again.
 *   - Database: public.paypal_record_tip_capture is idempotent (same capture =
 *     no-op; one 'paid' flip; tip_id UNIQUE = one payout).
 * It acts on the order as PayPal reports it now, never on a webhook body.
 *
 * Refuses a row from another environment (a sandbox row under live keys, or
 * the reverse): design §6 proof plan.
 */
import { ProviderApiError, type CaptureResult, type PaymentProvider } from "./types.ts";
import { captureFromOrder } from "./paypalCheckout.ts";
import type { PayPalClient } from "./paypalClient.ts";

/** The two calls this needs from the service-role supabase-js client. */
export interface TipSettleDb {
  from(table: "provider_payments"): {
    select(cols: string): {
      eq(col: string, v: string): {
        maybeSingle(): PromiseLike<{ data: TipPaymentRow | null; error: { message: string } | null }>;
      };
    };
  };
  rpc(fn: "paypal_record_tip_capture", args: {
    p_provider_payment_id: string;
    p_order_id: string;
    p_outcome: "completed" | "pending" | "failed";
    p_capture_id: string | null;
    p_amount_cents: number;
  }): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

interface TipPaymentRow {
  id: string;
  subject_kind: string;
  subject_id: string;
  env: string;
  provider_order_id: string;
  provider_capture_id: string | null;
  amount_cents: number;
  status: string;
}

/** What paypal_record_tip_capture answered. */
export interface TipCaptureRecord {
  tip_id: string;
  payment_status: string;
  tip_status: "pending" | "paid" | "failed";
  payout_id: string | null;
  payout_status: string | null;
  /** queued | held | already_queued | no_payable_destination | not_settled | not_captured | payment_<status> */
  payout_reason: string;
}

export type TipSettleOutcome =
  /** The poster has not approved on PayPal yet (or left): nothing changed. */
  | { state: "not_approved"; orderStatus: string }
  /** PayPal declined the card/account at capture; the poster may try again with another way to pay. */
  | { state: "declined"; issue: string | null }
  | { state: "recorded"; record: TipCaptureRecord };

interface PayPalOrderLite {
  id: string;
  status: string;
  purchase_units?: Array<{ payments?: { captures?: Array<{ id: string; status: string; amount: { currency_code: string; value: string } }> } }>;
}

/** Statuses after which the capture is already on our row (settled or later). */
const RECORDED = new Set(["captured", "partially_refunded", "refunded", "disputed", "reversed"]);

export function tipCaptureKey(providerPaymentId: string): string {
  return `lh:pp:${providerPaymentId}:capture`;
}

async function record(db: TipSettleDb, row: TipPaymentRow, outcome: "completed" | "pending" | "failed", cap: Pick<CaptureResult, "providerCaptureId" | "amountCents"> | null): Promise<TipCaptureRecord> {
  const { data, error } = await db.rpc("paypal_record_tip_capture", {
    p_provider_payment_id: row.id,
    p_order_id: row.provider_order_id,
    p_outcome: outcome,
    p_capture_id: cap?.providerCaptureId ?? null,
    p_amount_cents: cap?.amountCents ?? row.amount_cents,
  });
  // Never swallowed: money was (or may have been) taken. The caller answers 5xx so the webhook is
  // redelivered and the return page can retry; both converge on the same idempotent record.
  if (error) throw new Error(`paypal_record_tip_capture failed for ${row.id}: ${error.message}`);
  if (!data || typeof data !== "object") throw new Error(`paypal_record_tip_capture returned nothing for ${row.id}`);
  return data as TipCaptureRecord;
}

export async function settlePayPalTip(
  db: TipSettleDb,
  provider: PaymentProvider,
  client: PayPalClient,
  providerPaymentId: string,
): Promise<TipSettleOutcome> {
  const { data: row, error } = await db.from("provider_payments")
    .select("id, subject_kind, subject_id, env, provider_order_id, provider_capture_id, amount_cents, status")
    .eq("id", providerPaymentId)
    .maybeSingle();
  if (error) throw new Error(`provider_payments read failed for ${providerPaymentId}: ${error.message}`);
  if (!row) throw new Error(`tip_payment_not_found: ${providerPaymentId}`);
  if (row.subject_kind !== "tip") throw new Error(`not_a_tip_payment: ${providerPaymentId} is ${row.subject_kind}`);
  if (row.env !== provider.env || client.env !== provider.env) {
    throw new Error(`paypal_env_mismatch: row ${row.id} is ${row.env}, keys are ${provider.env}`);
  }

  // Already captured on our side: re-record (idempotent) so a payout that could not be queued
  // earlier (no payable PayPal email yet) is queued now.
  if (RECORDED.has(row.status) && row.provider_capture_id) {
    return { state: "recorded", record: await record(db, row, "completed", { providerCaptureId: row.provider_capture_id, amountCents: row.amount_cents }) };
  }

  // The order as PayPal reports it now.
  const order = await client.request<PayPalOrderLite>("GET", `/v2/checkout/orders/${encodeURIComponent(row.provider_order_id)}`);
  if (!order?.id || order.id !== row.provider_order_id) throw new Error(`paypal order read mismatch for ${row.id}`);

  let cap: CaptureResult;
  if (order.status === "COMPLETED") {
    cap = captureFromOrder(order as Parameters<typeof captureFromOrder>[0]);
  } else if (order.status === "APPROVED") {
    try {
      cap = await provider.capture(tipCaptureKey(row.id), row.provider_order_id);
    } catch (e) {
      if (e instanceof ProviderApiError && e.errorName === "CAPTURE_NOT_SUCCESSFUL") {
        // PayPal answered the capture DECLINED/FAILED inside a 2xx: the tip did not happen.
        await record(db, row, "failed", null);
        return { state: "declined", issue: e.issue };
      }
      if (e instanceof ProviderApiError && e.issue === "INSTRUMENT_DECLINED") {
        // The order stays approvable with another funding source: nothing is recorded.
        return { state: "declined", issue: e.issue };
      }
      if (e instanceof ProviderApiError && e.issue === "ORDER_ALREADY_CAPTURED") {
        // Captured by an earlier call whose request id PayPal no longer remembers: read it.
        const again = await client.request<PayPalOrderLite>("GET", `/v2/checkout/orders/${encodeURIComponent(row.provider_order_id)}`);
        cap = captureFromOrder(again as Parameters<typeof captureFromOrder>[0]);
      } else {
        throw e;
      }
    }
  } else if (order.status === "VOIDED") {
    await record(db, row, "failed", null);
    return { state: "declined", issue: "ORDER_VOIDED" };
  } else {
    // CREATED / PAYER_ACTION_REQUIRED / SAVED: the poster has not approved.
    return { state: "not_approved", orderStatus: order.status };
  }

  if (cap.providerOrderId !== row.provider_order_id) throw new Error(`capture is for another order (${cap.providerOrderId}) than ${row.id}`);
  return {
    state: "recorded",
    record: await record(db, row, cap.settled ? "completed" : "pending", cap),
  };
}

/**
 * Webhook routing for tips (lead 2026-10-23: pp-phase5's dispatcher calls these
 * for subject_kind 'tip'). Each finds our tip payment by the PayPal ORDER id in
 * the verified event, then settles from PayPal's current state.
 * Returns null when the event is not about a tip payment (another handler's).
 */
export const TIP_WEBHOOK_EVENT_TYPES = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.DECLINED",
] as const;

interface VerifiedEventLite {
  event_type: string;
  resource?: { id?: unknown; supplementary_data?: { related_ids?: { order_id?: unknown } } };
}

/** The PayPal order an event is about: an order event names it; a capture event names it in related_ids. */
export function orderIdOfEvent(event: VerifiedEventLite): string | null {
  const id = event.event_type.startsWith("CHECKOUT.ORDER.")
    ? event.resource?.id
    : event.resource?.supplementary_data?.related_ids?.order_id;
  return typeof id === "string" && /^[A-Z0-9]+$/.test(id) ? id : null;
}

export async function handleTipWebhookEvent(
  db: TipSettleDb,
  provider: PaymentProvider,
  client: PayPalClient,
  event: VerifiedEventLite,
): Promise<TipSettleOutcome | null> {
  if (!(TIP_WEBHOOK_EVENT_TYPES as readonly string[]).includes(event.event_type)) return null;
  const orderId = orderIdOfEvent(event);
  if (!orderId) return null;
  // provider_payments is UNIQUE (provider, provider_order_id), and paypal_checkout is its only provider.
  const { data: row, error } = await db.from("provider_payments")
    .select("id, subject_kind, subject_id, env, provider_order_id, provider_capture_id, amount_cents, status")
    .eq("provider_order_id", orderId)
    .maybeSingle();
  if (error) throw new Error(`provider_payments read failed for order ${orderId}: ${error.message}`);
  if (!row || row.subject_kind !== "tip") return null;
  return await settlePayPalTip(db, provider, client, row.id);
}
