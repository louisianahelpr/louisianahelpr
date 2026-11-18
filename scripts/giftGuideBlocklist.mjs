/**
 * Brands that never reach any gift guide, store page or deal section (lead 2026-11-18), read by
 * scripts/gift-guide-picks.mjs at import time and by src/test/giftGuidesPage.test.tsx against the shipped chunks.
 * A pick is blocked when its brand/store/retailer IS one of these (spaces and punctuation ignored), when its name,
 * title, brand, store or retailer carries one as a whole word, or when its link's host is the brand's own domain.
 * Types: giftGuideBlocklist.d.mts.
 */
export const BLOCKED_BRANDS = ["SheVibe", "King Palm", "AnyListingSEO", "Loren", "Restoro"];

const compact = (s) => String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const blockedCompact = BLOCKED_BRANDS.map(compact);
const blockedWords = BLOCKED_BRANDS.map((b) => new RegExp(`(^|[^a-z0-9])${b.toLowerCase().replace(/\s+/g, "[\\s_-]*")}($|[^a-z0-9])`, "i"));
const hostCore = (h) => {
  try {
    return compact(new URL(h).hostname.toLowerCase().replace(/^(www|shop|us)\./, "").replace(/\.[a-z]+(\.[a-z]+)?$/, ""));
  } catch {
    // Not a URL (a missing or plain-text link): no host to match.
    return "";
  }
};

/** True when a raw pick or deal ({ brand, store, retailer, storeName, name, title, href, affiliate_href }) is blocked. */
export function blockedBrand(p) {
  for (const v of [p.brand, p.store, p.retailer, p.storeName]) if (v && blockedCompact.includes(compact(v))) return true;
  for (const v of [p.name, p.title, p.brand, p.store, p.retailer, p.storeName]) if (v && blockedWords.some((re) => re.test(String(v)))) return true;
  for (const h of [p.href, p.affiliate_href]) {
    const core = h ? hostCore(h) : "";
    if (core && blockedCompact.includes(core)) return true;
  }
  return false;
}
