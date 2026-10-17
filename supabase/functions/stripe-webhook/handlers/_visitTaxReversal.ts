import type Stripe from "https://esm.sh/stripe@18.5.0";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { formatExactDollars } from "../../_shared/money.ts";
import { caughtMessage } from "../../_shared/caughtMessage.ts";

/**
 * Q1655 / Q1782 (2): a refunded recurring visit's sales tax comes off Stripe
 * Tax's filing reports, once per refunded cent.
 *
 * An off-session visit charge has no Checkout `automatic_tax`, so
 * charge-recurring-visits records its tax itself with
 * tax.transactions.createFromCalculation (ONE line: the visit's labor, tax
 * exclusive) and stamps the transaction's id on the PaymentIntent
 * (`metadata.tax_transaction_id`). Stripe reverses only Checkout /
 * automatic-tax refunds on its own; a Tax API transaction stays "collected"
 * until we reverse it.
 *
 * The rule (owner pop-up 2026-10-15 ~3:30 AM UTC; lead's ruling the same day):
 *   - tax is reversed only on money actually returned to the poster. Fees we
 *     keep (the card fee, a late-cancel fee paid to the Helpr, crew block
 *     fees) are never part of a refund (refundAmount.ts), so their share of
 *     the transaction stays collected and its tax stays paid;
 *   - EACH refund gets its own reversal, keyed on the refund id (reference
 *     `refund:<re_id>`, idempotency key `visit-tax-reversal:<re_id>`): a
 *     redelivery or retry finds the reversal already recorded on the
 *     PaymentIntent (`metadata.tax_rev_<re_id>`) or Stripe hands back the same
 *     one, while a second partial refund, or a refund re-issued after one
 *     failed, gets a reversal of its own;
 *   - a refund's taxed share = min(its amount, what is left of the
 *     transaction's labor + tax after the refunds before it). The cumulative
 *     reversal therefore never exceeds what was collected (Stripe refuses an
 *     over-reversal anyway);
 *   - a refund that returns the whole labor + tax while nothing has been
 *     reversed yet is a FULL reversal (mode full); every other share is a
 *     partial reversal by flat amount (Stripe spreads it over the labor and
 *     its tax by what is left on each);
 *   - a refund that later FAILS is undone by a full reversal of its own
 *     reversal transaction (Stripe docs, "Undo a partial refund"):
 *     undoVisitTaxForFailedRefund below, on charge.refund.updated.
 * Never throws: a reversal problem pages ops and the refund itself is still
 * settled by the rest of the handler.
 */

/** The PaymentIntent metadata key that records the Stripe Tax reversal made for one refund. */
function taxReversalMetadataKey(refundId: string): string {
  return `tax_rev_${refundId}`;
}

/** Stripe caps a metadata key at 40 characters. */
const METADATA_KEY_MAX = 40;

interface VisitTaxShare {
  refundId: string;
  /** What this refund reverses of the transaction (labor + tax), in cents. */
  shareCents: number;
  /** What the refunds before it reversed, in cents. */
  beforeCents: number;
}

/**
 * Each live refund's share of a visit's tax transaction, oldest refund first.
 * `refunds` is in Stripe's list order (newest first); a refund's `created`
 * decides the order when both carry it. Pure.
 */
// The running total counts what each refund's share SHOULD have reversed, not
// what Stripe actually holds: a reversal that failed (paged), was undone, or was
// made by hand is not read back. That only matters once refunds pass the
// transaction's total; Stripe refuses an over-reversal (which pages), and an
// under-reversal overpays tax. Prod had 0 recurring_visit_payments rows when
// this shipped (2026-10-15), so no hand or legacy reversals exist.
function visitTaxShares(
  refunds: ReadonlyArray<{ id: string; amount?: number | null; created?: number | null }>,
  txTotalCents: number,
): VisitTaxShare[] {
  const oldestFirst = refunds
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ca = typeof a.r.created === "number" ? a.r.created : null;
      const cb = typeof b.r.created === "number" ? b.r.created : null;
      if (ca !== null && cb !== null && ca !== cb) return ca - cb;
      // Stripe lists newest first, so a later index is an older refund.
      return b.i - a.i;
    })
    .map(({ r }) => r);
  const total = Math.max(0, Math.round(Number(txTotalCents) || 0));
  let before = 0;
  return oldestFirst.map((r) => {
    const amount = Math.max(0, Math.round(Number(r.amount ?? 0) || 0));
    const shareCents = Math.min(amount, Math.max(0, total - before));
    const row = { refundId: r.id, shareCents, beforeCents: before };
    before += shareCents;
    return row;
  });
}

