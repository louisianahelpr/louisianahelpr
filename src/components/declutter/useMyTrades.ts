/**
 * The member's trade offers, on both sides, from the same read and key as the trade sections (DeclutterTradeOffers):
 * Buying and Selling name a trade in its own words with it (lead 11-08), never "Free", "Claimed" or "Someone is buying".
 * Its own small file so the order cards and listing rows pay for no trade-section code.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchMyTrades, tradedForMyItems, type MyTrade } from "@/lib/declutter/trades";

const TRADES_KEY = ["declutter", "trades"] as const;

export function useMyTrades(side: "buyer" | "seller", userId: string | null) {
  return useQuery({ queryKey: [...TRADES_KEY, side, userId], queryFn: () => fetchMyTrades(side, userId as string), enabled: !!userId });
}

/** The viewer's own listing id -> the item they get for it, over both sides' accepted or finished trades. */
export function useTradedFor(userId: string | null): Map<string, string> {
  const asSeller = useMyTrades("seller", userId).data;
  const asBuyer = useMyTrades("buyer", userId).data;
  return tradedForMyItems([...(asSeller ?? []), ...(asBuyer ?? [])] as MyTrade[]);
}
