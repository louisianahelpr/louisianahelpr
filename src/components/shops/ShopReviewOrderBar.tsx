/**
 * S026 (Shops audit 11-12): the sticky "Review order (n) $X" bar on a shop's page once the order holds something.
 * It sits right after the order sheet with `sticky bottom-3` (DeclutterBunchBar's pattern), so it rides the bottom of
 * the screen while the buyer looks at items above, and settles under the order sheet once they reach it. Tapping it
 * scrolls to the order sheet's heading. S2-028: while the order sheet is on screen the bar hides, so it never covers the
 * sheet's note box or hold terms. Area 07 M11 (design audit 11-18): the amount is the order sheet's own pickup "Total before
 * tax" (items + buyerFeeCents + the one-time setup fee from the same hook), never the items alone ($2.00 vs $2.80). A
 * delivery the buyer picks inside the sheet adds to the sheet's total there.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchShopItems } from "@/lib/shops/items";
import { fetchItemOptions } from "@/lib/shops/variants";
import { fetchItemPreorders } from "@/lib/shops/preorders";
import { buyerFeeCents, formatCents } from "@/lib/shops/orders";
import { useFirstPayoutFeeCents } from "@/hooks/useFirstPayoutFee";
import { chosenLines, orderableItems, useShopCart } from "./shopCart";

export default function ShopReviewOrderBar({ shopId }: { shopId: string }) {
  const { qty } = useShopCart();
  const setupFeeOwed = useFirstPayoutFeeCents();
  // The same queries (and cache keys) the order sheet reads: no extra fetch.
  const items = useQuery({ queryKey: ["shops", "items", shopId], queryFn: () => fetchShopItems(shopId), enabled: !!shopId });
  const options = useQuery({ queryKey: ["shops", "item-options", shopId], queryFn: () => fetchItemOptions(shopId), enabled: !!shopId });
  const preorders = useQuery({ queryKey: ["shops", "item-preorders", shopId], queryFn: () => fetchItemPreorders(shopId), enabled: !!shopId });
  // S2-028: hide while the order sheet is in view (no IntersectionObserver, e.g. old browsers: always shown).
  const [sheetInView, setSheetInView] = useState(false);
  useEffect(() => {
    const sheet = document.getElementById("shop-order-sheet");
    if (!sheet || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setSheetInView(entries.some((e) => e.isIntersecting)), { threshold: 0.15 });
    io.observe(sheet);
    return () => io.disconnect();
  }, []);
  const lines = chosenLines(orderableItems(items.data, preorders.data), options.data, qty);
  const count = lines.reduce((s, l) => s + l.n, 0);
  if (count === 0 || sheetInView) return null;
  const itemsCents = lines.reduce((s, l) => s + l.unit * l.n, 0);
  // The order sheet's own sum (ShopOrderSheet: itemsCents + feeCents + setupFeeCents before any delivery).
  const cents = itemsCents > 0 ? itemsCents + buyerFeeCents(itemsCents) + setupFeeOwed : 0;
  return (
    <div className="sticky bottom-3 z-20" data-shop-review-bar="">
      <Button
        type="button"
        size="md"
        className="btn-grad-primary flex w-full items-center justify-between gap-3 rounded-full px-5 text-ds-13 font-semibold text-primary-foreground shadow-md"
        onClick={() => document.getElementById("shop-order-sheet")?.scrollIntoView({ behavior: "smooth", block: "start" })}
      >
        <span className="inline-flex items-center gap-2">
          <ShoppingBag className="h-4 w-4" aria-hidden />
          {`Review order (${count})`}
        </span>
        <span>{formatCents(cents)}</span>
      </Button>
    </div>
  );
}