/**
 * Stripe refused a reversal because its reference is already used, so that
 * refund's reversal exists. Matched on the error's structure (an invalid
 * request about the reference) AND its text: Stripe does not document the
 * exact wording, so any other refusal (an over-reversal, an idempotency
 * conflict, a network error) is a failure and is paged, never read as done.
 */
function referenceTaken(e: unknown): boolean {
  const err = (e ?? {}) as { type?: string; rawType?: string; param?: string };
  const invalidRequest = err.type === "StripeInvalidRequestError" || err.rawType === "invalid_request_error";
  const msg = caughtMessage(e);
  const aboutReference = err.param === "reference" || /reference/i.test(msg);
  return invalidRequest && aboutReference && /(already|exists|unique|duplicate)/i.test(msg);
}

/**
 * What a person must do after reversing a refund's tax by hand, so the next
 * charge.refunded event on the charge (a later refund lists this one again)
 * does not reverse the same share a second time.
 */
function handInstruction(piId: string, refundId: string): string {
  return `Use reference refund:${refundId}, then set metadata.${taxReversalMetadataKey(refundId)}=<that reversal's id> on PaymentIntent ${piId}, or the next refund event on this charge reverses it again`;
}

function listRefunds(refunds: ReadonlyArray<{ id: string; amount?: number | null }>): string {
  return refunds.map((r) => `${r.id} ($${formatExactDollars(Number(r.amount ?? 0) / 100)})`).join(", ");
}

