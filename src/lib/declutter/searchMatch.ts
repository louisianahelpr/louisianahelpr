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

/**
 * The same rule as a PostgREST filter, for /search (SearchPage.tsx), which reads declutter_items straight from the
 * database: one `or=(and(or(title,description,category ilike word),...))` value, every word required. The database
 * sees the RAW text, so a word that ends in "y" drops it ("berry" must also find "berries", whose stem is "berry");
 * that makes the filter a little wider than matchesSearch, never narrower, and the caller keeps only the rows
 * matchesSearch accepts. Words are a-z0-9 only (searchWords splits on everything else), so nothing needs escaping.
 * Null for an empty query.
 */
export function searchOrFilter(query: string, columns: readonly [string, string, string] = ["title", "description", "category"]): string | null {
  const words = searchWords(query);
  if (words.length === 0) return null;
  const [t, d, c] = columns;
  const any = (w: string) => {
    const loose = w.length >= 3 && w.endsWith("y") ? w.slice(0, -1) : w;
    return `or(${t}.ilike.*${loose}*,${d}.ilike.*${loose}*,${c}.ilike.*${loose}*)`;
  };
  return `and(${words.map(any).join(",")})`;
}

/** At most one letter added, dropped or changed between two words (a one-letter typo). */
function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** Common household words in Spanish (stemmed, no accents) and the English word listings use. Suggestions only. */
const SPANISH_WORDS: Readonly<Record<string, string>> = {
  lampara: "lamp", silla: "chair", mesa: "table", cama: "bed", sillon: "couch", bicicleta: "bike", juguete: "toy",
  libro: "book", zapato: "shoe", espejo: "mirror", escritorio: "desk", ventilador: "fan", alfombra: "rug",
  plato: "plate", taza: "mug", olla: "pot", cuna: "crib", cortina: "curtain", almohada: "pillow", cobija: "blanket",
  estante: "shelf", lavadora: "washer", secadora: "dryer", cochecito: "stroller", reloj: "clock", bolsa: "bag",
};

/**
 * Audit 11-10 F310: "lamb" found nothing while "lamp" had 5 items. When a search finds nothing, the nearest search
 * that would: each query word no item holds is swapped for a word the items do hold one typo away (words of 4 letters
 * or more, so "cup" never turns into "cap"). Null when no such swap finds an item. It only SUGGESTS (Browse offers it
 * as a button); matchesSearch, the one rule shared with the server, is unchanged.
 * F310 second half: "lampara" (or "lámpara") also found nothing. Accents are dropped first, and a common household
 * word in Spanish that no item holds is tried as its English word (SPANISH_WORDS) before the typo swap.
 */
export function closeSearch(
  query: string,
  items: readonly { title: string; description?: string | null; category?: string | null }[],
): string | null {
  const words = searchWords(query.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  if (words.length === 0) return null;
  const texts = items.map((it) => itemText(it.title, it.description, it.category));
  const vocab = new Set(texts.flatMap((t) => t.split(" ")));
  let changed = false;
  const fixed = words.map((w) => {
    if (texts.some((t) => t.includes(w))) return w;
    const english = SPANISH_WORDS[w];
    if (english && texts.some((t) => t.includes(english))) {
      changed = true;
      return english;
    }
    if (w.length < 4) return w;
    const near = [...vocab].find((v) => v.length >= 4 && oneEditApart(w, v));
    if (!near) return w;
    changed = true;
    return near;
  });
  if (!changed) return null;
  const next = fixed.join(" ");
  return items.some((it) => matchesSearch(next, it)) ? next : null;
}
