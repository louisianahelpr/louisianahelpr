/**
 * The seller's payout line on a handed-over order card: what the payout is made of, and where it stands. Pure, so the
 * rule is tested apart from the screen (src/lib/declutter/payoutWords.test.ts). Moved out of DeclutterHandoverViews.tsx
 * for D2-6 (audit 1b #6). Never a fee figure: only what was refunded and what the seller owed.
 */
import { formatPrice } from "@/lib/declutter/distance";
import type { MyPayout } from "@/lib/declutter/handover";

const PAYOUT_WORDS: Record<MyPayout["status"], string> = {
  // 141d: the payout waits until the sale is final (20261026155251).
  pending: "We send it once the sale is final: 24 hours after the handover, unless the buyer asks for a refund.",
  failed: "Your payout didn't go through yet. Check that your payout account is set up. If it still doesn't arrive, message Support.",
  succeeded: "Paid to your payout account. Banks usually show it in 2 business days.",
  nothing_due: "Nothing to pay out.",
};

/**
 * D2-6 (audit 1b #6): a $0 payout says WHY, from the payout row itself: a refund that took the whole sale back, or an
 * amount owed from an earlier refund that this sale covered. On prod 2026-10-29 a sale refunded in full read "this
 * sale covered an amount you owed" while nothing owed had been taken.
 */
export function payoutStatusWords(p: Pick<MyPayout, "status" | "items_cents" | "delivery_cents" | "refunded_cents" | "debt_cents">): string {
  if (p.status !== "nothing_due") return PAYOUT_WORDS[p.status];
  const sale = p.items_cents + (p.delivery_cents ?? 0);
  if ((p.refunded_cents ?? 0) >= sale) return "Nothing to pay out: the buyer was refunded for this sale.";
  if (p.debt_cents > 0) return "Nothing to pay out: this sale covered an amount you owed from an earlier refund.";
  if ((p.refunded_cents ?? 0) > 0) return "Nothing to pay out: the buyer's refund took the rest of this sale.";
  return PAYOUT_WORDS.nothing_due;
}

/**
 * What the payout is made of: "after the buyer's refund" (board 141d), or
 * "($30.00 + $15.00 delivery minus $1.50 you owed)". A seller delivery's rate is
 * paid with the items (20261027153244), so the payout is items + rate - refunded - debt,
 * each read from the row's own columns. A free delivery adds no delivery part.
 */
export function payoutBreakdown(p: Pick<MyPayout, "items_cents" | "delivery_cents" | "refunded_cents" | "debt_cents">): string {
  // D2-6: a refund and an amount owed can both come off one sale; each is named from what was actually taken.
  if ((p.refunded_cents ?? 0) > 0) return p.debt_cents > 0 ? ` after the buyer's refund and ${formatPrice(p.debt_cents)} you owed` : " after the buyer's refund";
  const rate = p.delivery_cents ?? 0;
  if (rate <= 0 && p.debt_cents <= 0) return "";
  const parts = rate > 0 ? `${formatPrice(p.items_cents)} + ${formatPrice(rate)} delivery` : formatPrice(p.items_cents);
  return p.debt_cents > 0 ? ` (${parts} minus ${formatPrice(p.debt_cents)} you owed)` : ` (${parts})`;
}
