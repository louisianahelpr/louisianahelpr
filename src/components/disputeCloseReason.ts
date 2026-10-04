/**
 * Why a decided dispute closed without its split running, read from the
 * `execution_error` the server stamps when something outside the split took
 * the money first (or there was none). Each prefix is byte-identical to the
 * migration that writes it; src/test/disputeCloseReason.test.ts reads both.
 *
 *   chargeback       settle_dispute_by_chargeback (20260926034237): the card
 *                    holder's bank took the whole charge back.
 *   outside_refund   settle_dispute_by_external_refund (20261003181427): a full
 *                    refund made outside the split (Stripe dashboard, or a
 *                    refund path other than the split) sent it all back.
 *   no_payment       rpc_settle_dispute_without_payment (20260924013122): an
 *                    admin closed it with no payment on file, both amounts $0.
 */
export const CHARGEBACK_CLOSE_PREFIX = "closed by a lost card chargeback";
export const OUTSIDE_REFUND_CLOSE_PREFIX = "closed by a full refund made outside the split";
export const NO_PAYMENT_CLOSE_PREFIX = "closed by an admin, no payment on file";

export type DisputeCloseReason = "chargeback" | "outside_refund" | "no_payment";

export function disputeCloseReason(
  dispute: { execution_status?: string | null; execution_error?: string | null } | null | undefined,
): DisputeCloseReason | null {
  if (dispute?.execution_status !== "executed") return null;
  const note = dispute.execution_error ?? "";
  if (note.startsWith(CHARGEBACK_CLOSE_PREFIX)) return "chargeback";
  if (note.startsWith(OUTSIDE_REFUND_CLOSE_PREFIX)) return "outside_refund";
  if (note.startsWith(NO_PAYMENT_CLOSE_PREFIX)) return "no_payment";
  return null;
}

/** The sentence each close shows on the dispute timeline. */
export const DISPUTE_CLOSE_COPY: Record<DisputeCloseReason, string> = {
  chargeback: "Closed by the card holder's bank: the payment went back to the card, so nothing was split here.",
  outside_refund:
    "Closed by a full refund: the whole payment went back to the card before the split ran, so the decision's split did not apply.",
  no_payment: "Closed by an admin: no payment was on file for this job, so nothing was split here.",
};

/**
 * Closes that moved nothing, whose "Settled: $0.00 · $0.00" line would say
 * nothing true (Q342 M2). An outside refund's amounts are real and stay.
 */
export function closeMovedNothing(reason: DisputeCloseReason | null): boolean {
  return reason === "chargeback" || reason === "no_payment";
}
