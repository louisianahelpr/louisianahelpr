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
  porch: "The seller leaves it on their porch or another safe place, no need to meet. Address after you pay.",
  pickup_home: "Pick it up at the seller's door. Address after you pay.",
  seller_delivery: "The seller brings it to you at a time you pick.",
  delivery: "A local Helpr picks it up and brings it to you. Best for big items.",
  // A3-52: a seller's own spot is not checked; only the police safe exchange spots are.
  meetup: "Meet at a public place: the seller's own spot, or a police safe exchange spot Louisiana Helpr checked. No home address is shared.",
};
// BUY-14 (Declutter buying audit 10-30): the porch choice is "Porch pickup" here, as on the item page and in every
// notice; its line says the seller may use another safe place. "Porch or safe place" used to be its title while seller
// delivery was open. Guard: declutterTradeViews.test.tsx "seller delivery (20261027153244)".
