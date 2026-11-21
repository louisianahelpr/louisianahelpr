/**
 * The gift guides' two plain constants, with no imports, so a small module that needs only these (the gift lists'
 * Amazon cart link, src/lib/retailerCart.ts; a pasted link or idea, src/lib/wishLinks.ts) never pulls the whole
 * catalog onto /sponsor's critical path (train 1121f build: 323 KB gz vs a 258 KB budget). giftGuideCatalog.ts
 * re-exports both, so every other reader is unchanged.
 */

/** The Amazon Associates ID every Amazon link must carry (owner 2026-11-17). */
export const AMAZON_TAG = "louisianahelpr-20";

/**
 * Words that carry no meaning in a gift search (holistic review 11-18 H5: "gift for mom" listed Mom plus 18 Life
 * moments guides). Dropped before matching, unless the query is nothing else.
 */
export const SEARCH_FILLER = new Set(["gift", "gifts", "for", "my", "a", "an", "the", "ideas", "idea", "to", "who", "that", "someone", "present", "presents", "of", "and", "is", "likes", "loves"]);
