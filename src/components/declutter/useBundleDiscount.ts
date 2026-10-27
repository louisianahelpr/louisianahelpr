/**
 * Q2427 (20261027211754): the seller's bundle discount on one seller's cart lines, previewed by the server (the
 * same computation checkout uses: each paid line N% off its own price when 2 or more, never below the item's
 * lowest price). The total is on the discounted items. Members see "Bundle discount" and what they pay, never a
 * fee name or number (owner 2026-10-25, issue #3672).
 */
import { useQuery } from "@tanstack/react-query";
import type { CartLine } from "@/lib/declutter/api";
import { fetchBundlePreview } from "@/lib/declutter/bundle";
import { checkoutAmounts } from "@/lib/declutter/money";

export function useBundleDiscount(sellerId: string, lines: CartLine[]) {
  const itemsCents = lines.reduce((sum, l) => sum + l.price_cents, 0);
  const paidCount = lines.filter((l) => l.price_cents > 0).length;
  const preview = useQuery({
    queryKey: ["declutter", "bundle-preview", sellerId, lines.map((l) => `${l.line_id}:${l.price_cents}`).join(",")],
    queryFn: () => fetchBundlePreview(sellerId),
    enabled: paidCount >= 2,
  });
  const discountCents = paidCount >= 2 ? Math.min(preview.data ?? 0, itemsCents) : 0;
  return { itemsCents, discountCents, totalCents: checkoutAmounts([itemsCents - discountCents]).totalCents };
}
