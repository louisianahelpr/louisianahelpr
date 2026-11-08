/**
 * The seller's badges on the item page's seller card (owner 11-07, after reviewing Vinted; our own look): small
 * chips under the name, each from real data with an honest bar (src/lib/declutter/sellerBadges.ts), none at all when
 * nothing clears its bar. Read only after the page has painted (`after`), never in the item's loading gate.
 * "More from this seller" is the same read (and key) as the row under the item, so "Lists often" costs nothing extra.
 * Guard: src/test/declutterItemTrust.test.tsx.
 */
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Clock, Layers } from "lucide-react";
import { fetchSellerItems } from "@/lib/declutter/api";
import { fetchLastSignIn, fetchOnTimeHandovers, sellerBadges, type SellerBadge } from "@/lib/declutter/sellerBadges";

const ICON: Record<SellerBadge["key"], typeof Clock> = { lists_often: Layers, on_time: CalendarClock, active: Clock };

export function SellerTrustBadges({ sellerId, itemId, after }: { sellerId: string; itemId: string; after: boolean }) {
  const more = useQuery({ queryKey: ["declutter", "more-from-seller", sellerId, itemId], queryFn: () => fetchSellerItems(sellerId, itemId), enabled: after });
  const onTime = useQuery({ queryKey: ["declutter", "seller-on-time", sellerId], queryFn: () => fetchOnTimeHandovers(sellerId), enabled: after, staleTime: 10 * 60_000 });
  const seen = useQuery({ queryKey: ["declutter", "seller-last-sign-in", sellerId], queryFn: () => fetchLastSignIn(sellerId), enabled: after, staleTime: 60_000 });
  // A failed or unfinished read shows no badge (a missing badge is never a claim).
  const badges = sellerBadges({
    othersForSale: more.data ? more.data.filter((r) => r.status === "live" || r.status === "reserved").length : null,
    onTime: onTime.data ?? null,
    lastSignIn: seen.data ?? null,
  });
  if (badges.length === 0) return null;
  return (
    <span data-seller-badges="" className="mt-1 flex flex-wrap gap-1.5">
      {badges.map((b) => {
        const Icon = ICON[b.key];
        return (
          <span key={b.key} data-seller-badge={b.key} className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--bark)/0.08)] px-2 py-0.5 text-xs font-semibold text-foreground">
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {b.label}
          </span>
        );
      })}
    </span>
  );
}
