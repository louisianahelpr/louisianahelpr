/**
 * Brands that never reach any gift guide, store page, deal section or code (lead 2026-11-18), read by
 * scripts/gift-guide-picks.mjs at import time and by src/test/giftGuidesPage.test.tsx against the shipped chunks.
 * A pick is blocked when its brand/store/retailer IS one of these (spaces and punctuation ignored), when its name,
 * title, brand, store or retailer carries one as a whole word, or when its link's host is the brand's own domain.
 * Types: giftGuideBlocklist.d.mts.
 */
export const BLOCKED_BRANDS = ["SheVibe", "King Palm", "AnyListingSEO", "Loren", "Restoro",
  // Affiliate sweep 11-18 PM: Yeloly (adult, joined by mistake), Serika, Parallels (software), HerbsPro (supplements);
  // ZazzMode (owner 11-18: stays out of the guides).
  "Yeloly", "Serika", "Parallels", "HerbsPro", "ZazzMode",
  // Lead 11-18 PM: VPN / security software, desktop software and key resellers, PC cleaners, games, airline and
  // travel booking, car and RV rental, ticket resale: no gift stores (their store pages are REMOVED_GUIDES too).
  "NordVPN", "Surfshark", "Keeper Security", "NordPass", "hide.me", "Intego", "Corel", "Clip Studio Paint", "Daz 3D",
  "Wondershare", "Roxio", "Pinnacle Studio", "Lalal.ai", "Ashampoo", "AOMEI", "PandaOffice", "Jalbum", "O&O Software",
  "Abelssoft", "Paragon Software", "GearUP", "YUPLAY", "Whokeys", "DirectDeals", "Hero Wars", "Skytours", "Oojo",
  "Cheapvuelos", "Ovago", "HopeGoo", "Air India", "Ocean Hotels", "Rent Cars", "VIP Cars", "Carla Car Rental", "RVshare",
  "Undercover Tourist", "PARISCityVISION",
  // Owner 11-19 ("don't think it should be on any gift guides"): a jade bangle, an Indian cookbook-and-sauce set and an
  // 8-pint ice cream shipment; and ("alot cuter things to pick from") an embroidered tablecloth, glass wall art and a
  // weighted blanket. Their store pages go too.
  "Ying Mart", "YingMart", "Brooklyn Delhi", "eCreamery", "AimHave", "Minteefy", "Mosaic Weighted Blankets",
  // Owner 11-19 ("remove"): Dragontree crystal jewelry and ornaments, Deme by Gabriella dresses.
  "Dragontree", "Dragontree Apothecary", "Deme by Gabriella", "Deme",
  // Owner 11-19 ("remove these hats on every guide"): CHORD caps, store page too.
  "CHORD",
  // Owner 2026-11-19 ("remove all life is good or limit it to 2 items total"): removed entirely, store page too.
  "Life is Good",
  // Owner 11-19 ("remove", a model-photo shearling biker jacket): The Jacket Maker, store page too.
  "The Jacket Maker",
  // Owner 11-19 ("remove entirely from all guides"): Diamond Art Club kits, store page too.
  "Diamond Art Club",
  // Owner 11-19 ("remove from all guides"): Lubiwood wooden art puzzles, store page too.
  "Lubiwood",
  // Owner 11-19 (flagged twice, "remove from all guides"): nixplay, frames included, store page too.
  "nixplay",
  // Lead 11-19 (pre-launch audit B): Walmart's own store brands are no gift brands. ("George" is matched as a brand
  // only, in WALMART_BRAND_ONLY below, so a George Foreman grill stays.)
  "onn.", "Mainstays", "Hyper Tough", "Holiday Time", "Better Homes & Gardens", "Better Homes and Gardens", "Great Value", "Time and Tru"];
/** Store brands matched on the brand field only (a whole-word match on names would catch other products). */
export const WALMART_BRAND_ONLY = ["George"];

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
  if (WALMART_BRAND_ONLY.some((b) => String(p.brand ?? "").trim().toLowerCase() === b.toLowerCase())) return true;
  for (const v of [p.brand, p.store, p.retailer, p.storeName]) if (v && blockedCompact.includes(compact(v))) return true;
  for (const v of [p.name, p.title, p.brand, p.store, p.retailer, p.storeName]) if (v && blockedWords.some((re) => re.test(String(v)))) return true;
  for (const h of [p.href, p.affiliate_href]) {
    const core = h ? hostCore(h) : "";
    if (core && blockedCompact.includes(core)) return true;
  }
  return false;
}
