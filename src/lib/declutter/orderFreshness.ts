/**
 * Order and money reads are read again every time they are shown (Declutter deep audit #17 / SH-5, 2026-10-28,
 * shots 49b, 58 vs 58b, 76): the cache saved on the device showed an order's old state for 6 to 20 s after reopening
 * (a "1 to hand over" that was already done, a refund offer the buyer couldn't see yet, a paid order missing from
 * Purchases), with nothing on screen saying it was still updating.
 *
 * For these reads only: never "fresh" (staleTime 0), and read again on every mount and every return to the app,
 * even inside the app's usual 60 s fresh window. While one of them is reading again over data already on screen,
 * OrdersUpdating says "Updating…". Guard: src/test/orderReadsStayFresh.test.tsx.
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** The second key part of every ["declutter", ...] read about an order or its money. */
export const ORDER_QUERY_HEADS = [
  "my-cart",
  "my-offers",
  "handover",
  "bookings",
  "payouts",
  "delivery-raise",
  "refund-request",
  "seller-delivery-booking",
  "order-meetup",
  "delivery-tips",
] as const;

const HEADS: ReadonlySet<string> = new Set(ORDER_QUERY_HEADS);

export function isOrderQueryKey(key: QueryKey): boolean {
  return key[0] === "declutter" && typeof key[1] === "string" && HEADS.has(key[1]);
}

export function keepOrderReadsFresh(qc: QueryClient): void {
  for (const head of ORDER_QUERY_HEADS) {
    qc.setQueryDefaults(["declutter", head], { staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: "always" });
  }
}
