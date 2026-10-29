/**
 * The seller's payout line on a handed-over order card (row 93), moved out of DeclutterHandoverViews.tsx unchanged
 * (componentSizeRatchet: that file stays under 600 lines), plus audit 1b D2-2: while a problem is open a pending
 * payout says it is held.
 */
import type { MyPayout } from "@/lib/declutter/handover";
import { formatPrice } from "@/lib/declutter/distance";

const PAYOUT_WORDS: Record<MyPayout["status"], string> = {
  // 141d: the payout waits until the sale is final (20261026155251).
  pending: "We send it once the sale is final: 24 hours after the handover, unless the buyer asks for a refund.",
  failed: "Your payout didn't go through yet. We'll keep trying. Check that your payout account is set up.",
  succeeded: "Paid to your payout account. Banks usually show it in 2 business days.",
  nothing_due: "Nothing to pay out: this sale covered an amount you owed from an earlier refund.",
};
/** D2-2: a pending payout while a problem is open. */
const PAYOUT_HELD = "It's held while Louisiana Helpr looks at the problem.";

/**
 * What the payout is made of: "after the buyer's refund" (board 141d), or
 * "($30.00 + $15.00 delivery minus $1.50 you owed)". A seller delivery's rate is
 * paid with the items (20261027153244), so the payout is items + rate - refunded - debt,
 * each read from the row's own columns. A free delivery adds no delivery part.
 */
function payoutBreakdown(p: Pick<MyPayout, "items_cents" | "delivery_cents" | "refunded_cents" | "debt_cents">): string {
  if ((p.refunded_cents ?? 0) > 0) return " after the buyer's refund";
  const rate = p.delivery_cents ?? 0;
  if (rate <= 0 && p.debt_cents <= 0) return "";
  const parts = rate > 0 ? `${formatPrice(p.items_cents)} + ${formatPrice(rate)} delivery` : formatPrice(p.items_cents);
  return p.debt_cents > 0 ? ` (${parts} minus ${formatPrice(p.debt_cents)} you owed)` : ` (${parts})`;
}

/** "$38.50 ($40 minus $1.50 you owed). We send it once the sale is final: …" */
export function payoutLine(payout: MyPayout, problemOpen: boolean): string {
  const words = problemOpen && payout.status === "pending" ? PAYOUT_HELD : PAYOUT_WORDS[payout.status];
  return `${formatPrice(payout.amount_cents)}${payoutBreakdown(payout)}. ${words}`;
}
