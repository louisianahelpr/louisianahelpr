/**
 * Whether the Holiday gift guides promo (GiftGuidesPromo.tsx) shows at all: not once closed on this device, and not
 * after Dec 25. Its own tiny module so Home can ask it at first paint and hold the strip's slot while the promo's
 * own chunk loads (owner 11-21: the strip sits at the top of Home, so its late arrival must move nothing).
 * Guard: src/test/giftGuidesPromo.test.tsx.
 */
export const GIFT_PROMO_KEY = "lh-gift-guides-promo-closed";
/** The last day the banner shows (YYYY-MM-DD, local). */
const GIFT_PROMO_LAST_DAY = "2026-12-25";

const todayIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function giftPromoClosedBefore(): boolean {
  try {
    return window.localStorage.getItem(GIFT_PROMO_KEY) === "1";
  } catch {
    return false; // storage blocked (private window): the banner shows; closing still hides it for this visit
  }
}

/** Past the last day: the promo draws nothing. */
export function giftPromoOver(now: Date): boolean {
  return todayIso(now) > GIFT_PROMO_LAST_DAY;
}

export function giftPromoShows(now = new Date()): boolean {
  return !giftPromoClosedBefore() && !giftPromoOver(now);
}
