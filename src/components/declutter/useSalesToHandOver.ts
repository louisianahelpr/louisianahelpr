/**
 * THE count of sales the seller still has to hand over (post-merge check 11-20 #6: the Selling home's to-do said "Hand
 * over 4 sales" while the Sold heading said "3 to hand over" for the same cart). A paid sale waiting for its pickup,
 * less any on hold for an open problem (Q2631: its card says "On hold until the problem is decided."). The Sold
 * heading, the "To hand over" chip and the to-do row all read it, so they can never disagree again.
 *
 * Same reads and keys as the order cards (my-cart, useOpenProblems), so it adds no request.
 * Guard: src/components/declutter/sellingHome.test.tsx.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchMyCart, type CartLine } from "@/lib/declutter/api";
import { useOpenProblems } from "./useOpenProblems";

/** The paid orders whose problems decide "on hold" (the order cards' own read and key). */
export const paidOrderIds = (lines: readonly CartLine[]) => lines.filter((l) => l.status === "paid" && l.order_id).map((l) => l.order_id as string);

/**
 * The orders behind that count (deep audit 11-22 #50: "Pickups to do · 3" opened 5 or more cards, a delivery and
 * finished sales among them). The "To hand over" chip lists exactly these.
 */
export function salesToHandOverIds(lines: readonly CartLine[], problems: { has: (orderId: string) => boolean }): Set<string> {
  return new Set(lines.filter((l) => l.status === "paid" && l.order_status === "paid" && l.handover !== "delivery" && l.order_id && !problems.has(l.order_id)).map((l) => l.order_id as string));
}

/** Sales to hand over among one side's cart lines, given the open problems by order id. */
export function salesToHandOver(lines: readonly CartLine[], problems: { has: (orderId: string) => boolean }): number {
  return salesToHandOverIds(lines, problems).size;
}

/** The seller's sales to hand over; null until the cart has answered. */
export function useSalesToHandOver(): number | null {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const lines = (cart.data ?? []).filter((l) => l.my_side === "seller");
  const problems = useOpenProblems(paidOrderIds(lines), true);
  return cart.data ? salesToHandOver(lines, problems) : null;
}
