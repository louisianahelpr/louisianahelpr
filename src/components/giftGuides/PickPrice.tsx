import { giftGuides as G } from "@/content/giftGuides";
import type { CatalogPick } from "@/content/giftGuideCatalog";
import { pickPriceShown, shownDollars } from "@/lib/pickPriceShown.mjs";

/**
 * Prices on gift-guide picks (owner 11-18): "~$24" beside Shop on a pick with a checked price, and one "Prices as of
 * Nov 18, may change" note per list. AMAZON TOO since owner 2026-11-21 ~12:05 PM ("each item also needs a price"):
 * warned in a pop-up that Amazon allows prices only from its PA-API feed and that showing them risks the Associates
 * account, she chose "Show Amazon prices anyway". An Amazon pick's price is the one captured from her own saved list.
 * A price older than PRICE_MAX_AGE_DAYS on the day the page opens is hidden, so a file nobody re-imported never shows
 * an old price. The rule (and the rounding) lives in src/lib/pickPriceShown.mjs, shared with the guide's JSON-LD.
 * Guard: src/test/giftGuidePrices.test.tsx.
 */
const todayInLouisiana = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());

/** Whether a pick shows its price today. */
export const showsPrice = (pick: CatalogPick, today: string = todayInLouisiana()): boolean => pickPriceShown(pick.price, pick.priceAt, today);

/** "~$24" (rounded to the dollar, at least $1), or nothing. */
export function PickPrice({ pick }: { pick: CatalogPick }) {
  if (!showsPrice(pick)) return null;
  return <span className="gg-price" data-gift-price="">{G.priceApprox(shownDollars(pick.price))}</span>;
}

/** The list's one price note (the oldest check day among the shown prices), or nothing when no row shows a price. */
export function PricesAsOf({ picks }: { picks: CatalogPick[] }) {
  const today = todayInLouisiana();
  const days = picks.filter((p) => showsPrice(p, today)).map((p) => p.priceAt as string).sort();
  if (days.length === 0) return null;
  const day = new Date(`${days[0]}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return <p className="gg-price-note" data-gift-prices-as-of="">{G.pricesAsOf(day)}</p>;
}
