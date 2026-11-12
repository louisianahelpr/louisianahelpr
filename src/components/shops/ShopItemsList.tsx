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
import { fetchItemOptions } from "@/lib/shops/variants";
import { fetchItemPreorders } from "@/lib/shops/preorders";
import { SHOP_ITEMS_GRID, ShopItemsGrid } from "./ShopProfile";
import { shopsErrorMessage } from "@/lib/shops/errors";

export default function ShopItemsList({ shopId, reportable = false }: { shopId: string; reportable?: boolean }) {
  const items = useQuery({ queryKey: ["shops", "items", shopId], queryFn: () => fetchShopItems(shopId), enabled: !!shopId });
  // The same query the order sheet reads (one fetch); a failed read only drops the "From" word.
  const options = useQuery({ queryKey: ["shops", "item-options", shopId], queryFn: () => fetchItemOptions(shopId), enabled: !!shopId });
  // Preorders (20261108184654): the same query the order sheet reads; a failed read only drops the preorder words
  // (the order sheet refuses to order while it can't tell which items are preorders).
  const preorders = useQuery({ queryKey: ["shops", "item-preorders", shopId], queryFn: () => fetchItemPreorders(shopId), enabled: !!shopId });
  // One gate (oneLoadingGatePerScreen): the items, their "From" words and their preorder lines paint together.
  const listLoading = items.isLoading || options.isLoading || preorders.isLoading;
  const live = (items.data ?? []).filter((i) => i.status === "live");
  return (
    <section className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-sm" aria-labelledby="shop-items">
      <h2 id="shop-items" className="font-sans text-base font-bold not-italic text-foreground">Items</h2>
      {listLoading ? (
        <div role="status" aria-label="Loading items" className={SHOP_ITEMS_GRID}>
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
        <ShopItemsGrid items={live} reportable={reportable} withOptions={options.data} preorders={preorders.data} />
      )}
    </section>
  );
}
