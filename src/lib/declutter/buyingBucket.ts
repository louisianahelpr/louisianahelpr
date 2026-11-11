/**
 * Audit 11-10 F374: the Buying tab's chips (Needs you / Waiting / Upcoming / Done / Cancelled) filtered only the
 * paid orders; the offers and trade offers above them stayed put whatever chip was on. These two rules file an offer
 * or a trade offer under the same chip an order would take, so one tap narrows the whole tab:
 *   Needs you  — an open offer or trade waiting on this member's answer
 *   Waiting    — an open offer or trade waiting on the other side
 *   Upcoming   — nothing (only booked orders are upcoming)
 *   Done       — an accepted offer; an accepted or completed trade
 *   Cancelled  — a declined, expired, withdrawn or voided offer; the same for a trade, plus one that lapsed
 */
import type { OrderBucket } from "@/components/declutter/OrderSteps";

type OfferLike = { status: "open" | "accepted" | "declined" | "expired" | "withdrawn" | "voided"; awaiting: "buyer" | "seller" };
/** A trade offer is the buyer's; open, it waits on the seller. Accepted, each side checks out its own $0 line. */
type TradeLike = { status: "open" | "accepted" | "declined" | "expired" | "withdrawn" | "voided" | "lapsed" | "completed"; my_line_status: string | null };

export function offerBucket(o: OfferLike, side: "buyer" | "seller"): OrderBucket {
  if (o.status === "open") return o.awaiting === side ? "needs_you" : "waiting";
  if (o.status === "accepted") return "done";
  return "cancelled";
}

export function tradeBucket(t: TradeLike, side: "buyer" | "seller"): OrderBucket {
  if (t.status === "open") return side === "seller" ? "needs_you" : "waiting";
  if (t.status === "accepted") return t.my_line_status === "in_cart" ? "needs_you" : "done";
  if (t.status === "completed") return "done";
  return "cancelled";
}

/** The rows a chip keeps: every row when no chip is on. */
export function underChip<T>(rows: T[], only: OrderBucket | null | undefined, bucketOf: (row: T) => OrderBucket): T[] {
  return only ? rows.filter((r) => bucketOf(r) === only) : rows;
}
