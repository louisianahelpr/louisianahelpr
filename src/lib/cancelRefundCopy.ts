import { formatPriceExact } from "@/lib/format";
import { stripeProcessingCostCents } from "@/lib/stripeFees";

/**
 * Whether a gift card paid toward this job, read right after the cancel:
 * - "gift_only": the gift paid the whole job (redeem_gift_card settled it with
 *   no Stripe checkout: no card was charged). void-cancelled-payments gives it
 *   back to the gift balance within the hour, less any late-cancellation fee
 *   it pays (Q1806);
 * - "gift_and_card": the gift paid part and a card paid the rest;
 * - "redeemed": a gift paid toward the job, but the job's cost was not known
 *   here, so which of the two it is cannot be said;
 * - "reserved": the gift was set aside for a checkout; it is never spent
 *   until the card leg completes, and that sweep's Part C un-reserves it;
 * - "none": no gift on this job;
 * - "unknown": the read failed, or the donation behind the gift was refunded
 *   or charged back (the restored gift cannot be spent), so neither the card
 *   copy nor the gift copy is safe.
 */
export type GiftOnJob = "none" | "gift_only" | "gift_and_card" | "redeemed" | "reserved" | "unknown";

type GiftRow = { status: string | null; amount?: number | string | null; payment_status?: string | null };

/**
 * What a gift_cards read for the job says (rows with status 'redeemed' or
 * 'reserved' that the poster can see; RLS "Gift cards are party-only", and
 * redeem_gift_card makes the poster the recipient). A read error is
 * "unknown", never "none": the card copy on a gift-paid job is the defect
 * this exists for (lh-money-escrow design review of Q1806, 2026-10-17: on a
 * failed read show neutral copy, never the card copy).
 *
 * `costCents` is the poster-side cost redeem_gift_card compares the gift with
 * (budget + urgent fee): a gift worth at least that settled the job alone.
 * Null/undefined: not known, so a spent gift is just "redeemed".
 */
export function giftOnJobFromRead(rows: GiftRow[] | null, error: unknown, costCents?: number | null): GiftOnJob {
  if (error) return "unknown";
  const list = rows ?? [];
  const spent = list.find((r) => r.status === "redeemed");
  if (spent) {
    // revoke_gift_card_for_refund stamps the spent row when the donor's
    // purchase was refunded or charged back; the gift it restores is then
    // not spendable, so "goes back to your gift balance" would be false
    // (lh-money-escrow review of 39279d3e5, #4).
    if (spent.payment_status != null && spent.payment_status !== "paid") return "unknown";
    const giftCents = Math.round(Number(spent.amount ?? NaN) * 100);
    if (costCents == null || !Number.isFinite(costCents) || costCents <= 0 || !Number.isFinite(giftCents)) return "redeemed";
    return giftCents >= costCents ? "gift_only" : "gift_and_card";
  }
  const reserved = list.find((r) => r.status === "reserved");
  if (reserved) {
    // Re-review nit 4: a reserved gift whose donation was reversed is
    // un-reserved but cannot be spent, so "back on your gift balance" is false.
    if (reserved.payment_status != null && reserved.payment_status !== "paid") return "unknown";
    return "reserved";
  }
  return "none";
}

/**
 * What the card paid of the job's cost when a gift paid the rest, in cents
 * (cost minus the spent gift), or null when it is not known or there is no
 * spent gift. Used to say whether a late fee fits in the card payment.
 * `costCents` assumes budget and urgent_fee hold whole cents (both are what
 * the poster typed in dollars; prod had no sub-cent urgent_fee, 2026-10-17).
 */
export function cardShareCentsFromRead(rows: GiftRow[] | null, costCents?: number | null): number | null {
  const spent = (rows ?? []).find((r) => r.status === "redeemed");
  if (!spent || costCents == null || !Number.isFinite(costCents) || costCents <= 0) return null;
  const giftCents = Math.round(Number(spent.amount ?? NaN) * 100);
  if (!Number.isFinite(giftCents)) return null;
  return Math.max(0, costCents - giftCents);
}

/**
 * The confirmation a poster reads after cancelling a job, naming what happens
 * to their money. Pulled out of CancellationDialog so every branch is tested
 * (lh-money-escrow review of 7166349cd, #4: the legacy late-fee branch said
 * "the rest returns to your card" while void-cancelled-payments also keeps the
 * service fee paid at checkout).
 *
 * - never funded: nothing was charged, nothing to refund (and a gift set aside
 *   for that checkout goes back);
 * - flat model (roadmap F3, stamped at funding): the poster paid the job price
 *   only, so the refund is that payment less the card-processing fee Stripe
 *   keeps (refundToPayerCents);
 * - legacy (paid before F3): the budget comes back and the card-cost service
 *   fee charged at checkout is kept;
 * - a GIFT paid toward the job (Q?gift-cancel-copy): the gift goes back to the
 *   gift balance, and only a card payment comes back to the card. Gift only:
 *   "No card was charged", and a late fee is paid from the gift (Q1806). Gift
 *   and card: the fee comes out of the card payment. A reserved gift comes
 *   back whatever the card did. A failed read or a reversed donation gets
 *   neutral copy that promises no notice (the $0-refund branch sends none).
 * `keptFeeSentence` is the one-time setup-fee sentence (empty when none).
 */
