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

/**
 * Louisiana Helpr's Facebook page: the 25 Days page's links (src/content/sponsorPage.ts reads it from here) and the gift
 * guides landing's giveaways button, which reads it here so a guide page never downloads the 25 Days page's words
 * (vite.config.ts sponsor-page-reads).
 */
export const LOUISIANA_HELPR_FACEBOOK = "https://www.facebook.com/louisianahelpr";
