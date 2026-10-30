/**
 * The Selling tab's "May drop tonight", said only when it can: a seller's own read knows their lowest price and whether
 * they stopped the drops (same read and cache entry as the Manage sheet). Asked only for the few rows that would say it.
 */
import { useQueries } from "@tanstack/react-query";
import { fetchManageState, type DeclutterItem, type DropStateRow } from "@/lib/declutter/api";
import { dropOutlook } from "@/lib/declutter/browseFilters";
import { sellerStateStopsDrops } from "@/lib/declutter/priceDrop";

export function useMyDropsTonight(items: DeclutterItem[], dropStates: Map<string, DropStateRow> | undefined): Set<string> {
  const tonight = items.filter((i) => i.status === "live" && dropOutlook(i, dropStates?.get(i.id)).tonight);
  const reads = useQueries({
    queries: tonight.map((i) => ({ queryKey: ["declutter", "manage", i.id], queryFn: () => fetchManageState(i.id) })),
  });
  return new Set(tonight.filter((i, n) => {
    const st = reads[n]?.data;
    // Until it is read, say nothing: hiding is the safe side of the truth rule.
    return !!st && (st === "not_deployed" || !sellerStateStopsDrops(st, i.current_price_cents));
  }).map((i) => i.id));
}
