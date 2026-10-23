/**
 * THE one way a PayPal payment is refunded (PayPal Plan A, phase 5). Every refund path (a cancelled
 * job, an admin refund, an agreed refund request) comes through refundProviderPayment; no other
 * code calls PaymentProvider.refund (src/test/paypalRefundsGoThroughTheClaim.test.ts).
 *
 * Order, so a crash or a timeout anywhere can never refund twice or lose a refund:
 *   1. CLAIM  paypal_refund_claim writes the provider_refunds row first (or answers the existing
 *             one for the same key). The database refuses a refund once a payout of the payment is
 *             queued, held or sent, and refunds beyond the payment (phase 1's provider_refunds_guard).
 *   2. ASK    PayPal, with PayPal-Request-Id = that row's key. A retry with the same key gets the
 *             SAME refund back (PayPal idempotency; sandbox replay measured in phase 1 and here).
 *   3. RECORD paypal_refund_record puts PayPal's refund id and status on the row and moves the
 *             payment to partially_refunded / refunded.
 * A claim whose PayPal answer was lost stays `pending` (still counted against payouts) and is
 * finished by the next retry with the same key, or by PAYMENT.CAPTURE.REFUNDED (reconcile attaches
 * it). A definite refusal from PayPal (4xx) marks the row failed, which frees the amount.
 *
 * The keys are deterministic and name the business event (`lh:job:<id>:refund:cancel`,
 * `lh:job:<id>:refund:admin:<request id>`, `lh:dispute:<id>:refund`): never random.
 */
import { ProviderApiError, type PaymentProvider } from "./types.ts";

/** The slice of a Supabase client this needs: an RPC call. A PGlite shim implements it in proofs. */
export interface RefundRpc {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string; details?: string | null } | null }>;
}

export type RefundRefusal =
  | "refund_after_payout_queued"
  | "refund_exceeds_payment"
  | "refund_needs_captured_payment"
  | "refund_key_reused"
  | "refund_env_mismatch"
  | "provider_refused"
  | "earlier_attempt_failed";

export type RefundOutcome =
  /** PayPal refunded (settled = COMPLETED; false = PENDING at PayPal, still on its way). */
  | { kind: "refunded"; refundRowId: string; providerRefundId: string; settled: boolean; amountCents: number; replay: boolean; paymentStatus: string | null }
  /** Nothing moved, and nothing will on a retry with this key. */
  | { kind: "refused"; code: RefundRefusal; message: string; refundRowId: string | null }
  /** Not finished (PayPal or the database unreachable). Retry with the SAME key. */
  | { kind: "retry"; message: string; refundRowId: string | null }
  /** PayPal refunded, but our ledger did not take it. Money moved: page ops. Reconcile will attach it. */
  | { kind: "recorded_late"; message: string; refundRowId: string; providerRefundId: string; amountCents: number };

export interface RefundRequest {
  paymentId: string;
  idempotencyKey: string;
  amountCents: number;
  /** Stored on the row (why), never shown to PayPal. */
  reason: string;
  /** Shown to the payer by PayPal. */
  noteToPayer?: string;
}

interface ClaimRow {
  refund_id: string;
  status: string;
  provider_refund_id: string | null;
  amount_cents: number;
  capture_id: string | null;
  env: string;
  replay: boolean;
}

const GUARD_CODES: RefundRefusal[] = ["refund_after_payout_queued", "refund_exceeds_payment", "refund_needs_captured_payment", "refund_key_reused"];

const DEFINITE_NO = new Set([400, 404, 422]);

function guardCode(message: string): RefundRefusal | null {
  return GUARD_CODES.find((c) => message.includes(c)) ?? null;
}

