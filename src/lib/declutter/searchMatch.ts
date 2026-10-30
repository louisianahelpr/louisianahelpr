/**
 * Declutter search words (audit DA-1, 2026-10-30: "mug blue", "mugs" and "kitchen" found nothing, because Browse
 * matched the whole query as one exact phrase inside the title).
 *
 * The rule, ONE rule for Browse (browseFilters.ts) and the saved-search alerts and counts on the server
 * (public.declutter_search_matches, the same steps in SQL; src/test/pglite/declutterSearchMatchParity.pglite.mjs
 * runs both over one table of cases):
 *   1. lower-case; split the query and the item into words on anything that is not a-z or 0-9;
 *   2. each word loses a simple plural ending: "ies" -> "y" ("berries" -> "berry"), "es" after s/x/z/ch/sh
 *      ("dishes" -> "dish", "boxes" -> "box"), else one "s" when the word is longer than 3 and does not end in "ss"
 *      ("mugs" -> "mug", "glass" stays);
 *   3. the item's words are its title, its description and its category key ("home_decor" -> "home decor");
 *   4. EVERY query word must appear inside that run of item words (so "mug blue" finds "Blue mug", "phone" still
 *      finds "iPhone", and a half-typed "lam" finds "Lamp").
 * An empty query matches everything.
 */

const SPLIT = /[^a-z0-9]+/;

/** One word without a simple plural ending (step 2). */
export function stemWord(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** The query's words, stemmed; empty when the query has no letters or digits. */
export function searchWords(query: string): string[] {
  return query.toLowerCase().split(SPLIT).filter(Boolean).map(stemWord);
}

/** The item's words (step 3), stemmed and joined by single spaces. */
function itemText(title: string, description: string | null | undefined, category: string | null | undefined): string {
  return [title, description ?? "", (category ?? "").replace(/_/g, " ")]
    .join(" ").toLowerCase().split(SPLIT).filter(Boolean).map(stemWord).join(" ");
}

/** Whether an item matches a search (step 4). */
export function matchesSearch(
  query: string,
  item: { title: string; description?: string | null; category?: string | null },
): boolean {
  const words = searchWords(query);
  if (words.length === 0) return true;
  const text = itemText(item.title, item.description, item.category);
  return words.every((w) => text.includes(w));
}
