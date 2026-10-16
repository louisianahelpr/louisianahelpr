/**
 * The items on a shop's page (Shops slice 2; docs/specs/local-shops-prep.md
 * L5-L22): photo, title, price, when it can be ready, its type, and on every
 * home-kitchen food item the notice the law asks for (L7, R.S. 40:4.9 D(1)).
 * Only LIVE items show here; the owner manages every item on /shops/mine.
 * Ordering is the next slice (S3): no order button until it exists.
 */
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchShopItems,
  formatItemPrice,
  HOME_KITCHEN_NOTICE,
  itemPhotoUrl,
  readinessLabel,
  SHOP_ITEM_TYPE_LABEL,
  type ShopItem,
} from "@/lib/shops/items";
import { shopsErrorMessage } from "@/lib/shops/errors";

function ItemCard({ item }: { item: ShopItem }) {
  const cover = item.photos[0];
  return (
    <li className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="aspect-[4/3] w-full bg-muted">
        {cover ? <img src={itemPhotoUrl(cover.storage_path)} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
      </div>
      <div className="space-y-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 font-semibold [overflow-wrap:anywhere]">{item.title}</p>
          <p className="shrink-0 font-semibold">{formatItemPrice(item.price_cents)}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {SHOP_ITEM_TYPE_LABEL[item.subtype] ?? "Item"} · {readinessLabel(item)}
        </p>
        {item.description && <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">{item.description}</p>}
        {item.home_kitchen && (
          <p className="rounded-lg bg-muted/70 px-2 py-1 text-xs text-foreground" data-testid="home-kitchen-notice">
            {HOME_KITCHEN_NOTICE}
          </p>
        )}
      </div>
    </li>
  );
}

export default function ShopItemsList({ shopId }: { shopId: string }) {
  const items = useQuery({ queryKey: ["shops", "items", shopId], queryFn: () => fetchShopItems(shopId), enabled: !!shopId });
  const live = (items.data ?? []).filter((i) => i.status === "live");
  return (
    <section className="space-y-2" aria-labelledby="shop-items">
      <h2 id="shop-items" className="text-sm font-semibold">Items</h2>
      {items.isLoading ? (
        <div role="status" aria-label="Loading items" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      ) : items.isError ? (
        <p className="text-sm" role="alert">{shopsErrorMessage(items.error)}</p>
      ) : live.length === 0 ? (
        <p className="text-sm text-muted-foreground">No items listed yet.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Ordering opens here soon.</p>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {live.map((i) => <ItemCard key={i.id} item={i} />)}
          </ul>
        </>
      )}
    </section>
  );
}
