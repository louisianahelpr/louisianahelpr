/**
 * An offer card's two "are you sure" sheets (Buying / Selling -> offers): Accept (lead 2026-10-28, never
 * window.confirm) and Say no (audit 1d D4-9, 2026-10-29: it ended the offer at one tap). Kept apart from
 * DeclutterTradeViews so that file stays under the component-size line (componentSizeRatchet).
 */
import type { MyOffer } from "@/lib/declutter/api";
import { formatPrice } from "@/lib/declutter/distance";
import { ConfirmSheet } from "./DeclutterConfirmSheet";

export function OfferConfirmSheets({ o, accepting, declining, pending, answer, closeAccept, closeDecline }: {
  o: Pick<MyOffer, "my_side" | "amount_cents" | "item_title">;
  accepting: boolean;
  declining: boolean;
  pending: boolean;
  answer: (action: "accept" | "decline") => void;
  closeAccept: () => void;
  closeDecline: () => void;
}) {
  return (
    <>
      <ConfirmSheet open={accepting} pending={pending} onConfirm={() => answer("accept")} onClose={closeAccept}
        title={o.my_side === "seller" ? `Sell it for ${formatPrice(o.amount_cents)}?` : `Buy it for ${formatPrice(o.amount_cents)}?`}
        confirmLabel="Accept" testId="accept-offer">
        {o.my_side === "seller"
          ? `"${o.item_title}": every other offer on it closes, and the buyer gets 48 hours to pay.`
          : `"${o.item_title}": you'll have 48 hours to check out and pay. Nothing is charged until you do.`}
      </ConfirmSheet>
      <ConfirmSheet open={declining} pending={pending} onConfirm={() => answer("decline")} onClose={closeDecline}
        title={`Say no to ${formatPrice(o.amount_cents)}?`} confirmLabel="Say no" testId="decline-offer">
        {o.my_side === "seller"
          ? `"${o.item_title}": this offer ends, and the buyer is told you said no.`
          : `"${o.item_title}": this counter ends. Nothing is charged.`}
      </ConfirmSheet>
    </>
  );
}
