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
 * dashboard) ends in charge.refunded, so it is reversed here:
 *   - FULL refund in ONE refund: a full reversal, keyed on the charge
 *     (reference + Stripe idempotency key), so a redelivery cannot reverse
 *     twice;
 *   - every other refund (Q1828: a PARTIAL one, or each refund of a charge
 *     refunded in several parts): its own reversal, keyed on the REFUND id
 *     (reference refund:<re_…> + idempotency key), so each refund is reversed
 *     once however often the charge's events are redelivered. The amount is
 *     the refund's TAXED share. Owner 2026-10-15: tax stays paid on what the
 *     platform keeps and is reversed only on money returned. Lead rule: a
 *     refund comes out of the taxed labor + tax first, capped at what is left
 *     of the transaction: min(refund, labor + tax not yet reversed), refunds
 *     taken oldest first. Stripe's flat_amount spreads that total over the
 *     transaction's one labor line, tax included, so the tax reversed is the
 *     refund's proportional share. Every per-refund reversal is mode partial,
 *     even one whose share is the whole transaction, so each stays on
 *     Stripe's documented undo path (fully reversing that reversal).
 *     A reversal made is stamped on its Refund (metadata.tax_reversal_id), and
 *     a refund that carries the stamp is never sent again: later refunds on
 *     the same charge re-walk the earlier ones, and after Stripe's 24-hour
 *     idempotency window the only other signal would be an error's wording
 *     (lh-money-escrow review of 401d97ab8, #1).
 *     The charge-keyed FULL reversal is taken only when the charge never had
 *     another refund, failed ones included: a failed partial may already
 *     carry its own partial reversal, and a full reversal does not net it
 *     (review #3).
 *     Before Q1828 every partial refund paged ops to reverse it by hand, and
 *     the never-absorb rule (owner, 2026-10-14) made every fee-keeping visit
 *     refund partial. Measured 2026-10-17: prod holds no recurring visit at all
 *     (jobs with parent_job_id: 0), so no hand reversal exists for this to
 *     repeat.
 * Never throws: a reversal problem pages ops and the refund itself is still
 * settled by the rest of the handler.
 */
export async function reverseVisitTaxForRefund(args: {
  stripe: Stripe;
  piId: string | null | undefined;
  charge: Stripe.Charge;
  isFullRefund: boolean;
  liveRefundedCents: number;
  /** Live, non-correction refunds on the charge (Stripe's list, newest first). */
  ordinaryRefunds: Stripe.Refund[];
  /** Every non-correction refund ever made on the charge, failed and canceled included. */
  everRefundCount: number;
  logStep: (step: string, details?: unknown) => void;
}): Promise<"none" | "reversed" | "partial_paged" | "failed_paged"> {
  const { stripe, piId, charge, isFullRefund, liveRefundedCents, ordinaryRefunds, everRefundCount, logStep } = args;
  if (!piId) return "none";
  // A redelivery after every refund on the charge failed: nothing was
  // returned, so nothing is reversed or paged here (Q1730 pages the failure).
  // (review #6)
  if (everRefundCount > 0 && ordinaryRefunds.length === 0 && liveRefundedCents === 0) return "none";
  let txId: string | undefined;
  try {
    const pi = await stripe.paymentIntents.retrieve(piId);
    txId = (pi?.metadata as Record<string, string> | null)?.tax_transaction_id || undefined;
  } catch (e) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Refund: could not check for a recurring-visit tax transaction",
      message: `Charge ${charge.id} was refunded, but its PaymentIntent ${piId} could not be read to see whether it carries a Stripe Tax transaction to reverse (${caughtMessage(e)}). Check the PaymentIntent's metadata.tax_transaction_id and, if it has one, reverse the refunded share in Stripe Tax.`,
      fields: { "Payment Intent": piId, Charge: charge.id },
      oncePerDayKey: `visit-tax-lookup:${charge.id}`,
    });
    return "failed_paged";
  }
  if (!txId) return "none";

  if (isFullRefund && ordinaryRefunds.length <= 1 && everRefundCount <= 1) {
    return (await reverseOnce({
      stripe, txId, logStep, chargeId: charge.id,
      params: { mode: "full", original_transaction: txId, reference: `refund:${charge.id}` },
      idempotencyKey: `visit-tax-reversal:${charge.id}`,
      what: `Charge ${charge.id} was fully refunded`,
    })).outcome;
  }

  // Q1828: per-refund reversals. With no refund listed there is no refund id
  // to key on, so it is paged rather than guessed.
  if (ordinaryRefunds.length === 0) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Taxed recurring visit partly refunded: reverse its sales tax by hand",
      message: `Charge ${charge.id} (Stripe Tax transaction ${txId}) has ${formatExactDollars(liveRefundedCents / 100)} of ${formatExactDollars(charge.amount / 100)} refunded, but no refund on it could be read, so the reversal could not be keyed on one. Reverse the refunded share of labor + tax in Stripe Tax (Transactions > ${txId} > Reverse, partial).`,
      fields: { "Tax transaction": txId, Charge: charge.id, "Payment Intent": piId },
      oncePerDayKey: `visit-tax-partial:${charge.id}:${liveRefundedCents}`,
    });
    return "partial_paged";
  }

  // What the transaction recorded: its labor line(s) plus their tax.
  let txTotalCents = 0;
  try {
    let startingAfter: string | undefined;
    for (let page = 0; page < 10; page++) {
      const list = await stripe.tax.transactions.listLineItems(txId, { limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
      const rows = (list?.data ?? []) as Array<{ id: string; amount?: number | null; amount_tax?: number | null; tax_behavior?: string | null }>;
      // An inclusive line's amount already holds its tax (review #5; every
      // visit line today is exclusive).
      for (const li of rows) {
        txTotalCents += Math.abs(Number(li.amount ?? 0)) + (li.tax_behavior === "inclusive" ? 0 : Math.abs(Number(li.amount_tax ?? 0)));
      }
      if (!list?.has_more || rows.length === 0) break;
      if (page === 9) throw new Error("more than 1,000 line items; refusing to read a partial list");
      startingAfter = rows[rows.length - 1].id;
    }
    if (!(txTotalCents > 0)) throw new Error("the transaction lists no taxed amount");
  } catch (e) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Taxed recurring visit refunded: its sales tax was NOT reversed",
      message: `Charge ${charge.id} has ${formatExactDollars(liveRefundedCents / 100)} of ${formatExactDollars(charge.amount / 100)} refunded, but Stripe Tax transaction ${txId}'s line items could not be read (${caughtMessage(e)}), so the refunded share could not be worked out. Reverse it by hand: each refund's share is min(refund, labor + tax not yet reversed), oldest refund first.`,
      fields: { "Tax transaction": txId, Charge: charge.id, "Payment Intent": piId },
      oncePerDayKey: `visit-tax-lines:${charge.id}:${liveRefundedCents}`,
    });
    return "failed_paged";
  }

  // Oldest first, so each refund's share is fixed by the refunds before it and
  // a redelivery computes the same cents for the same refund id.
  const oldestFirst = [...ordinaryRefunds].sort((a, b) =>
    (Number(a.created ?? 0) - Number(b.created ?? 0)) || String(a.id).localeCompare(String(b.id)));
  let remaining = txTotalCents;
  let outcome: "none" | "reversed" | "failed_paged" = "none";
  for (const r of oldestFirst) {
    const share = Math.min(Math.max(0, Math.round(Number(r.amount ?? 0))), remaining);
    if (!(share > 0)) continue;
    remaining -= share;
    // Already reversed by an earlier delivery: its share still counts above.
    if ((r.metadata as Record<string, string> | null)?.tax_reversal_id) {
      if (outcome === "none") outcome = "reversed";
      continue;
    }
    const res = await reverseOnce({
      stripe, txId, logStep, chargeId: charge.id,
      params: { mode: "partial", original_transaction: txId, reference: `refund:${r.id}`, flat_amount: -share },
      idempotencyKey: `visit-tax-reversal:${r.id}`,
      what: `Refund ${r.id} (${formatExactDollars(Number(r.amount ?? 0) / 100)}, taxed share ${formatExactDollars(share / 100)}) on charge ${charge.id}`,
    });
    if (res.outcome === "reversed" && res.reversalId) {
      try {
        await stripe.refunds.update(r.id, { metadata: { tax_reversal_id: res.reversalId } });
      } catch (e) {
        // The reversal stands; without the stamp a later delivery sends it
        // again, which Stripe's idempotency (24 h) or reference check answers.
        console.warn(`[stripe-webhook] tax reversal ${res.reversalId} made for ${r.id} but not stamped on it: ${caughtMessage(e)}`);
      }
    }
    if (res.outcome === "failed_paged") outcome = "failed_paged";
    else if (outcome === "none") outcome = res.outcome;
  }
  return outcome;
}

