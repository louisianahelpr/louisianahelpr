/**
 * Owner 2026-10-28: the seller ticks the ways buyers can get each item (declutter_items.handovers, migration
 * 20261028235247). A checkout groups the lines from one seller, so it may offer only the ways EVERY item allows;
 * the server refuses any other (declutter_start_checkout / declutter_checkout_free: handover_not_offered).
 */
import type { CartLine, Handover } from "./api";

/**
 * The ways every line allows; null when no line recorded any (older items: every way, as before). An EMPTY list when
 * the lines share none: there is no fallback to the seller's door (owner 2026-10-28, Q2462 #3730), so checkout offers
 * nothing and the buyer and seller talk it through (DeclutterHandoverTalk, 20261028235249).
 */
export function waysEveryLineAllows(lines: Pick<CartLine, "handovers" | "porch_ok">[]): Handover[] | null {
  if (!lines.some((l) => Array.isArray(l.handovers))) return null;
  // An older line (no ticks) allows every way, but not porch when its porch is off (as declutter_handover_refused).
  const ALL_BUT_PORCH: Handover[] = ["pickup_home", "seller_delivery", "meetup", "delivery"];
  const sets = lines
    .map((l) => (Array.isArray(l.handovers) ? l.handovers : l.porch_ok === false ? ALL_BUT_PORCH : null))
    .filter((h): h is Handover[] => Array.isArray(h));
  return sets.reduce((acc, s) => acc.filter((w) => s.includes(w)));
}

/** Whether a way may be offered under that rule. */
export function wayAllowed(ways: Handover[] | null, way: Handover): boolean {
  return ways === null || ways.includes(way);
}
