/**
 * Board 4's "2 more from Marie. One pickup, one fee." row on a Declutter item.
 * True because checkout is per seller: declutter_start_checkout(p_seller_id)
 * puts every line in the buyer's cart from that seller into ONE order with ONE
 * handover and charges declutter_buyer_fee_cents(items total) once (5% of the
 * items + 70¢; measured live with pg_get_functiondef, 2026-10-20). Shown only
 * when the seller has other items that can still be bought (status live), and
 * never for the member's own items. Tapping it jumps to "More from this seller".
 */
import { useQuery } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import { fetchSellerCard, fetchSellerItems, type DeclutterItem } from "@/lib/declutter/api";
import { formatName } from "@/lib/utils";

export function DeclutterBundleRow({ item, viewerId }: { item: DeclutterItem; viewerId: string | null }) {
  // Same keys as DeclutterItemRows / DeclutterSellerCard: one read each, shared.
  const more = useQuery({
    queryKey: ["declutter", "more-from-seller", item.seller_id, item.id],
    queryFn: () => fetchSellerItems(item.seller_id, item.id),
  });
  const card = useQuery({ queryKey: ["declutter", "seller-card", item.seller_id], queryFn: () => fetchSellerCard(item.seller_id) });
  const buyable = (more.data ?? []).filter((r) => r.status === "live" && r.seller_id !== viewerId);
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
          {buyable.length} more from {name}.
        </span>{" "}
        One pickup, one fee.
      </span>
    </button>
  );
}
