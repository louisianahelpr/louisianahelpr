/**
 * The top of a Declutter order card (board 47 / 26): the title, the money in ink, ONE line on how it's coming; no
 * "You're buying" (lead 2026-10-28). Lead 11-08: an order from a trade says "Trade" where the money goes, drops the
 * "You're giving / selling" words, and names what the viewer gets ("Your trade: <item>"): the other side's listing on a
 * buyer's card, the item offered for theirs on a seller's card (from the trade read; nothing when it hasn't answered).
 * Moved out of DeclutterHandoverViews.tsx (component size limit).
 * Audit 11-10 F372: the order's first item photo sits at the left, like a cart line (BUY-15 CartThumb), so a list of
 * orders scans by picture, not only by title. The order read carries it (declutter_my_cart.photo_path, 20261112054500),
 * so no extra request. A grey square while it loads, when there is none (or before that deploy), or when it fails.
 */
import { useState } from "react";
import { itemPriceLabel } from "@/lib/declutter/distance";
import { photoPublicUrl } from "@/lib/declutter/api";
import { squarePhotoUrl, THUMB_PHOTO_PX } from "@/lib/declutter/photoSizes";
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

/** F372: the order's item photo; the 160 px square first (B77), the original if that fails, then grey. */
function OrderThumb({ path }: { path?: string }) {
  const [stage, setStage] = useState<"thumb" | "full" | "failed">("thumb");
  return (
    <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted" data-order-thumb="" aria-hidden="true">
      {path && stage !== "failed" && <img loading="lazy" src={stage === "thumb" ? squarePhotoUrl(photoPublicUrl(path), THUMB_PHOTO_PX) ?? photoPublicUrl(path) : photoPublicUrl(path)} width={THUMB_PHOTO_PX} height={THUMB_PHOTO_PX} alt="" decoding="async" onError={() => setStage((s) => (s === "thumb" ? "full" : "failed"))} className="h-full w-full object-cover" />}
    </span>
  );
}

export function OrderCardHead({ order, userId }: { order: PaidOrder; userId: string }) {
  const title = order.lines.map((l) => l.item_title).join(", ");
  const items = order.lines.reduce((sum, l) => sum + l.price_cents, 0);
  const trade = isTradeOrder(order);
  const tradedFor = useTradedFor(trade ? userId : null);
  const tradeGets = !trade ? null : order.side === "buyer" ? title : tradedFor.get(order.lines[0]?.item_id ?? "") ?? null;
  return (
    <div className="flex items-start justify-between gap-3 min-w-0" data-order-head="">
      <OrderThumb path={order.lines.find((l) => l.photo_path)?.photo_path ?? undefined} />
      <div className="min-w-0 flex-1">
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