export async function reverseVisitTaxForRefund(args: {
  stripe: Stripe;
  piId: string | null | undefined;
  charge: Stripe.Charge;
  /** The charge's LIVE, non-correction refunds, in Stripe's list order (newest first). */
  refunds: Stripe.Refund[];
  /**
   * Whether Stripe listed ANY refund on the charge (failed and canceled ones
   * included). Listed but none live = every refund failed: no money went
   * back, so nothing is reversed and nobody is told to reverse it.
   */
  listedAnyRefund: boolean;
  logStep: (step: string, details?: unknown) => void;
}): Promise<"none" | "reversed" | "failed_paged"> {
  const { stripe, piId, charge, refunds, listedAnyRefund, logStep } = args;
  if (!piId) return "none";
  let txId: string | undefined;
  let piMeta: Record<string, string> = {};
  try {
    const pi = await stripe.paymentIntents.retrieve(piId);
    // A copy: the recorded reversals are added to it as this run makes them.
    piMeta = { ...((pi?.metadata ?? {}) as Record<string, string>) };
    txId = piMeta.tax_transaction_id || undefined;
  } catch (e) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Refund: could not check for a recurring-visit tax transaction",
      message: `Charge ${charge.id} was refunded, but its PaymentIntent ${piId} could not be read to see whether it carries a Stripe Tax transaction to reverse (${caughtMessage(e)}). Check the PaymentIntent's metadata.tax_transaction_id by hand. If it is set, each live refund (${listRefunds(refunds) || "none listed"}) whose metadata.tax_rev_<refund id> is missing needs its share reversed in Stripe Tax with reference refund:<refund id>, then metadata.tax_rev_<refund id>=<that reversal's id> set on the PaymentIntent, or the next refund event on this charge reverses it again.`,
      fields: { "Payment Intent": piId, Charge: charge.id },
      oncePerDayKey: `visit-tax-lookup:${charge.id}`,
    });
    return "failed_paged";
  }
  if (!txId) return "none";

  if (refunds.length === 0) {
    // Every listed refund failed or was canceled (a stale delivery, Q1355
    // (2)): no money went back, so there is nothing to reverse
    // (lh-silent-failure + lh-money-escrow reviews of 994f077b2).
    if (listedAnyRefund) {
      logStep("Recurring-visit tax: every refund on the charge failed; nothing to reverse", { txId, chargeId: charge.id });
      return "none";
    }
    // The event says money went back but Stripe listed no refund at all to
    // key a reversal on: a person decides.
    if (Number(charge.amount_refunded ?? 0) <= 0) return "none";
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Taxed recurring visit refunded: reverse its sales tax by hand",
      message: `Charge ${charge.id} (Stripe Tax transaction ${txId}) reads $${formatExactDollars(Number(charge.amount_refunded ?? 0) / 100)} refunded, but no live refund was listed to key a reversal on. Reverse the refunded share in Stripe Tax (Transactions > ${txId} > Reverse, partial) so it is not reported as collected.`,
      fields: { "Tax transaction": txId, Charge: charge.id, "Payment Intent": piId },
      oncePerDayKey: `visit-tax-unlisted:${charge.id}`,
    });
    return "failed_paged";
  }

  // What the transaction recorded: its labor and the tax on it (one line,
  // tax exclusive). Read from Stripe Tax itself, the record being reversed.
  // Q1828 (the one part of sec-a-1017-13 that Q1782 (2) lacked): an INCLUSIVE
  // line's amount already holds its tax (Stripe Tax API: "If tax_behavior=
  // inclusive, then this amount includes taxes"), so its amount_tax is not
  // added again. charge-recurring-visits writes exclusive lines today; this
  // keeps a later inclusive one from inflating the total, which would turn a
  // full refund's reversal into a partial one.
  let txTotalCents = 0;
  try {
    const items = await stripe.tax.transactions.listLineItems(txId, { limit: 100 });
    for (const li of (items?.data ?? []) as Array<{ amount?: number | null; amount_tax?: number | null; tax_behavior?: string | null }>) {
      txTotalCents += Math.abs(Number(li.amount ?? 0)) + (li.tax_behavior === "inclusive" ? 0 : Math.abs(Number(li.amount_tax ?? 0)));
    }
    if (items?.has_more) throw new Error("more than 100 line items listed; refusing to read a partial total");
  } catch (e) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Taxed recurring visit refunded: its sales tax was NOT reversed",
      message: `Charge ${charge.id} was refunded, but Stripe Tax transaction ${txId}'s line items could not be read (${caughtMessage(e)}), so the refunded share could not be worked out. Live refunds: ${listRefunds(refunds)}. For each one whose metadata.tax_rev_<refund id> is missing on PaymentIntent ${piId}, reverse its share (at most what is left of the labor and tax) by hand in Stripe Tax, with reference refund:<refund id>, then set metadata.tax_rev_<refund id>=<that reversal's id> on the PaymentIntent, or the next refund event on this charge reverses it again.`,
      fields: { "Tax transaction": txId, Charge: charge.id, "Payment Intent": piId },
      oncePerDayKey: `visit-tax-lines:${charge.id}`,
    });
    return "failed_paged";
  }
  if (!(txTotalCents > 0)) {
    logStep("Recurring-visit tax transaction records nothing to reverse", { txId, chargeId: charge.id });
    return "none";
  }

  let outcome: "none" | "reversed" | "failed_paged" = "none";
  for (const { refundId, shareCents, beforeCents } of visitTaxShares(refunds, txTotalCents)) {
    const metaKey = taxReversalMetadataKey(refundId);
    if (piMeta[metaKey]) {
      // A redelivery, or a later refund's event listing this one again.
      logStep("Recurring-visit tax already reversed for this refund", { txId, refundId, reversal: piMeta[metaKey] });
      if (outcome === "none") outcome = "reversed";
      continue;
    }
    if (shareCents <= 0) {
      logStep("Recurring-visit tax: nothing left to reverse for this refund", { txId, refundId, beforeCents, txTotalCents });
      continue;
    }
    const full = beforeCents === 0 && shareCents >= txTotalCents;
    const reference = `refund:${refundId}`;
    let reversalId: string | null = null;
    try {
      const rev = await stripe.tax.transactions.createReversal(
        full
          ? { mode: "full", original_transaction: txId, reference, metadata: { refund_id: refundId, charge_id: charge.id } }
          : { mode: "partial", flat_amount: -shareCents, original_transaction: txId, reference, metadata: { refund_id: refundId, charge_id: charge.id } },
        { idempotencyKey: `visit-tax-reversal:${refundId}` },
      );
      reversalId = (rev as { id?: string } | null)?.id ?? null;
      logStep("Recurring-visit tax reversed for a refund", { txId, refundId, mode: full ? "full" : "partial", shareCents, reversalId });
      if (outcome === "none") outcome = "reversed";
    } catch (e) {
      const msg = caughtMessage(e);
      if (referenceTaken(e)) {
        // A redelivery after Stripe's idempotency window: this refund's
        // reversal exists, which is the outcome wanted. It is not recorded on
        // the PaymentIntent, so a later failure of this refund pages instead
        // of undoing it automatically.
        logStep("Recurring-visit tax already reversed for this refund (reference taken)", { txId, refundId });
        if (outcome === "none") outcome = "reversed";
        continue;
      }
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "warning",
        title: "Refunded recurring visit: sales tax NOT reversed in Stripe Tax",
        message: `Refund ${refundId} on charge ${charge.id} returned $${formatExactDollars(shareCents / 100)} of the visit's $${formatExactDollars(txTotalCents / 100)} labor and tax, but reversing Stripe Tax transaction ${txId} for it failed (${msg}). First look in Stripe Tax for a reversal with reference ${reference} (another delivery may be making it: an "idempotency key in use" error means exactly that); only if there is none, reverse $${formatExactDollars(shareCents / 100)} by hand (Stripe Tax > Transactions > ${txId} > Reverse${full ? ", full" : ", partial"}) so it is not reported as collected. ${handInstruction(piId, refundId)}.`,
        fields: { "Tax transaction": txId, Refund: refundId, Charge: charge.id, "Payment Intent": piId },
        oncePerDayKey: `visit-tax-reversal:${refundId}`,
      });
      outcome = "failed_paged";
      continue;
    }
    // Record which reversal this refund made, so a redelivery skips it and a
    // later failure of the refund can undo exactly this one.
    if (reversalId && metaKey.length <= METADATA_KEY_MAX) {
      try {
        await stripe.paymentIntents.update(piId, { metadata: { [metaKey]: reversalId } });
        piMeta[metaKey] = reversalId;
      } catch (e) {
        await postSlackOpsAlert({
          kind: "money_at_risk",
          severity: "warning",
          title: "Visit tax reversed, but the reversal was not recorded on its payment",
          message: `Refund ${refundId}'s sales tax was reversed in Stripe Tax (${reversalId}), but recording it on PaymentIntent ${piId} failed (${caughtMessage(e)}). Nothing is reversed twice (the reference refund:${refundId} is taken), but if this refund later fails, its reversal is not undone automatically: set metadata.${metaKey}=${reversalId} on the PaymentIntent by hand.`,
          fields: { "Tax reversal": reversalId, Refund: refundId, "Payment Intent": piId },
          oncePerDayKey: `visit-tax-stamp:${refundId}`,
        });
      }
    } else {
      // Unreachable in practice (Stripe returns an id; a re_/pyr_ key is ~35
      // characters), but a reversal whose record is lost is said out loud.
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "warning",
        title: "Visit tax reversed, but the reversal was not recorded on its payment",
        message: `Refund ${refundId}'s sales tax was reversed in Stripe Tax (${reversalId ?? "no id returned"}), but it could not be recorded on PaymentIntent ${piId} (${reversalId ? `metadata key ${metaKey} is longer than ${METADATA_KEY_MAX} characters` : "Stripe returned no reversal id"}). If this refund later fails, undo that reversal by hand (fully reverse it in Stripe Tax).`,
        fields: { "Tax reversal": reversalId ?? "—", Refund: refundId, "Payment Intent": piId },
        oncePerDayKey: `visit-tax-stamp:${refundId}`,
      });
    }
  }
  return outcome;
}

