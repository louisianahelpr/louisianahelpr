/**
 * "N views" (unique people, owner request 11-05) on the seller's own Selling row and their own item page. Only ever
 * mounted for the seller; the server answers only the caller's own items anyway (declutter_my_item_view_counts).
 * While the read is loading the line keeps its height, empty (no jump when it arrives); a failed read shows nothing,
 * because a missing count is not a zero.
 */
import { Eye } from "lucide-react";
import { useMyItemViewCounts, viewsLabel } from "@/lib/declutter/itemViews";

export function ItemViewsCount({ sellerId, itemId, className = "" }: { sellerId: string; itemId: string; className?: string }) {
  const counts = useMyItemViewCounts(sellerId);
  if (counts.isLoading) return <p aria-hidden className={`invisible text-ds-13 ${className}`}>0 views</p>;
  if (!counts.data) return null;
  const n = counts.data.get(itemId) ?? 0;
  return (
    <p data-item-views={n} className={`inline-flex items-center gap-1 text-ds-13 text-muted-foreground tabular-nums ${className}`}>
      <Eye className="h-3.5 w-3.5" aria-hidden />
      {viewsLabel(n)}
    </p>
  );
}
