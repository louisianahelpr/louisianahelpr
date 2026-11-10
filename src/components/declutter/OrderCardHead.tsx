/**
 * The top of a Declutter order card (board 47 / 26): the title, the money in ink, ONE line on how it's coming; no
 * "You're buying" (lead 2026-10-28). Lead 11-08: an order from a trade says "Trade" where the money goes, drops the
 * "You're giving / selling" words, and names what the viewer gets ("Your trade: <item>"): the other side's listing on a
 * buyer's card, the item offered for theirs on a seller's card (from the trade read; nothing when it hasn't answered).
 * Moved out of DeclutterHandoverViews.tsx (component size limit).
 */
import { itemPriceLabel } from "@/lib/declutter/distance";
import { isTradeOrder, type PaidOrder } from "./paidOrders";
import { useTradedFor } from "./useMyTrades";

function howItComes(order: Pick<PaidOrder, "handover" | "side">): string {
  switch (order.handover) {
    case "ship": return order.side === "buyer" ? "Shipped to you" : "You ship it";
    case "porch": return "Porch pickup";
    case "delivery": return "Helpr delivery";
    case "seller_delivery": return "Seller delivers";
    case "meetup": return "Meet at a safe spot";
    default: return "Pickup at the seller's home";
  }
}

export function OrderCardHead({ order, userId }: { order: PaidOrder; userId: string }) {
  const title = order.lines.map((l) => l.item_title).join(", ");
  const items = order.lines.reduce((sum, l) => sum + l.price_cents, 0);
  const trade = isTradeOrder(order);
  const tradedFor = useTradedFor(trade ? userId : null);
  const tradeGets = !trade ? null : order.side === "buyer" ? title : tradedFor.get(order.lines[0]?.item_id ?? "") ?? null;
  return (
    <div className="flex items-start justify-between gap-3 min-w-0" data-order-head="">
      <div className="min-w-0">
        {/* Audit 1110 F408: an order title wraps to two lines (break-words) instead of an ellipsis at 375 / Bigger text. */}
        <p className="line-clamp-2 break-words text-ds-15 font-semibold leading-snug" title={title}>{title}</p>
        <p className="text-ds-13 text-muted-foreground">
          {howItComes(order)}{trade ? "" : order.side === "seller" ? (items === 0 ? " · You're giving" : " · You're selling") : ""}
        </p>
        {tradeGets && <p data-order-trade="" className="truncate text-ds-13 font-semibold text-foreground" title={tradeGets}>Your trade: {tradeGets}</p>}
      </div>
      <span className="shrink-0 text-ds-15 font-bold tabular-nums text-[hsl(var(--accent-ink))]">{trade ? "Trade" : itemPriceLabel(items)}</span>
    </div>
  );
}
