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
      message: `Charge ${charge.id} (Stripe Tax transaction ${txId}) has ${formatExactDollars(liveRefundedCents)} of ${formatExactDollars(charge.amount)} refunded. Reverse the taxed share in Stripe Tax (Transactions > ${txId} > Reverse, partial) so it is not reported as collected.`,
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
