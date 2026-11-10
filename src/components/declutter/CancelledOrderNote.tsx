/**
 * Audit 11-10 F377 (High) / F393: a paid order refunded before the handover (declutter_orders.status 'refunded') fell
 * into the pickup branch of the order card, which loaded the pickup address and the seller's times for a sale that
 * no longer exists: two "We couldn't load…" panels, a "Pick a pickup time" heading and a live "Book" button. The card
 * now says plainly that it ended, and loads nothing about a pickup. The amount refunded is on the buyer's head line
 * (BuyingOrders refundedStep, from declutter_my_refunded_cents).
 *
 * F393, the seller's side: the card said nothing about the listing. It now reads the seller's own listings (the
 * Selling tab's one read, myItemsQuery) and says where each item of the order stands: back up for sale (the refund
 * put it back to 'live'), or taken down (status 'withdrawn') with Relist, the same button as Selling history
 * (ReopenListingButton: back to a draft, then the sell flow). The card does NOT say who cancelled: declutter_orders
 * records close_reason 'refunded' for every refund, so nothing the client reads proves "the buyer cancelled".
 */
import { useQuery } from "@tanstack/react-query";
import type { DeclutterItem } from "@/lib/declutter/api";
import { myItemsQuery } from "./myItemsQuery";
import { ReopenListingButton } from "./DeclutterReopenListing";

const SELLER_NOTE = "This sale was cancelled before the handover and the buyer was refunded, so there's no payout for it.";

/** What the seller's card adds about the order's listings, from their statuses (null: nothing to say yet). */
export function cancelledListingWords(items: readonly Pick<DeclutterItem, "status">[]): string | null {
  if (items.length === 0) return null;
  const live = items.filter((i) => i.status === "live").length;
  const down = items.filter((i) => i.status === "withdrawn").length;
  const parts: string[] = [];
  if (live > 0) parts.push(live === 1 && items.length === 1 ? "Your listing is back up for sale." : `${live} of your listings ${live === 1 ? "is" : "are"} back up for sale.`);
  if (down > 0) parts.push(down === 1 && items.length === 1 ? "Your listing is taken down; buyers can't see it." : `${down} of your listings ${down === 1 ? "is" : "are"} taken down; buyers can't see ${down === 1 ? "it" : "them"}.`);
  return parts.length > 0 ? parts.join(" ") : null;
}

export function CancelledOrderNote({ side, userId = "", itemIds = [] }: { side: "buyer" | "seller"; userId?: string; itemIds?: readonly (string | null)[] }) {
  const ids = itemIds.filter((id): id is string => !!id);
  const mine = useQuery({ ...myItemsQuery(userId), enabled: side === "seller" && !!userId && ids.length > 0 });
  if (side === "buyer") {
    return <p className="text-sm text-muted-foreground" data-cancelled-order="">This order was cancelled and refunded to your card, so there's nothing to pick up.</p>;
  }
  const items = (mine.data ?? []).filter((i) => ids.includes(i.id));
  const listing = cancelledListingWords(items);
  const down = items.filter((i) => i.status === "withdrawn");
  return (
    <div className="space-y-2" data-cancelled-order="">
      <p className="text-sm text-muted-foreground">{SELLER_NOTE}{listing ? ` ${listing}` : ""}</p>
      {down.length > 0 && (
        <div className="flex flex-wrap gap-2" data-cancelled-relist="">
          {down.map((i) => <ReopenListingButton key={i.id} itemId={i.id} quiet />)}
        </div>
      )}
    </div>
  );
}
