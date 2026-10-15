import type Stripe from "https://esm.sh/stripe@18.5.0";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { formatExactDollars } from "../../_shared/money.ts";
import { caughtMessage } from "../../_shared/caughtMessage.ts";

/**
 * Q1655: a refunded recurring visit's sales tax comes off Stripe Tax's filing
 * reports.
 *
 * An off-session visit charge has no Checkout `automatic_tax`, so
 * charge-recurring-visits records its tax itself with
 * tax.transactions.createFromCalculation and stamps the transaction's id on
 * the PaymentIntent (`metadata.tax_transaction_id`). Stripe reverses only
 * Checkout/automatic-tax refunds on its own; a Tax API transaction stays
 * "collected" until we reverse it, so every refunded taxed visit was
 * over-remitted (lh-money-escrow review of Q1578, 2026-10-12).
 *
 * Every refund path (cancellation, dispute split, admin refund, the Stripe
 * dashboard) ends in charge.refunded, so it is reversed here, once:
 *   - FULL refund in ONE refund: a full reversal, keyed on the charge
 *     (reference + Stripe idempotency key), so a redelivery cannot reverse
 *     twice;
 *   - FULL after an earlier PARTIAL: ops was already paged to reverse the
 *     partial by hand, and Stripe's full reversal does NOT net earlier partial
 *     reversals (it would reverse that share twice), so this pages too:
 *     void the partial reversal(s), then reverse in full;
 *   - PARTIAL refund: how much of it was taxed labor (vs the kept service fee)
 *     differs by path, so it is not guessed: ops is paged with the amounts to
 *     reverse by hand in Stripe Tax.
 * Never throws: a reversal problem pages ops and the refund itself is still
 * settled by the rest of the handler.
 */
export async function reverseVisitTaxForRefund(args: {
  stripe: Stripe;
  piId: string | null | undefined;
  charge: Stripe.Charge;
  isFullRefund: boolean;
  liveRefundedCents: number;
  /** Live, non-correction refunds on the charge. */
  ordinaryRefundCount: number;
  logStep: (step: string, details?: unknown) => void;
}): Promise<"none" | "reversed" | "partial_paged" | "failed_paged"> {
  const { stripe, piId, charge, isFullRefund, liveRefundedCents, ordinaryRefundCount, logStep } = args;
  if (!piId) return "none";
  let txId: string | undefined;
  try {
    const pi = await stripe.paymentIntents.retrieve(piId);
    txId = (pi?.metadata as Record<string, string> | null)?.tax_transaction_id || undefined;
  } catch (e) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Refund: could not check for a recurring-visit tax transaction",
      message: `Charge ${charge.id} was refunded, but its PaymentIntent ${piId} could not be read to see whether it carries a Stripe Tax transaction to reverse (${caughtMessage(e)}). Check the PaymentIntent's metadata.tax_transaction_id by hand.`,
      fields: { "Payment Intent": piId, Charge: charge.id },
      oncePerDayKey: `visit-tax-lookup:${charge.id}`,
    });
    return "failed_paged";
  }
  if (!txId) return "none";

  if (!isFullRefund) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Taxed recurring visit partly refunded: reverse its sales tax by hand",
      message: `Charge ${charge.id} (Stripe Tax transaction ${txId}) has ${formatExactDollars(liveRefundedCents / 100)} of ${formatExactDollars(charge.amount / 100)} refunded. Reverse the taxed share in Stripe Tax (Transactions > ${txId} > Reverse, partial) so it is not reported as collected.`,
      fields: { "Tax transaction": txId, Charge: charge.id, "Payment Intent": piId },
      oncePerDayKey: `visit-tax-partial:${charge.id}:${liveRefundedCents}`,
    });
    return "partial_paged";
  }

  if (ordinaryRefundCount > 1) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Taxed recurring visit refunded in parts: reverse its sales tax by hand",
      message: `Charge ${charge.id} (Stripe Tax transaction ${txId}) is now fully refunded across ${ordinaryRefundCount} refunds. Stripe's full reversal does not net earlier partial reversals, so it was not run: in Stripe Tax, void any partial reversal made for this charge, then reverse ${txId} in full.`,
      fields: { "Tax transaction": txId, Charge: charge.id, "Payment Intent": piId },
      oncePerDayKey: `visit-tax-multi:${charge.id}`,
    });
    return "partial_paged";
  }

  try {
    await stripe.tax.transactions.createReversal(
      { mode: "full", original_transaction: txId, reference: `refund:${charge.id}` },
      { idempotencyKey: `visit-tax-reversal:${charge.id}` },
    );
    logStep("Recurring-visit tax reversed", { txId, chargeId: charge.id });
    return "reversed";
  } catch (e) {
    // A redelivery after the idempotency window finds the reference taken:
    // that reversal already exists, which is the outcome wanted.
    const msg = caughtMessage(e);
    if (/reference/i.test(msg) && /(already|exists|unique)/i.test(msg)) {
      logStep("Recurring-visit tax already reversed", { txId, chargeId: charge.id });
      return "reversed";
    }
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Refunded recurring visit: sales tax NOT reversed in Stripe Tax",
      message: `Charge ${charge.id} was fully refunded, but reversing Stripe Tax transaction ${txId} failed (${msg}). Reverse it by hand (Stripe Tax > Transactions) so the tax is not reported as collected.`,
      fields: { "Tax transaction": txId, Charge: charge.id, "Payment Intent": piId },
    });
    return "failed_paged";
  }
}

