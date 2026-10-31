/**
 * Audit 2, A2-20 (2026-10-28, idea 3: keep a "Cancelled / Sold elsewhere / Deleted" history row in Selling): a sale
 * that ended without a handover left the seller no record. The buyer keeps one on Buying ("Ended"); the seller's
 * line ('missed' or 'cancelled_by_seller', from declutter_my_cart) showed nowhere on Selling. Now it is a row in
 * Selling history, saying what happened in plain words. declutter_close_paid_order sets a paid or claimed order's
 * lines to missed / cancelled_by_seller and the order to 'refunded'; an unpaid checkout that ran out or was called off
 * has no order. declutter_my_cart returns an ended line for 30 days.
 */
import { useQuery } from "@tanstack/react-query";
import { PackageX } from "lucide-react";
import { fetchMyCart, type CartLine } from "@/lib/declutter/api";
import { itemPriceLabel } from "@/lib/declutter/distance";

/** The seller's ended sales: the same read and key as the Selling counts, so this adds no request. */
export function useEndedSales(): CartLine[] {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  return (cart.data ?? []).filter((l) => l.my_side === "seller" && (l.status === "missed" || l.status === "cancelled_by_seller"));
}

/**
 * DC-18 + DB-19: the day an ended sale ended, put before its words ("Oct 29 · ..."), or nothing before the
 * closed_at column is deployed. Shared by the seller's rows here and the buyer's EndedLine (BuyingOrders).
 */
export function endedOnPrefix(closedAt: string | null | undefined): string {
  if (!closedAt) return "";
  const day = new Date(closedAt);
  if (Number.isNaN(day.getTime())) return "";
  return `${day.toLocaleDateString([], { month: "short", day: "numeric" }).replace(/ /g, "\u00a0")} · `;
}

/** What happened to an ended sale, from the seller's side. No amounts (the notices carry them); no fee words. */
function endedSaleWords(l: Pick<CartLine, "status" | "order_status" | "price_cents">): string {
  const free = l.price_cents === 0;
  // BUY-46 (audit 10-30): the line does not say WHY a paid order closed. declutter_close_paid_order sets 'missed' for
  // every close that is not the seller's fault (a buyer no-show, but also no Helpr in time) and 'cancelled_by_seller'
  // for the seller's (seller_no_show, not_as_described, seller_backed_out); a paid sale can't be called off by the
  // seller (declutter_seller_cancel_sale refuses). So the words name only what the status proves. Its own notice says
  // "Your item is back on sale" when the seller is not at fault.
  if (l.order_status === "refunded") {
    if (l.status === "missed") return free ? "Cancelled after it was claimed. Your item is back up." : "Cancelled after the buyer paid. They were refunded, and your item is back on sale.";
    return free ? "Cancelled on your side after it was claimed." : "Cancelled on your side after the buyer paid. They were refunded.";
  }
  if (l.status === "missed") return free ? "The buyer didn't pick a pickup in 48 hours." : "The buyer didn't check out in 48 hours. Nothing was charged.";
  return "You called off the sale. Nothing was charged.";
}

/** The rows, inside Selling history (DeclutterTakenDown's section). */
export function EndedSaleRows({ lines }: { lines: CartLine[] }) {
  return (
    <>
      {lines.map((l) => (
        <li key={l.line_id} className="flex items-center gap-3 px-4 py-3" data-ended-sale-row="">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground" aria-hidden>
            <PackageX className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-ds-15 font-semibold text-muted-foreground" title={l.item_title}>{l.item_title}</p>
            <p className="text-ds-13 text-muted-foreground">{endedOnPrefix(l.closed_at)}{endedSaleWords(l)}</p>
          </div>
          <span className="shrink-0 text-ds-15 font-bold tabular-nums text-muted-foreground">{itemPriceLabel(l.price_cents)}</span>
        </li>
      ))}
    </>
  );
}
