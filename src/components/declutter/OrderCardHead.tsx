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
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { itemPriceLabel } from "@/lib/declutter/distance";
import { photoPublicUrl } from "@/lib/declutter/api";
import { squarePhotoUrl, THUMB_PHOTO_PX } from "@/lib/declutter/photoSizes";
import { isTradeOrder, type PaidOrder } from "./paidOrders";
import { useTradedFor } from "./useMyTrades";
import { t, useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enDeclPanels";
import "@/lib/i18n/enDeclSell";

function howItComes(order: Pick<PaidOrder, "handover" | "side">): string {
  switch (order.handover) {
    case "ship": return order.side === "buyer" ? t("dbuy.how.shippedToYou") : t("dbuy.how.youShip");
    case "porch": return t("ho.title.porch");
    case "delivery": return t("ho.title.delivery");
    case "seller_delivery": return t("ho.title.seller_delivery");
    case "meetup": return t("dbuy.how.meetup");
    default: return t("dbuy.how.home");
  }
}

/** F372: the order's item photo; the 160 px square first (B77), the original if that fails, then grey. */
function OrderThumb({ path }: { path?: string }) {
  const [stage, setStage] = useState<"thumb" | "full" | "failed">("thumb");
  return (
    <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-photo-empty" data-order-thumb="" aria-hidden="true">
      {/* Area 06 L3 (11-18): no photo was a blank grey square; the same icon placeholder as the listing rows. */}
      {(!path || stage === "failed") && <PhotoPlaceholder icon={categoryIcon(null)} seed="order" className="absolute inset-0 h-full w-full" iconClassName="h-5 w-5" />}
      {path && stage !== "failed" && <img loading="lazy" src={stage === "thumb" ? squarePhotoUrl(photoPublicUrl(path), THUMB_PHOTO_PX) ?? photoPublicUrl(path) : photoPublicUrl(path)} width={THUMB_PHOTO_PX} height={THUMB_PHOTO_PX} alt="" decoding="async" onError={() => setStage((s) => (s === "thumb" ? "full" : "failed"))} className="h-full w-full object-cover" />}
    </span>
  );
}

export function OrderCardHead({ order, userId }: { order: PaidOrder; userId: string }) {
  useLanguage();
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
          {howItComes(order)}{trade ? "" : order.side === "seller" && items === 0 ? t("dsl.giving") : ""}
        </p>
        {tradeGets && <p data-order-trade="" className="break-words text-ds-13 font-semibold text-foreground" title={tradeGets}>{t("dsl.yourTrade", { title: tradeGets })}</p>}
      </div>
      <span className="shrink-0 text-ds-15 font-bold tabular-nums text-[hsl(var(--accent-ink))]">{trade ? t("dsl.trade") : itemPriceLabel(items)}</span>
    </div>
  );
}
