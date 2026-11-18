/**
 * Area 06 H2 (11-18): Selling folded a handed-over sale under "Show 1 finished sale" while it still had the seller's
 * "Leave a review" and "You get $40 once your payout account is ready" on it. A handed-over sale folds only once the
 * seller has left the review AND its payout went out (or nothing was due); a refunded one folds as before. Same reads
 * and keys as the order card (payouts, i-reviewed), so this adds no request the card doesn't already make.
 */
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchIReviewed } from "@/lib/declutter/handover";
import { fetchMyPayouts } from "@/lib/declutter/payoutReads";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const reviewedKey = (orderId: string, side: "buyer" | "seller") => `declutter-reviewed:${orderId}:${side}`;

/** This device's mark that the member reviewed this order (the server has no cheap read for a list). */
export function rememberedReviewed(orderId: string, side: "buyer" | "seller"): boolean {
  try {
    return localStorage.getItem(reviewedKey(orderId, side)) === "1";
  } catch (err) {
    // Storage blocked (private mode): the button shows, and the server still refuses a second review.
    console.warn("[declutter] could not read the reviewed mark", err);
    return false;
  }
}

export function rememberReviewed(orderId: string, side: "buyer" | "seller") {
  try {
    localStorage.setItem(reviewedKey(orderId, side), "1");
  } catch (err) {
    console.warn("[declutter] could not save the reviewed mark", err);
  }
}

const PAID_OUT = new Set(["succeeded", "settled_by_hand", "nothing_due"]);

/** The handed-over sales (of `orderIds`) that may fold: reviewed and paid out. Unknown reads never fold. */
export function useFoldableSales(orderIds: string[]): Set<string> {
  const { user } = useCurrentUser();
  const userId = user?.id ?? "";
  const payouts = useQuery({
    queryKey: ["declutter", "payouts", userId],
    queryFn: () => fetchMyPayouts(userId),
    enabled: !!userId && orderIds.length > 0,
  });
  const paidOut = new Set((payouts.data ?? []).filter((p) => PAID_OUT.has(p.status)).map((p) => p.order_id));
  const askFor = orderIds.filter((id) => paidOut.has(id) && !rememberedReviewed(id, "seller"));
  const reviewed = useQueries({
    queries: askFor.map((id) => ({ queryKey: ["declutter", "i-reviewed", id], queryFn: () => fetchIReviewed(id) })),
  });
  const reviewedOnServer = new Set(askFor.filter((_, i) => reviewed[i]?.data === true));
  return new Set(orderIds.filter((id) => paidOut.has(id) && (rememberedReviewed(id, "seller") || reviewedOnServer.has(id))));
}
