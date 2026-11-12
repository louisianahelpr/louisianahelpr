/**
 * S026 (Shops audit 11-12): the sticky "Review order (n) $X" bar on a shop's page once the order holds something.
 * It sits right after the order sheet with `sticky bottom-3` (DeclutterBunchBar's pattern), so it rides the bottom of
 * the screen while the buyer looks at items above, and settles under the order sheet once they reach it. Tapping it
 * scrolls to the order sheet. The amount is the items only; the order sheet shows the full total before the card hold.
 */
import { useQuery } from "@tanstack/react-query";
import { ShoppingBag } from "lucide-react";
import { fetchShopItems } from "@/lib/shops/items";
import { fetchItemOptions } from "@/lib/shops/variants";
import { fetchItemPreorders } from "@/lib/shops/preorders";
import { formatCents } from "@/lib/shops/orders";
import { chosenLines, orderableItems, useShopCart } from "./shopCart";

export default function ShopReviewOrderBar({ shopId }: { shopId: string }) {
  const { qty } = useShopCart();
  // The same queries (and cache keys) the order sheet reads: no extra fetch.
  const items = useQuery({ queryKey: ["shops", "items", shopId], queryFn: () => fetchShopItems(shopId), enabled: !!shopId });
  const options = useQuery({ queryKey: ["shops", "item-options", shopId], queryFn: () => fetchItemOptions(shopId), enabled: !!shopId });
  const preorders = useQuery({ queryKey: ["shops", "item-preorders", shopId], queryFn: () => fetchItemPreorders(shopId), enabled: !!shopId });
  const lines = chosenLines(orderableItems(items.data, preorders.data), options.data, qty);
  const count = lines.reduce((s, l) => s + l.n, 0);
  if (count === 0) return null;
  const cents = lines.reduce((s, l) => s + l.unit * l.n, 0);
  return (
    <div className="sticky bottom-3 z-20" data-shop-review-bar="">
      <button
        type="button"
        className="btn-grad-primary flex min-h-12 w-full items-center justify-between gap-3 rounded-full px-5 text-sm font-semibold text-primary-foreground shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => document.getElementById("shop-order-sheet")?.scrollIntoView({ behavior: "smooth", block: "start" })}
      >
        <span className="inline-flex items-center gap-2">
          <ShoppingBag className="h-4 w-4" aria-hidden />
          {`Review order (${count})`}
        </span>
        <span>{formatCents(cents)}</span>
      </button>
    </div>
  );
}
