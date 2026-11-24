/**
 * The search pages' slugs and the guides each one reads (owner 2026-11-23, "add a lot of different searches"). Kept
 * apart from the pages' words (guideSearchPages.mjs) so the guide pages' first paint carries only this small map: the
 * catalog loads a search page's chunks by it and the page knows the slug is a search page before the words load.
 * Every page in guideSearchPages.mjs has its entry here and no other (src/test/guideSearchPages1123.test.ts).
 */
export const SEARCH_PAGE_GUIDES = {
  "gifts-for-her-under-25": ["her"],
  "gifts-for-her-under-50": ["her"],
  "gifts-for-her-under-100": ["her"],
  "luxury-gifts-for-her": ["her"],
  "stocking-stuffers-for-women": ["her"],
  "beauty-gifts-for-her": ["her"],
  "cozy-gifts-for-her": ["her"],
  "home-gifts-for-mom": ["her"],
  "jewelry-and-bag-gifts-for-her": ["her"],
  "louisiana-gifts-for-her": ["her"],
  "gifts-for-him-under-25": ["him"],
  "gifts-for-him-under-50": ["him"],
  "gifts-for-him-under-100": ["him"],
  "luxury-gifts-for-him": ["him"],
  "stocking-stuffers-for-men": ["him"],
  "hunting-gifts-for-men": ["him"],
  "fishing-gifts-for-men": ["him"],
  "tech-gifts-for-men": ["him"],
  "grilling-gifts-for-dad": ["him"],
  "gifts-for-husband": ["him"],
  "grooming-gifts-for-men": ["him"],
  "louisiana-gifts-for-him": ["him"],
  "gifts-for-toddlers": ["kids"],
  "gifts-for-kids-ages-3-5": ["kids"],
  "gifts-for-kids-ages-6-8": ["kids"],
  "gifts-for-kids-ages-9-12": ["kids"],
  "gifts-for-teens": ["kids"],
  "kids-gifts-under-25": ["kids"],
  "kids-gifts-under-50": ["kids"],
  "outdoor-toys-for-kids": ["kids"],
  "arts-and-crafts-gifts-for-kids": ["kids"],
  "tech-gifts-for-kids": ["kids"],
  "stocking-stuffers-under-10": ["her", "him", "kids"],
  "secret-santa-gifts-under-25": ["her", "him"],
  "gifts-for-coworkers-under-15": ["her", "him"],
  "louisiana-christmas-gifts": ["her", "him", "kids"],
};

/** The guides a search page reads, or null when `slug` is no search page. */
export const searchPageGuides = (slug) => (typeof slug === "string" && Object.prototype.hasOwnProperty.call(SEARCH_PAGE_GUIDES, slug) ? SEARCH_PAGE_GUIDES[slug] : null);
