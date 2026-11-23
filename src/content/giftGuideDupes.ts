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
  /** "dupe" (a true lookalike) or "similar" (same use, different look): see DupeKind below. */
  kind: DupeKind;
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

/**
 * Owner 2026-11-23 ~2:40 PM: "some of them aren't dupes, they are just similar". A "dupe" is a true lookalike (same
 * item type with the same look, silhouette, color or details: the UGG Evelina clogs, Oura to RingConn); a "similar" is
 * the same use for less in a different look or brand style (Carhartt cooler for the YETI Hopper). Each record says
 * which (owner's list: ~/Desktop/Louisiana Helpr Work/Gift guides and affiliate/Dupes-1123/dupe-vs-similar-1123.md).
 */
export type DupeKind = "dupe" | "similar";
type Kinded = { name: string; kind?: DupeKind };
/** True when at least one is a true lookalike (a record with no kind, e.g. an older saved live copy, counts as one). */
export const hasTrueDupe = (dupes: readonly Kinded[]) => dupes.some((d) => d.kind !== "similar");

/** The plain-word copy for the "dupe" / "similar" link and its panel. */
export const DUPE = {
  /** The card's word: "dupe" when any is a true lookalike, else "similar". */
  word: (dupes: readonly Kinded[]) => (hasTrueDupe(dupes) ? "dupe" : "similar"),
  /** The word's screen-reader name after the word: one named with its price, several counted. */
  label: (dupes: readonly Kinded[], price?: string) => {
    const at = price ? `, ${price}` : "";
    if (hasTrueDupe(dupes)) return dupes.length === 1 ? `Cheaper lookalike: ${dupes[0].name}${at}` : `${dupes.length} cheaper lookalikes`;
    return dupes.length === 1 ? `Similar for less: ${dupes[0].name}${at}` : `${dupes.length} similar for less`;
  },
  title: (dupes: readonly Kinded[]) => (hasTrueDupe(dupes) ? (dupes.length === 1 ? "Cheaper lookalike" : "Cheaper lookalikes") : "Similar for less"),
  panelLabel: (dupes: readonly Kinded[], of: string) => `${DUPE.title(dupes)} for ${of}`,
  close: "Close",
};

/** A pick's dupes (records matched by its link, else by brand + name), in file order; empty when it has none. */
export const dupesFor = (pick: { href: string; name: string; brand?: string }, entries: readonly DupeEntry[]): GuideDupe[] =>
  entries
    .filter((d) => ("href" in d.for ? d.for.href === pick.href : pick.brand === d.for.brand && pick.name.includes(d.for.nameHas)))
    .flatMap((d) => d.dupes);