/**
 * Q1730 / Q1782 (2): a refund whose tax was reversed (above, on
 * charge.refunded) later FAILED or was canceled. The money stayed with the
 * platform, so the tax on it is collected after all: the refund's own
 * reversal is undone by a FULL reversal of that reversal transaction (Stripe
 * docs, "Undo a partial refund"; tax transactions cannot be edited or
 * voided), keyed on the failed refund (reference `refund-failed:<re_id>`,
 * idempotency key `visit-tax-reversal-undo:<re_id>`), so a redelivery cannot
 * undo twice. A refund issued again later is reversed under its own id.
 * When no reversal is recorded for the refund on the PaymentIntent, a taxed
 * visit is paged for a person to check. Never throws.
 */
export async function undoVisitTaxForFailedRefund(args: {
  stripe: Stripe;
  piId: string | null | undefined;
  chargeId: string | null | undefined;
  refundId: string;
  refundStatus: string;
  amountCents: number;
  logStep: (step: string, details?: unknown) => void;
}): Promise<"none" | "undone" | "paged"> {
  const { stripe, piId, chargeId, refundId, refundStatus, amountCents, logStep } = args;
  if (!piId) return "none";
  let txId: string | undefined;
  let reversalId: string | undefined;
  try {
    const pi = await stripe.paymentIntents.retrieve(piId);
    const meta = (pi?.metadata ?? {}) as Record<string, string>;
    txId = meta.tax_transaction_id || undefined;
    reversalId = meta[taxReversalMetadataKey(refundId)] || undefined;
  } catch (e) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Failed refund: could not check for a recurring-visit tax reversal",
      message: `Refund ${refundId} turned '${refundStatus}', but its PaymentIntent ${piId} could not be read to see whether it carries a Stripe Tax transaction (${caughtMessage(e)}). If metadata.tax_transaction_id is set, check Stripe Tax for a reversal with reference refund:${refundId} and, if there is one, fully reverse it.`,
      fields: { Refund: refundId, "Payment Intent": piId, Charge: chargeId ?? "—" },
      oncePerDayKey: `visit-tax-refund-failed-lookup:${refundId}`,
    });
    return "paged";
  }
  if (!txId && !reversalId) return "none";

  if (!reversalId) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Failed refund on a taxed recurring visit: check its sales tax reversal",
      message: `Refund ${refundId} ($${formatExactDollars(amountCents / 100)}) on ${chargeId ?? piId} turned '${refundStatus}': the money stayed with the platform, so the visit's tax on it is collected after all. No Stripe Tax reversal is recorded for this refund on PaymentIntent ${piId} (none was made, or it was made but not recorded). In Stripe Tax, look for a reversal of ${txId} with reference refund:${refundId}; if there is one, fully reverse THAT reversal transaction.`,
      fields: { "Tax transaction": txId ?? "—", Refund: refundId, Charge: chargeId ?? "—", "Payment Intent": piId },
      oncePerDayKey: `visit-tax-refund-failed:${refundId}`,
    });
    return "paged";
  }

  try {
    await stripe.tax.transactions.createReversal(
      { mode: "full", original_transaction: reversalId, reference: `refund-failed:${refundId}`, metadata: { refund_id: refundId, undoes: reversalId } },
      { idempotencyKey: `visit-tax-reversal-undo:${refundId}` },
    );
    logStep("Recurring-visit tax reversal undone for a failed refund", { refundId, reversalId });
    return "undone";
  } catch (e) {
    const msg = caughtMessage(e);
    if (referenceTaken(e)) {
      logStep("Recurring-visit tax reversal already undone for this refund", { refundId, reversalId });
      return "undone";
    }
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Failed refund on a taxed recurring visit: its tax reversal was NOT undone",
      message: `Refund ${refundId} ($${formatExactDollars(amountCents / 100)}) turned '${refundStatus}', so the money stayed with the platform, but undoing its Stripe Tax reversal ${reversalId} failed (${msg}). Fully reverse ${reversalId} by hand in Stripe Tax so the tax is reported as collected.`,
      fields: { "Tax reversal": reversalId, "Tax transaction": txId ?? "—", Refund: refundId, "Payment Intent": piId },
      oncePerDayKey: `visit-tax-refund-failed:${refundId}`,
    });
    return "paged";
  }
}


/**
 * Q1724: a chargeback the platform LOST returns the money to the card holder
 * through charge.dispute.closed (status lost), with no refund and so no
 * charge.refunded event: reverseVisitTaxForRefund never runs, and a taxed
 * recurring visit's Stripe Tax transaction stayed reported as collected.
 *
 * A dispute that took the WHOLE charge (nothing refunded before it) is
 * reversed in full, keyed on the dispute (reference + idempotency key), so a
 * redelivery cannot reverse twice and a refund's own reference (refund:<re_id>)
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
