/**
 * The items on a shop's page (Shops slice 2; docs/specs/local-shops-prep.md
 * L5-L22): photo, title, price, when it can be ready, its type, and on every
 * home-kitchen food item the notice the law asks for (L7, R.S. 40:4.9 D(1)).
 * Only LIVE items show here; the owner manages every item on /shops/mine.
 * Ordering is ShopOrderSheet, below this list on the shop's page (M1).
 */
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchShopItems } from "@/lib/shops/items";
import { ShopItemsGrid } from "./ShopProfile";
import { shopsErrorMessage } from "@/lib/shops/errors";

export default function ShopItemsList({ shopId }: { shopId: string }) {
  const items = useQuery({ queryKey: ["shops", "items", shopId], queryFn: () => fetchShopItems(shopId), enabled: !!shopId });
  const live = (items.data ?? []).filter((i) => i.status === "live");
  return (
    <section className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-sm" aria-labelledby="shop-items">
      <h2 id="shop-items" className="font-sans text-base font-bold not-italic text-foreground">Items</h2>
      {items.isLoading ? (
        <div role="status" aria-label="Loading items" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      ) : items.isError && !items.data ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm">{shopsErrorMessage(items.error)}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void items.refetch()} disabled={items.isFetching}>
            Try again
          </Button>
        </div>
      ) : (
        <ShopItemsGrid items={live} />
      )}
    </section>
  );
}
