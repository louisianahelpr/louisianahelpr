/**
 * The words of one Shops order's handover (shops audit 11-08 #3 and #14). A service or work at the buyer's place is
 * "done", never "handed over" or "picked up": the server freezes such an order to the in-person step (no ready photo,
 * no porch photo rule; 20261108200421_shops_services_in_person.sql), so its completion is the shop's "Mark complete", then
 * the buyer's "It's done" or the 48-hour auto-confirm.
 */
import type { ShopOrder } from "./orders";

/** A service or at-home order: done by the shop, never handed over. Rentals keep the goods words (they are handed over). */
export function isServiceOrder(order: Pick<ShopOrder, "shop_order_lines">): boolean {
  return order.shop_order_lines.some((l) => l.kind === "service" || !!l.at_buyer);
}

/** How the order reaches the buyer, in one short line (#14: never "Pick up in person" on a delivery). */
export function handoverIntro(order: Pick<ShopOrder, "shop_order_lines" | "handover_mode" | "fulfillment" | "helpr_unfilled_at">): string {
  if (isServiceOrder(order)) return "The shop marks it done when the work is finished.";
  if (order.fulfillment === "shop_delivers") return "The shop delivers.";
  if (order.fulfillment === "helpr_delivers" && !order.helpr_unfilled_at) return "A Helpr delivers.";
  return order.handover_mode === "porch" ? "Left out for pickup." : "Pick up in person.";
}

/**
 * S055 (Shops audit 11-12): the buyer's safety net differs by handover, so the order says which one applies. Left out:
 * no ready photo by 3 days after the ready day refunds the card in full on its own (shop_refund_sweep,
 * 'no_ready_photo', full_shop_pays_fee). In person: nothing pays on its own; the money stays held until "I got it" or
 * the shop's "Handed over". Pickup goods only (a delivery or a service has its own words), and only before the step
 * it describes has happened. null: nothing to add.
 */
export function buyerHandoverSafety(
  order: Pick<ShopOrder, "shop_order_lines" | "handover_mode" | "fulfillment" | "helpr_unfilled_at">,
  h: { ready_photo_path: string | null; shop_confirmed_at?: string | null } | null,
): string | null {
  if (isServiceOrder(order)) return null;
  const pickup = order.fulfillment !== "shop_delivers" && !(order.fulfillment === "helpr_delivers" && !order.helpr_unfilled_at);
  if (!pickup) return null;
  if (order.handover_mode === "porch") {
    return h?.ready_photo_path ? null
      : "If the shop hasn't posted its ready photo 3 days after the ready day, your card is refunded in full.";
  }
  return h?.shop_confirmed_at ? null
    : "The shop is paid only after you tap \"I got it\" or the shop marks it handed over, so the money stays held if the pickup doesn't happen.";
}

export interface HandoverWords {
  shopDone: string;
  shopDoneToast: string;
  shopDoneBody: string;
  shopMarkedWait: string;
  shopOpenWait: string;
  buyerShopSaysDone: string;
  buyerGotIt: string;
  buyerGotItBody: string;
  buyerProblem: string;
  buyerProblemPlaceholder: string;
}

const GOODS: HandoverWords = {
  shopDone: "Handed over",
  shopDoneToast: "Marked handed over. The buyer has 48 hours to report a problem.",
  shopDoneBody: "Only tap this once the buyer has the order. They have 48 hours to report a problem; then you're paid.",
  shopMarkedWait: "You marked it handed over. You're paid 48 hours after that unless the buyer reports a problem.",
  shopOpenWait: "The buyer taps \"I got it\", or you tap \"Handed over\" once they have it. Until one of you does, the money stays held.",
  buyerShopSaysDone: " The shop says you have it. If you didn't get it, tell us within 48 hours.",
  buyerGotIt: "I got it",
  buyerGotItBody: "The shop is paid now and the order is final. Only tap this once you have it.",
  buyerProblem: "I didn't get it",
  buyerProblemPlaceholder: "Nobody was there at pickup",
};

const SERVICE: HandoverWords = {
  shopDone: "Mark complete",
  shopDoneToast: "Marked done. The buyer has 48 hours to report a problem.",
  shopDoneBody: "Only tap this once the work is finished. The buyer has 48 hours to report a problem; then you're paid.",
  shopMarkedWait: "You marked it done. You're paid 48 hours after that unless the buyer reports a problem.",
  shopOpenWait: "Tap \"Mark complete\" when the work is finished. The buyer confirms, or it confirms itself 48 hours after your tap unless they report a problem.",
  buyerShopSaysDone: " The shop says the work is done. If something's wrong, tell us within 48 hours.",
  buyerGotIt: "It's done",
  buyerGotItBody: "The shop is paid now and the order is final. Only tap this once the work is finished.",
  buyerProblem: "Something's wrong",
  buyerProblemPlaceholder: "The work wasn't done",
};

export function handoverWords(order: Pick<ShopOrder, "shop_order_lines">): HandoverWords {
  return isServiceOrder(order) ? SERVICE : GOODS;
}
