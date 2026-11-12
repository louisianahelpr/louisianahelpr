/**
 * Audit 1030 DB-4: the buyer's no-delivery total said "with pickup" (item page Buy now "Total with pickup", the offer
 * line "At most, with pickup", "for pickup" after an offer, the counter's "You pay with pickup") on items whose
 * seller offers no pickup at all, so checkout then had none. The words now follow the ways the seller ticked
 * (declutter_items.handovers, 20261028235247; there is no fallback to the seller's door, owner 2026-10-28).
 *
 * `ways` null = an older item with no ticks (every way, the door included, as before): "pickup".
 */
import type { SellerHandover } from "./api";
import "@/lib/i18n/enDeclutter";
import { t } from "@/lib/i18n/language";

export type NoDeliveryWay = "pickup" | "porch" | "meetup" | "none";

/** Which no-delivery way the item's plain total is for (the BuyerTotal amount: item + fee, nothing for delivery). */
export function noDeliveryWay(ways: SellerHandover[] | null | undefined): NoDeliveryWay {
  // An older item (no ticks) is picked up at the porch or the door either way: "pickup" is true.
  if (!Array.isArray(ways)) return "pickup";
  if (ways.includes("porch")) return "porch";
  if (ways.includes("meetup")) return "meetup";
  return "none";
}

/** "with porch pickup" / "at a safe meetup" / "with pickup"; "before delivery" when every way is a delivery. */
export function totalPhrase(way: NoDeliveryWay): string {
  return t(way === "porch" ? "decl.total.porch" : way === "meetup" ? "decl.total.meetup" : way === "none" ? "decl.total.none" : "decl.total.pickup");
}

/** "for porch pickup" / "for a safe meetup" / "for pickup"; "before delivery" when every way is a delivery. */
export function forPhrase(way: NoDeliveryWay): string {
  return t(way === "porch" ? "decl.for.porch" : way === "meetup" ? "decl.for.meetup" : way === "none" ? "decl.for.none" : "decl.for.pickup");
}
