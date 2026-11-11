/**
 * The seller's payout line on a handed-over order card: what the payout is made of, and where it stands. Pure, so the
 * rule is tested apart from the screen (src/lib/declutter/payoutWords.test.ts). Moved out of DeclutterHandoverViews.tsx
 * for D2-6 (audit 1b #6). Never a fee figure: only what was refunded and what the seller owed.
 */
import { formatPrice } from "@/lib/declutter/distance";
import type { MyPayout } from "@/lib/declutter/handover";

/**
 * soldstates-4: the payout run's last try, from the NEWEST declutter_payouts_due (20261026155251: attempts < 12).
 * After it nothing restarts a failed payout on its own. No duration is promised: a payout that waits for the seller's
 * payout setup (20261019070737) moves its next try without counting one. Bound to the SQL by payoutWords.test.ts.
 */
export const PAYOUT_TRIES = 12;

const PAYOUT_WORDS: Record<MyPayout["status"], string> = {
  // 141d: the payout waits until the sale is final (20261026155251).
  pending: "We send it once the sale is final: 24 hours after the handover, unless the buyer asks for a refund.",
  // soldstates-4 review: a missing payout account never fails a try (the run waits for it), so these words name no cause.
  failed: "Your payout didn't go through yet. We'll try again on our own. If it still doesn't arrive, message Support.",
  succeeded: "Paid to your payout account. Banks usually show it in 2 business days.",
  nothing_due: "Nothing to pay out.",
  // Audit 11-10 F392 (High): these two statuses (20261019070737, 20261102043754) had no words, so the card read
  // "$50. undefined". held_for_review: the payout left the automatic run until an admin releases or settles it.
  held_for_review: "On hold while Louisiana Helpr checks this payout. If it doesn't arrive soon, message Support.",
  settled_by_hand: "Paid to you by Louisiana Helpr.",
};

/** A status this screen doesn't know yet still reads as words, never "undefined". */
const PAYOUT_UNKNOWN = "If you have a question about this payout, message Support.";

// Never promises the money: a last try can fail on a refunded or disputed charge, which ops must not pay by hand
// (declutter-money pageIfLastTry).
const PAYOUT_GAVE_UP = "Your payout didn't go through and we've stopped trying. Message Support and we'll look into it.";
const PAYOUT_FAILED_UNKNOWN = "Your payout didn't go through yet. Check that your payout account is set up. If it still doesn't arrive, message Support.";

/**
 * D2-6 (audit 1b #6): a $0 payout says WHY, from the payout row itself: a refund that took the whole sale back, or an
 * amount owed from an earlier refund that this sale covered. On prod 2026-10-29 a sale refunded in full read "this
 * sale covered an amount you owed" while nothing owed had been taken.
 */
export function payoutStatusWords(p: Pick<MyPayout, "status" | "items_cents" | "delivery_cents" | "refunded_cents" | "debt_cents" | "attempts">): string {
  // soldstates-4: after the last try nothing restarts the payout on its own; say so, and who sends it.
  // A row set back to pending (a rebook, a held row released) without its tries reset is never tried again by the run
  // (attempts < 12): at 12 or more it says Support too, never a payment that won't happen on its own.
  if ((p.status === "failed" || p.status === "pending") && (p.attempts ?? 0) >= PAYOUT_TRIES) return PAYOUT_GAVE_UP;
  // Try count unknown (the grant not live yet): the old words, which promise no retries.
  if (p.status === "failed" && p.attempts === undefined) return PAYOUT_FAILED_UNKNOWN;
  if (p.status !== "nothing_due") return PAYOUT_WORDS[p.status] ?? PAYOUT_UNKNOWN;
  const sale = p.items_cents + (p.delivery_cents ?? 0);
  if ((p.refunded_cents ?? 0) >= sale) return "Nothing to pay out: the buyer was refunded for this sale.";
  if (p.debt_cents > 0) return "Nothing to pay out: this sale covered an amount you owed from an earlier refund.";
  if ((p.refunded_cents ?? 0) > 0) return "Nothing to pay out: the buyer's refund took the rest of this sale.";
  return PAYOUT_WORDS.nothing_due;
}

/**
 * What the payout is made of, in the owner's words (11-11 ~2:10 PM, F360b/F398/F404): "after the $20 refund", or
 * "($45 + $5 delivery)", or "($30 + $15 delivery minus $1.50 you owed)". A seller delivery's rate is paid with the
 * items (20261027153244), so the payout is items + rate - refunded - debt, each read from the row's own columns. A
 * free delivery adds no delivery part. No fee words.
 */
export function payoutBreakdown(p: Pick<MyPayout, "items_cents" | "delivery_cents" | "refunded_cents" | "debt_cents">): string {
  // D2-6: a refund and an amount owed can both come off one sale; each is named from what was actually taken.
  const owed = p.debt_cents > 0 ? `${formatPrice(p.debt_cents)} you owed` : "";
  const refunded = p.refunded_cents ?? 0;
  if (refunded > 0) return owed ? ` after the ${formatPrice(refunded)} refund and ${owed}` : ` after the ${formatPrice(refunded)} refund`;
  const rate = p.delivery_cents ?? 0;
  if (rate <= 0 && !owed) return "";
  const parts = rate > 0 ? `${formatPrice(p.items_cents)} + ${formatPrice(rate)} delivery` : formatPrice(p.items_cents);
  return owed ? ` (${parts} minus ${owed})` : ` (${parts})`;
}