export async function refundProviderPayment(db: RefundRpc, provider: PaymentProvider, req: RefundRequest): Promise<RefundOutcome> {
  if (!Number.isInteger(req.amountCents) || req.amountCents <= 0) throw new Error("refund amountCents must be a positive integer");

  // 1. CLAIM
  const claimed = await db.rpc("paypal_refund_claim", {
    p_payment_id: req.paymentId,
    p_idempotency_key: req.idempotencyKey,
    p_amount_cents: req.amountCents,
    p_reason: req.reason,
  });
  if (claimed.error) {
    const code = guardCode(claimed.error.message);
    if (code) return { kind: "refused", code, message: claimed.error.message, refundRowId: null };
    return { kind: "retry", message: `claim failed: ${claimed.error.message}`, refundRowId: null };
  }
  const claim = claimed.data as ClaimRow;
  if (!claim?.refund_id) return { kind: "retry", message: "claim returned no row", refundRowId: null };
  if (claim.env !== provider.env) {
    // A sandbox payment is never refunded with live keys, nor the reverse.
    return { kind: "refused", code: "refund_env_mismatch", message: `payment is ${claim.env}, provider is ${provider.env}`, refundRowId: claim.refund_id };
  }
  if (claim.status === "completed" && claim.provider_refund_id) {
    return { kind: "refunded", refundRowId: claim.refund_id, providerRefundId: claim.provider_refund_id, settled: true, amountCents: claim.amount_cents, replay: true, paymentStatus: null };
  }
  if (claim.status === "failed" || claim.status === "cancelled") {
    return { kind: "refused", code: "earlier_attempt_failed", message: `this refund (${req.idempotencyKey}) already ${claim.status}`, refundRowId: claim.refund_id };
  }
  if (!claim.capture_id) return { kind: "refused", code: "refund_needs_captured_payment", message: "payment has no capture", refundRowId: claim.refund_id };

  // 2. ASK PayPal (same key = same refund on a retry)
  let paid;
  try {
    paid = await provider.refund({ idempotencyKey: req.idempotencyKey, providerCaptureId: claim.capture_id, amountCents: req.amountCents, note: req.noteToPayer, customId: claim.refund_id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 400/404/422 are PayPal's "no" to this request; a 401/403 is OUR credentials or permissions and
    // is retried (marking it failed would strand the refund behind a config fix).
    if (e instanceof ProviderApiError && (DEFINITE_NO.has(e.httpStatus) || e.errorName === "REFUND_NOT_SUCCESSFUL")) {
      // A definite no (e.g. 422 REFUND_AMOUNT_EXCEEDED, REFUND_TIME_LIMIT_EXCEEDED, or a refund PayPal
      // answered as FAILED/CANCELLED inside a 2xx): free the amount.
      const marked = await db.rpc("paypal_refund_record", { p_refund_id: claim.refund_id, p_provider_refund_id: null, p_status: "failed", p_amount_cents: null });
      if (marked.error) return { kind: "retry", message: `PayPal refused (${e.issue ?? e.httpStatus}) and the row could not be marked failed: ${marked.error.message}`, refundRowId: claim.refund_id };
      return { kind: "refused", code: "provider_refused", message: `${e.issue ?? e.errorName ?? e.httpStatus}: ${msg}`, refundRowId: claim.refund_id };
    }
    // Transport, 5xx, 429, a declined-in-2xx status or an unreadable answer: we do not know whether
    // PayPal refunded. The row stays pending (the money stays spoken for); retry with the same key.
    return { kind: "retry", message: msg, refundRowId: claim.refund_id };
  }

  // 3. RECORD
  const recorded = await db.rpc("paypal_refund_record", {
    p_refund_id: claim.refund_id,
    p_provider_refund_id: paid.providerRefundId,
    p_status: paid.settled ? "completed" : "pending",
    p_amount_cents: paid.amountCents,
  });
  if (recorded.error) {
    return { kind: "recorded_late", message: recorded.error.message, refundRowId: claim.refund_id, providerRefundId: paid.providerRefundId, amountCents: paid.amountCents };
  }
  const rec = recorded.data as { payment_status?: string } | null;
  return {
    kind: "refunded",
    refundRowId: claim.refund_id,
    providerRefundId: paid.providerRefundId,
    settled: paid.settled,
    amountCents: paid.amountCents,
    replay: claim.replay,
    paymentStatus: rec?.payment_status ?? null,
  };
}
