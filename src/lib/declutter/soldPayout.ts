/**
 * Deep audit #60 (2026-10-28): a sold listing on Selling says where its payout stands, on the row's one status line
 * ("Handed over · Paid out Oct 29"), from the seller's own payout row (declutter_payouts, read with fetchMyPayouts).
 * Never a fee figure (owner: members see no fee numbers but the one-time setup fee); only where the money is.
 * The live rule (20261026155251): a payout is offered once the sale is final, 24 hours after the handover with no
 * refund request open.
 */
import type { MyPayout } from "./handover";

/** The payout words for a sold or handed-over listing, or null when there is nothing to say (a free item, no sale read). */
export function soldPayoutWords(
  status: "sold" | "completed",
  saleCents: number | undefined,
  payout: Pick<MyPayout, "status" | "executed_at"> | null | undefined,
  // "Oct 29" never breaks across lines (a no-break space).
  formatDay: (iso: string) => string = (iso) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }).replace(/ /g, "\u00a0"),
): string | null {
  // A free item is claimed, never paid out; an unread sale has no words yet.
  if (saleCents === undefined || saleCents === 0) return null;
  if (status === "sold") return "Paid 24 hours after the handover";
  if (!payout) return null;
  switch (payout.status) {
    case "succeeded":
      return payout.executed_at ? `Paid out ${formatDay(payout.executed_at)}` : "Paid out";
    case "pending":
      return "Payout once the sale is final";
    case "failed":
      return "Payout didn't go through yet";
    case "nothing_due":
      return "Nothing to pay out";
  }
  return null;
}