/**
 * Q1730: the refund that drove a recurring visit's tax reversal (above, on
 * charge.refunded) later FAILED or was canceled. The money stayed with the
 * platform, but a full reversal may already have taken the tax off Stripe
 * Tax's filing reports (a partial one was paged for a person to make). Undoing
 * a reversal is not automatic here: which share was reversed is a person's
 * call, so ops is paged with the transaction to fix. Never throws.
 */
export async function pageVisitTaxForFailedRefund(args: {
  stripe: Stripe;
  piId: string | null | undefined;
  chargeId: string | null | undefined;
  refundId: string;
  refundStatus: string;
  amountCents: number;
}): Promise<"none" | "paged"> {
  const { stripe, piId, chargeId, refundId, refundStatus, amountCents } = args;
  if (!piId) return "none";
  let txId: string | undefined;
  try {
    const pi = await stripe.paymentIntents.retrieve(piId);
    txId = (pi?.metadata as Record<string, string> | null)?.tax_transaction_id || undefined;
  } catch (e) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Failed refund: could not check for a recurring-visit tax reversal",
      message: `Refund ${refundId} turned '${refundStatus}', but its PaymentIntent ${piId} could not be read to see whether it carries a Stripe Tax transaction (${caughtMessage(e)}). If metadata.tax_transaction_id is set, check Stripe Tax for a reversal made for this refund.`,
      fields: { Refund: refundId, "Payment Intent": piId, Charge: chargeId ?? "—" },
      oncePerDayKey: `visit-tax-refund-failed-lookup:${refundId}`,
    });
    return "paged";
  }
  if (!txId) return "none";
  await postSlackOpsAlert({
    kind: "money_at_risk",
    severity: "warning",
    title: "Failed refund on a taxed recurring visit: its sales tax may be reversed",
    message: `Refund ${refundId} (${formatExactDollars(amountCents / 100)}) on ${chargeId ?? piId} turned '${refundStatus}': the money stayed with the platform, and Stripe Tax transaction ${txId} may already be reversed for it (reference refund:${chargeId ?? "?"}, or a partial reversal made by hand). If the card holder will be refunded again (the usual case), LEAVE the reversal: a re-refund's own full reversal finds that reference taken and does nothing. Only if the money is kept for good, undo it in Stripe Tax by fully reversing that reversal transaction (tax transactions cannot be edited or voided).`,
    fields: { "Tax transaction": txId, Refund: refundId, Charge: chargeId ?? "—", "Payment Intent": piId },
    oncePerDayKey: `visit-tax-refund-failed:${refundId}`,
  });
  return "paged";
}

/**
 * Q1724: a chargeback the platform LOST returns the money to the card holder
 * through charge.dispute.closed (status lost), with no refund and so no
 * charge.refunded event: reverseVisitTaxForRefund never runs, and a taxed
 * recurring visit's Stripe Tax transaction stayed reported as collected.
 *
 * A dispute that took the WHOLE charge (nothing refunded before it) is
 * reversed in full, keyed on the dispute (reference + idempotency key), so a
 * redelivery cannot reverse twice and a refund's own reference (refund:<charge>)
 * is never reused. The charge is read for what was refunded BEFORE the dispute
 * (lh-money-escrow review of 5f292defa, #2): fully refunded means the refund
 * path already reversed it (nothing to do); partly refunded means a partial
 * reversal may already exist and a full one would reverse that share twice, so
 * it is paged. A dispute of part of the charge is paged too. Never throws.
 */