type TaxReversalParams = {
  mode: "full" | "partial";
  original_transaction: string;
  reference: string;
  flat_amount?: number;
};

/** One Stripe Tax reversal; one already made (reference taken) counts as done. Never throws. */
async function reverseOnce(args: {
  stripe: Stripe;
  txId: string;
  chargeId: string;
  params: TaxReversalParams;
  idempotencyKey: string;
  what: string;
  logStep: (step: string, details?: unknown) => void;
}): Promise<{ outcome: "reversed" | "failed_paged"; reversalId?: string }> {
  const { stripe, txId, chargeId, params, idempotencyKey, what, logStep } = args;
  try {
    const rev = await stripe.tax.transactions.createReversal(params, { idempotencyKey });
    logStep("Recurring-visit tax reversed", { txId, chargeId, reference: params.reference, mode: params.mode, flatAmount: params.flat_amount });
    return { outcome: "reversed", reversalId: (rev as { id?: string } | null)?.id };
  } catch (e) {
    // A redelivery after the idempotency window finds the reference taken:
    // that reversal already exists, which is the outcome wanted. (The exact
    // wording is unverified, so the error code is matched too.)
    const msg = caughtMessage(e);
    const code = (e as { code?: string } | null)?.code;
    const type = (e as { type?: string } | null)?.type;
    if (code === "resource_already_exists" || (/reference/i.test(msg) && /(already|exists|unique)/i.test(msg))) {
      logStep("Recurring-visit tax already reversed", { txId, chargeId, reference: params.reference });
      return { outcome: "reversed" };
    }
    // Review #2: an idempotency error means a reversal under this key was (or
    // is being) made, with these or with different amounts (a failed earlier
    // refund shifted the shares). Never tell ops it was NOT reversed.
    if (type === "StripeIdempotencyError" || type === "idempotency_error" || /idempot/i.test(msg)) {
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "warning",
        title: "Recurring visit tax reversal: check it, do not re-reverse",
        message: `${what}: Stripe refused a reversal of tax transaction ${txId} under key ${idempotencyKey} (${msg}). A reversal with reference ${params.reference} was already made or is in flight, possibly for a different amount (an earlier refund on the charge failed, so the shares moved). Check Stripe Tax > Transactions for reference ${params.reference} and correct its amount if needed; do NOT reverse again.`,
        fields: { "Tax transaction": txId, Charge: chargeId, Reference: params.reference },
        oncePerDayKey: `visit-tax-reverse-idem:${params.reference}`,
      });
      return { outcome: "failed_paged" };
    }
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Refunded recurring visit: sales tax NOT reversed in Stripe Tax",
      message: `${what}, but reversing Stripe Tax transaction ${txId} (${params.mode}${params.flat_amount !== undefined ? `, ${formatExactDollars(-params.flat_amount / 100)}` : ""}) failed (${msg}). Reverse it by hand (Stripe Tax > Transactions) so the tax is not reported as collected.`,
      fields: { "Tax transaction": txId, Charge: chargeId, Reference: params.reference },
      oncePerDayKey: `visit-tax-reverse-failed:${params.reference}`,
    });
    return { outcome: "failed_paged" };
  }
}

/**
 * Q1730: the refund that drove a recurring visit's tax reversal (above, on
 * charge.refunded) later FAILED or was canceled. The money stayed with the
 * platform, but a full reversal may already have taken the tax off Stripe
 * Tax's filing reports, under refund:<charge> (a full refund in one) or, since
 * Q1828, under refund:<this refund's id> (a partial or multi-part one). Undoing
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
    message: `Refund ${refundId} (${formatExactDollars(amountCents / 100)}) on ${chargeId ?? piId} turned '${refundStatus}': the money stayed with the platform, and Stripe Tax transaction ${txId} may already be reversed for it. Look for a reversal with reference refund:${refundId} (a partial or multi-part refund): if there is one, UNDO it by fully reversing that reversal transaction, whatever happens next, because a re-refund gets its own reversal under its own refund id. Look also for reference refund:${chargeId ?? "?"} (a full refund in one): if the card holder will be refunded again in full (the usual case), LEAVE the reversal: the re-refund's own per-refund reversal will be refused (nothing is left to reverse) and page 'sales tax NOT reversed'; ignore that page for this charge. Only if the money is kept for good, undo it the same way (tax transactions cannot be edited or voided).`,
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
