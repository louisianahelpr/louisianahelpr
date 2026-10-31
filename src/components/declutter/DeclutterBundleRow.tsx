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

export function DeclutterBundleRow({ item, viewerId }: { item: DeclutterItem; viewerId: string | null }) {
  // Same keys as DeclutterItemRows / DeclutterSellerCard: one read each, shared.
  const more = useQuery({
    queryKey: ["declutter", "more-from-seller", item.seller_id, item.id],
    queryFn: () => fetchSellerItems(item.seller_id, item.id),
  });
  const card = useQuery({ queryKey: ["declutter", "seller-card", item.seller_id], queryFn: () => fetchSellerCard(item.seller_id) });
  // Q2427 (20261027211754): the seller's "Buy 2+, get N% off", when they set one. A failed read says nothing extra.
  const rule = useQuery({ queryKey: ["declutter", "bundle-rule", item.seller_id], queryFn: () => fetchBundleRule(item.seller_id) });
  const buyable = (more.data ?? []).filter((r) => r.status === "live" && r.seller_id !== viewerId);
  // Deep audit #36: say "Buy 2+, get N% off" only when the discount can apply to one of these items (above its
  // lowest price, checkout's own bound); asked only once a rule exists. Null = not deployed yet: shown as before.
  const ids = [item.id, ...buyable.map((r) => r.id)];
  const applies = useQuery({
    queryKey: ["declutter", "bundle-applies", ids.join(",")],
    queryFn: () => fetchBundleApplies(ids),
    enabled: !!rule.data && buyable.length > 0,
  });
  // Audit BUY-3: an item the seller offers only delivered has no pickup to share (the same key as the item page's ways).
  const ways = useQuery({ queryKey: ["declutter", "item-handovers", item.id], queryFn: () => fetchItemHandovers(item.id) });
  const pickup = noDeliveryWay(ways.data) !== "none";
  const offer = !!rule.data && (applies.data === null || !!applies.data && ids.some((id) => applies.data!.has(id)));
  // fetchSellerItems reads at most 12 (live + reserved): a full page may hide more, so say "12+".
  const capped = (more.data?.length ?? 0) >= 12;
  if (buyable.length === 0 || card.isLoading) return null;
  const name = card.data?.name?.trim() ? formatName(card.data.name).split(" ")[0] : "this seller";
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
          {buyable.length}{capped ? "+" : ""} more from {name}.
        </span>{" "}
        {item.current_price_cents === 0 ? "Get them together: one pickup." : pickup ? "Check out together: one pickup, one payment." : "Check out together: one payment."}
        {offer && rule.data ? <span className="font-semibold text-primary" data-bundle-offer=""> {bundleLabel(rule.data)}.</span> : null}
      </span>
    </button>
  );
}
