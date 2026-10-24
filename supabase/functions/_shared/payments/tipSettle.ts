/**
 * settlePayPalTip — the ONE path that turns an approved PayPal tip order into a
 * captured payment, a paid tip and a queued manual payout (PayPal tips; design
 * ~/.lh-wt/paypal-design.md §6a). Called from two places, any number of times,
 * in any order:
 *   - paypal-tip "capture", when the poster returns from PayPal;
 *   - paypal-webhook, for CHECKOUT.ORDER.APPROVED / PAYMENT.CAPTURE.* on a tip
 *     order (tipOrderEventHandler, ./webhook/tipEvents.ts).
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
import { postSlackOpsAlert } from "../slack-alerts.ts";

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
interface TipCaptureRecord {
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

function tipCaptureKey(providerPaymentId: string): string {
  return `lh:pp:${providerPaymentId}:capture`;
}

/** PayPal said no to the money (a decline, or a pending capture later denied). Any other unsuccessful
 *  status (REFUNDED, PARTIALLY_REFUNDED: money that did move and was later sent back) is not a decline:
 *  it throws, so a human sees it (lh-silent-failure round 2, #2). */
function isDecline(e: unknown): e is ProviderApiError {
  return e instanceof ProviderApiError && e.errorName === "CAPTURE_NOT_SUCCESSFUL" && (e.issue === "DECLINED" || e.issue === "FAILED");
}

/** A capture PayPal reports neither settled nor declined (REFUNDED, PARTIALLY_REFUNDED, ...): money that
 *  moved and came back outside our records. Never recorded as a decline; a human is told, then it throws. */
async function alertUnexpectedCapture(row: { id: string; provider_order_id: string }, e: ProviderApiError): Promise<never> {
  await postSlackOpsAlert({
    kind: "money_at_risk",
    severity: "critical",
    title: "PayPal tip capture in an unexpected state",
    message: `Tip payment ${row.id} (PayPal order ${row.provider_order_id}): PayPal reports the capture as ${e.issue ?? "unknown"}, which we never recorded. The tip is left as it was; check the order in PayPal and settle it by hand.`,
    oncePerDayKey: `paypal-tip-unexpected-capture:${row.id}`,
  });
  throw e;
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
    try {
      cap = captureFromOrder(order as Parameters<typeof captureFromOrder>[0]);
    } catch (e) {
      // A capture PayPal reports DECLINED/FAILED (a pending one later denied) is a final answer: record
      // it as failed (the RPC never undoes settled money), so a redelivered event does not retry it.
      if (isDecline(e)) {
        await record(db, row, "failed", null);
        return { state: "declined", issue: e.issue };
      }
      if (e instanceof ProviderApiError && e.errorName === "CAPTURE_NOT_SUCCESSFUL") await alertUnexpectedCapture(row, e);
      throw e;
    }
  } else if (order.status === "APPROVED") {
    try {
      cap = await provider.capture(tipCaptureKey(row.id), row.provider_order_id);
    } catch (e) {
      if (isDecline(e)) {
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
        try {
          cap = captureFromOrder(again as Parameters<typeof captureFromOrder>[0]);
        } catch (inner) {
          if (isDecline(inner)) {
            await record(db, row, "failed", null);
            return { state: "declined", issue: inner.issue };
          }
          if (inner instanceof ProviderApiError && inner.errorName === "CAPTURE_NOT_SUCCESSFUL") await alertUnexpectedCapture(row, inner);
          throw inner;
        }
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
 * A captured tip that is owed but not payable from the queue: no payable PayPal email (no payout row
 * yet), or a payout written 'held' (a payout hold, a ban review, or an email changed after the job
 * was approved). Nothing re-tries either on its own: an admin re-queues it once it is clear
 * (admin_requeue_paypal_tip_payout). Both callers alert ops, once a day per tip.
 */
export async function alertIfTipOwedWithoutDestination(outcome: TipSettleOutcome): Promise<void> {
  if (outcome.state !== "recorded") return;
  const r = outcome.record;
  if (r.payout_reason !== "no_payable_destination" && r.payout_reason !== "held") return;
  await postSlackOpsAlert({
    kind: "money_at_risk",
    severity: "warning",
    title: r.payout_reason === "held" ? "PayPal tip captured, payout held" : "PayPal tip captured, Helpr has no PayPal email",
    message: r.payout_reason === "held"
      ? `Tip ${r.tip_id} was paid through PayPal; its payout ${r.payout_id} is HELD (payout hold, ban review, or the Helpr changed their PayPal email after the job was approved). Check it, then re-queue it with admin_requeue_paypal_tip_payout('${r.tip_id}', true).`
      : `Tip ${r.tip_id} was paid through PayPal but the Helpr has no payable PayPal email, so no payout is queued. Ask them to add one, then queue it with admin_requeue_paypal_tip_payout('${r.tip_id}').`,
    oncePerDayKey: `paypal-tip-owed:${r.tip_id}`,
  });
}
