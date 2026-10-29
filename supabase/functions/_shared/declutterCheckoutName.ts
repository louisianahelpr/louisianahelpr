/**
 * The name the buyer reads on Stripe's Declutter payment page (audit 1a #15,
 * 2026-10-29: one page read "Pay Helpr $15.30", another "Declutter purchase
 * $26.95"). The purchase line always carries what the buyer is buying: the
 * item's own title, or the first title and how many more for a bundle.
 * "Declutter purchase" is only the fallback when no title could be read.
 *
 * Pure (no Deno, no network) so vitest can prove it: src/test/declutterCheckoutName.test.ts.
 */

/** The fallback when the order's titles could not be read. */
export const DECLUTTER_CHECKOUT_FALLBACK_NAME = "Declutter purchase";

/* Titles are 3-80 characters in SQL (declutter_items.title CHECK), so the name stays one short line. */

export function declutterCheckoutLineName(titles: ReadonlyArray<string | null | undefined>): string {
  const clean = titles
    .map((t) => (typeof t === "string" ? t.replace(/\s+/g, " ").trim() : ""))
    .filter((t) => t.length > 0)
    .sort((a, b) => a.localeCompare(b));
  if (clean.length === 0) return DECLUTTER_CHECKOUT_FALLBACK_NAME;
  const first = clean[0];
  const more = clean.length - 1;
  return more === 0 ? first : `${first} + ${more} more ${more === 1 ? "item" : "items"}`;
}
