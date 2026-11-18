import { giftGuides as G } from "@/content/giftGuides";
import type { CatalogPick } from "@/content/giftGuideCatalog";

/**
 * Prices on gift-guide picks (owner 11-18): "~$24" beside Shop on a NON-Amazon pick with a price fill_prices.py
 * checked, and one "Prices as of Nov 18, may change" note per list. Amazon picks NEVER show a price (Associates rule:
 * no Amazon price outside its API), checked here by store and by link host even though the import already drops them.
 * A price older than PRICE_MAX_AGE_DAYS on the day the page opens is hidden, so a file nobody re-imported never shows
 * an old price. Guard: src/test/giftGuidePrices.test.tsx.
 */
export const PRICE_MAX_AGE_DAYS = 3;
const AMAZON_HOST = /(^|\.)(amazon\.[a-z.]+|amzn\.to|a\.co)$/;
const todayInLouisiana = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
const dayNumber = (ymd: string) => Date.parse(`${ymd}T12:00:00Z`) / 86400000;
const isAmazonPick = (pick: CatalogPick) => {
  if (pick.store === "amazon" || pick.store === "store-amazon") return true;
  try {
    return AMAZON_HOST.test(new URL(pick.href).hostname);
  } catch {
    // An unparseable link is treated as Amazon: no price is shown on it.
    return true;
  }
};

/** Whether a pick shows its price today. */
export const showsPrice = (pick: CatalogPick, today: string = todayInLouisiana()): boolean => {
  if (!pick.price || !(pick.price > 0) || !pick.priceAt || !/^\d{4}-\d{2}-\d{2}$/.test(pick.priceAt) || isAmazonPick(pick)) return false;
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
