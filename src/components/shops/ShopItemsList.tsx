/**
 * The items on a shop's page (Shops slice 2; docs/specs/local-shops-prep.md
 * L5-L22): photo, title, price, when it can be ready, its type, and on every
 * home-kitchen food item the notice the law asks for (L7, R.S. 40:4.9 D(1)).
 * Only LIVE items show here; the owner manages every item on /shops/mine.
 * Ordering is ShopOrderSheet, below this list on the shop's page (M1).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchShopItems } from "@/lib/shops/items";
import { fetchItemOptions } from "@/lib/shops/variants";
import { fetchItemPreorders } from "@/lib/shops/preorders";
import { SHOP_ITEMS_GRID, ShopItemsGrid } from "./ShopProfile";
import { shopsErrorMessage } from "@/lib/shops/errors";
import ShopItemSheet from "./ShopItemSheet";
import { orderableItems, useHasShopCart } from "./shopCart";

/**
 * S026 (Shops audit 11-12): the item card's "Order" goes to that item's row in the order sheet below (the same page),
 * scrolls it to the middle and focuses its first live control (the stepper's add, or the first option picker). An
 * item the sheet has no row for lands on the sheet itself.
 */
export function goToOrderRow(itemId: string): void {
  const row = document.querySelector<HTMLElement>(`[data-order-item="${CSS.escape(itemId)}"]`);
  const target = row ?? document.getElementById("shop-order-sheet");
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  row?.querySelector<HTMLElement>("button:not(:disabled), select:not(:disabled), [role=combobox]")?.focus({ preventScroll: true });
}

export default function ShopItemsList({ shopId, reportable = false, orderable = false }: { shopId: string; reportable?: boolean; orderable?: boolean }) {
  const items = useQuery({ queryKey: ["shops", "items", shopId], queryFn: () => fetchShopItems(shopId), enabled: !!shopId });
  // The same query the order sheet reads (one fetch); a failed read only drops the "From" word.
  const options = useQuery({ queryKey: ["shops", "item-options", shopId], queryFn: () => fetchItemOptions(shopId), enabled: !!shopId });
  // Preorders (20261108184654): the same query the order sheet reads; a failed read only drops the preorder words
  // (the order sheet refuses to order while it can't tell which items are preorders).
  const preorders = useQuery({ queryKey: ["shops", "item-preorders", shopId], queryFn: () => fetchItemPreorders(shopId), enabled: !!shopId });
  // One gate (oneLoadingGatePerScreen): the items, their "From" words and their preorder lines paint together.
  const listLoading = items.isLoading || options.isLoading || preorders.isLoading;
  const live = (items.data ?? []).filter((i) => i.status === "live");
  // S026 (rest): on a page that shares one order (ShopView's ShopCartProvider), a card opens the item sheet.
  const sharesOrder = useHasShopCart();
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = orderable && sharesOrder ? live.find((i) => i.id === openId) ?? null : null;
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
        <ShopItemsGrid items={live} reportable={reportable} withOptions={options.data} preorders={preorders.data} onOrder={orderable ? goToOrderRow : undefined}
          onOpen={orderable && sharesOrder ? setOpenId : undefined} />
      )}
      {orderable && sharesOrder && (
        <ShopItemSheet item={opened} onClose={() => setOpenId(null)} options={opened ? options.data?.get(opened.id) : undefined}
          preorder={opened ? preorders.data?.get(opened.id) : undefined} orderable={orderableItems(items.data, preorders.data)}
          preorders={preorders.data} />
      )}
    </section>
  );
}