export function cancelRefundToast(args: {
  wasFunded: boolean;
  appliedFee: number;
  flatModel: boolean;
  keptFeeSentence: string;
  gift?: GiftOnJob;
  /** cardShareCentsFromRead: the card's part of the cost on a gift-and-card job. */
  cardShareCents?: number | null;
  /** The one-time setup fee the card payment keeps, in cents (with keptFeeSentence). */
  keptSetupCents?: number;
  /** A crew job: its block fees are kept too and are not known here. */
  crew?: boolean;
}): string {
  const { wasFunded, appliedFee, flatModel, keptFeeSentence } = args;
  const gift = args.gift ?? "none";
  const neutral = `Job cancelled. Anything that comes back to you is returned within the hour, to the card or gift balance it came from.${keptFeeSentence}`;
  // A reserved gift is never spent before its card leg completes, so it comes
  // back whatever the card did; it is decided BEFORE wasFunded (lh-money-escrow
  // review of 39279d3e5, #1). Funded and reserved at once is a paid card leg
  // whose gift was not marked spent (the checkoutSessionCompleted alert): say
  // nothing that may be false.
  if (gift === "reserved") {
    return wasFunded
      ? neutral
      : "Job cancelled. Your checkout was never completed, so your card was never charged, and the gift you set aside goes back to your gift balance within the hour.";
  }
  if (!wasFunded) {
    return "Job cancelled. Your checkout was never completed, so you were never charged — there's nothing to refund.";
  }
  if (gift === "unknown") return neutral;
  const fee = `$${formatPriceExact(appliedFee)}`;
  if (gift === "gift_only") {
    // No card was charged (redeem_gift_card funds a fully covered job with no
    // Stripe checkout). Q1806: a late fee is paid from the gift and only the
    // rest is restored.
    return appliedFee > 0
      ? `Job cancelled. The ${fee} cancellation fee is paid from your gift; the rest goes back to your gift balance within the hour. No card was charged.${keptFeeSentence}`
      : `Job cancelled. Your gift goes back to your gift balance within the hour. No card was charged.${keptFeeSentence}`;
  }
  const cardKeeps = flatModel ? "the card-processing fee Stripe keeps" : "the service fee you paid at checkout";
  if (gift === "gift_and_card") {
    if (appliedFee <= 0) {
      return `Job cancelled. Your card payment returns to your card, less ${cardKeeps}, and your gift goes back to your gift balance within the hour.${keptFeeSentence}`;
    }
    // void-cancelled-payments takes a late fee from the card payment and
    // restores the whole gift. That is only what happens when the card paid
    // more than the fee and Stripe's card fee on it; a card share the fee
    // swallows is Q1806's open half (lh-money-escrow re-review of 1a2787c30,
    // #1: an $80 gift on a $100 job with a $50 fee), so it gets neutral copy.
    // Final delta review of 6aee7938d, nit 1: the refund also keeps the
    // one-time setup fee, and a crew's block fees (not known here: neutral).
    // Stripe's fee is counted twice as a margin for cards that cost more
    // than the estimate (international cards, nit 2).
    const cardShare = args.cardShareCents;
    const feeFitsInCard = cardShare != null && args.crew !== true
      && Math.round(appliedFee * 100) + Math.max(0, args.keptSetupCents ?? 0) + 2 * stripeProcessingCostCents(cardShare) < cardShare;
    return feeFitsInCard
      ? `Job cancelled. The ${fee} cancellation fee comes out of your card payment; the rest of it returns to your card, less ${cardKeeps}, and your gift goes back to your gift balance within the hour.${keptFeeSentence}`
      : neutral;
  }
  if (gift === "redeemed") {
    // Gift-only or gift-and-card cannot be told apart here, so a late fee's
    // source cannot be named: neutral (re-review #1).
    return appliedFee > 0
      ? neutral
      : `Job cancelled — your gift goes back to your gift balance within the hour, and any card payment returns to your card, less ${cardKeeps}.${keptFeeSentence}`;
  }
  if (appliedFee > 0) {
    const rest = flatModel
      ? "the rest, less the card-processing fee Stripe keeps, returns to your card."
      : "the rest, less the service fee you paid at checkout, returns to your card.";
    return `Job cancelled. The ${fee} cancellation fee applies — ${rest}${keptFeeSentence}`;
  }
  return flatModel
    ? `Job cancelled — your payment returns to your card, less the card-processing fee Stripe keeps.${keptFeeSentence}`
    : `Job cancelled — your job budget returns to your card; the service fee isn't refundable.${keptFeeSentence}`;
}
