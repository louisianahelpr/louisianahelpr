/**
 * The other person on a Declutter order: id (from the order row, which both
 * sides may read) and public first name (the seller card's profile read).
 * `who` falls back to their role ("the seller" / "the buyer"), never a pronoun.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchSellerCard } from "@/lib/declutter/api";
import { fetchOrderOtherPerson } from "@/lib/declutter/reviews";

export function useOrderOtherPerson(orderId: string, userId: string, side: "buyer" | "seller") {
  const other = useQuery({ queryKey: ["declutter", "order-other", orderId], queryFn: () => fetchOrderOtherPerson(orderId, userId) });
  const otherId = other.data ?? null;
  const card = useQuery({
    queryKey: ["declutter", "seller-card", otherId],
    queryFn: () => fetchSellerCard(otherId!),
    enabled: !!otherId,
  });
  const first = (card.data?.name ?? "").trim().split(/\s+/)[0] || null;
  return {
    otherId,
    name: card.data?.name ?? null,
    avatarUrl: card.data?.avatarUrl ?? null,
    first,
    who: first ?? (side === "buyer" ? "the seller" : "the buyer"),
  };
}
