/**
 * Cheaper lookalikes ("dupes") for guide picks (owner 2026-11-23 ~1:05 PM approved them one by one; "for the ones with
 * dupes we will just add the word dupe to the left of the cart, no circle around it", then "those don't show on the
 * main list, only when they click dupe next to the cart will it show"). A dupe is never a card, never in a guide's list
 * or its counts: it rides on its original pick (CatalogPick.dupes), stamped when the guide's picks load
 * (loadGuidePicks), and shows only in the small panel the card's "dupe" word opens (DupeLink / DupePanel).
 *
 * The data is src/content/giftGuideDupes.json, kept apart from the generated picks files (scripts/gift-guide-picks.mjs
 * never touches it). Each entry names its original by the pick's link (`for.href`), or, for a pick whose link is being
 * changed on another branch, by brand plus a piece of its name (`for.brand` + `for.nameHas`), and holds its dupes as an
 * array (owner 11-23 ~1:50 PM: a gift can have more than one; the UGG Evelina has three). Every dupe link is a plain
 * Amazon product link with our Associates tag. Guard: src/test/giftGuideDupes1123.test.tsx.
 */

export interface GuideDupe {
  name: string;
  /** USD, read off the Amazon product page on `priceAt` (YYYY-MM-DD, Louisiana). */
  price: number;
  priceAt: string;
  /** https://www.amazon.com/dp/<ASIN>?tag=louisianahelpr-20 */
  href: string;
  /** The Amazon product photo (the guide photo rule: Amazon's own image, no box behind it). */
  image?: string;
  rating?: number;
  reviewCount?: number;
}

export interface DupeEntry {
  /** The original pick: its link, or its brand plus a piece of its name. */
  for: { href: string } | { brand: string; nameHas: string };
  /** The guide the owner approved it on (her, him, kids) and the original's name, for people reading the file. */
  guide: string;
  original: string;
  /** Its dupes, in the order the owner approved them (one or more). */
  dupes: GuideDupe[];
}

/** The plain-word copy for the "dupe" link and its panel. */
export const DUPE = {
  word: "dupe",
  /** The word's screen-reader name after "dupe": one dupe named with its price, several counted. */
  label: (dupes: readonly { name: string }[], price?: string) =>
    dupes.length === 1 ? `Cheaper lookalike: ${dupes[0].name}${price ? `, ${price}` : ""}` : `${dupes.length} cheaper lookalikes`,
  title: (n: number) => (n === 1 ? "Cheaper lookalike" : "Cheaper lookalikes"),
  panelLabel: (n: number, of: string) => `${n === 1 ? "Cheaper lookalike" : "Cheaper lookalikes"} for ${of}`,
  close: "Close",
};

/** A pick's dupes (records matched by its link, else by brand + name), in file order; empty when it has none. */
export const dupesFor = (pick: { href: string; name: string; brand?: string }, entries: readonly DupeEntry[]): GuideDupe[] =>
  entries
    .filter((d) => ("href" in d.for ? d.for.href === pick.href : pick.brand === d.for.brand && pick.name.includes(d.for.nameHas)))
    .flatMap((d) => d.dupes);
