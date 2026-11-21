import { giftGuides as G } from "@/content/giftGuides";
import type { CatalogPick } from "@/content/giftGuideCatalog";

/**
 * Prices on gift-guide picks (owner 11-18): "~$24" beside Shop on a pick with a checked price, and one "Prices as of
 * Nov 18, may change" note per list. AMAZON TOO since owner 2026-11-21 ~12:05 PM ("each item also needs a price"):
 * warned in a pop-up that Amazon allows prices only from its PA-API feed and that showing them risks the Associates
 * account, she chose "Show Amazon prices anyway". An Amazon pick's price is the one captured from her own saved list.
 * A price older than PRICE_MAX_AGE_DAYS on the day the page opens is hidden, so a file nobody re-imported never shows
 * an old price. Guard: src/test/giftGuidePrices.test.tsx.
 */
const PRICE_MAX_AGE_DAYS = 3;
const todayInLouisiana = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
const dayNumber = (ymd: string) => Date.parse(`${ymd}T12:00:00Z`) / 86400000;

/** Whether a pick shows its price today. */
export const showsPrice = (pick: CatalogPick, today: string = todayInLouisiana()): boolean => {
  if (!pick.price || !(pick.price > 0) || !pick.priceAt || !/^\d{4}-\d{2}-\d{2}$/.test(pick.priceAt)) return false;
  const age = dayNumber(today) - dayNumber(pick.priceAt);
  return age >= 0 && age <= PRICE_MAX_AGE_DAYS;
};

/** "~$24" (rounded to the dollar, at least $1), or nothing. */
export function PickPrice({ pick }: { pick: CatalogPick }) {
  if (!showsPrice(pick)) return null;
  return <span className="gg-price" data-gift-price="">{G.priceApprox(Math.max(1, Math.round(pick.price ?? 0)))}</span>;
}

/** The list's one price note (the oldest check day among the shown prices), or nothing when no row shows a price. */
export function PricesAsOf({ picks }: { picks: CatalogPick[] }) {
  const today = todayInLouisiana();
  const days = picks.filter((p) => showsPrice(p, today)).map((p) => p.priceAt as string).sort();
  if (days.length === 0) return null;
  const day = new Date(`${days[0]}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return <p className="gg-price-note" data-gift-prices-as-of="">{G.pricesAsOf(day)}</p>;
}
