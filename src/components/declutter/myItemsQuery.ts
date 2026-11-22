/**
 * The seller's own listings, one read for Selling's chips and My listings (audit 1028 D1-8). A listing waiting for
 * review said "Waiting for a review" after the admin approved it, even on a fresh page load: the cache is kept on the
 * device (queryPersister, 24 h) and a read under a minute old counts as fresh (staleTime 60 s), so a reload inside that
 * minute showed the old row without asking again. While any listing is waiting, every mount and every return to the
 * screen reads again, and a new notice (the approval sends one) reads again at once.
 */
import { useEffect } from "react";
import { useQueryClient, type Query, type QueryKey } from "@tanstack/react-query";
import { fetchMyItems, type DeclutterItem } from "@/lib/declutter/api";
import { subscribeUserRealtime } from "@/lib/userRealtimeBus";

/**
 * Listings that are history, not for sale: taken down, or sold elsewhere (A2-5). They live in Selling history; every
 * other listing is a row under Your listings, and the Listed chip counts exactly those rows (NIGHT-SELL-Sellinglist-2).
 */
export const PAST_LISTING: ReadonlySet<DeclutterItem["status"]> = new Set(["withdrawn", "sold_elsewhere"]);

/**
 * Deep audit 11-22 #49 (owner rule: a listing never shows twice; lead 11-22 Option A): an item sold on Declutter is its
 * sale card on Selling (to hand over, or under the finished sales), so it is not a Your listings row as well. Its sold
 * price, "Claimed", payout and "held" words are the card's (src/components/declutter/declutterHandoverViews.test.tsx "#49"). A
 * search of the seller's own listings still finds it (the sale cards step aside then, #53).
 */
const ON_A_SALE_CARD: ReadonlySet<DeclutterItem["status"]> = new Set(["sold", "completed"]);

/** A row under Your listings: not history, and (unless searching) not shown as a sale card. */
export const isListingsRow = (i: Pick<DeclutterItem, "status">, searching = false) =>
  !PAST_LISTING.has(i.status) && (searching || !ON_A_SALE_CARD.has(i.status));

const waiting = (q: Query<DeclutterItem[]>) => (q.state.data ?? []).some((i) => i.status === "pending_review");

export function myItemsQuery(userId: string) {
  return {
    queryKey: ["declutter", "mine", userId] as QueryKey,
    queryFn: () => fetchMyItems(userId),
    refetchOnMount: (q: Query<DeclutterItem[]>) => (waiting(q) ? ("always" as const) : true),
    refetchOnWindowFocus: (q: Query<DeclutterItem[]>) => (waiting(q) ? ("always" as const) : true),
  };
}

/** A new notice for this member (an approval, a sale, an offer) reads the listings again. */
export function useMyItemsFollowNotices(userId: string) {
  const qc = useQueryClient();
  useEffect(
    () => subscribeUserRealtime(userId, "notifications:insert", () => void qc.invalidateQueries({ queryKey: ["declutter", "mine", userId] })),
    [qc, userId],
  );
}
