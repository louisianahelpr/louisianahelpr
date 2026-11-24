/**
 * Retired guide links that still get visits (lead 11-24, from the 11-23 flow audit: /gift-guides/mom 9 loads, /dad 3,
 * ...): a retired guide with an HONEST match among the search pages (src/content/guideSearchPages.mjs, each a filtered
 * view of Her, Him and Kids) opens that page instead of the gift guides landing. Every other retired guide still opens
 * the landing, and the relationship pages (mom -> her, dad -> him ...) keep opening Her or Him (giftGuidePeople.mjs).
 *
 * Read by newSlugFor (giftGuideCatalog.ts), so the page forwards it (GiftGuides.tsx) and the server answers a 301 to it
 * (src/prerender/seoData.ts `moved` -> api/share.ts). A key is never a live guide or a search page itself, and every
 * value is a real search page slug. Used only when the old slug has no live guide to open (a merged guide keeps its
 * parent section). Guard: src/test/retiredGuideForward1124.test.tsx.
 */
export const RETIRED_TO_SEARCH_PAGE: Readonly<Record<string, string>> = {
  // Stocking stuffers / the small budgets: every gift under $10 on Her, Him and Kids.
  "stocking-stuffers": "stocking-stuffers-under-10",
  "under-5": "stocking-stuffers-under-10",
  "under-10": "stocking-stuffers-under-10",
  // Every gift under $15 on Her and Him (the coworkers page is exactly that list).
  "under-15": "gifts-for-coworkers-under-15",
  coworkers: "gifts-for-coworkers-under-15",
  "work-gifts": "gifts-for-coworkers-under-15",
  teachers: "gifts-for-coworkers-under-15",
  "elementary-teachers": "gifts-for-coworkers-under-15",
  "preschool-teachers": "gifts-for-coworkers-under-15",
  "high-school-teachers": "gifts-for-coworkers-under-15",
  // Every gift under $25 on Her and Him.
  "under-25": "secret-santa-gifts-under-25",
  "secret-santa": "secret-santa-gifts-under-25",
  "white-elephant": "secret-santa-gifts-under-25",
  // Louisiana brands and Cajun, LSU, Saints and New Orleans picks.
  "louisiana-made": "louisiana-christmas-gifts",
  "louisiana-kitchen": "louisiana-christmas-gifts",
  "louisiana-by-region": "louisiana-christmas-gifts",
  "louisiana-celebrations": "louisiana-christmas-gifts",
  "louisiana-food-gifts": "louisiana-christmas-gifts",
  "louisiana-pantry": "louisiana-christmas-gifts",
  "louisiana-small-businesses": "louisiana-christmas-gifts",
  "louisiana-sweets-and-bakeries": "louisiana-christmas-gifts",
  "louisiana-boutiques": "louisiana-christmas-gifts",
  "louisiana-artists": "louisiana-christmas-gifts",
  "north-louisiana": "louisiana-christmas-gifts",
  "shop-small-louisiana": "louisiana-christmas-gifts",
  "new-orleans": "louisiana-christmas-gifts",
  acadiana: "louisiana-christmas-gifts",
  "baton-rouge": "louisiana-christmas-gifts",
  "purple-and-gold-lover": "louisiana-christmas-gifts",
  // Kids by age (the gendered toddler guides already open Kids at its toddlers section).
  toddlers: "gifts-for-toddlers",
  teens: "gifts-for-teens",
  "gender-neutral-teens": "gifts-for-teens",
  "boys-teens": "gifts-for-teens",
  "girls-teens": "gifts-for-teens",
  // Hobbies with their own Him page.
  hunters: "hunting-gifts-for-men",
  fishermen: "fishing-gifts-for-men",
  "grill-master": "grilling-gifts-for-dad",
};
