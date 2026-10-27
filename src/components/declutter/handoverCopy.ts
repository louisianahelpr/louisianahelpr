/**
 * The checkout's handover choices, in the buyer's words (title and one line each). Kept apart from
 * DeclutterTradeViews (the component-size ratchet, 600 lines).
 */
import type { Handover } from "@/lib/declutter/api";

export const HANDOVER_TITLE: Record<Handover, string> = {
  porch: "Porch pickup",
  pickup_home: "Meet at the seller's home",
  seller_delivery: "Seller delivers",
  delivery: "Helpr delivery",
  meetup: "Meet at a safe spot",
};
export const HANDOVER_WORDS: Record<Handover, string> = {
  porch: "The seller leaves it out for you, no need to meet. Address after you pay.",
  pickup_home: "Pick it up at the seller's door. Address after you pay.",
  seller_delivery: "The seller brings it to you at a time you pick.",
  delivery: "A local Helpr picks it up and brings it to you. Best for big items.",
  meetup: "Meet at a public place Louisiana Helpr checked, like a police safe exchange spot. No address is shared.",
};
/** With seller delivery open, the porch choice says what it is: porch or another safe place (the spec's wording). */
export const PORCH_OR_SAFE_PLACE = "Porch or safe place";
