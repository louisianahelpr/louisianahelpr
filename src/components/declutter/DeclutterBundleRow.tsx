/**
 * Board 4's "2 more from Marie" row on a Declutter item, worded "Check out
 * together: one pickup, one fee." (money review design-b-1020 #3: a second
 * checkout later is a second order and a second fee). True because checkout is per seller: declutter_start_checkout(p_seller_id)
 * puts every line in the buyer's cart from that seller into ONE order with ONE
 * handover and charges declutter_buyer_fee_cents(items total) once (5% of the
 * items + 70¢; measured live with pg_get_functiondef, 2026-10-20). Shown only
 * when the seller has other items that can still be bought (status live), and
 * never for the member's own items. Tapping it jumps to "More from this seller".
 */
import { useQuery } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import { fetchItemHandovers, fetchSellerCard, fetchSellerItems, type DeclutterItem } from "@/lib/declutter/api";
import { noDeliveryWay } from "@/lib/declutter/pickupWords";
import { formatName } from "@/lib/utils";
import { bundleLabel, fetchBundleApplies, fetchBundleRule } from "@/lib/declutter/bundle";

export type BundleSummary = { count: number; capped: boolean; firstName: string; free: boolean; pickup: boolean; offer: string | null };

/** The reads behind "N more from <seller>": null while loading, or when the seller has nothing else to buy. */
export function useBundleSummary(itemOrNull: DeclutterItem | null, viewerId: string | null, wanted = true): BundleSummary | null {
  // The item page calls this before its item has loaded (hooks run in one order): an empty item reads nothing.
  const enabled = wanted && !!itemOrNull;
  const item = itemOrNull ?? ({ id: "", seller_id: "", current_price_cents: 0 } as DeclutterItem);
  // Same keys as DeclutterItemRows / DeclutterSellerCard: one read each, shared.
  const more = useQuery({
    queryKey: ["declutter", "more-from-seller", item.seller_id, item.id],
    queryFn: () => fetchSellerItems(item.seller_id, item.id),
    enabled,
  });
  const card = useQuery({ queryKey: ["declutter", "seller-card", item.seller_id], queryFn: () => fetchSellerCard(item.seller_id), enabled });
  // Q2427 (20261027211754): the seller's "Buy 2+, get N% off", when they set one. A failed read says nothing extra.
  const rule = useQuery({ queryKey: ["declutter", "bundle-rule", item.seller_id], queryFn: () => fetchBundleRule(item.seller_id), enabled });
  const buyable = (more.data ?? []).filter((r) => r.status === "live" && r.seller_id !== viewerId);
  // Deep audit #36: say "Buy 2+, get N% off" only when the discount can apply to one of these items (above its
  // lowest price, checkout's own bound); asked only once a rule exists. Null = not deployed yet: shown as before.
  const ids = [item.id, ...buyable.map((r) => r.id)];
  const applies = useQuery({
    queryKey: ["declutter", "bundle-applies", ids.join(",")],
    queryFn: () => fetchBundleApplies(ids),
    enabled: enabled && !!rule.data && buyable.length > 0,
  });
  // Audit BUY-3: an item the seller offers only delivered has no pickup to share (the same key as the item page's ways).
  const ways = useQuery({ queryKey: ["declutter", "item-handovers", item.id], queryFn: () => fetchItemHandovers(item.id), enabled });
  const pickup = noDeliveryWay(ways.data) !== "none";
  const offer = !!rule.data && (applies.data === null || !!applies.data && ids.some((id) => applies.data!.has(id)));
  // fetchSellerItems reads at most 12 (live + reserved): a full page may hide more, so say "12+".
  const capped = (more.data?.length ?? 0) >= 12;
  if (!enabled || buyable.length === 0 || card.isLoading) return null;
  const firstName = card.data?.name?.trim() ? formatName(card.data.name).split(" ")[0] : "this seller";
  return { count: buyable.length, capped, firstName, free: item.current_price_cents === 0, pickup, offer: offer && rule.data ? bundleLabel(rule.data) : null };
}

/**
 * Owner mockup 11-01: the "more items" note folded into the seller card, one line: "12+ more items · check out
 * together, one pickup". The card opens the seller's profile, where every item is.
 */
export function BundleLine({ summary }: { summary: BundleSummary }) {
  const how = summary.free ? "get them together, one pickup" : summary.pickup ? "check out together, one pickup" : "check out together, one payment";
  return (
    <span data-bundle-line="" className="block text-xs font-semibold text-primary">
      {summary.count}{summary.capped ? "+" : ""} more {summary.count === 1 ? "item" : "items"} · {how}
      {summary.offer ? <span data-bundle-offer="">. {summary.offer}</span> : null}
    </span>
  );
}

export function DeclutterBundleRow({ item, viewerId }: { item: DeclutterItem; viewerId: string | null }) {
  const b = useBundleSummary(item, viewerId);
  if (!b) return null;
  return (
    <button
      type="button"
      data-bundle-row=""
      onClick={() => document.getElementById("declutter-more-from-seller")?.scrollIntoView({ behavior: "smooth", block: "start" })}
      className="flex w-full min-h-[48px] text-left items-center gap-3 rounded-[20px] border border-dashed border-border px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Layers className="h-5 w-5 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0">
        <span className="font-semibold">
          {b.count}{b.capped ? "+" : ""} more from {b.firstName}.
        </span>{" "}
        {b.free ? "Get them together: one pickup." : b.pickup ? "Check out together: one pickup, one payment." : "Check out together: one payment."}
        {b.offer ? <span className="font-semibold text-primary" data-bundle-offer=""> {b.offer}.</span> : null}
      </span>
    </button>
  );
}
