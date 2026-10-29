import { useQuery } from "@tanstack/react-query";
import { fetchMyPaidCents } from "@/lib/declutter/paidCents";

/**
 * A1-B2: what the buyer was charged for each of these orders (declutter_my_paid_cents: the sale plus a setup fee
 * that stood), the one figure every "You paid" line prints. Null while loading, on a failed read, before the RPC is
 * deployed, or for an order it does not answer: the line then shows no figure, never the sale total $2 low.
 */
export function useMyPaidCents(orderIds: string[], enabled = true): Map<string, number> | null {
  const ids = [...new Set(orderIds)].sort();
  const q = useQuery({
    queryKey: ["declutter", "my-paid-cents", ids.join(",")],
    queryFn: () => fetchMyPaidCents(ids),
    enabled: enabled && ids.length > 0,
  });
  return q.data ?? null;
}
