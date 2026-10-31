/**
 * LEAD-DOOR-PAYLINE: the seller's one payout rule per handover kind, said once on the sale card (the money note) and
 * reused by the Helpr-delivery and seller-delivery lines. From OWNER-DECISIONS "Declutter handover money" (10-30):
 * the buyer's "I got it" alone finishes the order and pays the seller; the seller confirms and the buyer is silent:
 * 48 hours, then the seller is paid; nobody says anything: the money is held (no auto-pay).
 * The live server it describes (read 10-31):
 *   - declutter_sale_final / declutter_payouts_due (20261026155251): paid 24 hours after the handover, unless the
 *     buyer asks for a refund (board 141's refund window).
 *   - declutter_handover_sweep (20261031004529): door and meeting spot finish 24 hours after the seller's "Picked up"
 *     (never without it); porch 24 hours after the later of the pickup time and the porch photo (never without the
 *     photo); seller delivery 24 hours after "Delivered" (auto_confirm_hours 24).
 *   - helpr_task_sweep (20261031014011): a Helpr delivery confirms itself 24 hours after the drop-off.
 * So the seller's own step plus the buyer's silence is about 48 hours, and "I got it" is 24 hours.
 */
export type SellerPayoutKind = "pickup_home" | "meetup" | "porch" | "seller_delivery" | "delivery";

const AFTER_GOT_IT = "You're paid 24 hours after the buyer taps \"I got it\", unless they ask for a refund.";

export function sellerPayoutRule(kind: SellerPayoutKind): string {
  switch (kind) {
    case "pickup_home":
    case "meetup":
      return `${AFTER_GOT_IT} If you tap "Picked up" and the buyer says nothing, you're paid about 48 hours later. If neither of you says anything, the money stays held.`;
    case "porch":
      return "You're paid 24 hours after the buyer taps \"I got it\" or takes their pickup photo, unless they ask for a refund. If the buyer says nothing, you're paid about 48 hours after the later of the pickup time and your porch photo. With no porch photo, the money stays held until the buyer confirms.";
    case "seller_delivery":
      return `${AFTER_GOT_IT} If you mark it delivered and the buyer says nothing, you're paid about 48 hours later.`;
    case "delivery":
      return `${AFTER_GOT_IT} If the Helpr leaves it and the buyer says nothing, you're paid about 48 hours after the drop-off.`;
  }
}
