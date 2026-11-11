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

/**
 * How the order reaches the buyer, in one short line (#14: never "Pick up in person" on a delivery), in the words of
 * the side reading it (Q2154 screenshot pass 11-10: the shop read "The shop marks it done ..." and "The shop
 * delivers." about itself). A service's shop side has no intro: its wait line already says "Tap Mark complete ...".
 */
export function handoverIntro(order: Pick<ShopOrder, "shop_order_lines" | "handover_mode" | "fulfillment" | "helpr_unfilled_at">, side: "buyer" | "shop"): string {
  const shop = side === "shop";
  if (isServiceOrder(order)) return shop ? "" : "The shop marks it done when the work is finished.";
  if (order.fulfillment === "shop_delivers") return shop ? "You deliver it." : "The shop delivers.";
  if (order.fulfillment === "helpr_delivers" && !order.helpr_unfilled_at) return "A Helpr delivers.";
  if (order.handover_mode === "porch") return shop ? "You leave it out for pickup." : "Left out for pickup.";
  return shop ? "The buyer picks it up from you." : "Pick up in person.";
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