export async function reverseVisitTaxForLostDispute(args: {
  stripe: Stripe;
  piId: string | null | undefined;
  dispute: Stripe.Dispute;
  logStep: (step: string, details?: unknown) => void;
}): Promise<"none" | "reversed" | "partial_paged" | "failed_paged"> {
  const { stripe, piId, dispute, logStep } = args;
  if (!piId) {
    // The handler could not find the dispute's PaymentIntent (charge read
    // failed): whether it was a taxed visit is unknown, so it is paged, not
    // dropped (lh-silent-failure review of 5f292defa, #5).
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Lost chargeback: could not check for a recurring-visit tax transaction",
      message: `Dispute ${dispute.id} was lost, but its PaymentIntent could not be found, so whether it carries a Stripe Tax transaction to reverse is unknown. Check the charge's PaymentIntent metadata.tax_transaction_id by hand.`,
      fields: { Dispute: dispute.id, Charge: String(dispute.charge ?? "—") },
      oncePerDayKey: `visit-tax-dispute-nopi:${dispute.id}`,
    });
    return "failed_paged";
  }
  let txId: string | undefined;
  let chargedCents = 0;
  try {
    const pi = await stripe.paymentIntents.retrieve(piId);
    txId = (pi?.metadata as Record<string, string> | null)?.tax_transaction_id || undefined;
    chargedCents = Number(pi?.amount_received ?? pi?.amount ?? 0);
  } catch (e) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Lost chargeback: could not check for a recurring-visit tax transaction",
      message: `Dispute ${dispute.id} was lost, but its PaymentIntent ${piId} could not be read to see whether it carries a Stripe Tax transaction to reverse (${caughtMessage(e)}). Check the PaymentIntent's metadata.tax_transaction_id by hand.`,
      fields: { Dispute: dispute.id, "Payment Intent": piId },
      oncePerDayKey: `visit-tax-dispute-lookup:${dispute.id}`,
    });
    return "failed_paged";
  }
  if (!txId) return "none";

  // What was refunded before the dispute: the PaymentIntent's amount_received
  // never goes down, so the charge itself is read.
  let refundedCents = 0;
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : (dispute.charge as { id?: string } | null)?.id;
  try {
    const ch = chargeId ? await stripe.charges.retrieve(chargeId) : null;
    refundedCents = Number(ch?.amount_refunded ?? 0);
  } catch (e) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Lost chargeback on a taxed recurring visit: reverse its sales tax by hand",
      message: `Dispute ${dispute.id} was lost on a taxed visit (Stripe Tax transaction ${txId}), but its charge could not be read to see what was already refunded (${caughtMessage(e)}). Reverse what is still reported as collected in Stripe Tax by hand.`,
      fields: { "Tax transaction": txId, Dispute: dispute.id, "Payment Intent": piId },
      oncePerDayKey: `visit-tax-dispute-charge:${dispute.id}`,
    });
    return "failed_paged";
  }
  if (chargedCents > 0 && refundedCents >= chargedCents) {
    logStep("Lost chargeback on a fully refunded visit: its tax was reversed by the refund", { txId, disputeId: dispute.id });
    return "none";
  }

  const disputedCents = Number(dispute.amount ?? 0);
  if (!(chargedCents > 0) || refundedCents > 0 || disputedCents < chargedCents) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Lost chargeback on a taxed recurring visit: reverse its sales tax by hand",
      message: `Dispute ${dispute.id} was lost for ${formatExactDollars(disputedCents / 100)} of a ${formatExactDollars(chargedCents / 100)} charge (${formatExactDollars(refundedCents / 100)} refunded before it; Stripe Tax transaction ${txId}). Reverse the taxed share not already reversed in Stripe Tax (Transactions > ${txId} > Reverse, partial) so it is not reported as collected.`,
      fields: { "Tax transaction": txId, Dispute: dispute.id, "Payment Intent": piId },
      oncePerDayKey: `visit-tax-dispute-partial:${dispute.id}`,
    });
    return "partial_paged";
  }

  try {
    await stripe.tax.transactions.createReversal(
      { mode: "full", original_transaction: txId, reference: `dispute:${dispute.id}` },
      { idempotencyKey: `visit-tax-reversal-dispute:${dispute.id}` },
    );
    logStep("Recurring-visit tax reversed for a lost chargeback", { txId, disputeId: dispute.id });
    return "reversed";
  } catch (e) {
    const msg = caughtMessage(e);
    if (/reference/i.test(msg) && /(already|exists|unique)/i.test(msg)) {
      logStep("Recurring-visit tax already reversed for this dispute", { txId, disputeId: dispute.id });
      return "reversed";
    }
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Lost chargeback on a recurring visit: sales tax NOT reversed in Stripe Tax",
      message: `Dispute ${dispute.id} was lost, but reversing Stripe Tax transaction ${txId} failed (${msg}). Reverse it by hand (Stripe Tax > Transactions) so the tax is not reported as collected.`,
      fields: { "Tax transaction": txId, Dispute: dispute.id, "Payment Intent": piId },
    });
    return "failed_paged";
  }
}
