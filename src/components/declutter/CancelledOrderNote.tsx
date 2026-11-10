/**
 * Audit 11-10 F377 (High) / F393: a paid order refunded before the handover (declutter_orders.status 'refunded') fell
 * into the pickup branch of the order card, which loaded the pickup address and the seller's times for a sale that
 * no longer exists: two "We couldn't load…" panels, a "Pick a pickup time" heading and a live "Book" button. The card
 * now says plainly that it ended, and loads nothing about a pickup. The amount refunded is on the buyer's head line
 * (BuyingOrders refundedStep, from declutter_my_refunded_cents).
 */
export function CancelledOrderNote({ side }: { side: "buyer" | "seller" }) {
  return (
    <p className="text-sm text-muted-foreground" data-cancelled-order="">
      {side === "buyer"
        ? "This order was cancelled and refunded to your card, so there's nothing to pick up."
        : "This sale was cancelled before the handover and the buyer was refunded, so there's no payout for it."}
    </p>
  );
}
