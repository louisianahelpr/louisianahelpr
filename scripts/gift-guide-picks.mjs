#!/usr/bin/env node
/**
 * Gift-guide picks loader (lead 2026-11-18, follow-up batch 11-18 PM): turns the researched picks in
 * ~/Desktop/Gift-guide-picks into src/content/giftGuidePicks.ts, the generated file src/content/giftGuideCatalog.ts
 * reads. Re-runnable: every run re-reads every file, so links added on the Desktop flow in on the next run.
 * Usage: node scripts/gift-guide-picks.mjs [<picks dir>]
 *
 * Read:
 *   - <slug>.json: one guide's picks, in order (store-<x>.json is a store page's own "Louisiana Helpr Picks");
 *   - extras with a `fits` list of guide slugs: _awin.json, _cj.json (CJ links), _impact.json and _shopify-collabs.json (when present), _later.json, _later-mylinks.json (every Later link), _later-brands.json;
 *   - _pets-fill-1118.json: the Fish, Horse and Bird Lover lists (PETS_FILL, replacing those guides' own);
 *   - late fills (LATE_FILLS): _momcozy-1118.json (New Mom) and _fidget-1118.json, below each guide's top 25;
 *   - store extras: _xtratuf.json, _warby-parker.json (+ Her/Him/Coworkers/RNs/Teens), _walmart.json,
 *     _tiktok-shop.json, _amazon-trending.json, _amazon-bounties.json (Prime/Audible/registries);
 *   - deal sections: _store-deal-sections.json, _walmart-collections.json, _amazon-hub.json, _later-deals.json,
 *     _later-promos.json (each hidden after its end date, on the page).
 *
 * LINK RULE (owner 2026-11-18): a pick links to its `affiliate_href` when it has one. Otherwise its plain `href` is
 * used only on a host that needs no affiliate link (Amazon with tag=louisianahelpr-20, ShopMy, the Louisiana shops,
 * the sponsors and BRAND_SITES); any other pick stays HIDDEN until its affiliate link exists. Every link must be https
 * on an allowlisted host (AFFILIATE_HOSTS + those) and no text may carry a price ("$" + digit): a pick that breaks a
 * rule is hidden and listed, never shown unchecked.
 * PHOTOS FIRST (owner 11:35 AM): within each guide, picks with a real product photo come first, the order inside each
 * group kept.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { blockedBrand } from "./giftGuideBlocklist.mjs";
import { applyTrain1120b } from "./giftGuideTrain1120b.mjs";
import { applyTrain1120c } from "./giftGuideTrain1120c.mjs";
import { verifiedPrice } from "./giftGuidePrice.mjs";
import { applyBudgetCaps } from "./giftGuideBudgetCaps.mjs";
import { applyTrain1120d } from "./giftGuideTrain1120d.mjs";
import { BRAND_CODES, CUTS_1120, budgetBand, importRows1120, productKey1120, swapCuts } from "./giftGuideBig1120.mjs";
import { FRANCHISE_SPONSORS_1120, SPONSOR_SECTIONS_1120, auditActions1120, brandFirst, followUpOut, louisianaAdds1120, readAudits1120, renameOf, zeroSwaps1120 } from "./giftGuideFollowUp1120.mjs";
import { BASE_MERGES, GUIDE_MERGES, MERGED_INTO, NEW_PARENTS, NO_LIST_SECTIONS, STORE_PAGES_KEPT, SECTION_CAP, SECTION_GROUPS, SECTION_MAX, SECTION_MIN, isFoldedStore } from "../src/content/giftGuideMerges.mjs";
import { GUIDE_CAP, buildRateData, byCommission, ccTwin, commissionOf, guideRanks, itemPopularity, pickType, sectionGuides, typeMax, CROWD_TYPES, KNOWN_BRAND, THIN_TARGET } from "./giftGuideSort.mjs";
import { BRAND_CASE, LA_LINE, MAIL_CARRIER, MAIL_CARRIER_MAX, bannedLink, belongsWhy, homepageLink, neutralLine, wrapItem, NEW_MOM_CARE, NOT_A_GIFT_ITEM, NOT_LOUISIANA_BUSINESS, PET_ITEM, PET_ONLY, WOMEN_GUIDES, WORK_BOOT, WORK_BOOT_OFF, brokenImage, collectionLink, fitsGuide, isLouisianaItem, mensItem, nonUsUrl, INSTAX_OFF, instaxItem, placeholderName, productName, tidyName, BEAUTY_GUIDE_MAX, BRAND_NAME, DECK_BOOT, NEUTRAL_GUIDES, ONE_GENDER, beautyGuide, beautyItem, beautyRank, brandFromName, brandKey, onceKey, utilityCare, BADGE_PHOTO_SWAPS, fixName, fixedBrand, modelYearName, GUIDE_GROUPS, foodOff, TREATS_GUIDE, resaleOrUkShop, LASH, VERA_BRADLEY, DIGITAL_FRAME, FOOD_SUB_MAX, isFoodSub, PHOTO_PRODUCT, PHOTO_BOOK_GUIDES, JIGSAW, PUZZLE_MAX, applySiblingOverlap, siblingOverlap, SIBLING_FAMILIES, approvalLine, newApprovalSlot, fitR4Why, typeCaps, beautyPreference, NORTH_LA, NORTH_LA_GUIDE, placeRow, retailerBrand, r4Name, MEN_PASTEL, MEN_COLOR_GUIDES, followUpOff, OLD_ELECTRONICS, OWNER_REMOVED, HIKING, nonGiftService, PRICE_MAX, DUP_GUIDE_MAX, SHOPMY_S3, INSULATED, TUMBLER_MAX, fillerGuide, FILLER_OK, R4_OFF, kidsToyOff } from "./giftGuideRules.mjs";
/** True for an amazon.com URL (exact host or a subdomain), checked on the parsed hostname. */
const isAmazonUrl = (u) => { try { const h = new URL(String(u)).hostname; return h === "amazon.com" || h.endsWith(".amazon.com"); } catch { return false; } };

const dir = process.argv[2] ?? join(homedir(), "Desktop", "Gift-guide-picks");
const out = new URL("../src/content/giftGuidePicks.ts", import.meta.url);
/** One lazy chunk per guide (PERF, follow-up 11-18: the single file grew to ~245 KB gz; the index page loads none). */
const chunkDir = new URL("../src/content/giftGuidePicks/", import.meta.url);
/** The indexed guides' names (SEO, follow-up 11-18): read by the sitemap, the server head (api/share.ts) and the page. */
const seoOut = new URL("../src/content/giftGuideSeo.mjs", import.meta.url);
const content = readFileSync(new URL("../src/content/giftGuides.ts", import.meta.url), "utf8");
const indexSrc = readFileSync(new URL("../src/content/giftGuideIndex.ts", import.meta.url), "utf8");
// Each guide's group ("By person", "By budget", ...), read by fitsGuide's not-giftable-decor rule (owner 11-19).
for (const m of indexSrc.matchAll(/group: "([^"]+)"[^}]*?slug: "([^"]+)"/g)) GUIDE_GROUPS.set(m[2], m[1]);
const listed = (name) => [...(content.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`))?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const AMAZON = new Set(["www.amazon.com", "amazon.com", "amzn.to"]);
const LOUISIANA = new Set(listed("LOUISIANA_SHOPS"));
const SPONSORS = new Set([...listed("SPONSOR_SITES"), ...listed("NATIONAL_SPONSOR_SITES")]);
/** The Louisiana sponsors' hosts only (a national sponsor's shop is no Louisiana item; train 1120b). */
const LA_SPONSORS = new Set(listed("SPONSOR_SITES"));
/**
 * The 25 Days sponsors by name (follow-up 1120: their 0% picks stay, owner 11-20 ~12:05 AM): SPONSOR_BRANDS and every
 * confirmed Louisiana sponsor on the Small Business Saturday page (src/content/giftGuideSmallBiz.json).
 */
const SPONSOR_NAMES = new Set([...listed("SPONSOR_BRANDS"), "Dupuy's", // "Dupuy's Seafood & Steak" names its gift certificates "Dupuy's".
  ...JSON.parse(readFileSync(new URL("../src/content/giftGuideSmallBiz.json", import.meta.url), "utf8")).map((b) => String(b.name).replace(/\s*\([^)]*\)\s*$/, ""))]
  .map((n) => n.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "")).filter((n) => n.length >= 4));
/** A 25 Days sponsor's pick: flagged, on a sponsor's site, or made by a sponsor (its brand, or its name starts with one). */
export const isSponsorPick = (p) => {
  if (p.sponsor === true) return true;
  try { if (SPONSORS.has(new URL(p.href).hostname)) return true; } catch { /* no URL: judged by name */ }
  const c = (x) => String(x ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  return SPONSOR_NAMES.has(c(p.brand)) || [...SPONSOR_NAMES].some((n) => c(p.name).startsWith(n));
};
const BRANDS = new Set(listed("BRAND_SITES"));
/** Hosts a plain (non-affiliate) link may use. */
const PLAIN_OK = new Set([...AMAZON, "shopmy.us", ...LOUISIANA, ...SPONSORS, ...BRANDS]);
const AFFILIATE = new Set([...listed("AFFILIATE_HOSTS"), ...AMAZON, "shopmy.us"]);

/**
 * ShopMy's moved photos (lead 11-19, 1530 train): an old S3 photo URL (403) that scripts/gift-guide-shopmy-cdn.mjs found
 * drawable on static.shopmy.us is read as that CDN URL, in every picks file, before any rule sees it. An unchecked one
 * stays on the S3 host and is still held (deadHost below).
 */
export const SHOPMY_CDN_PHOTOS = (() => {
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(join(dir, "_shopmy-cdn-photos.json"), "utf8"))));
  } catch {
    // Not built yet: every S3 photo stays held.
    return new Map();
  }
})();
const S3_URL = new RegExp(`${SHOPMY_S3.source}[^"\\s]*`, "g");
const cdnPhotos = (text) => (SHOPMY_CDN_PHOTOS.size ? text.replace(S3_URL, (u) => SHOPMY_CDN_PHOTOS.get(u) ?? u) : text);
const deskJson = (path) => JSON.parse(cdnPhotos(readFileSync(path, "utf8")));
const readJson = (f) => (existsSync(join(dir, f)) ? deskJson(join(dir, f)) : null);
/** A list file: a plain array, or a research file still in progress ({ _progress, links: [...] }). */
const readList = (f) => {
  const v = readJson(f);
  const rows = Array.isArray(v) ? v : Array.isArray(v?.links) ? v.links : [];
  // A file that puts the affiliate short link in `href` (_walmart-under5-1118.json: walmrt.us) keeps it as the
  // affiliate link and its product page as the plain one.
  return rows.map((p) => (p && !p.affiliate_href && typeof p.href === "string" && /^https:\/\/walmrt\.us\//.test(p.href)
    ? { ...p, affiliate_href: p.href, href: typeof p.product_url === "string" ? p.product_url : p.href } : p));
};

/** The guide slugs and store-page titles on the owner's list (giftGuideIndex.ts). */
const INDEX = [...indexSrc.matchAll(/slug: "([^"]+)", title: "([^"]+)"/g)].map((m) => ({ slug: m[1], title: m[2] }));
const GUIDE_SLUGS = new Set(INDEX.map((g) => g.slug));
const compact = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const STORE_BY_COMPACT = new Map(INDEX.filter((g) => g.slug.startsWith("store-")).flatMap((g) => [[compact(g.title), g], [compact(g.slug.slice(6)), g]]));
const slugify = (s) => s.toLowerCase().replace(/&/g, "and").replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const cleanName = (s) => s.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+(US|USA)$/, "").replace(/\s+Affiliate Program$/i, "").trim();
const domainCore = (d) => d.replace(/^(www|shop|us)\./, "").replace(/\.(com|us|co|net|org)(\.[a-z]+)?$/, "");

/**
 * US STORES ONLY (batch 11-19, nonUsUrl): every research row is read once. A link any row ties to a UK, Australian or
 * Canadian store (its href, product_url, store_href, store, retailer or domain) is NON_US_LINKS; a row on such a link,
 * or whose own fields name such a store, takes a US link of the same product from our data (US_TWIN: a ShopMy pin
 * first, else any other affiliate or Amazon link), or is hidden.
 */
export const NON_US_LINKS = new Set();
const US_TWIN = new Map();
export const nonUs = { relinked: 0, hidden: 0 };
const linkOf = (v) => v.affiliate_href || v.new_href || (v.pin_id ? `https://go.shopmy.us/p-${v.pin_id}` : "") || (typeof v.href === "string" && /^https:\/\/(www\.)?amazon\.com\//.test(v.href) ? v.href : "");
const placeFields = (v) => [v.href, v.product_url, v.store_href, v.store, v.retailer, v.domain].filter((x) => typeof x === "string" && x);
const productKey = (v) => {
  const brand = compact(String(v.brand ?? ""));
  let n = compact(String(v.name ?? "").replace(/^[^|]*\|\s*/, ""));
  if (brand && n.startsWith(brand)) n = n.slice(brand.length);
  return n.length > 6 ? n : "";
};
{
  const rows = [];
  const walk = (v) => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (!v || typeof v !== "object") return;
    if (typeof v.name === "string" && linkOf(v)) rows.push(v);
    for (const x of Object.values(v)) if (x && typeof x === "object") walk(x);
  };
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try { walk(JSON.parse(readFileSync(join(dir, f), "utf8"))); } catch { /* a file that is not JSON is read (and reported) where it is used */ }
  }
  for (const v of rows) if (placeFields(v).some(nonUsUrl)) NON_US_LINKS.add(linkOf(v));
  const rank = (l) => (/^https:\/\/go\.shopmy\.us\/p-/.test(l) ? 0 : isAmazonUrl(l) ? 2 : 1);
  for (const v of rows) {
    const link = linkOf(v);
    const key = productKey(v);
    // A link the links audit banned (dead, sold out, wrong page) is never a twin either.
    if (!key || NON_US_LINKS.has(link) || bannedLink(link) || placeFields(v).some(nonUsUrl) || /shopmy\.us\/collections\//.test(link)) continue;
    const had = US_TWIN.get(key);
    if (!had || rank(link) < rank(had.link)) US_TWIN.set(key, { link, plain: typeof v.href === "string" && !nonUsUrl(v.href) ? v.href : link, store: v.retailer || v.store || v.brand || "" });
  }
}
/** A row on a non-US store: the same product's US link (the row's own name, photo and copy kept), or null. */
const usRelink = (p) => {
  const link = p.affiliate_href || p.href;
  if (!NON_US_LINKS.has(link) && !placeFields(p).some(nonUsUrl)) return p;
  const twin = US_TWIN.get(productKey(p));
  if (!twin) return null;
  const { store_href: _sh, product_url: _pu, domain: _d, ...rest } = p;
  return { ...rest, href: twin.plain, affiliate_href: twin.link === twin.plain && isAmazonUrl(twin.link) ? undefined : twin.link, store: twin.store, retailer: undefined };
};

/** Every store page a pick belongs to: slug -> name (and the hosts its links use, filled below). */
const stores = new Map();
/**
 * One store page per store however a feed spells it (lead 2026-11-18: stanley, stanley-1913 and stanley1913 were three
 * pages): compact spelling -> the one name its page uses.
 */
export const STORE_ALIASES = {
  // Live audit r3 #5: one Muck Boot store page (muckbootcompany.com and "Muck Boot Company" fold into it).
  muckbootcompany: "Muck Boot", muckboot: "Muck Boot",
  anker: "Anker", ankerinnovations: "Anker", stanley: "Stanley", stanley1913: "Stanley", ulta: "Ulta Beauty",
  underarmour: "Under Armour", worldmarket: "World Market", twelvesouth: "Twelve South", landsend: "Lands' End",
  comrad: "Comrad Socks", loop: "Loop Earplugs", loopearplugsus: "Loop Earplugs", malbon: "Malbon Golf",
  giftcards: "GiftCards.com", giftcardscom: "GiftCards.com", magazines: "Magazines.com", magazinescom: "Magazines.com",
  "831stories": "831 Stories", communitycoffee: "Community Coffee", freyrs: "Freyrs Eyewear", freyrseyewear: "Freyrs Eyewear",
  lashnextdoor: "Lash Next Door", gilt: "Gilt", giltandgiltcity: "Gilt", giltcity: "Gilt", yotoplay: "Yoto", campsnap: "Camp Snap", campsnapphoto: "Camp Snap",
};
const storeFor = (raw) => {
  if (!raw) return null;
  const domainLike = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(raw);
  const alias = STORE_ALIASES[compact(domainLike ? domainCore(raw) : cleanName(raw))];
  const isDomain = domainLike && !alias;
  const name = alias ?? (isDomain ? domainCore(raw) : cleanName(raw));
  // ShopMy is how a link is made, never a store (owner 2026-11-18: no ShopMy tile; each retailer is its own page).
  if (compact(name) === "shopmy") return null;
  const hit = STORE_BY_COMPACT.get(compact(name));
  const slug = hit?.slug ?? `store-${slugify(name)}`;
  const title = hit?.title ?? (isDomain ? name.charAt(0).toUpperCase() + name.slice(1) : name);
  if (!stores.has(slug)) stores.set(slug, { name: title, hosts: new Set() });
  return slug;
};

/**
 * THE switch for Amazon CDN product photos (m.media-amazon.com, tagged image_source "amazon-sitestripe"). ON since the
 * owner's decision of 2026-11-18 PM ("Once we get 3 sales we will fix it correctly"; she accepts the Associates risk
 * until then): photo-less Amazon picks show the CDN photo the image finder collected, hotlinked (never re-hosted), lazy,
 * in the fixed square thumb (object-fit contain). A brand-site photo (amazon-brand-images.json) always wins over it.
 * MUST be switched OFF (or these replaced by PA-API images) once 3 sales unlock the Product Advertising API.
 * Off: those picks have no photo (the page draws the store tile), so mixed guides swap them for photo'd picks.
 */
export const AMAZON_CDN_PHOTOS = process.env.GIFT_AMAZON_PHOTOS !== "off";
/** The link library (~/Desktop/Link-library): unused-by-guide.json holds each guide's links not yet on it. */
const LIB = process.env.GIFT_LINK_LIBRARY ?? join(homedir(), "Desktop", "Link-library");
const hidden = [];
/**
 * A stock line used on more than LINE_MAX_PRODUCTS different products ("The cup that goes everywhere…" on 109 rows on 2026-11-18,
 * design audit r2 #6) reads as filler and lands on the wrong product: it is left blank, never replaced.
 */
const LINE_MAX_PRODUCTS = 3;
const lineProducts = new Map();
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  let v;
  try {
    v = JSON.parse(readFileSync(join(dir, f), "utf8"));
  } catch {
    // A file another agent is mid-writing: its lines are counted on the next run.
    continue;
  }
  for (const r of Array.isArray(v) ? v : Array.isArray(v?.links) ? v.links : []) {
    if (!r || typeof r.line !== "string" || !r.line.trim() || typeof r.name !== "string") continue;
    const set = lineProducts.get(r.line.trim()) ?? new Set();
    set.add(compact(r.name));
    lineProducts.set(r.line.trim(), set);
  }
}
const stockLine = (line) => (lineProducts.get(String(line ?? "").trim())?.size ?? 0) > LINE_MAX_PRODUCTS;
/**
 * Photo-less Amazon picks (lead 11-18 PM): amazon-brand-images.json gives the BRAND's own photo of the same product
 * (by ASIN, source "brand-site"; the Amazon link is kept), and amazon-swaps.json swaps an ASIN for the same product at
 * another store (its own link, photo and checked price). Both optional; a later run picks up new entries. An image on an
 * Amazon host is never taken from them (AMAZON_IMAGE_HOST).
 */
export const AMAZON_IMAGE_HOST = /(^|\.)(media-amazon|images-amazon|ssl-images-amazon|amazon|amazon-adsystem)\.com$/;
const readLib = (f) => {
  try {
    return deskJson(join(LIB, f));
  } catch {
    // Not written yet (or mid-write): no brand photos or swaps this run.
    return {};
  }
};
const BRAND_IMAGES = readLib("amazon-brand-images.json");
const AMAZON_SWAPS = readLib("amazon-swaps.json");
const offAmazonImage = (u) => {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && !AMAZON_IMAGE_HOST.test(x.hostname);
  } catch {
    // Not a URL: no photo.
    return false;
  }
};
const asinOf = (p) => [p.affiliate_href, p.href].map((u) => String(u ?? "").match(/amazon\.com\/(?:[^?#]*\/)?dp\/([A-Z0-9]{10})/)?.[1]).find(Boolean);
/** The raw pick after the Amazon swap and brand-photo files: a swap replaces it; a brand photo fills a missing one. */
const withAmazonFixes = (p) => {
  const asin = asinOf(p);
  if (!asin) return p;
  const swap = AMAZON_SWAPS[asin];
  if (swap?.href && swap.name && swap.source === "swap") {
    return {
      name: swap.name, brand: p.brand, line: p.line, store: swap.store, affiliate_href: swap.href, href: swap.href,
      ...(offAmazonImage(swap.image) ? { image: swap.image } : {}),
      ...(swap.price && swap.price_checked_at ? { price: swap.price, price_currency: "USD", price_checked_at: swap.price_checked_at, price_source: "amazon-swaps.json" } : {}),
      ...(p.louisianaFit ? { louisianaFit: p.louisianaFit } : {}),
    };
  }
  const brand = BRAND_IMAGES[asin];
  const hasOwn = typeof p.image === "string" && offAmazonImage(p.image);
  if (!hasOwn && brand?.source === "brand-site" && offAmazonImage(brand.image)) return { ...p, image: brand.image, image_source: "brand-site" };
  return p;
};
/** One raw pick -> the page's pick, or null (hidden: the reason is listed). */
/**
 * Rows whose source name is a page title, renamed to the plain product (design audit loop 2026-11-18, name-only):
 * keyed by the source href. The Atlas rows' names come from their URLs ("12-month-email-tea-gift-corporate", "12-month-email-gift-corporate"); the two
 * SharkNinja rows link to a category page, so they name the category's product, not a model.
 */
export const RENAMED = {
  "https://atlascoffeeclub.com/products/12-month-email-tea-gift-corporate": "12-Month Tea Club Gift Subscription",
  "https://atlascoffeeclub.com/products/12-month-email-gift-corporate": "12-Month Coffee Club Gift Subscription",
  "https://atlascoffeeclub.com/products/12-month-email-gift-quarterly-corporate": "12-Month Coffee Club Gift, Shipped Quarterly",
  "https://www.sharkninja.com/kitchen/small-kitchen-appliances/air-fryers": "Ninja Air Fryer",
  "https://www.sharkninja.com/beauty/skincare": "Shark Beauty LED Face Mask",
  // "Garden Kneeler" links to a watering can (photo finder 11-18 PM): named for what the link sells.
  "https://go.shopmy.us/p-104061840": "Sophie Conran Galvanized Steel Watering Can",
  // A box of caramels whose name ends in "Collection" reads as a category page (CATEGORY_NAME): its own words, minus that.
  "https://fortechocolate.com/product/assorted-caramels-collection/": "Forte Assorted Caramels",
};
/**
 * Photos found for photo-less picks (~/Desktop/Link-library/missing-images-1118.json, owner 11-18 PM): { "<pick name>":
 * { image, source_url, store, href, checked_at, note? } } (a plain URL string is read too); "_no_photo" and other "_" keys
 * are not photos. Matched by the pick's link first, then its name. Optional file.
 */
/** A link many products share (a ShopMy collection): never evidence of which product a photo shows. */
const sharedLink = (h) => { try { const u = new URL(h); return u.hostname === "shopmy.us" && u.pathname.startsWith("/collections/"); } catch { return false; } };
/** Lowercase letters and digits only. */
const squash = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
/**
 * A name-only photo match (wrong-photo fix 11-18 PM: a Cheirosa mist showed earbuds, a throw an UGG slipper) is kept only
 * when the row's brand shows in the photo's own link, source page or image URL.
 */
const brandInSource = (brand, from) => { const b = squash(String(brand ?? "").split(/\s+/)[0]); return b.length >= 3 && squash(from).includes(b); };
const MISSING_BY_NAME = new Map();
const MISSING_BY_HREF = new Map();
{
  const f = join(homedir(), "Desktop", "Link-library", "missing-images-1118.json");
  const v = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
  for (const [name, e] of Object.entries(v && typeof v === "object" && !Array.isArray(v) ? v : {})) {
    if (name.startsWith("_")) continue;
    const image = typeof e === "string" ? e : e && typeof e.image === "string" ? e.image : undefined;
    if (!image) continue;
    MISSING_BY_NAME.set(compact(name), { image, from: [e?.href, e?.source_url, image].filter((x) => typeof x === "string").join(" ") });
    // A shared link (a ShopMy collection holds many products) says nothing about which product a photo shows.
    if (e && typeof e.href === "string" && !sharedLink(e.href)) MISSING_BY_HREF.set(e.href, image);
  }
}
const MISSING_IMAGES = MISSING_BY_NAME;
/**
 * 1530 train (lead: "don't drop them"): a row on a ShopMy link whose photo is Amazon-hosted (never shown on a non-Amazon
 * link) takes another picks-folder row's own photo for the SAME link: the brand-links pull's ShopMy CDN photo, read
 * through the S3 -> static.shopmy.us swap. Never an Amazon, S3 or TIFF photo; a shared collection link is skipped.
 */
const HREF_PHOTO = new Map();
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  let v;
  try { v = readJson(f); } catch { continue; /* a file another agent is mid-writing: read on the next run */ }
  const visit = (r) => {
    if (!r || typeof r !== "object" || typeof r.href !== "string" || typeof r.image !== "string" || HREF_PHOTO.has(r.href) || !/^https:\/\/go\.shopmy\.us\/p-/.test(r.href)) return;
    let host = "";
    try { host = new URL(r.image).hostname; } catch { return; }
    if (/(^|\.)(media-amazon|images-amazon|ssl-images-amazon|amazon)\.com$/.test(host) || SHOPMY_S3.test(r.image) || /\.(avif|heic|heif)(\?|#|$)/i.test(r.image) || (/\.tiff?(\?|#|$)/i.test(r.image) && !/^https:\/\/static\.shopmy\.us\//.test(r.image))) return;
    HREF_PHOTO.set(r.href, r.image);
  };
  if (Array.isArray(v)) v.forEach(visit);
  else if (v && typeof v === "object") for (const l of Object.values(v)) if (Array.isArray(l)) l.forEach(visit);
}
/** A TIFF photo, unless the server converts it (KitchenAid's ".tif?fmt=png" is served as a PNG, ShopMy's mirror as JPEG). */
// ShopMy's static.shopmy.us mirror sends JPEG bytes under a ".tif" name (checked 11-18 PM: a 600x600 baseline JPEG).
const isTiff = (u) => /\.tiff?(\?|#|$)/i.test(u) && !/[?&]fmt=(png|jpe?g|webp)\b/i.test(u) && !/^https:\/\/static\.shopmy\.us\//.test(u);
/**
 * SOLD-OUT SWAPS (_soldout-swaps-1118.json, 13 Walmart rows as of 2026-11-19, owner 11-19): [{ old_href, new_href, name }]. Every row whose
 * link is a sold-out product's opens the in-stock one instead, under its name, wherever it appears. The old row's file
 * price is not the new product's (dropped), and its photo shows the old product, so the photo is kept only where the
 * swap is the same product in another size, color or pack (SOLDOUT_SAME_LOOK, judged from the two names); the others
 * fall to the photo finder. When the file gives the new product's Walmart Creator link (new_affiliate_href) and photo
 * (new_image), those are used (all 13 have both, checked 2026-11-19); the file's new_price is not a checked price (not shown).
 */
export const SOLDOUT_SAME_LOOK = /CREAMi|DualZone|Tony Chachere|Ayieyill|Salted Coconut|Headlamp|MUK LUKS/i;
const SOLDOUT = new Map();
for (const s of readList("_soldout-swaps-1118.json")) {
  if (typeof s?.old_href !== "string" || typeof s.new_href !== "string" || typeof s.name !== "string") continue;
  if (!URL.canParse(s.new_href)) continue;
  SOLDOUT.set(s.old_href, s);
}
export const soldout = { swapped: 0 };
const withSoldoutSwap = (p) => {
  const s = SOLDOUT.get(p.href) ?? SOLDOUT.get(p.affiliate_href);
  if (!s) return p;
  soldout.swapped += 1;
  // The new product's Walmart Creator link (new_affiliate_href, on an AFFILIATE_HOSTS host) is its link; a row without
  // one has no affiliate link and stays hidden like any other. Its own photo (new_image) wins over the old one.
  const creator = (() => { try { return typeof s.new_affiliate_href === "string" && AFFILIATE.has(new URL(s.new_affiliate_href).hostname) ? s.new_affiliate_href : ""; } catch { return ""; } })();
  const newImage = typeof s.new_image === "string" && s.new_image.startsWith("https://") ? s.new_image : "";
  const { price: _p, price_source: _ps, price_checked_at: _pc, price_currency: _pcur, image: oldImage, ...rest } = p;
  const image = newImage || (SOLDOUT_SAME_LOOK.test(s.name) ? oldImage : "");
  return { ...rest, name: s.name, href: s.new_href, affiliate_href: creator || s.new_href, ...(image ? { image } : {}) };
};
/**
 * LINK UPGRADES (lead 11-19, ~/Desktop/New-approvals-fit-1119.md): a link a better-paying network now carries for the same
 * product page. Soundcore's Boom Go 3i moves from Later (5.6%) to CJ (7%, AID 17033430): the CJ Evergreen deep link to
 * www.soundcore.com's own page for it (that page answered 200 with the Boom Go 3i title on 2026-11-19).
 */
export const LINK_UPGRADES = new Map([
  ["https://mavely.app.link/x6voFDcOa8b", {
    affiliate_href: "https://www.anrdoezrs.net/click-101930553-17033430?url=https%3A%2F%2Fwww.soundcore.com%2Fproducts%2Fd5103-boom-go-3i-portable-speaker-for-powerful-sound",
    href: "https://www.soundcore.com/products/d5103-boom-go-3i-portable-speaker-for-powerful-sound",
  }],
]);
export const linkUpgrades = { rows: 0 };
const withLinkUpgrade = (p) => {
  const u = LINK_UPGRADES.get(p.affiliate_href) ?? LINK_UPGRADES.get(p.href);
  if (!u) return p;
  linkUpgrades.rows += 1;
  // The old store's checked price priced the old link: it goes with it.
  const { price: _p, price_source: _ps, price_checked_at: _pc, price_currency: _pcur, ...rest } = p;
  return { ...rest, ...u };
};
function toPick(p, where) {
  if (blockedBrand(p)) return hidden.push(`${where}: ${p.name} is a blocked brand`), null;
  // Lead 11-19: Depop resale pages and UK-only boots.com show nowhere (their store pages too).
  if (resaleOrUkShop(p)) return hidden.push(`${where}: ${p.name} opens a resale or UK-only shop`), null;
  p = withLinkUpgrade(withSoldoutSwap(p));
  const fixed = withAmazonFixes(p);
  // A swap is a different product: the blocklist reads it too.
  if (fixed !== p && blockedBrand(fixed)) return hidden.push(`${where}: ${fixed.name} (swap) is a blocked brand`), null;
  p = fixed;
  // US stores only (nonUsUrl): a UK/AU/CA store link moves to the same product's US link, or the row is hidden.
  const us = usRelink(p);
  if (!us) return nonUs.hidden += 1, hidden.push(`${where}: ${p.name} opens a non-US store and has no US link`), null;
  if (us !== p) nonUs.relinked += 1;
  p = us;
  let href = p.affiliate_href || p.href;
  let url;
  try {
    url = new URL(href);
  } catch {
    hidden.push(`${where}: bad link ${href}`);
    return null;
  }
  // A raw "®" or "™" in a store path (affiliate sweep 11-18: two Community Coffee links) is percent-encoded, the way
  // the URL parser writes it; an all-ASCII link keeps its exact bytes.
  if (/[^\x00-\x7f]/.test(href)) href = url.href;
  const host = url.hostname;
  const isAffiliate = Boolean(p.affiliate_href);
  if (url.protocol !== "https:") return hidden.push(`${where}: ${href} is not https`), null;
  if (isAffiliate ? !AFFILIATE.has(host) : !PLAIN_OK.has(host)) return hidden.push(`${where}: ${p.name} has no affiliate link yet (${host})`), null;
  if (AMAZON.has(host) && host !== "amzn.to" && url.searchParams.get("tag") !== "louisianahelpr-20") return hidden.push(`${where}: ${href} lacks tag=louisianahelpr-20`), null;
  for (const v of [p.name, p.line]) if (/\$\s?\d/.test(v ?? "")) return hidden.push(`${where}: price in "${v}"`), null;
  const plainHost = (() => { try { return new URL(p.href).hostname; } catch { return ""; } })();
  // The store page: Amazon, a ShopMy pick's retailer, or the pick's store/brand. Louisiana shops and sponsors keep
  // their own badge line and have no store page here.
  // A shopmy.us/collections link opens a mixed ShopMy collection, not the retailer (affiliate sweep 11-18: 2,610 picks
  // on 43 collections were filed under Wayfair, Macy's...): no store page; the row says "On ShopMy" (product pins,
  // go.shopmy.us/p-..., keep their retailer).
  const collection = host === "shopmy.us" && url.pathname.startsWith("/collections/");
  const store = collection ? null
    : AMAZON.has(host) || AMAZON.has(plainHost) ? storeFor("Amazon")
    : LOUISIANA.has(host) || SPONSORS.has(host) ? null
    : storeFor(p.retailer || p.store || p.brand);
  // A Louisiana shop or a 25 Days sponsor keeps its own words: those rows name the local business on purpose.
  const rawName = RENAMED[p.href] ?? RENAMED[p.affiliate_href] ?? (LOUISIANA.has(host) || SPONSORS.has(host) ? p.name : productName(p.name, [p.brand, typeof p.store === "string" ? cleanName(p.store) : "", p.retailer, store && stores.get(store)?.name], domainCore(host)));
  // Owner 11-19: no model years on a shown name; an old model or an old edition is removed (modelYearName).
  const tidied = rawName && fixName(tidyName(rawName));
  if (tidied && !modelYearName(tidied)) return hidden.push(`${where}: "${tidied}" is an older model or an old edition`), null;
  const name = tidied && modelYearName(tidied);
  if (!name) return hidden.push(`${where}: "${p.name}" is a page title, store name or promo, not a product`), null;
  if (store) stores.get(store).hosts.add(host);
  const flags = Object.fromEntries(["trending", "tiktok", "shipsFast", "localPickup"].filter((k) => p[k] === true).map((k) => [k, true]));
  // No Amazon-hosted product photo is hotlinked (Associates rules: Amazon images only through SiteStripe or its API);
  // those picks get the store tile on the page. AMAZON_CDN_PHOTOS lets the SiteStripe-tagged ones through.
  const amazonHosted = typeof p.image === "string" && p.image.startsWith("https://") && AMAZON_IMAGE_HOST.test(new URL(p.image).hostname);
  // A TIFF photo shows blank in every browser (affiliate sweep 11-18: 279 ShopMy "_fpx.tif" images): dropped, so the
  // pick is swapped for a photo'd one in a mixed guide or draws its store tile.
  const tiff = typeof p.image === "string" && isTiff(p.image);
  // ShopMy's own S3 photos answer 403 AccessDenied (all 639 distinct URLs, curl 11-18 PM): dropped like the TIFFs, so
  // mixed guides swap in photo'd picks and no row makes a failed request.
  const deadHost = typeof p.image === "string" && /^https:\/\/production-shopmyshelf-[a-z]+\.s3[.-]/.test(p.image);
  const ownImage = !tiff && !deadHost && !(typeof p.image === "string" && brokenImage(p.image)) && typeof p.image === "string" && p.image.startsWith("https://") && (!amazonHosted || (AMAZON_CDN_PHOTOS && p.image_source === "amazon-sitestripe" && new URL(p.image).hostname === "m.media-amazon.com")) ? p.image : undefined;
  // "All items need a picture, find one. No excuses." (owner 11-18 PM): a pick with no usable photo takes the one the
  // link library found for it (~/Desktop/Link-library/missing-images-1118.json), never an Amazon-hosted one.
  const byName = MISSING_BY_NAME.get(compact(p.name ?? ""));
  const found = ownImage ? undefined : (!sharedLink(p.affiliate_href ?? "") && MISSING_BY_HREF.get(p.affiliate_href))
    || (!sharedLink(p.href) && MISSING_BY_HREF.get(p.href))
    || (!sharedLink(p.href) && HREF_PHOTO.get(p.href)) || (!sharedLink(p.affiliate_href ?? "") && HREF_PHOTO.get(p.affiliate_href))
    || (byName && brandInSource(p.brand, byName.from) ? byName.image : undefined) || undefined;
  // The owner approved Amazon product images for these (11-18 PM): the CDN photo, on an Amazon link only (Associates).
  const amazonFound = Boolean(found) && AMAZON_IMAGE_HOST.test(new URL(found).hostname);
  const swap = ownImage ? BADGE_PHOTO_SWAPS.get(ownImage.split("?")[0]) : undefined;
  const image = swap !== undefined ? (swap && AMAZON_CDN_PHOTOS && (AMAZON.has(host) || AMAZON.has(plainHost)) ? swap : undefined) : ownImage ?? (found && found.startsWith("https://") && !brokenImage(found) && !isTiff(found)
    && (!amazonFound || (new URL(found).hostname === "m.media-amazon.com" && (AMAZON.has(host) || AMAZON.has(plainHost)))) ? found : undefined);
  // PRICES (owner 11-18): only a checked, fresh, non-Amazon price (scripts/giftGuidePrice.mjs).
  const priced = verifiedPrice(p, [host, plainHost], store);
  // A brand field naming the store (Macy's, Target, Tractor Supply) takes the maker the name opens with (fit audit r4).
  const brand = fixedBrand(name) || retailerBrand(name, BRAND_CASE[compact(p.brand ?? "")] ?? BRAND_NAME[compact(p.brand ?? "")] ?? (p.brand || brandFromName(name)));
  const louisianaFit = p.louisianaFit && ![p.brand, p.store, p.retailer].some((x) => typeof x === "string" && NOT_LOUISIANA_BUSINESS.test(x.trim()));
  // Big batch 1120: the budget filter's band (never shown as a price; none on an Amazon pick, Associates rule), a
  // pre-order flag and a brand's discount code (21 Collective, COLLECTIVE10).
  const amazonPick = AMAZON.has(host) || AMAZON.has(plainHost) || store === "store-amazon";
  const band = amazonPick ? undefined : priced ? budgetBand(priced.price) : budgetBand(p.raw_price ?? (typeof p.price === "number" || typeof p.price === "string" ? p.price : undefined));
  const code = BRAND_CODES[brand]?.code;
  return {
    name, brand, line: stockLine(p.line) ? "" : (p.line ?? ""), href,
    ...(image ? { image } : {}), ...(priced ?? {}), ...(store ? { store } : {}), ...(louisianaFit ? { louisianaFit: true } : {}), ...flags,
    ...(band ? { band } : {}), ...(p.preorder === true ? { preorder: true } : {}), ...(code ? { code } : {}),
  };
}

/** The 25 Days sponsors guide: every pick there is a sponsor's (lead 2026-11-18: each gets the sponsor badge). */
export const SPONSORS_GUIDE = "25-days-sponsors";
/** Picks left out by the lead, by guide and brand, the brand kept by name only (Hilma's probiotic, a health product). */
export const NAME_ONLY = [{ guide: SPONSORS_GUIDE, brand: "Hilma" }];
const nameOnly = (slug, p) => NAME_ONLY.some((x) => x.guide === slug && x.brand === p.brand);

/** Near-duplicate variants (design audit r2 #7: "…Coffee Pods, 12 Boxes" and "…Coffee Pods"): same brand, same first 24 letters. */
const variantKey = (p) => `${compact(p.brand ?? "")} ${compact(p.name).slice(0, 24)}`;
/**
 * TASTE CURATION (lead 11-19, every ~/Desktop/Gift-guide-picks/_curation-*.json, read in name order so a later file
 * wins per guide): { "<slug>": { remove: [{ name, brand, reason }], top12: [names], add: [{ name, brand, href, image, why }] } }.
 * Per guide the "remove" names never show (dropped at add time and again from the final page), "top12" then the "add"
 * names lead the featured order, and the "add" rows join the guide. Every other rule still applies on top.
 */
const CURATION = {};
for (const f of readdirSync(dir).filter((x) => /^_curation-.*\.json$/.test(x)).sort()) {
  const v = readJson(f);
  if (!v || typeof v !== "object" || Array.isArray(v)) continue;
  // The 25 Days sponsors guide lists every sponsor as they gave it: no curation touches it (11-19: one dropped two sponsors).
  for (const [slug, c] of Object.entries(v)) if (!slug.startsWith("_") && slug !== "25-days-sponsors" && c && typeof c === "object") CURATION[slug] = { ...c, file: f };
}
// The taste audit (lead 11-19, every _taste-audit-*.json: { "<slug>": [{ name, reason }] }) removes like the curation.
for (const f of readdirSync(dir).filter((x) => /^_taste-audit-.*\.json$/.test(x)).sort()) {
  const v = readJson(f);
  if (!v || typeof v !== "object" || Array.isArray(v)) continue;
  for (const [slug, rows] of Object.entries(v)) {
    if (slug.startsWith("_") || slug === "25-days-sponsors" || !Array.isArray(rows)) continue;
    const c = (CURATION[slug] ??= { file: f });
    c.remove = [...(Array.isArray(c.remove) ? c.remove : []), ...rows.filter((r) => r && typeof r.name === "string")];
  }
}
const CURATION_REMOVE = new Map(Object.entries(CURATION).map(([slug, c]) => [slug, new Set((Array.isArray(c.remove) ? c.remove : []).map((r) => compact(String(r?.name ?? r ?? ""))).filter(Boolean))]));
/** Lead 11-19: Mail Carrier keeps its Walmart Creator picks at $20 or less (USPS gift limit; cheap is the point). */
const MAIL_GUIDE = "mail-carrier-and-delivery-drivers";
const keepsCheapWalmart = (slug, p) => slug === MAIL_GUIDE && /^https:\/\/(walmrt\.us|(www\.)?walmart\.com|goto\.walmart\.com)\//.test(p.href) && typeof p.price === "number" && p.price <= 20;
const curatedOut = (slug, p) => {
  const out = CURATION_REMOVE.get(slug);
  return Boolean(out && out.has(compact(p.name)) && !keepsCheapWalmart(slug, p));
};
/** No guide drops under this many picks from curation removes alone (lead 11-19); Mail Carrier keeps 15. */
const CURATION_FLOOR = 8;
const curationFloor = (slug) => (slug === MAIL_GUIDE ? 15 : CURATION_FLOOR);
const curationCounts = Object.fromEntries(Object.keys(CURATION).map((slug) => [slug, { removed: 0, added: 0, top12: 0 }]));
const guides = {};
/** The food picks moved off other guides into Treats & Food Gifts (owner 11-19), counted for the run's log. */
const movedToTreats = new Set();
/** Every pick that names a North Louisiana maker, team or town, as read (before any page's rules): North Louisiana's pool. */
const NORTH_LA_POOL = [];
/** The two new guides (11-19) list only their own file's rows (gift cards had drifted onto Gift Tags). */
const OWN_FILE_GUIDES = { "advent-calendars": /^_advent-/, "gift-tags": /^_gift-tags-/ };
const OWN_FILE_HREFS = { "advent-calendars": new Set(), "gift-tags": new Set() };
const add = (slug, raw, where) => {
  if (OWN_FILE_GUIDES[slug] && !OWN_FILE_GUIDES[slug].test(String(where))) return;
  const p = toPick(raw, where);
  if (!p) return;
  if (NORTH_LA.test(`${p.name} ${p.brand ?? ""}`)) NORTH_LA_POOL.push(p);
  // Owner 11-19: food leaves every non-food guide and goes to the one Treats & Food Gifts guide instead.
  if (foodOff(slug, p)) {
    movedToTreats.add(`${p.href} ${p.name}`);
    add(TREATS_GUIDE, raw, where);
    return hidden.push(`${where}: ${p.name} is food, moved from ${slug} to ${TREATS_GUIDE}`);
  }
  if (!fitsGuide(slug, p)) return hidden.push(`${where}: ${p.name} does not fit ${slug}`);
  if (OWN_FILE_HREFS[slug]) OWN_FILE_HREFS[slug].add(p.href);
  if (slug === SPONSORS_GUIDE) p.sponsor = true;
  const list = (guides[slug] ??= []);
  // One row per link in a guide (a ShopMy collection link is shared by several products, so those match by name too).
  const shared = new URL(p.href).hostname === "shopmy.us";
  // ... and one row per product name (design audit 11-18: UGG Tasman at #1 on Amazon and again at #23 on ShopMy).
  if (list.some((x) => (x.href === p.href && (!shared || x.name === p.name)) || compact(x.name) === compact(p.name))) return;
  // A near-duplicate variant: the one with a photo stays (the first, when both or neither have one).
  const twin = list.findIndex((x) => variantKey(x) === variantKey(p));
  if (twin >= 0) {
    if (!list[twin].image && p.image) list[twin] = p;
    return;
  }
  list.push(p);
};

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort()) {
  const slug = file.replace(/\.json$/, "");
  for (const p of deskJson(join(dir, file))) if (!nameOnly(slug, p)) add(slug, p, file);
}
/** Extras that name their guides (`fits`); each also lands on its store page. */
// _walmart-under5-1118.json: 60 Walmart links at $5 or less, photos and checked prices (lead 11-18 PM: fill Under $5).
for (const f of ["_awin.json", "_cj.json", "_impact.json", "_shopify-collabs.json", "_later.json", "_later-mylinks.json", "_later-brands.json", "_walmart-under5-1118.json"]) {
  for (const p of readList(f)) for (const slug of p.fits ?? []) if (GUIDE_SLUGS.has(slug)) add(slug, p, f);
}
/**
 * Gift cards and Subscriptions fill (owner approved 11-18 PM): _giftcards-subs-fill-1118.json, { "gift-cards": [...],
 * "subscriptions": [...] }, Amazon links in popularity order with the products' own Amazon photos (no trials, no prices).
 * Added after each guide's own picks; Subscriptions still opens on PINNED_TOP.
 */
{
  const isAmazonLink = (h) => AMAZON.has(new URL(h).hostname);
  const fill = readJson("_giftcards-subs-fill-1118.json");
  for (const slug of ["gift-cards", "subscriptions"]) {
    for (const p of Array.isArray(fill?.[slug]) ? fill[slug] : []) {
      if (p && typeof p.href === "string" && typeof p.name === "string") {
        // An affiliate short link in `href` (meowbox's mavely.app.link) is the affiliate link; a non-Amazon row's store is
        // the brand its name opens with ("meowbox Cat Subscription Box" -> meowbox's store page).
        const affiliate = AFFILIATE.has(new URL(p.href).hostname) ? { affiliate_href: p.href } : {};
        add(slug, { brand: "", line: "", ...(isAmazonLink(p.href) ? { store: "Amazon", image_source: "amazon-sitestripe" } : { store: p.name.split(" ")[0] }), ...p, ...affiliate }, "_giftcards-subs-fill-1118.json");
      }
    }
  }
}
/**
 * SAM'S CLUB MEMBERSHIPS (owner 11-19, _sams-membership-1119.json): the Plus and Club memberships on Sam's Club Creator
 * links (samsclub.co, AFFILIATE_HOSTS), pinned beside Walmart+ in Subscriptions (PINNED_TOP). Sam's Club's card art is
 * an SVG, which the photo rules do not take: SAMS_IMAGES are the same cards rendered to JPEG and served from our own
 * site (public/gift-guides/memberships/). No store page: we carry no other Sam's Club picks.
 */
export const SAMS_IMAGES = {
  "Sam's Club Plus Membership": "https://www.louisianahelpr.com/gift-guides/memberships/sams-club-plus.jpg",
  "Sam's Club Membership": "https://www.louisianahelpr.com/gift-guides/memberships/sams-club.jpg",
};
export const SAMS_LINES = { "Sam's Club Plus Membership": "Free shipping, early shopping hours and cash rewards.", "Sam's Club Membership": "A year of warehouse prices, gas savings and Scan & Go." };
{
  const v = readJson("_sams-membership-1119.json");
  const list = (guides.subscriptions ??= []);
  for (const r of [v?.alt_plus, v]) {
    if (!r || typeof r.href !== "string" || !SAMS_IMAGES[r.name] || list.some((x) => x.href === r.href)) continue;
    try { if (new URL(r.href).hostname !== "samsclub.co") continue; } catch { continue; /* not a link */ }
    const store = storeFor("Sam's Club");
    stores.get(store).hosts.add("samsclub.co");
    list.push({ name: r.name, brand: "Sam's Club", line: SAMS_LINES[r.name], href: r.href, image: SAMS_IMAGES[r.name], store });
  }
}
/**
 * Store photos (11-18 PM, _store-photos-1118.json): { "<store slug>": [{ name, href, image, ... }] }, products we list in
 * other guides that their store page was missing, each with a checked photo. Two point at another retailer (a Laneige
 * mask on printfresh.com, a Brightland oil on loft.com) and stay off those store pages. An "http:" photo is asked for over
 * https; an affiliate short link in `href` is the affiliate link.
 */
{
  const OTHER_RETAILER = /^https?:\/\/([^/]*\.)?(printfresh\.com|loft\.com)\//i;
  const v = readJson("_store-photos-1118.json");
  const listed = new Map();
  for (const list of Object.values(guides)) for (const x of list) if (!listed.has(compact(x.name))) listed.set(compact(x.name), x);
  for (const [slug, rows] of Object.entries(v && typeof v === "object" && !Array.isArray(v) ? v : {})) {
    if (!slug.startsWith("store-") || !Array.isArray(rows)) continue;
    for (const p of rows) {
      if (!p || typeof p.href !== "string" || typeof p.name !== "string" || typeof p.image !== "string") continue;
      if (OTHER_RETAILER.test(p.image) || ["printfresh.com", "loft.com"].some((d) => String(p.note ?? "").toLowerCase().includes(d))) continue;
      // A plain retailer link takes the affiliate link the same product already has in another guide.
      const twin = AFFILIATE.has(new URL(p.href).hostname) ? undefined : listed.get(compact(p.name));
      const affiliate = AFFILIATE.has(new URL(p.href).hostname) ? { affiliate_href: p.href } : twin ? { affiliate_href: twin.href } : {};
      // The store page it is filed under names its store (a ShopMy pin carries none of its own).
      add(slug, { brand: twin?.brand ?? "", line: twin?.line ?? "", store: stores.get(slug)?.name ?? slug.slice("store-".length), ...p, image: p.image.replace(/^http:\/\//, "https://"), ...affiliate }, "_store-photos-1118.json");
    }
  }
}
/**
 * STORE FILLS (11-18 night): _store-fill-{amazon,shopmy,later,shark}-1118.json. Shapes: { "<store key>": [rows] } or
 * { links: [{ store_slug, fits?, ...row }] }. Each row joins its store page (store-<key>, when that store exists); a
 * row's `fits` guides take it too, below the guide's audited top 25 (FILL_HREFS, featuredFirst). File prices are not
 * checked prices and are dropped. Photo, fit and Louisiana rules apply as everywhere.
 */
export const FILL_HREFS = new Set();
/** A store-fill name tidied (owner 11-18 night: long or generic Amazon names): size-range notes, "Unisex-Adult", an
 * all-caps brand and a trailing burn-time or "including ..." clause go; tidyName then trims anything still long. */
const cleanFillName = (n) => String(n).replace(/\s*\((Standard|Regular)[^)]*Size\)/gi, "").replace(/\bUnisex-Adult\s*/g, "")
  .replace(/^THE NORTH FACE\b/, "The North Face").replace(/\bWomens\b/g, "Women's").replace(/\bMens\b/g, "Men's")
  .replace(/\s+with up to \d+ Hour Burn Time$/i, "").replace(/\s+including .*$/i, "").replace(/\s*\((clearance|sale|on sale)\)/gi, "").replace(/\s{2,}/g, " ").trim();
export const fillCounts = { rows: 0, store: 0, guides: 0, noCommission: 0, noStore: new Set() };
{
  for (const f of ["_store-fill-amazon-1118.json", "_store-fill-shopmy-1118.json", "_store-fill-later-1118.json", "_store-fill-shark-1118.json"]) {
    const v = readJson(f);
    if (!v || typeof v !== "object") continue;
    // { store: "SharkNinja", picks: [...] } (the Shark file) names one store for every row.
    const oneStore = typeof v.store === "string" && Array.isArray(v.picks) ? storeFor(v.store) : null;
    const rows = Array.isArray(v) ? v : Array.isArray(v.links) ? v.links : oneStore ? v.picks.map((r) => ({ store_slug: oneStore, ...r }))
      : Object.entries(v).filter(([k, l]) => !k.startsWith("_") && Array.isArray(l)).flatMap(([k, l]) => l.map((r) => ({ store_slug: k, ...r })));
    for (const r of rows) {
      if (!r || typeof r.href !== "string" || typeof r.name !== "string" || typeof r.image !== "string") continue;
      // A pin ShopMy shows at no commission (round 2, 11-18 night: the 4 Community Coffee pins, "none shown") earns
      // nothing: left out.
      if (/\bnone\b/i.test(String(r.commission ?? ""))) { fillCounts.noCommission += 1; continue; }
      fillCounts.rows += 1;
      const key = String(r.store_slug ?? "").replace(/^store-/, "");
      // A short key names the one store page it starts ("darn-tough" -> store-darn-tough-vermont).
      const longer = key ? [...stores.keys()].filter((k) => k.startsWith(`store-${key}-`)) : [];
      const slug = !key ? "" : stores.has(`store-${key}`) || longer.length !== 1 ? `store-${key}` : longer[0];
      let host = "";
      try { host = new URL(r.href).hostname; } catch { continue; }
      const { price: _price, commission: _commission, guides: _guides, ...row } = r;
      row.name = cleanFillName(r.name);
      const raw = { brand: r.brand ?? stores.get(slug)?.name ?? "", line: "", ...row, ...(stores.has(slug) ? { store: stores.get(slug).name } : {}),
        image: r.image.replace(/^http:\/\//, "https://"), ...(AFFILIATE.has(host) && !AMAZON.has(host) ? { affiliate_href: r.href } : {}),
        ...(AMAZON.has(host) ? { image_source: "amazon-sitestripe" } : {}) };
      if (stores.has(slug)) { add(slug, raw, f); fillCounts.store += 1; } else if (slug) fillCounts.noStore.add(slug);
      for (const g of Array.isArray(r.fits) ? r.fits : Array.isArray(r.guides) ? r.guides : []) {
        if (!GUIDE_SLUGS.has(g) || g.startsWith("store-")) continue;
        const before = guides[g]?.length ?? 0;
        add(g, raw, f);
        if ((guides[g]?.length ?? 0) > before) { FILL_HREFS.add(guides[g][guides[g].length - 1].href); fillCounts.guides += 1; }
      }
    }
  }
}
/**
 * LATE FILLS (batch 11-19): research files whose rows go into guides the lead named, each below the guide's audited
 * top 25 (FILL_HREFS) like a store fill; the files' own `fits` are not taken. File prices are not checked prices:
 * dropped. Every row needs its affiliate link (Rakuten on click.linksynergy.com, Awin on www.awin1.com: AFFILIATE_HOSTS).
 * - _momcozy-1118.json: 10 Momcozy Rakuten deep links (breast pumps already left out), New Mom only.
 * - _fidget-1118.json: The Fidget Company (Awin). The Classic Set in the big kids and teens guides and Stocking
 *   Stuffers; never Dad or Coworkers (owner 11-19). Both sets sit on its store page. Its collection link is skipped (H3;
 *   collectionLink would hide it anyway).
 */
export const LATE_FILLS = {
  "_momcozy-1118.json": () => ["new-mom"],
  // Owner 11-19: "Remove fidget from dad and coworker" (both sets stay on The Fidget Company's store page).
  "_fidget-1118.json": (r) => /\bclassic\b/i.test(r.name) ? ["boys-big-kids", "girls-big-kids", "gender-neutral-big-kids", "boys-teens", "girls-teens", "gender-neutral-teens", "stocking-stuffers"] : [],
};
export const lateFillCounts = {};
for (const [f, guidesFor] of Object.entries(LATE_FILLS)) {
  const v = readJson(f);
  const c = (lateFillCounts[f] = { rows: 0, added: 0 });
  for (const r of Array.isArray(v?.picks) ? v.picks : []) {
    if (!r || typeof r.href !== "string" || typeof r.name !== "string" || typeof r.affiliate_href !== "string" || collectionLink(r.href)) continue;
    c.rows += 1;
    const { price: _price, compare_at: _compareAt, commission: _commission, fits: _fits, ...row } = r;
    // Every row also sits on its own store page, even one no guide takes (the Fidget Executive Set, owner 11-19).
    const own = typeof r.store === "string" ? storeFor(r.store) : null;
    if (own) add(own, row, f);
    for (const g of guidesFor(r)) {
      if (!GUIDE_SLUGS.has(g)) continue;
      const before = guides[g]?.length ?? 0;
      add(g, row, f);
      if ((guides[g]?.length ?? 0) > before) { FILL_HREFS.add(guides[g][guides[g].length - 1].href); c.added += 1; }
    }
  }
}
/** Store extras: the store page, and for Warby Parker the guides the owner named (11-18). */
const WARBY_GUIDES = ["her", "him", "coworkers", "rns", "girls-teens", "boys-teens"];
const storeExtras = [["_xtratuf.json", []], ["_warby-parker.json", WARBY_GUIDES], ["_walmart.json", []], ["_tiktok-shop.json", []], ["_amazon-trending.json", []], ["_later.json", []], ["_awin.json", []], ["_cj.json", []], ["_impact.json", []], ["_shopify-collabs.json", []], ["_later-mylinks.json", []], ["_later-brands.json", []], ["_walmart-under5-1118.json", []]];
for (const [f, extraGuides] of storeExtras) {
  for (const p of readList(f)) {
    const pick = toPick(p, f);
    if (!pick?.store) continue;
    add(pick.store, p, f);
    for (const g of extraGuides) add(g, p, f);
  }
}
/** XTRATUF in the Louisiana guides the lead named (2026-11-18), by product, from _xtratuf.json. */
export const XTRATUF_GUIDES = {
  "crawfish-boil-host": ["Men's Ankle Deck Boot", "Women's Ankle Deck Boot"],
  "commercial-fishermen-and-shrimpers": ['Men\'s 15" Legacy Boot', "Men's Ankle Deck Boot", "Women's Ankle Deck Boot"],
};
for (const [slug, names] of Object.entries(XTRATUF_GUIDES)) {
  for (const p of readList("_xtratuf.json")) if (names.includes(p.name)) add(slug, p, "_xtratuf.json");
}
/** Amazon bounties (Prime, Audible, registries) in the guides they fit. */
const BOUNTY_GUIDES = { "Try Prime free": ["store-amazon", "stocking-stuffers"], "Audible free trial": ["book-lover", "new-mom", "store-amazon"], "Start an Amazon Baby Registry": ["new-mom", "store-amazon"], "Start an Amazon Wedding Registry": ["newlyweds", "newly-engaged", "store-amazon"] };
// The curation's added rows (each a real link and photo), after every source file so a duplicate keeps the first row.
for (const [slug, c] of Object.entries(CURATION)) {
  if (!GUIDE_SLUGS.has(slug)) continue;
  for (const a of Array.isArray(c.add) ? c.add : []) {
    if (!a?.name || !a?.href) continue;
    const before = guides[slug]?.length ?? 0;
    add(slug, { brand: a.brand ?? "", line: a.why ?? "", ...a, affiliate_href: a.affiliate_href ?? a.href }, c.file);
    if ((guides[slug]?.length ?? 0) > before) curationCounts[slug].added += 1;
  }
}
/**
 * THIN-GUIDE FILLS (lead 11-19, every _fill-thin-*.json and _trending-brands-*.json): rows with a real href, name and
 * image, each naming its guides (`fits` / `guides` / `guide_slugs` / `guide`), or grouped under their guide's slug ({ "<slug>": [rows] }, or { picks | links: [rows] }).
 */
export const thinFillCounts = {};
// Follow-up 11-19: _trend-links-*.json ({ "<slug>": [rows] }) too, and the two new guides' own files (_advent-*.json ->
// Advent Calendars, _gift-tags-*.json -> Gift Tags; rows that name no guide go to the file's guide).
const FILE_GUIDE = [[/^_advent-/, "advent-calendars"], [/^_gift-tags-/, "gift-tags"]];
/** Any fill file's rows: a list, { picks | links: [rows] }, or rows grouped under a key ({ "<slug or brand>": [rows] }, the key as _guide). */
const rowsOf = (v) => (Array.isArray(v) ? v : Array.isArray(v?.picks) ? v.picks : Array.isArray(v?.links) ? v.links
  : v && typeof v === "object" ? Object.entries(v).filter(([k, l]) => !k.startsWith("_") && Array.isArray(l)).flatMap(([k, l]) => l.map((r) => ({ _guide: k, ...r }))) : []);
/**
 * DEDUPE (owner 11-19: "some stuff is likely duplicates"; ~/Desktop/Gift-guide-picks/_dedupe-1119.json): every drop[]
 * row is skipped, matched on its href AND its file together (some drops share their href with the kept row in another
 * file), and the kept row (dup_of, from dup_of_file) takes the guide slots the dropped row would have held.
 */
export const DEDUPE_FILE = "_dedupe-1119.json";
const DEDUPE = readJson(DEDUPE_FILE) ?? {};
export const DEDUPE_DROP = new Map((Array.isArray(DEDUPE.drop) ? DEDUPE.drop : []).filter((d) => d && typeof d.href === "string" && typeof d.file === "string").map((d) => [`${d.file}|${d.href}`, d]));
export const DEDUPE_FLAGS = Array.isArray(DEDUPE.flags) ? DEDUPE.flags.filter((x) => x && typeof x.href === "string") : [];
export const dedupeCounts = { dropped: 0, slotted: 0 };
const keptRow = (d) => (typeof d.dup_of === "string" && typeof d.dup_of_file === "string" ? rowsOf(readJson(d.dup_of_file)).find((r) => r?.href === d.dup_of) : undefined);
/**
 * BRAND LINKS (lead 11-19, _brand-links-1119-a.json and -b.json: { "<brand>": [{ name, href, image, price, section,
 * store }] }) name no guide: _brand-links-placement-1119c.json ({ "<href>": ["<slug>", ...] }, chosen by hand for fit,
 * thin guides first) places them.
 */
/** ASIN -> true when its product page title matched the row (the import train title check of 2026-11-19; null = not read yet). */
export const AMAZON_TITLE_OK = (() => {
  try {
    return new Map(Object.entries(readJson("_amazon-title-check-1119.json") ?? {}).map(([a, v]) => [a, v?.ok ?? null]));
  } catch {
    // Mid-write by the checker: no row passes this run.
    return new Map();
  }
})();
export const BRAND_PLACEMENT_FILE = "_brand-links-placement-1119c.json";
// 1530 train: later placement files (_brand-links-placement-1530.json, ...) place the rows the hand file does not name,
// and the lead's asks there (adult stocking stuffers, Teen Boy, Husband, Camp Snap off Teen Boy) override it.
const BRAND_PLACEMENT = Object.assign({}, readJson(BRAND_PLACEMENT_FILE) ?? {}, ...readdirSync(dir)
  .filter((x) => /^_brand-links-placement-.*\.json$/.test(x) && x !== BRAND_PLACEMENT_FILE).sort().map((x) => readJson(x) ?? {}));
for (const f of readdirSync(dir).filter((x) => /^_(fill-thin|fill-1119|trending-brands|curated-links|trend-links|advent|gift-tags|brand-links-1119)-.*\.json$/.test(x)).sort()) {
  const fileGuide = FILE_GUIDE.find(([rx]) => rx.test(f))?.[1];
  const brandFile = /^_brand-links-/.test(f);
  const v = readJson(f);
  const c = (thinFillCounts[f] = { rows: 0, added: 0 });
  const rows = rowsOf(v).map((r) => (brandFile && r ? { ...r, brand: r.brand ?? r._guide, _guide: undefined, guides: Array.isArray(BRAND_PLACEMENT[r.href]) ? BRAND_PLACEMENT[r.href] : [] } : r));
  for (const r0 of rows) {
    let r = r0;
    const drop = r0 && DEDUPE_DROP.get(`${f}|${r0.href}`);
    if (drop) {
      dedupeCounts.dropped += 1;
      const kept = keptRow(drop);
      if (!kept) continue;
      // The kept row, in the dropped row's guides (its own guides are placed by its own file).
      r = { ...kept, fits: r0.fits, guides: r0.guides, guide: r0.guide, guide_slugs: r0.guide_slugs, _guide: r0._guide };
      dedupeCounts.slotted += 1;
    }
    if (!r || typeof r.href !== "string" || typeof r.name !== "string" || typeof r.image !== "string" || collectionLink(r.href)) continue;
    // An Amazon row whose product page was throttled has an unchecked title (lead 11-19): held until its title is checked.
    if (/throttled/i.test(String(r.source ?? ""))) { c.held = (c.held ?? 0) + 1; continue; }
    // _fill-1119-a's Amazon rows lost their title check (lead 11-19): a row goes in only when its product page's <title>
    // was read and matches its name and brand (_amazon-title-check-1119.json, one fetch at a time); the rest wait.
    if (/^_fill-1119-a\./.test(f) && /^amazon$/i.test(String(r.source ?? "")) && AMAZON_TITLE_OK.get(r.href.match(/\/dp\/([A-Z0-9]{10})/)?.[1] ?? "") !== true) { c.held = (c.held ?? 0) + 1; continue; }
    c.rows += 1;
    let host = "";
    try { host = new URL(r.href).hostname; } catch { continue; }
    const { price: _price, commission: _commission, commission_pct: _pct, network: _network, fits, guides: gs, guide, guide_slugs: slugs, _guide, ...row } = r;
    const raw = { brand: r.brand ?? "", line: r.why ?? r.line ?? "", ...row, image: r.image.replace(/^http:\/\//, "https://"),
      ...(r.affiliate_href ? {} : AFFILIATE.has(host) && !AMAZON.has(host) ? { affiliate_href: r.href } : {}), ...(AMAZON.has(host) ? { image_source: "amazon-sitestripe" } : {}) };
    const targets = [...new Set([...(Array.isArray(fits) ? fits : []), ...(Array.isArray(gs) ? gs : []), ...(Array.isArray(slugs) ? slugs : []), ...(typeof guide === "string" ? [guide] : []), ...(_guide ? [_guide] : []), ...(fileGuide ? [fileGuide] : [])])]
      // Lead 11-19: the New Balance 574 is men's (him and teen boys only); a Saranoni toddler blanket goes on baby and new-mom guides only.
      .filter((g) => !/\bnew balance 574\b/i.test(r.name) || /^(him|boyfriend-or-husband|boys-teens|dad|brother)$/.test(g))
      .filter((g) => !/saranoni/i.test(`${r.brand ?? ""} ${r.name}`) || /bab(y|ies)|toddler|new-mom|mom-to-be/.test(g))
      // Owner 11-19: no Camp Snap on Teen Boy (Teen Girl and a big-kids guide instead).
      .filter((g) => !/\bcamp snap\b/i.test(`${r.brand ?? ""} ${r.name}`) || g !== "boys-teens");
    for (const g of targets) {
      if (!GUIDE_SLUGS.has(g) || g.startsWith("store-")) continue;
      const before = guides[g]?.length ?? 0;
      add(g, raw, f);
      if ((guides[g]?.length ?? 0) > before) { FILL_HREFS.add(guides[g][guides[g].length - 1].href); c.added += 1; }
    }
  }
}
/**
 * THE UNUSED LIBRARY (owner 11-19: "we have brands that literally nothing needs to be repeated"): the link library's
 * unused product links (~/Desktop/Link-library/unused-by-guide.json, { "<slug>": [{ name, brand, affiliate_href,
 * store_href, image, type, match }] }), each with a photo, join the guide they were matched to; every rule applies.
 */
export const unusedCounts = { rows: 0, added: 0 };
{
  const file = join(homedir(), "Desktop", "Link-library", "unused-by-guide.json");
  const v = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  for (const [slug, rows] of Object.entries(v && typeof v === "object" && !Array.isArray(v) ? v : {})) {
    if (!GUIDE_SLUGS.has(slug) || slug.startsWith("store-") || !Array.isArray(rows)) continue;
    for (const r of rows) {
      if (!r || r.type !== "product" || r.match === "store" || typeof r.name !== "string" || typeof r.image !== "string" || !r.image.startsWith("http")) continue;
      const href = typeof r.store_href === "string" && r.store_href ? r.store_href : r.affiliate_href;
      if (typeof href !== "string" || typeof r.affiliate_href !== "string" || collectionLink(href)) continue;
      unusedCounts.rows += 1;
      const before = guides[slug]?.length ?? 0;
      add(slug, { brand: r.brand ?? "", line: "", name: r.name, href, affiliate_href: r.affiliate_href, image: r.image.replace(/^http:\/\//, "https://") }, "unused-by-guide.json");
      if ((guides[slug]?.length ?? 0) > before) { FILL_HREFS.add(guides[slug][guides[slug].length - 1].href); unusedCounts.added += 1; }
    }
  }
}
for (const b of readList("_amazon-bounties.json")) {
  const key = Object.keys(BOUNTY_GUIDES).find((k) => b.name.startsWith(k));
  for (const slug of key ? BOUNTY_GUIDES[key] : []) add(slug, { name: b.name, brand: "Amazon", line: "", href: b.href }, "_amazon-bounties.json");
}
/**
 * Mixed guides swap a pick with no photo for an unused photo'd pick the link library lists for that guide (lead
 * 2026-11-18: rows show a photo; most no-photo picks are Amazon, so the swap also moves guides toward <= ~50% Amazon).
 * Store pages and the sponsors guide keep every pick. A swapped-out pick still lists on its store page (Amazon's too).
 */
const swappedOut = [];
{
  const unused = (() => {
    try {
      return JSON.parse(readFileSync(join(LIB, "unused-by-guide.json"), "utf8"));
    } catch {
      // No link library on this machine: nothing to swap in, every pick stays.
      return {};
    }
  })();
  const used = new Set(Object.values(guides).flatMap((l) => l.map((p) => p.href)));
  for (const slug of Object.keys(guides)) {
    if (slug.startsWith("store-") || slug === SPONSORS_GUIDE || !GUIDE_SLUGS.has(slug)) continue;
    const list = guides[slug];
    const names = new Set(list.map((p) => compact(p.name)));
    const pool = [];
    for (const u of Array.isArray(unused[slug]) ? unused[slug] : []) {
      if (u.type !== "product" || !u.image) continue;
      const raw = { brand: u.brand, name: u.name, line: u.line ?? "", image: u.image, image_source: u.image_source, href: u.store_href || u.affiliate_href, affiliate_href: u.affiliate_href };
      const p = toPick(raw, `unused-by-guide ${slug}`);
      if (!p?.image || used.has(p.href) || names.has(compact(p.name)) || !fitsGuide(slug, p) || list.some((x) => variantKey(x) === variantKey(p))) continue;
      pool.push(p);
      names.add(compact(p.name));
    }
    for (let i = 0; i < list.length && pool.length; i++) {
      if (list[i].image) continue;
      const p = pool.shift();
      swappedOut.push(list[i]);
      used.add(p.href);
      list[i] = p;
    }
  }
}
/** Photos first, order kept inside each group. */
for (const slug of Object.keys(guides)) guides[slug] = [...guides[slug].filter((p) => p.image), ...guides[slug].filter((p) => !p.image)];
const COLOR_WORDS = "black|white|red|blue|green|pink|purple|gold|silver|grey|gray|navy|brown|beige|cream|tan|ivory|yellow|orange|teal|clear|multi|multicolor|rose|charcoal|olive|sage|lavender|burgundy|maroon|natural|espresso|stone|sand|mint|coral|plum|copper|bronze|chrome|walnut|oak|honey|camo|realtree|mossy oak";
const SIZE_UNITS = "oz|fl oz|fl\\.? oz|in|inch|inches|ft|qt|quart|ct|count|pc|pcs|piece|pieces|pack|pk|ml|l|liter|lb|lbs|mm|cm|gb|tb|g|kg|cup|cups";
export const dedupeKey = (name) => String(name ?? "").toLowerCase()
  .replace(/\([^)]*\)/g, " ")
  .replace(new RegExp(`\\b\\d+(\\.\\d+)?\\s*-?\\s*(${SIZE_UNITS})\\b\\.?`, "g"), " ")
  .replace(/\b(set|pack|box) of \d+\b|\b\d+\s*-?\s*(pack|pk|count|ct)\b/g, " ")
  // "Thin Blue Line" and "Thin Red Line" flags are two products (police, fire): a color before "line" stays.
  .replace(new RegExp(`\\b(${COLOR_WORDS})\\b(?! line\\b)`, "g"), " ")
  .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
/** The color words a pick's name names, in name order ("Stanley Quencher, Rose Quartz" -> "rose"); "" when none. */
export const pickColor = (p) => [...String(p.name ?? "").toLowerCase().matchAll(new RegExp(`\\b(${COLOR_WORDS})\\b`, "g"))].map((m) => m[1]).join(" ");
/** An LSU item (owner 11-19: at most LSU_MAX in one guide section). */
export const LSU_ITEM = /\bLSU\b|\bLouisiana State\b|\bTigers?\b.*\bLSU\b/i;
export const LSU_MAX = 2;
/** The merged guides made new in 1120: no picks of their own, only their sections (src/content/giftGuideMerges.mjs). */
export const NEW_MERGE_PARENTS = new Set([...NEW_PARENTS, ...NO_LIST_SECTIONS]);
/** An old guide's section title on its merged guide: its index title, with its age band ("Toddlers (ages 1–3)"). */
const oldSectionTitle = (slug) => {
  const raw = indexSrc.match(new RegExp(`\\{[^{}]*slug: "${slug}"[^{}]*\\}`))?.[0] ?? "";
  const title = raw.match(/title: "([^"]*)"/)?.[1] ?? slug;
  const age = raw.match(/age: "([^"]*)"/)?.[1];
  return age ? `${title} (${age})` : title;
};
/**
 * THE FIT AUDITS of the merged guides (lead 11-20: ~/Desktop/Gift-guide-picks/_fit-audit-big-am.json and -nz.json,
 * read on e2aa9b4f75; each row { guide, section, item_name, href, action: cut | move, move_to_guide, move_to_section }).
 * A row's guide and section name its old guide (the section titles of that build, or a section group's title); a cut
 * is a judgment cut there, so the sort fills its place from the unused pool with the next strong fit; a move is a cut
 * there and a forced place on its new guide. A store page's cut leaves that page. The owner's protected picks (her
 * keeps and swaps, the Fabletics scrubs) are never cut.
 */
export const AUDIT_1120 = (() => {
  const norm = (x) => String(x ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  const titleSlug = new Map();
  // The big batch's parents (BASE_MERGES) too: the follow-up audits name them ("work-gifts", section "Boss").
  for (const m of [...BASE_MERGES, ...GUIDE_MERGES]) {
    for (const sl of m.sections) titleSlug.set(`${m.parent}|${norm(oldSectionTitle(sl))}`, sl);
    for (const g of SECTION_GROUPS[m.parent]?.groups ?? []) titleSlug.set(`${m.parent}|${norm(g.title)}`, g.from[0]);
    titleSlug.set(`${m.parent}|toppicks`, m.parent);
  }
  const oldSlug = (guide, section) => {
    if (!guide) return null;
    if (!section) return guide;
    return titleSlug.get(`${guide}|${norm(section)}`) ?? titleSlug.get(`${guide}|${norm(section.replace(/\s*\(ages[^)]*\)/i, ""))}`) ?? guide;
  };
  const out = { cuts: new Map(), storeCuts: new Set(), storeMoves: new Map(), moves: [], rows: 0, skipped: [] };
  for (const f of ["_fit-audit-big-am.json", "_fit-audit-big-nz.json"]) {
    let rows = [];
    try { rows = readJson(f) ?? []; } catch { continue; /* mid-write: read on the next run */ }
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || typeof r.href !== "string" || !["cut", "move"].includes(r.action)) continue;
      out.rows += 1;
      if (/^Fabletics .*Scrub/i.test(String(r.item_name ?? ""))) { out.skipped.push(`protected: ${r.item_name}`); continue; }
      const from = oldSlug(r.guide, r.section);
      if (!from) continue;
      if (from.startsWith("store-")) {
        out.storeCuts.add(`${from}|${r.href}`);
        if (r.action === "move" && typeof r.move_to_guide === "string" && r.move_to_guide.startsWith("store-")) out.storeMoves.set(`${from}|${r.href}`, r.move_to_guide);
        continue;
      }
      // A cut is off the whole merged guide (every one of its sections), not only the section it was seen in.
      const parent = MERGED_INTO[from]?.parent ?? from;
      const family = [parent, ...(GUIDE_MERGES.find((m) => m.parent === parent)?.sections ?? [])];
      for (const sl of family) out.cuts.set(sl, new Set([...(out.cuts.get(sl) ?? []), `h:${r.href}`]));
      if (r.action === "move") {
        const to = oldSlug(r.move_to_guide || r.guide, r.move_to_section);
        // A move within the same merged guide keeps the item there: its new section is not cut.
        if (to && to !== from) { out.moves.push({ href: r.href, from, to }); out.cuts.get(to)?.delete(`h:${r.href}`); }
      }
    }
  }
  // FOLLOW-UP 1120: the three full audits and the guide QA (scripts/giftGuideFollowUp1120.mjs), mapped onto the merged
  // guides the same way: a cut leaves the whole merged guide, a store-page copy leaves its page, a move is placed.
  const fu = auditActions1120(readAudits1120(readJson), oldSlug);
  for (const c of fu.cuts) {
    if (c.slug.startsWith("store-")) { out.storeCuts.add(`${c.slug}|${c.href}`); continue; }
    if (/^Fabletics .*Scrub/i.test(c.item)) { out.skipped.push(`protected: ${c.item}`); continue; }
    const parent = MERGED_INTO[c.slug]?.parent ?? c.slug;
    const family = [parent, ...(GUIDE_MERGES.find((m) => m.parent === parent)?.sections ?? [])];
    for (const sl of family) out.cuts.set(sl, new Set([...(out.cuts.get(sl) ?? []), `h:${c.href}`]));
  }
  for (const k of fu.storeCuts) out.storeCuts.add(k);
  for (const mv of fu.moves) if (mv.to !== mv.from && !mv.to.startsWith("store-")) { out.moves.push(mv); out.cuts.get(mv.to)?.delete(`h:${mv.href}`); }
  out.renames = fu.renames;
  out.followUp = fu.counts;
  out.oldSlug = oldSlug;
  return out;
})();
/**
 * FEATURED ORDER (owner 11-18 PM: "This can't possibly be the top gifts you're recommending"): _featured-order.json,
 * { "<slug>": [pick names or { name, from }, up to 25], "top-10": [{ guide, name }] }, from bestseller research over existing picks only.
 * A guide's featured picks lead in that order, then the rest by the photos-first order above. Optional file.
 */
const FEATURED = (() => {
  const v = readJson("_featured-order.json");
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
})();
/**
 * FIT AUDIT (11-18 PM, _fit-audit-1118.json): each guide's `final_top25` is its featured order (misfits replaced, 25 per
 * guide), and `remove_louisiana` names leave that page. Crawfish Boil Host and Purple & Gold moved into the Louisiana
 * section (owner 11-18 PM) and keep their own order: the audit stripped their Louisiana items before the move.
 */
const AUDIT = (() => {
  const v = readJson("_fit-audit-1118.json");
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
})();
const MOVED_TO_LOUISIANA = ["crawfish-boil-host", "purple-and-gold-lover"];
for (const [slug, a] of Object.entries(AUDIT)) {
  // "top-10" is the landing's Top 10, owned by _featured-order.json as { guide, name } pairs: the audit's bare names
  // replaced it, so every entry stopped resolving and "most loved" nurse picks filled the row (owner 11-19).
  if (slug === "top-10" || MOVED_TO_LOUISIANA.includes(slug) || !Array.isArray(a?.final_top25) || !a.final_top25.length) continue;
  FEATURED[slug] = a.final_top25.filter((n) => typeof n === "string");
}
// The curation's top 12, then its added rows, lead the guide (over the fit audit's order; lead 11-19).
for (const [slug, c] of Object.entries(CURATION)) {
  const top = (Array.isArray(c.top12) ? c.top12 : []).filter((n) => typeof n === "string");
  if (!top.length) continue;
  FEATURED[slug] = [...new Set([...top, ...(Array.isArray(c.add) ? c.add : []).map((a) => a?.name).filter((n) => typeof n === "string")])];
}
/** The Louisiana section's guides (giftGuideIndex.ts group "Louisiana"): the only guides that hold Louisiana items. */
const LOUISIANA_GUIDES = new Set([...indexSrc.matchAll(/group: "Louisiana"[^}]*?slug: "([^"]+)"/g)].map((m) => m[1]));
const LA_HOSTS = new Set([...LOUISIANA, ...LA_SPONSORS]);
/** Store pages that are themselves a Louisiana brand's keep their own items. */
const LOUISIANA_STORE_PAGES = new Set(["store-community-coffee", "store-rebeccaillustrated"]);
const auditGone = (slug, p) => !MOVED_TO_LOUISIANA.includes(slug) && !slug.startsWith("store-")
  && Array.isArray(AUDIT[slug]?.remove_louisiana) && AUDIT[slug].remove_louisiana.some((n) => typeof n === "string" && compact(n) === compact(p.name));
/** A pick this page may not show under the Louisiana rule (a guide or store page outside the section). */
// Store pages follow the same lasting rule (a national store page drops Louisiana items; a Louisiana brand's own page keeps
// them); the audit's per-name lists apply to guides.
export const louisianaBlocked = (slug, p) => auditGone(slug, p) || (!LOUISIANA_GUIDES.has(slug) && !LOUISIANA_STORE_PAGES.has(slug) && isLouisianaItem(p, LA_HOSTS));
/** No more than one XTRATUF boot in any guide's first FEATURED_TOP picks (owner 11-18 PM: Her opened on two), store pages aside. */
export const FEATURED_TOP = 12;
/** A featured or trending name matches a pick by exact name, then normalized name, then a normalized prefix either way. */
const sameName = (want, have) => {
  const a = compact(want);
  const b = compact(have);
  if (!a || !b) return false;
  if (a === b || dedupeKey(want) === dedupeKey(have)) return true;
  return Math.min(a.length, b.length) >= 12 && (a.startsWith(b) || b.startsWith(a));
};
const findByName = (list, want) => list.find((p) => compact(p.name) === compact(want)) ?? list.find((p) => sameName(want, p.name));
const isXtratuf = (p) => /^xtratuf$/i.test(p.brand ?? "") || p.store === "store-xtratuf";
/**
 * A guide's featured entries: a pick name in that guide, or { name, from } borrowed from another guide (research 11-18
 * PM, the top 25 per guide). A borrowed pick reuses that guide's pick (link and photo) and must still fit this guide.
 */
/** Picks the owner put at the top of a guide herself (11-18 PM: "Subscription you can put Walmart plus here ... and Amazon"). */
export const PINNED_TOP = {
  subscriptions: ["Walmart+ membership", "Sam's Club Plus Membership", "Sam's Club Membership", "Gift Prime (3-month gift membership)", "Gift an Audible membership (1, 3, 6 or 12 months)",
    "Gift Kindle Unlimited (6, 12 or 24 months)", "Audible Premium Plus annual membership"],
};
/** Picks that may show without a photo (the owner's Subscriptions memberships, until one is found). */
export const NO_PHOTO_OK = new Set(PINNED_TOP.subscriptions);
const hasPhoto = (p) => Boolean(p.image) || NO_PHOTO_OK.has(p.name);
let photoless = 0;
const featuredEntries = (slug) => [...(PINNED_TOP[slug] ?? []), ...(Array.isArray(FEATURED[slug]) ? FEATURED[slug] : [])]
  .filter((x) => typeof x === "string" || (x && typeof x === "object" && typeof x.name === "string"));
const featuredNames = (slug) => featuredEntries(slug).map((x) => (typeof x === "string" ? x : x.name));
/** Every guide pick by compact name (photo'd first), for featured names the guide itself does not hold (the audit's replacements). */
let globalByName;
const fromAnyGuide = (slug, name) => {
  if (!globalByName) {
    globalByName = new Map();
    for (const [g, l] of Object.entries(guides)) if (!g.startsWith("store-")) for (const p of l) {
      const k = compact(p.name);
      if (!globalByName.has(k) || (!globalByName.get(k).image && p.image)) globalByName.set(k, p);
    }
  }
  const p = globalByName.get(compact(name));
  return p && fitsGuide(slug, p) && !louisianaBlocked(slug, p) ? p : undefined;
};
const resolveFeatured = (slug, list, e) => {
  if (typeof e === "string") {
    // The guide's own row, unless it has no photo and another guide holds the same product with one.
    const own = findByName(list, e);
    return own?.image ? own : fromAnyGuide(slug, e) ?? own;
  }
  const own = findByName(list, e.name);
  if (own) return own;
  const from = typeof e.from === "string" && e.from !== slug ? guides[e.from] : undefined;
  const p = from ? findByName(from, e.name) : undefined;
  return p && fitsGuide(slug, p) ? p : undefined;
};
const featuredFirst = (slug, list) => {
  const lead = featuredEntries(slug).map((e) => resolveFeatured(slug, list, e)).filter(Boolean);
  // No photo, no row (see NO PHOTO, NO ROW below): dropped before the top 25 is counted, so its limits hold.
  const kept = [...new Set([...lead, ...list])].filter((p) => !louisianaBlocked(slug, p)).filter((p) => slug === SPONSORS_GUIDE || hasPhoto(p) || ((photoless += 1), false));
  // Store-fill picks sit below the audited top: after every other pick unless the audit itself names them.
  const fillBelow = (p) => FILL_HREFS.has(p.href) && !lead.includes(p);
  const ordered = [...kept.filter((p) => !fillBelow(p)), ...kept.filter(fillBelow)];
  if (slug.startsWith("store-")) return ordered;
  const head = [];
  const later = [];
  let boots = 0;
  for (const p of ordered) {
    // XTRATUF: one in the first 12, two in the first 25.
    if (head.length < TOP_GIFTS && isXtratuf(p) && boots >= (head.length < FEATURED_TOP ? 1 : 2)) later.push(p);
    else if (head.length < TOP_GIFTS) {
      if (isXtratuf(p)) boots += 1;
      head.push(p);
    }
    else later.push(p);
  }
  // Photos first inside the first TOP_GIFTS (pre-launch audit 11-18 PM: Dad #10 a text tile, Him #10 no photo); the
  // owner's pinned picks keep the top whatever their photo.
  const pinned = new Set((PINNED_TOP[slug] ?? []).map((n) => findByName(head, n)).filter(Boolean));
  const top = [...head.filter((p) => pinned.has(p)), ...head.filter((p) => !pinned.has(p) && p.image), ...head.filter((p) => !pinned.has(p) && !p.image)];
  return [...top, ...later.sort((a, b) => ordered.indexOf(a) - ordered.indexOf(b))];
};
/**
 * TRENDING (owner 11-18 PM: "All guides should have the top trending gifts"): _featured-order.json's "trending" list,
 * [{ name, fits: [slugs], href? }], ~100 picks we already carry. In every guide (never a store page) its trending picks
 * come right after the featured ones; fitting ones are added (fits names the
 * guide) until its first TOP_GIFTS are featured or trending, never a repeat, and an Amazon one only while Amazon
 * stays at most half the guide.
 */
/** Owner 11-18 PM ("All guides should have the top 25 gifts"): each guide's first TOP_GIFTS are featured, then trending. */
export const TOP_GIFTS = 25;
const TRENDING = (Array.isArray(FEATURED.trending) ? FEATURED.trending : []).filter((t) => t && typeof t.name === "string");
const trendingPick = new Map();
for (const t of TRENDING) {
  const found = Object.entries(guides).filter(([s]) => !s.startsWith("store-")).flatMap(([, l]) => l)
    .find((p) => t.href && (p.href === t.href || p.href === t.affiliate_href));
  const pool = Object.entries(guides).filter(([s]) => !s.startsWith("store-")).flatMap(([, l]) => l);
  const byName = found ? undefined : (t.guide && guides[t.guide] ? findByName(guides[t.guide], t.name) : undefined) ?? findByName(pool, t.name);
  if (found ?? byName) trendingPick.set(t, found ?? byName);
}
const isTrending = (p) => [...trendingPick.values()].some((x) => x.href === p.href || dedupeKey(x.name) === dedupeKey(p.name));
const isAmazonPick = (p) => AMAZON.has(new URL(p.href).hostname);
const NO_TRENDING = ["subscriptions", "gift-cards"];
const withTrending = (slug, list) => {
  // Store pages stay store-only; the 25 Days guide stays sponsors-only.
  // Subscriptions and gift cards stay what they say (a tumbler is neither).
  if (slug.startsWith("store-") || slug === SPONSORS_GUIDE || NO_TRENDING.includes(slug) || !trendingPick.size) return list;
  const out = [...list];
  const featured = featuredNames(slug);
  const isTop = (p) => isTrending(p) || featured.some((n) => sameName(n, p.name));
  let have = out.filter(isTop).length;
  for (const [t, p] of trendingPick) {
    if (have >= TOP_GIFTS) break;
    if (!(Array.isArray(t.fits) && t.fits.includes(slug)) || !fitsGuide(slug, p)) continue;
    if (out.some((x) => x.href === p.href || dedupeKey(x.name) === dedupeKey(p.name) || variantKey(x) === variantKey(p))) continue;
    if (isAmazonPick(p) && (out.filter(isAmazonPick).length + 1) / (out.length + 1) > 0.5) continue;
    out.push(p);
    have += 1;
  }
  // Trending first (in the list's order), the rest as they were.
  const order = [...trendingPick.values()];
  const rankOf = (p) => order.findIndex((x) => x.href === p.href || dedupeKey(x.name) === dedupeKey(p.name));
  const hot = out.filter(isTrending).sort((a, b) => rankOf(a) - rankOf(b));
  return [...hot, ...out.filter((p) => !isTrending(p))];
};
/** A photo-less row takes the photo the same product (same link, else same name) carries anywhere else. */
{
  const twinPhoto = new Map();
  for (const list of Object.values(guides)) for (const p of list) if (p.image) {
    if (!sharedLink(p.href) && !twinPhoto.has(p.href)) twinPhoto.set(p.href, p.image);
    const key = `${squash(p.brand)}|${compact(p.name)}`;
    if (squash(p.brand) && !twinPhoto.has(key)) twinPhoto.set(key, p.image);
  }
  for (const list of Object.values(guides)) list.forEach((p, i) => {
    const image = p.image ? undefined : (!sharedLink(p.href) && twinPhoto.get(p.href)) || twinPhoto.get(`${squash(p.brand)}|${compact(p.name)}`);
    // An Amazon-hosted photo only on an Amazon link (Associates rule).
    if (image && (!AMAZON_IMAGE_HOST.test(new URL(image).hostname) || isAmazonPick(p))) list[i] = { ...p, image };
  });
}
/**
 * ONE PHOTO, ONE PRODUCT (wrong-photo fix 11-18 PM): a photo on rows of two different products (another brand, or names
 * sharing under a quarter of their words) stays only on the row it belongs to: the ShopMy pin in its URL
 * ("pins/zoom-<pin>-") matching the row's "go.shopmy.us/p-<pin>", else the largest group of rows naming one product.
 * The other rows lose it and fall under "no photo, no row".
 */
const productWords = (p) => new Set(dedupeKey(p.name).split(" ").filter((w) => w.length > 2 && !squash(p.brand).includes(w)));
const GENERIC_BRAND = /affiliate|program|walmart|amazon|target|shopmy/i;
const sameProduct = (a, b) => {
  // One link (not a shared collection) is one thing, whatever each row calls it.
  if (a.href === b.href && !sharedLink(a.href)) return true;
  const ba = GENERIC_BRAND.test(a.brand ?? "") ? "" : squash(a.brand);
  const bb = GENERIC_BRAND.test(b.brand ?? "") ? "" : squash(b.brand);
  if (ba && bb && ba !== bb && !ba.includes(bb) && !bb.includes(ba)) return false;
  const wa = productWords(a);
  const wb = productWords(b);
  if (!wa.size || !wb.size) return true;
  const both = [...wa].filter((w) => wb.has(w)).length;
  return both / Math.min(wa.size, wb.size) >= 0.25;
};
export const suspectPhotos = { images: 0, cleared: 0 };
{
  const rowsByImage = new Map();
  for (const list of [...Object.values(guides), swappedOut]) for (const p of list) if (p.image) (rowsByImage.get(p.image) ?? rowsByImage.set(p.image, []).get(p.image)).push(p);
  const clear = new Set();
  for (const [image, rows] of rowsByImage) {
    const groups = [];
    for (const r of rows) (groups.find((g) => sameProduct(g[0], r)) ?? (groups.push([]), groups[groups.length - 1])).push(r);
    if (groups.length < 2) continue;
    suspectPhotos.images += 1;
    const pin = /pins\/zoom-(\d+)-/.exec(image)?.[1];
    // On three or more different products a photo is a placeholder (one Amazon image on six Anker chargers): nobody keeps it.
    const owner = (pin && groups.find((g) => g.some((r) => r.href === `https://go.shopmy.us/p-${pin}`)))
      ?? (groups.length >= 3 ? undefined : [...groups].sort((a, b) => b.length - a.length)[0]);
    for (const g of groups) if (g !== owner) for (const r of g) clear.add(r);
  }
  const strip = (list) => list.map((p) => (clear.has(p) ? ((suspectPhotos.cleared += 1), { ...p, image: undefined }) : p));
  for (const slug of Object.keys(guides)) guides[slug] = strip(guides[slug]);
  swappedOut.splice(0, swappedOut.length, ...strip(swappedOut));
}
/**
 * SHOPMY UPGRADES (11-18 night, _shopmy-upgrade-done-1118.json: [{ old_href, new_href, image, brand, same_product }]):
 * a row on old_href moves to new_href when the checker marked it the same product. The pin's own photo replaces the old
 * one (an Amazon photo never sits on a non-Amazon link), and the old store's checked price goes (it priced another
 * store). A pin whose photo is a TIFF or a dead ShopMy S3 file is skipped. Optional file.
 */
export const shopmyUpgrades = { rows: 0, links: 0, skipped: 0 };
{
  const v = readJson("_shopmy-upgrade-done-1118.json");
  const map = new Map();
  for (const r of Array.isArray(v) ? v : []) {
    if (!r || r.same_product !== true || typeof r.old_href !== "string" || typeof r.new_href !== "string" || r.old_href === r.new_href) continue;
    // A rate the checker could not confirm is higher stays on its old link (coordinator 11-18 night).
    if (/unverified/i.test(String(r.rate_higher ?? ""))) { shopmyUpgrades.skipped += 1; continue; }
    const image = typeof r.image === "string" && r.image.startsWith("https://") && !isTiff(r.image) && !brokenImage(r.image)
      && !/^https:\/\/production-shopmyshelf-[a-z]+\.s3[.-]/.test(r.image) ? r.image : undefined;
    // No pin photo (image: null, e.g. the Leatherman tools): the row keeps its own photo unless that is Amazon-hosted.
    if (!image && r.image) { shopmyUpgrades.skipped += 1; continue; }
    let host = "";
    try { host = new URL(r.new_href).hostname; } catch { shopmyUpgrades.skipped += 1; continue; }
    if (!AFFILIATE.has(host)) { shopmyUpgrades.skipped += 1; continue; }
    const store = [r.brand, r.retailer].map((x) => (typeof x === "string" ? storeFor(x) : null)).find((x) => x && stores.has(x));
    if (!map.has(r.old_href)) map.set(r.old_href, { href: r.new_href, image, store, host });
  }
  shopmyUpgrades.links = map.size;
  for (const [slug, list] of Object.entries(guides)) guides[slug] = list.map((p) => {
    const u = map.get(p.href);
    if (!u) return p;
    const amazonPhoto = typeof p.image === "string" && AMAZON_IMAGE_HOST.test(new URL(p.image).hostname);
    if (!u.image && (!p.image || amazonPhoto)) return p;
    shopmyUpgrades.rows += 1;
    const { price: _p, priceAt: _a, ...rest } = p;
    if (u.store) stores.get(u.store).hosts.add(u.host);
    return { ...rest, href: u.href, image: u.image ?? rest.image, store: u.store ?? (rest.store === "store-amazon" ? undefined : rest.store) };
  });
}
/**
 * BEST-PAYING LINK (11-18 night, ~/Desktop/Link-library/best-rates-1118.json: per brand, each network's rate and the
 * best): when one product (same brand, same full name, sizes included) is carried on two or more networks, every row of it uses the
 * best-paying network's link, provided that row has a photo. Only the same product is ever swapped in, so an audited top
 * 25 keeps its products. Unknown rates ("?") never switch.
 */
export const rateSwitches = { switched: 0 };
{
  const f = join(homedir(), "Desktop", "Link-library", "best-rates-1118.json");
  const RATES = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
  const CJ = /(^|\.)(anrdoezrs|jdoqocy|dpbolvw|kqzyfj|tkqlhce)\.(net|com)$/;
  const networkOf = (p) => {
    const h = new URL(p.href).hostname;
    return AMAZON.has(h) ? "Amazon" : h === "go.shopmy.us" || h === "shopmy.us" ? "ShopMy" : h === "mavely.app.link" ? "Later"
      : h === "walmrt.us" ? "Walmart" : h === "www.awin1.com" ? "Awin" : CJ.test(h) ? "CJ" : "Direct";
  };
  const rateOf = (brand, net) => { const r = RATES[squash(brand)]?.all?.[net]; return typeof r === "number" ? r : undefined; };
  const byProduct = new Map();
  for (const list of Object.values(guides)) for (const p of list) {
    if (!p.image || !squash(p.brand) || !RATES[squash(p.brand)]) continue;
    const k = `${squash(p.brand)}|${compact(p.name)}`;
    (byProduct.get(k) ?? byProduct.set(k, new Map()).get(k)).set(networkOf(p), p);
  }
  const best = new Map();
  for (const [k, nets] of byProduct) {
    if (nets.size < 2) continue;
    const ranked = [...nets].filter(([n, p]) => rateOf(p.brand, n) !== undefined).sort((a, b) => rateOf(b[1].brand, b[0]) - rateOf(a[1].brand, a[0]));
    if (ranked.length) best.set(k, ranked[0]);
  }
  for (const list of Object.values(guides)) list.forEach((p, i) => {
    // The same product only: same brand and the same full name (sizes and pack counts included).
    const b = best.get(`${squash(p.brand)}|${compact(p.name)}`);
    if (!b || b[1].href === p.href || list.some((x) => x.href === b[1].href)) return;
    const mine = rateOf(p.brand, networkOf(p));
    if (mine !== undefined && mine >= rateOf(b[1].brand, b[0])) return;
    list[i] = b[1];
    rateSwitches.switched += 1;
  });
}
for (const slug of Object.keys(guides)) guides[slug] = featuredFirst(slug, withTrending(slug, guides[slug]));
/**
 * NO PHOTO, NO ROW (owner 11-18 PM: "All Items need a picture find one. No excuses."): a pick still without a photo
 * leaves every guide and store page (the next photo'd pick moves up). Only the owner's Subscriptions memberships may
 * keep their store tile until a photo is found.
 */
for (const slug of Object.keys(guides)) {
  // The 25 Days sponsors guide keeps every sponsor's pick (each is a sponsor commitment); a photo is still being found.
  if (slug === SPONSORS_GUIDE) continue;
  const before = guides[slug].length;
  guides[slug] = guides[slug].filter(hasPhoto);
  photoless += before - guides[slug].length;
  if (!guides[slug].length) delete guides[slug];
}

/**
 * TOP-UP (owner 11-18 PM: "All guides need 25"): a guide still under TOP_GIFTS borrows photo'd picks from the guides in
 * its own section (first picks first), under the same fit and Louisiana rules. Gift cards and Subscriptions have their
 * own back-fill below.
 */
{
  const sectionOf = new Map([...indexSrc.matchAll(/group: "([^"]+)"[^}]*?slug: "([^"]+)"/g)].map((m) => [m[2], m[1]]));
  for (const [slug, list] of Object.entries(guides)) {
    if (slug.startsWith("store-") || slug === "gift-cards" || slug === "subscriptions" || slug === SPONSORS_GUIDE || list.length >= TOP_GIFTS) continue;
    const peers = Object.entries(guides).filter(([g]) => g !== slug && !g.startsWith("store-") && sectionOf.get(g) === sectionOf.get(slug));
    // Picks naming the guide's own subject first ("crawfish" for Crawfish Season), then the peers' first picks.
    const title = new RegExp(`\\b(${slug.split("-").filter((w) => w.length > 3).join("|") || "^$"})`, "i");
    const pool = peers.flatMap(([, other]) => other.slice(0, 60));
    for (const p of [...pool.filter((x) => title.test(x.name)), ...pool.filter((x) => !title.test(x.name))]) {
      if (list.length >= TOP_GIFTS) break;
      if (!p?.image || !fitsGuide(slug, p) || louisianaBlocked(slug, p)) continue;
      if (list.some((x) => x.href === p.href || dedupeKey(x.name) === dedupeKey(p.name))) continue;
      list.push(p);
    }
  }
}
/**
 * BACK-FILL (owner 11-18 PM: "All guides need 25"): a guide under TOP_GIFTS after "no photo, no row" borrows fitting
 * photo'd picks from every other guide. Only Gift cards and Subscriptions can fall short (their picks must be gift cards
 * or memberships); every other guide measured 25+ after the removal (2026-11-18).
 */
const BACKFILL_FITS = { "gift-cards": (p) => fitsGuide("gift-cards", p), subscriptions: (p) => /\b(subscription|membership)\b/i.test(p.name) && !/free trial/i.test(p.name) };
for (const [slug, fits] of Object.entries(BACKFILL_FITS)) {
  const list = guides[slug] ?? [];
  // Every fitting photo'd pick, past 25 too: these two guides are "every gift card" and "every membership" we carry.
  for (const [from, other] of Object.entries(guides)) {
    if (from === slug) continue;
    for (const p of other) {
      if (!p.image || !fits(p) || !fitsGuide(slug, p) || louisianaBlocked(slug, p)) continue;
      if (list.some((x) => x.href === p.href || dedupeKey(x.name) === dedupeKey(p.name))) continue;
      list.push(p);
    }
  }
  if (list.length) guides[slug] = list;
}
/** "Nov 22" / "2026-11-23 (...)" -> "2026-11-22"; anything else -> no end date. */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const endDate = (s) => {
  if (!s) return undefined;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  const md = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})/.exec(s);
  if (!md || !MONTHS[md[1].toLowerCase()]) return undefined;
  const m = MONTHS[md[1].toLowerCase()];
  return `${m < 6 ? 2027 : 2026}-${String(m).padStart(2, "0")}-${String(md[2]).padStart(2, "0")}`;
};
const okLink = (href) => {
  try {
    const u = new URL(href);
    return u.protocol === "https:" && AFFILIATE.has(u.hostname) && (!AMAZON.has(u.hostname) || u.hostname === "amzn.to" || u.searchParams.get("tag") === "louisianahelpr-20");
  } catch {
    return false;
  }
};
const noPrice = (s) => !/\$\s?\d/.test(s ?? "");

/** Links audit r3 counts (bannedLink, homepageLink): deals and deal items dropped, picks moved to a twin or removed. */
export const linksR3 = { deals: 0, dealItems: 0, relinked: 0, removed: 0, homepage: 0, storesEmptied: [] };
/** Each store page's live deal sections (title, affiliate link, end date, items for Walmart's collections). */
const deals = {};
const addDeal = (slug, d) => {
  if (blockedBrand(d) || (stores.get(slug) && blockedBrand({ store: stores.get(slug).name }))) return hidden.push(`deal ${slug}: ${d.title} is a blocked brand`);
  if (!okLink(d.href) || !noPrice(d.title)) return hidden.push(`deal ${slug}: ${d.title} (no affiliate link or a price)`);
  // Links audit r3 (bannedLink): a deal that 404s or opens only the store's homepage, and a deal item on a banned link.
  if (bannedLink(d.href)) return linksR3.deals += 1, hidden.push(`deal ${slug}: ${d.title} (${bannedLink(d.href)})`);
  if (d.items?.length) d = { ...d, items: d.items.filter((i) => !bannedLink(i.href) || ((linksR3.dealItems += 1), false)) };
  if (!stores.has(slug)) stores.set(slug, { name: d.storeName, hosts: new Set() });
  const list = (deals[slug] ??= []);
  if (!list.some((x) => x.href === d.href)) list.push({ title: d.title, href: d.href, ...(d.ends ? { ends: d.ends } : {}), ...(d.items?.length ? { items: d.items } : {}) });
};
for (const [slug, list] of Object.entries(readJson("_store-deal-sections.json") ?? {})) {
  const title = INDEX.find((g) => g.slug === slug)?.title ?? slug.slice(6);
  for (const d of list) if (!d.hidden && d.affiliate_href) addDeal(slug, { storeName: title, title: d.title, href: d.affiliate_href, ends: endDate(d.ends) });
}
for (const c of readList("_walmart-collections.json")) {
  const items = (c.items ?? []).filter((i) => i.affiliate_href && okLink(i.affiliate_href) && noPrice(i.name)).map((i) => ({ name: i.name, href: i.affiliate_href }));
  if (c.collection_affiliate_href) addDeal(storeFor("Walmart"), { storeName: "Walmart", title: c.collection.replace(/^Walmart\s+/, ""), href: c.collection_affiliate_href, items });
}
for (const h of readList("_amazon-hub.json")) addDeal(storeFor("Amazon"), { storeName: "Amazon", title: h.name, href: h.affiliate_href, ends: endDate(h.ends) });
/** Deals that do not open their store (design review 11-18 M8: Zales's link is dead, Fleek's opens Neiman Marcus). */
export const DEAD_DEAL_BRANDS = /^(zales|fleek)$/i;
for (const f of ["_later-deals.json", "_later-promos.json"]) {
  for (const d of readList(f)) {
    if (DEAD_DEAL_BRANDS.test(String(d.brand ?? d.store ?? "").trim())) continue;
    const slug = storeFor(d.brand ?? d.store);
    if (slug) addDeal(slug, { storeName: stores.get(slug).name, title: d.title ?? d.offer, href: d.affiliate_href, ends: endDate(d.ends) });
  }
}

/**
 * Codes a deal names (follow-up 11-18: WINTERBREW, GRATITUDE, ...), for the sidebar's Discount codes: the store, the
 * code, the deal's own words (or a plain "Holiday code" when they carry a price), and its end date (hidden after).
 */
const dealCodes = [];
for (const f of ["_later-deals.json", "_later-promos.json", "_awin-offers.json"]) {
  for (const d of readList(f)) {
    const code = typeof d.code === "string" ? d.code.trim() : "";
    const store = cleanName(d.brand ?? d.store ?? d.advertiser ?? "");
    if (!/^[A-Z0-9-]{3,24}$/i.test(code) || !store || dealCodes.some((c) => c.code === code && c.store === store)) continue;
    if (blockedBrand({ ...d, store })) continue;
    const words = (d.title ?? d.offer ?? "").trim();
    const ends = endDate(d.ends);
    dealCodes.push({ rank: 50, store, code, offer: words && noPrice(words) ? words : "Holiday code", ...(ends ? { expires: ends } : {}) });
  }
}

/** The Sales list (sidebar): one line per store with a live deal, soonest end first; the page hides expired ones. */
// One line per link (design audit r2 #10: 9 links were listed twice, under Gilt and "Gilt & Gilt City").
const sales = Object.entries(deals).flatMap(([slug, list]) => list.filter((d) => d.ends).map((d) => ({ store: stores.get(slug).name, slug, offer: d.title, ends: d.ends, href: d.href })))
  .filter((x, i, all) => all.findIndex((y) => y.href === x.href) === i)
  .sort((a, b) => a.ends.localeCompare(b.ends) || a.store.localeCompare(b.store));

const storeList = Object.fromEntries([...stores.entries()].filter(([slug]) => guides[slug]?.length || deals[slug]?.length || Object.values(guides).some((l) => l.some((p) => p.store === slug)))
  .sort(([a], [b]) => a.localeCompare(b)).map(([slug, s]) => [slug, { name: s.name, hosts: [...s.hosts].sort() }]));

if (Object.keys(guides).length === 0) process.exit(1);
if (hidden.length && process.env.GIFT_PICKS_VERBOSE) console.error(`HIDDEN (no affiliate link yet, or a rule broken):\n${hidden.join("\n")}`);

/**
 * Each page's FINAL list, so a guide's chunk is all it needs: a store page (not Amazon, whose page is its own file) is
 * its own store-<x> file, then every pick on that store from every guide, once per link, photos first; any other
 * guide is its own file. A pick on a fixed store's host (zChocolat, Diecast) stays on that fixed store's page.
 */
/** The Amazon page's sections, in order (design audit 11-18 #3); a pick in no listed group goes under "More finds". */
export const AMAZON_SECTIONS = ["Louisiana Helpr Picks", "By person", "For kids", "By budget", "Louisiana", "Hobbies", "By career", "Life moments", "Colors", "Pets", "More finds"];
const FIXED_HOSTS = new Set(["www.zchocolat.com", "www.diecastmodelswholesale.com"]);
const sortedGuides = Object.entries(guides).sort(([a], [b]) => a.localeCompare(b));
const everyPick = [...sortedGuides.flatMap(([, l]) => l), ...swappedOut.filter(hasPhoto)];
const pageList = {};
// The Kids hub is a hub, not a list (owner 2026-11-18): its page shows Girls, Boys and Gender-Neutral only.
const NOT_A_LIST = new Set(["kids"]);
for (const [slug, list] of sortedGuides) if (GUIDE_SLUGS.has(slug) && !storeList[slug] && !NOT_A_LIST.has(slug)) pageList[slug] = list;
/** The Amazon page: every Amazon-link pick from every guide, once per link (the page adds the static Amazon picks first). */
{
  const byHref = new Map();
  const names = new Set();
  for (const p of [...(guides["store-amazon"] ?? []), ...everyPick]) {
    if (!AMAZON.has(new URL(p.href).hostname) || byHref.has(p.href) || names.has(compact(p.name))) continue;
    byHref.set(p.href, p);
    names.add(compact(p.name));
  }
  if (byHref.size) {
    // Sections (design audit 11-18 #3): the page's own picks first ("Louisiana Helpr Picks"), then each pick under the
    // owner's-list group of the guides listing it that comes first in AMAZON_SECTIONS (By person, For kids, ...).
    const groupOf = new Map([...indexSrc.matchAll(/group: "([^"]+)"[^}]*?slug: "([^"]+)"/g)].map((m) => [m[2], m[1]]));
    const own = new Set((guides["store-amazon"] ?? []).map((p) => p.href));
    const rank = (sec) => (AMAZON_SECTIONS.includes(sec) ? AMAZON_SECTIONS.indexOf(sec) : AMAZON_SECTIONS.length - 1);
    const firstGroup = new Map();
    for (const [slug, list] of sortedGuides) {
      const g = groupOf.get(slug);
      if (!g || slug.startsWith("store-")) continue;
      for (const p of list) if (!firstGroup.has(p.href) || rank(g) < rank(firstGroup.get(p.href))) firstGroup.set(p.href, g);
    }
    const sectionOf = (p) => (own.has(p.href) ? AMAZON_SECTIONS[0] : firstGroup.get(p.href) ?? AMAZON_SECTIONS[AMAZON_SECTIONS.length - 1]);
    pageList["store-amazon"] = [...byHref.values()].map((p) => ({ ...p, section: sectionOf(p) }))
      .map((p, i) => [p, i]).sort(([a, i], [b, j]) => rank(a.section) - rank(b.section) || i - j).map(([p]) => p);
  }
}
const FIXED_PAGES = new Set(["store-amazon", "store-zchocolat", "store-diecast-models"]);
/** How many guides (store pages aside) list a link in their first TOP_GIFTS: a store page's gift score. */
const topCount = new Map();
for (const [slug, list] of sortedGuides) if (!slug.startsWith("store-")) for (const p of list.slice(0, TOP_GIFTS)) topCount.set(p.href, (topCount.get(p.href) ?? 0) + 1);
for (const slug of Object.keys(storeList)) {
  if (FIXED_PAGES.has(slug)) continue;
  const byHref = new Map();
  const names = new Set();
  for (const p of [...(guides[slug] ?? []), ...everyPick.filter((x) => x.store === slug && !FIXED_HOSTS.has(new URL(x.href).hostname))]) {
    if (byHref.has(p.href) || names.has(compact(p.name))) continue;
    byHref.set(p.href, p);
    names.add(compact(p.name));
  }
  const firstWins = [...byHref.values()];
  // Photos first, then the store's best gifts (pre-launch audit 11-18 PM: Walmart opened on a beard trimmer, an Elf
  // plush and a $3.88 glass): trending picks, then the picks the most guides list in their first TOP_GIFTS.
  const score = (p) => (isTrending(p) ? 1000 : 0) + (topCount.get(p.href) ?? 0);
  const ranked = firstWins.map((p, i) => [p, i]).sort(([a, i], [b, j]) => Number(!a.image) - Number(!b.image) || score(b) - score(a) || i - j).map(([p]) => p);
  if (ranked.length) pageList[slug] = ranked;
}
/** The fixed store pages (zChocolat, Diecast) list the static picks plus every researched pick on their host, by name. */
for (const [slug, host] of [["store-zchocolat", "www.zchocolat.com"], ["store-diecast-models", "www.diecastmodelswholesale.com"]]) {
  const onHost = [...new Map(everyPick.filter((p) => new URL(p.href).hostname === host).map((p) => [p.name, p])).values()];
  if (onHost.length) pageList[slug] = onHost;
}
/**
 * NO REPEATS (owner 11-18 PM: "Don't repeat items in guides"): on every page a product shows once. Two rows are the
 * same product when they share a link, or a normalized name (dedupeKey: lowercase, sizes, colors, pack counts and
 * punctuation dropped; the brand ignored, so the same product at two stores matches). The first row stays (featured,
 * then photos first); a later twin with a photo lends it its photo slot when the first has none.
 */
let repeatsRemoved = 0;
const noRepeats = (list) => {
  const out = [];
  const seenHref = new Map();
  const seenKey = new Map();
  for (const p of list) {
    const key = dedupeKey(p.name);
    // The name with its brand cut off the front ("LANEIGE Lip Sleeping Mask" = "Lip Sleeping Mask"), and the Amazon ASIN
    // (design review 11-18 M6: LANEIGE x2 and Kitsch curlers x2 on Under $25).
    const brandWords = dedupeKey(p.brand ?? "");
    // Scoped to the brand: two brands' "Gift Card" rows are two gifts.
    const bare = brandWords ? `${brandWords}|${key.startsWith(`${brandWords} `) ? key.slice(brandWords.length + 1) : key}` : "";
    const asin = /\/dp\/([A-Z0-9]{10})\b/.exec(p.href)?.[1];
    // A ShopMy collection link is shared by several products: those match by name only.
    const shared = new URL(p.href).hostname === "shopmy.us";
    const at = (!shared && seenHref.has(p.href) ? seenHref.get(p.href) : undefined) ?? (asin ? seenKey.get(`asin:${asin}`) : undefined)
      ?? (key.length > 3 ? seenKey.get(key) : undefined) ?? (bare.length > 8 ? seenKey.get(`bare:${bare}`) : undefined);
    if (at !== undefined) {
      repeatsRemoved += 1;
      if (process.env.GIFT_PICKS_VERBOSE) console.error(`REPEAT: "${p.name}" = "${out[at].name}"`);
      if (!out[at].image && p.image) out[at] = p;
      continue;
    }
    if (!shared) seenHref.set(p.href, out.length);
    if (key.length > 3) seenKey.set(key, out.length);
    if (asin) seenKey.set(`asin:${asin}`, out.length);
    if (bare.length > 8) seenKey.set(`bare:${bare}`, out.length);
    out.push(p);
  }
  return out;
};
for (const slug of Object.keys(pageList)) pageList[slug] = noRepeats(pageList[slug]);
// The Louisiana rule on every page, store pages included (their audit list), after the store pages are assembled.
for (const slug of Object.keys(pageList)) {
  const kept = pageList[slug].filter((p) => !louisianaBlocked(slug, p));
  // A store page the rule would empty (World Market's only pick is its chicory coffee) keeps its item: picks in the
  // Louisiana guides still name that store.
  if (kept.length || !slug.startsWith("store-")) pageList[slug] = kept;
}
/**
 * EARNINGS + FIT (owner 11-18 night), on each guide's final list (store pages aside), in this order:
 * 1. FIT TAIL (_fit-audit-tail-1118.json { "<slug>": { remove: [{ name, href }] } }): misfits leave positions 26 on; the
 *    first TOP_GIFTS are never touched, so no guide drops under TOP_GIFTS.
 * 2. FILLER (GUIDE_FILLER): Her/Mom filler the trending list put in the Vets top 25 is replaced by fitting picks
 *    from the guide's own lower list, then its related guides.
 * 3. TOP EARNERS (_top-earners-plan-1118.json { "<slug>": { swap, relink, add } }): `swap` puts the named top earner in
 *    the place of the named low-paying item; `relink` moves a row to the better-paying link only when the target is the
 *    same product (sameVariant: no named size, color or gender that disagrees; Stanley, Owala and YETI each point at one
 *    pin); `add` appends fitting photo'd top earners below the top 25. A target's own row (photo, store) is used when we
 *    carry it; otherwise the row keeps its photo only if it is not Amazon-hosted, and drops the old store's price.
 * 4. BOOTS (owner 11-18 night): XTRATUF and Muck Boot (CJ deep links) sit in the men's and outdoor guides, below the
 *    top 25 unless already there (the XTRATUF limits below still hold).
 */
export const GUIDE_FILLER = {
  "vets-and-vet-techs": { out: ["UGG Women's Disquette", "Sol de Janeiro Perfume Cheirosa 62 Perfume Eau de Parfum", "LANEIGE Lip Sleeping Mask"],
    from: ["dog-lover", "cat-person"], fits: /\b(dogs?|cats?|pets?|paws?|kitty|puppy|litter|leash|harness|treats?|vet\w*|fountain|bowl)\b/i },
};
export const BOOT_GUIDES = ["him", "boyfriend-or-husband", "dad", "grandpa", "brother", "fishermen", "hunters", "outdoorsman", "farmers"];
export const earnings = { tailRemoved: 0, filler: 0, swaps: 0, swapSkipped: [], relinks: 0, relinkSkipped: [], adds: 0, boots: 0 };
const SIZE_RE = /\b\d+(?:\.\d+)?[\s-]?(?:fl oz|oz|qt|quart|ml|inch|in|mm|gb|tb|pack|pk|count|ct|pairs?|pcs|pc|piece|lbs|lb)\b/gi;
const sizesOf = (n) => new Set((String(n).toLowerCase().match(SIZE_RE) ?? []).map((x) => x.replace(/[\s-]/g, "").replace(/inch$/, "in").replace(/quart$/, "qt")));
const colorsOf = (n) => new Set(String(n).toLowerCase().match(new RegExp(`\\b(${COLOR_WORDS})\\b`, "g")) ?? []);
const genderOf = (n) => (/\b(women'?s|womens|ladies)\b/i.test(n) ? "w" : /\b(men'?s|mens)\b/i.test(n) ? "m" : /\b(kids'?|boys'?|girls'?|toddlers?|youth)\b/i.test(n) ? "k" : "");
/** A model generation or year ("AirTag (2nd Generation)", "Gen 2", "(2024 model)"): one gen is not another. */
const gensOf = (n) => new Set((String(n).toLowerCase().match(/\b\d+(?:st|nd|rd|th)\s?gen(?:eration)?\b|\bgen\s?\d+\b|\b20\d\d\b/g) ?? []).map((x) => x.replace(/\D/g, "")));
/** The same product: every size, color and generation either name gives, the other names too, and no gender disagrees. */
export const sameVariant = (from, to) => {
  for (const pick of [sizesOf, colorsOf, gensOf]) {
    const a = pick(from);
    const b = pick(to);
    // A row with no size or color named opens a page where the buyer picks one; a named one must match exactly.
    if (a.size && (a.size !== b.size || [...a].some((x) => !b.has(x)))) return false;
  }
  const ga = genderOf(from);
  const gb = genderOf(to);
  return !ga || !gb || ga === gb;
};
{
  const TAIL = readJson("_fit-audit-tail-1118.json") ?? {};
  const PLAN = readJson("_top-earners-plan-1118.json") ?? {};
  const pool = new Map();
  for (const p of [...Object.values(guides).flat(), ...swappedOut]) if (p.image && !pool.has(p.href)) pool.set(p.href, p);
  const isAmazonImage = (u) => { try { return AMAZON_IMAGE_HOST.test(new URL(u).hostname); } catch { return false; } };
  const twin = (list, p) => list.findIndex((x) => x.href === p.href || dedupeKey(x.name) === dedupeKey(p.name));
  const named = (list, name) => list.findIndex((x) => compact(x.name) === compact(name));
  const netOf = (href) => {
    const h = new URL(href).hostname;
    return AMAZON.has(h) ? "Amazon" : /(^|\.)shopmy\.us$/.test(h) ? "ShopMy" : h === "mavely.app.link" ? "Later" : h === "walmrt.us" ? "Walmart"
      : h === "www.awin1.com" ? "Awin" : /(^|\.)(anrdoezrs|jdoqocy|dpbolvw|kqzyfj|tkqlhce)\.(net|com)$/.test(h) ? "CJ" : "Direct";
  };
  for (const slug of Object.keys(pageList)) {
    if (slug.startsWith("store-") || slug === SPONSORS_GUIDE) continue;
    let list = [...pageList[slug]];
    // 1. Fit tail: positions 26 on only.
    const gone = (TAIL[slug]?.remove ?? []).filter((r) => r && typeof r.name === "string");
    const isGone = (p) => gone.some((r) => r.href === p.href || compact(r.name) === compact(p.name));
    const tail = list.slice(TOP_GIFTS).filter((p) => !isGone(p));
    earnings.tailRemoved += list.length - TOP_GIFTS - tail.length > 0 ? list.length - TOP_GIFTS - tail.length : 0;
    list = [...list.slice(0, TOP_GIFTS), ...tail];
    // 2. Filler.
    const filler = GUIDE_FILLER[slug];
    if (filler) {
      const cands = [...list.slice(TOP_GIFTS), ...filler.from.flatMap((g) => pageList[g] ?? guides[g] ?? [])]
        .filter((p) => p.image && filler.fits.test(p.name) && genderOf(p.name) !== "w" && genderOf(p.name) !== "k" && !isGone(p) && fitsGuide(slug, p) && !louisianaBlocked(slug, p));
      for (const name of filler.out) {
        const at = named(list.slice(0, TOP_GIFTS), name);
        if (at < 0) continue;
        const next = cands.find((c) => { const j = twin(list, c); return j < 0 || j >= TOP_GIFTS; });
        if (!next) break;
        const j = twin(list, next);
        if (j >= 0) list.splice(j, 1);
        list[at] = next;
        earnings.filler += 1;
      }
    }
    const plan = PLAN[slug] ?? {};
    // 3a. Swaps.
    for (const sw of Array.isArray(plan.swap) ? plan.swap : []) {
      const at = named(list.slice(0, TOP_GIFTS), String(sw?.out ?? ""));
      const p = sw?.in?.href ? pool.get(sw.in.href) : undefined;
      if (at < 0 || !p || !fitsGuide(slug, p) || louisianaBlocked(slug, p)) { earnings.swapSkipped.push(`${slug}: ${sw?.out}${at < 0 ? " (not in top 25)" : !p ? " (no photo'd row)" : " (fit or Louisiana rule)"}`); continue; }
      const j = twin(list, p);
      if (j >= 0 && j < TOP_GIFTS) { earnings.swapSkipped.push(`${slug}: ${sw.out} (already in top 25)`); continue; }
      if (j >= 0) list.splice(j, 1);
      list[at] = p;
      earnings.swaps += 1;
    }
    // 3b. Relinks.
    for (const rl of Array.isArray(plan.relink) ? plan.relink : []) {
      const to = rl?.to;
      if (!to || typeof to.href !== "string" || typeof rl.name !== "string") continue;
      const at = named(list, rl.name);
      if (at < 0 || list[at].href === to.href) continue;
      const cur = list[at];
      // Already moved off the plan's starting network (a checked ShopMy upgrade above): left as it is.
      if (typeof rl.from_network === "string" && netOf(cur.href) !== rl.from_network) continue;
      if (!sameVariant(cur.name, to.name)) { earnings.relinkSkipped.push(`${slug}: "${cur.name}" -> "${to.name}" (variant)`); continue; }
      if (list.some((x, k) => k !== at && x.href === to.href)) continue;
      const own = pool.get(to.href);
      let next;
      if (own && sameVariant(cur.name, own.name)) next = own;
      else if (cur.image && !isAmazonImage(cur.image)) { const { price: _p, priceAt: _a, store: _s, ...rest } = cur; next = { ...rest, href: to.href }; }
      if (!next) { earnings.relinkSkipped.push(`${slug}: "${cur.name}" (no photo for the new link)`); continue; }
      list[at] = next;
      earnings.relinks += 1;
    }
    // 3c. Adds below the top 25.
    for (const ad of Array.isArray(plan.add) ? plan.add : []) {
      const p = ad?.href ? pool.get(ad.href) : undefined;
      if (!p || isGone(p) || !fitsGuide(slug, p) || louisianaBlocked(slug, p) || twin(list, p) >= 0) continue;
      list.push(p);
      earnings.adds += 1;
    }
    // 4. Boots.
    if (BOOT_GUIDES.includes(slug)) {
      const boots = [...pool.values()].filter((p) => /^(xtratuf|muck boot)$/i.test(p.brand ?? "") && netOf(p.href) === "CJ"
        && !["w", "k"].includes(genderOf(p.name)) && !/\bsteel toe\b/i.test(p.name) && fitsGuide(slug, p) && !louisianaBlocked(slug, p));
      for (const brand of ["xtratuf", "muck boot"]) {
        if (list.some((x) => (x.brand ?? "").toLowerCase() === brand)) continue;
        const b = boots.find((x) => x.brand.toLowerCase() === brand && twin(list, x) < 0);
        if (b) { list.push(b); earnings.boots += 1; }
      }
    }
    pageList[slug] = noRepeats(list);
  }
}
/**
 * PETS FILL (batch 11-19, _pets-fill-1118.json { "fish-lover": [...], "horse-lover": [...], "bird-lover": [...] }):
 * researched Amazon lists (aquarium-only for Fish Lover, pet birds and no birdwatching for Bird Lover) that REPLACE
 * those guides' lists, after every earlier stage (featured order, trending, earnings) so no generic filler comes back.
 * Fish Lover, empty and hidden before, returns with them. Where the file has the same product from a brand and from a
 * small no-name seller, the small seller's row goes (PETS_FILL_DROPS). The holistic pass below still applies its link,
 * photo and BRAND_CAP rules, but not the name-only pet test (these rows are the researched list for that animal).
 */
export const PETS_FILL_DROPS = new Set([
  "4-in-1 Aquascaping Tool Kit", // Liveek; hygger's 4-piece aquascaping set is in the same list
  "Hoof Pick Brush with Soft-Touch Handle", // BOTH WINNERS; the Wahl Professional hoof pick is in the same list
]);
export const PETS_FILL = new Map();
{
  const v = readJson("_pets-fill-1118.json");
  for (const slug of ["fish-lover", "horse-lover", "bird-lover"]) {
    const list = [];
    for (const r of Array.isArray(v?.[slug]) ? v[slug] : []) {
      if (!r || typeof r.href !== "string" || typeof r.name !== "string" || PETS_FILL_DROPS.has(r.name)) continue;
      let host = "";
      try { host = new URL(r.href).hostname; } catch { continue; }
      const p = toPick({ brand: "", line: "", ...r, ...(AMAZON.has(host) ? { store: "Amazon", image_source: "amazon-sitestripe" } : {}) }, "_pets-fill-1118.json");
      if (!p?.image || list.some((x) => x.href === p.href || compact(x.name) === compact(p.name))) continue;
      list.push(p);
    }
    // Horse Lover keeps the adult equestrian picks placed before this (1530 train: the owner removed its toy horse and
    // asked for a refill); Fish and Bird Lover take only their file (fishing gear had crept into Fish Lover).
    if (list.length) { pageList[slug] = slug === "horse-lover" ? [...list, ...(pageList[slug] ?? []).filter((p) => !list.some((x) => x.href === p.href) && /\b(horses?|horseshoes?|equestrian|equine|riding|saddle|bridle|halter|hoof|tack)\b/i.test(p.name))] : list; PETS_FILL.set(slug, new Set(list.map((p) => p.href))); }
    // Amazon's store page lists every Amazon pick (it was assembled before this stage): new rows join its Pets section.
    const amazon = pageList["store-amazon"];
    if (!amazon) continue;
    for (const p of list) {
      if (p.store !== "store-amazon" || amazon.some((x) => x.href === p.href || compact(x.name) === compact(p.name))) continue;
      const lastPets = amazon.map((x) => x.section).lastIndexOf("Pets");
      const at = lastPets >= 0 ? lastPets + 1 : amazon.findIndex((x) => x.section === "More finds");
      amazon.splice(at >= 0 ? at : amazon.length, 0, { ...p, section: "Pets" });
    }
  }
}
/**
 * ITEMS THAT BELONG (owner 11-19, Builder 12), on every page's list (the 25 Days sponsors guide aside), before the
 * holistic pass below, in this order:
 * 1. Fit audit round 2 (_fit-audit-r2-A-1118.json: people, budget, kids, life moments; _fit-audit-r2-B-1118.json:
 *    careers, hobbies, pets, Louisiana, colors, store pages): { "<slug>": [{ name, href, position, reason }] }, read by
 *    hand. A listed pick leaves that page (matched by link, or by the same name).
 * 2. The lasting rules (belongsWhy in giftGuideRules.mjs): the filler block and tumblers in career, hobby and color
 *    guides, Bartesian and Cooking Light nowhere, placeholders, eGift cards in product spots, fishing gear on Boater and
 *    Kayaker, the toy grill on Girls and Niece.
 * 3. Gift Wrap & Cards keeps wrap and card items only; Mail Carrier keeps picks with a known price of $20 or less (a
 *    checked price, or the price the research file gave; the file price is not shown).
 * 4. Researched fills (BELONG_FILLS), in file order after the guide's fitting picks: _career-fill-A-1118.json (career
 *    guides a-m), _fill-B-1118.json (Purple & Gold, Artist, colors, Louisiana, careers n-z) and _purple-gold-1118.json
 *    (more LSU picks). Same link, photo, fit and Louisiana rules as every pick; prices dropped (Amazon shows none).
 * 5. A national page's line that names Louisiana is rewritten (neutralLine); the item stays.
 * A guide left under BELONG_SHORT picks is kept and listed in belong.short for more research, never padded with filler
 * (the holistic top-up from peer guides is off for the same reason).
 */
export const BELONG_FILLS = ["_career-fill-A-1118.json", "_fill-B-1118.json", "_purple-gold-1118.json"];
/**
 * NEW AFFILIATE APPROVALS (lead 11-19): _new-approvals-1119.json, [{ guide_slug, name, brand, href (the CJ or Awin link),
 * store_href (the product page), image, price, commission_pct, why_fits }], 74 rows from 16 newly approved brands (counted 2026-11-19)
 * (reasons in ~/Desktop/New-approvals-fit-1119.md). In the belong pass, after the guide's fills, each row goes below the
 * guide's top 3 and its Trending picks and ahead of its first Amazon pick (newApprovalSlot); the holistic pass's brand
 * cap, beauty, Louisiana and link rules still apply after it. Each placed row also joins its brand's store page.
 */
export const NEW_APPROVALS = "_new-approvals-1119.json";
export const newApprovals = { rows: 0, placed: 0, skipped: [] };
/** Each guide's placed new-approval links (re-slotted after the holistic pass, which can drop picks above them). */
export const NEW_APPROVAL_HREFS = new Map();
export const BELONG_SHORT = 12;
export const belong = { audit: 0, rules: {}, wrap: 0, mail: 0, fills: 0, fillSkipped: 0, lines: 0, short: [] };
export const BELONG_FILL_HREFS = new Map();
{
  const groupOf = new Map([...indexSrc.matchAll(/group: "([^"]+)"[^}]*?slug: "([^"]+)"/g)].map((m) => [m[2], m[1]]));
  const audit = {};
  for (const f of ["_fit-audit-r2-A-1118.json", "_fit-audit-r2-B-1118.json"]) {
    const v = readJson(f);
    for (const [slug, rows] of Object.entries(v && typeof v === "object" && !Array.isArray(v) ? v : {})) {
      if (slug === SPONSORS_GUIDE || !Array.isArray(rows)) continue;
      const a = (audit[slug] ??= { hrefs: new Set(), names: new Set() });
      for (const r of rows) {
        if (typeof r?.href === "string") a.hrefs.add(r.href);
        if (typeof r?.name === "string" && compact(r.name)) a.names.add(compact(r.name));
      }
    }
  }
  // Prices the research files give (not checked, never shown), by link: Mail Carrier's $20 test only.
  const filePrice = new Map();
  const num = (x) => { const n = typeof x === "number" ? x : Number(String(x ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 ? n : undefined; };
  const walk = (v, depth = 0) => {
    if (!v || typeof v !== "object" || depth > 4) return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    const n = num(v.price);
    if (n !== undefined) for (const h of [v.href, v.affiliate_href, v.link, v.url]) if (typeof h === "string" && !filePrice.has(h)) filePrice.set(h, n);
    for (const x of Object.values(v)) if (x && typeof x === "object") walk(x, depth + 1);
  };
  for (const d of [dir, LIB]) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((x) => x.endsWith(".json"))) {
      try { walk(JSON.parse(readFileSync(join(d, f), "utf8"))); } catch { continue; /* a half-written research file: no prices from it */ }
    }
  }
  const priceOf = (p) => (typeof p.price === "number" ? p.price : filePrice.get(p.href));
  const fillRows = {};
  for (const f of BELONG_FILLS) {
    const v = readJson(f);
    for (const [slug, rows] of Object.entries(v && typeof v === "object" && !Array.isArray(v) ? v : {})) {
      if (!Array.isArray(rows) || !GUIDE_SLUGS.has(slug) || slug.startsWith("store-") || slug === SPONSORS_GUIDE) continue;
      for (const r of rows) if (r && typeof r.href === "string" && typeof r.name === "string") (fillRows[slug] ??= []).push({ r, f });
    }
  }
  // MAIL CARRIER FILL (_mail-carrier-1119.json, lead 11-19): priced Walmart picks of $20 or less for Mail Carrier &
  // Delivery Drivers, after its fitting picks. A list, { picks | links: [...] } or { "<slug>": [...] }; a walmrt.us link in
  // `href` is the affiliate link (readList). Each row needs its own price at MAIL_CARRIER_MAX or less; its checked
  // price shows only under the price rules (verifiedPrice).
  const MAIL_FILL = "_mail-carrier-1119.json";
  {
    const v = readJson(MAIL_FILL);
    const rows = Array.isArray(v) ? v : Array.isArray(v?.picks) ? v.picks : Array.isArray(v?.links) ? v.links : Array.isArray(v?.[MAIL_CARRIER]) ? v[MAIL_CARRIER] : [];
    for (const raw of rows) {
      const r = raw && !raw.affiliate_href && typeof raw.href === "string" && /^https:\/\/walmrt\.us\//.test(raw.href)
        ? { ...raw, affiliate_href: raw.href, href: typeof raw.product_url === "string" ? raw.product_url : raw.href } : raw;
      if (!r || typeof r.href !== "string" || typeof r.name !== "string" || !(num(r.price) <= MAIL_CARRIER_MAX)) continue;
      (fillRows[MAIL_CARRIER] ??= []).push({ r, f: MAIL_FILL });
    }
  }
  const fillPick = (r, f) => {
    let host = "";
    try { host = new URL(r.href).hostname; } catch { return null; }
    const { price: _price, network: _network, ...rest } = r;
    // Mail Carrier prices are Walmart Creator's own (lead 11-19: checked, source "walmart-creator", 2026-11-19).
    const row = f === MAIL_FILL ? { ...rest, price: r.price, price_currency: "USD", price_source: "walmart-creator", price_checked_at: r.price_checked_at ?? "2026-11-19" } : rest;
    if (f === MAIL_FILL) return toPick({ brand: "", line: "", store: "Walmart", ...row }, f);
    const amazon = AMAZON.has(host);
    return toPick({ brand: "", line: "", ...row, ...(amazon ? { store: "Amazon", image_source: "amazon-sitestripe" } : {}),
      ...(!amazon && AFFILIATE.has(host) ? { affiliate_href: r.href } : {}) }, f);
  };
  // NEW AFFILIATE APPROVALS (lead 11-19): rows grouped by guide, highest commission first (an unconfirmed rate last).
  const approvalRows = {};
  {
    const v = readJson(NEW_APPROVALS);
    const rows = (Array.isArray(v) ? v : []).filter((r) => r && typeof r.guide_slug === "string" && typeof r.name === "string" && typeof r.href === "string" && typeof r.store_href === "string");
    newApprovals.rows = rows.length;
    for (const r of rows) {
      if (!GUIDE_SLUGS.has(r.guide_slug) || r.guide_slug.startsWith("store-") || r.guide_slug === SPONSORS_GUIDE) { newApprovals.skipped.push(`${r.guide_slug}: ${r.name} (no such guide)`); continue; }
      (approvalRows[r.guide_slug] ??= []).push(r);
    }
    const pct = (r) => (typeof r.commission_pct === "number" ? r.commission_pct : -1);
    for (const list of Object.values(approvalRows)) list.sort((x, y) => pct(y) - pct(x));
  }
  // The row's affiliate link (CJ or Awin, AFFILIATE_HOSTS) and its plain product page; the file price is not a checked
  // price (dropped), and why_fits becomes the line only after our notes and prices come out (approvalLine).
  const approvalPick = (r) => toPick({ name: r.name, brand: r.brand ?? "", store: r.brand ?? "", line: approvalLine(r.why_fits),
    href: r.store_href, affiliate_href: r.href, ...(typeof r.image === "string" ? { image: r.image } : {}) }, NEW_APPROVALS);
  // The fixed store pages (Amazon, zChocolat, Diecast) list every guide pick on their store: they go last, and a pick a
  // guide still lists stays on them (its guide kept it).
  const slugs = [...new Set([...Object.keys(pageList), ...Object.keys(fillRows), ...Object.keys(approvalRows)])].sort((x, y) => Number(FIXED_PAGES.has(x)) - Number(FIXED_PAGES.has(y)));
  let inGuides = null;
  for (const slug of slugs) {
    if (slug === SPONSORS_GUIDE) continue;
    if (FIXED_PAGES.has(slug) && !inGuides) inGuides = new Set(Object.entries(pageList).filter(([g]) => !g.startsWith("store-")).flatMap(([, l]) => l.map((p) => p.href)));
    const guideListed = (p) => FIXED_PAGES.has(slug) && inGuides.has(p.href);
    const group = groupOf.get(slug) ?? "";
    const a = audit[slug];
    const seen = { tumblers: 0 };
    const out = [];
    for (const p of pageList[slug] ?? []) {
      if (a && (a.hrefs.has(p.href) || a.names.has(compact(p.name))) && !guideListed(p)) { belong.audit += 1; continue; }
      const r = guideListed(p) ? "" : belongsWhy(slug, group, p, seen);
      if (r) { belong.rules[r] = (belong.rules[r] ?? 0) + 1; if (process.env.GIFT_PICKS_VERBOSE) console.error(`BELONG ${slug}: ${r}: ${p.name}`); continue; }
      if (slug === "gift-wrap-and-cards" && !wrapItem(p)) { belong.wrap += 1; continue; }
      if (slug === MAIL_CARRIER && !(priceOf(p) <= MAIL_CARRIER_MAX)) { belong.mail += 1; continue; }
      out.push(p);
    }
    for (const { r, f } of fillRows[slug] ?? []) {
      const p = fillPick(r, f);
      const dup = p && out.some((x) => x.href === p.href || dedupeKey(x.name) === dedupeKey(p.name) || variantKey(x) === variantKey(p));
      if (!p || !p.image || dup || !fitsGuide(slug, p) || louisianaBlocked(slug, p) || belongsWhy(slug, group, p, seen, true)
        || (a && (a.hrefs.has(p.href) || a.names.has(compact(p.name))))) { if (!dup) belong.fillSkipped += 1; continue; }
      out.push(p);
      (BELONG_FILL_HREFS.get(slug) ?? BELONG_FILL_HREFS.set(slug, new Set()).get(slug)).add(p.href);
      belong.fills += 1;
    }
    // 4b. New affiliate approvals (NEW_APPROVALS): placed by newApprovalSlot, highest-paying first, same rules as a fill.
    for (const r of approvalRows[slug] ?? []) {
      const p = approvalPick(r);
      const dup = p && out.some((x) => x.href === p.href || dedupeKey(x.name) === dedupeKey(p.name) || variantKey(x) === variantKey(p));
      const no = !p ? "hidden" : !p.image ? "no photo" : dup ? "already listed" : !fitsGuide(slug, p) ? "fit" : louisianaBlocked(slug, p) ? "Louisiana rule"
        : belongsWhy(slug, group, p, seen, true) || (a && (a.hrefs.has(p.href) || a.names.has(compact(p.name))) ? "fit audit" : "");
      if (no) { newApprovals.skipped.push(`${slug}: ${r.name} (${no})`); continue; }
      out.splice(newApprovalSlot(out, isTrending, isAmazonPick), 0, p);
      (BELONG_FILL_HREFS.get(slug) ?? BELONG_FILL_HREFS.set(slug, new Set()).get(slug)).add(p.href);
      (NEW_APPROVAL_HREFS.get(slug) ?? NEW_APPROVAL_HREFS.set(slug, new Set()).get(slug)).add(p.href);
      newApprovals.placed += 1;
    }
    // 5. Louisiana words on a national page's line.
    const national = !LOUISIANA_GUIDES.has(slug) && !LOUISIANA_STORE_PAGES.has(slug);
    pageList[slug] = out.map((p) => {
      if (!national || !LA_LINE.test(p.line ?? "")) return p;
      belong.lines += 1;
      return { ...p, line: neutralLine(p.line) };
    });
    if (!pageList[slug].length) delete pageList[slug];
  }
  // A fill row joins its store page too (an Amazon row under its guide's section on the Amazon page), and a store the
  // fills alone use gets its STORES entry (name and hosts), so every pick names a store page.
  const touched = new Set();
  for (const [slug, hrefs] of BELONG_FILL_HREFS) {
    for (const p of pageList[slug] ?? []) {
      if (!hrefs.has(p.href) || !p.store) continue;
      touched.add(p.store);
      if (louisianaBlocked(p.store, p)) continue;
      const page = (pageList[p.store] ??= []);
      if (page.some((x) => x.href === p.href)) continue;
      if (p.store !== "store-amazon") { page.push(p); continue; }
      // Under its guide's section, the sections kept in AMAZON_SECTIONS order.
      const section = AMAZON_SECTIONS.includes(groupOf.get(slug)) ? groupOf.get(slug) : "More finds";
      const rank = AMAZON_SECTIONS.indexOf(section);
      let at = 0;
      page.forEach((x, i) => { if (AMAZON_SECTIONS.indexOf(x.section) <= rank) at = i + 1; });
      page.splice(at, 0, { ...p, section });
    }
  }
  for (const s of touched) if (stores.has(s)) storeList[s] = { name: stores.get(s).name, hosts: [...stores.get(s).hosts].sort() };
  // A store page these removals emptied (no picks, no deals, no pick naming it) leaves the store list.
  const named = new Set(Object.values(pageList).flat().map((p) => p.store).filter(Boolean));
  for (const s of Object.keys(storeList)) if (!pageList[s]?.length && !deals[s]?.length && !named.has(s)) delete storeList[s];
  const sorted = Object.entries(storeList).sort(([a], [b]) => a.localeCompare(b));
  for (const [k] of sorted) delete storeList[k];
  for (const [k, v] of sorted) storeList[k] = v;
}
/**
 * HOLISTIC FIT (design review 11-18, gg-holistic-1118/FINDINGS.md H2, H3, M1, M5), on every page's final list:
 * every page drops collection/shop links, placeholder names, medical and personal-care items and MISMATCHED_LINKS;
 * guides (store pages aside) also drop pet items outside the Pets guides, work boots on Mom/Her/Wife, men's items on
 * the WOMEN_GUIDES (mensItem, batch 11-19), a brand's 4th
 * and later picks (BRAND_CAP; Louisiana guides, Gift cards and Subscriptions aside), gendered picks on Gender-Neutral
 * Teens (and its beauty picks past BEAUTY_CAP), and checked prices over $30 on Secret Santa and White Elephant. A guide
 * that falls under TOP_GIFTS borrows fitting picks from its own section, under the same rules.
 */
export const BRAND_CAP = 3;
export const BEAUTY_CAP = 3;
/** A link whose page is another product (design review 11-18 M4: Target's "The 14oz Mug" opens the 10 oz Ember). */
export const MISMATCHED_LINKS = new Set(["https://go.shopmy.us/p-103897297"]);
/** A mismatched link's replacement, when we carry the named product's own pin (the 14 oz Ember Mug 2 on Target via ShopMy). */
// Links audit r4 (11-19): the "FreeSip Bottle 24oz" pin (p-104112945) opens JD Sports' 40 oz bottle; Owala's own 24 oz
// FreeSip pin on owalalife.com (p-107580819) takes its place.
export const LINK_FIX = new Map([["https://go.shopmy.us/p-103897297", "https://go.shopmy.us/p-103885470"], ["https://go.shopmy.us/p-104112945", "https://go.shopmy.us/p-107580819"]]);
const LINK_FIX_ROW = new Map([...LINK_FIX].map(([from, to]) => [from, everyPick.find((x) => x.href === to && x.image)]).filter(([, p]) => p));
/** Plain homepage links kept on purpose (links audit r3: the Louisiana businesses and the 25 Days sponsors). */
const HOMEPAGE_OK = new Set([...LOUISIANA, ...SPONSORS]);
/**
 * BANNED_TWIN (links audit r3): a pick on a banned link takes the same product's row on another good link from our own
 * picks (same brand and the same full name, size and color included: a 30 oz twin is not the 20 oz pick; a photo; not
 * banned, not a homepage, collection or non-US link), or is removed by the holistic rules below. Never an invented link.
 * A store page takes only a twin from its own store (Level Shoes' sold-out mule is not swapped for Zappos').
 */
const goodTwin = (x) => x.image && !bannedLink(x.href) && !homepageLink(x.href) && !collectionLink(x.href) && !nonUsUrl(x.href);
const twinKey = (x) => `${squash(x.brand)}|${squash(x.name)}`;
const TWIN_BY_KEY = new Map();
for (const x of everyPick) if (goodTwin(x) && squash(x.name).length > 6 && !TWIN_BY_KEY.has(twinKey(x))) TWIN_BY_KEY.set(twinKey(x), x);
const BANNED_TWIN = new Map();
for (const x of everyPick) {
  if (!bannedLink(x.href) || BANNED_TWIN.has(x.href)) continue;
  const twin = TWIN_BY_KEY.get(twinKey(x));
  // A sold-out product's twin is at another store (the same store's other pin is likely just as sold out).
  if (twin && twin.href !== x.href && (bannedLink(x.href) !== "sold out" || (twin.store && twin.store !== x.store))) BANNED_TWIN.set(x.href, twin);
}
const PRICE_CAP = { "secret-santa": 30, "white-elephant": 30 };
/**
 * The Pets guides are for the animal (owner 11-18 night): a trending or widely listed pick (in 10+ top 25s: tumbler,
 * earbuds, UGG, lip mask) that is
 * not for that animal leaves the guide, and a short Pets guide borrows only that animal's picks.
 */
const DOG = /\b(dogs?|pupp(y|ies)|paws?|pets?|bark\w*|woof\w*)\b/i;
const CAT = /\b(cats?|kitt(en|ens|y|ies)|meow\w*|catnip|feline|litter|paws?|pets?)\b/i;
export const PET_ANIMAL = {
  "dog-lover": DOG, "new-puppy": DOG, "cat-person": CAT, "new-kitten": CAT,
  "horse-lover": /\b(horses?|horseshoes?|equestrian|western|riding|saddle|barn|cowboy|cowgirl|boots?|ranch)\b/i,
  "bird-lover": /\b(birds?|feeders?|binoculars?|hummingbirds?|owls?|nest\w*|birding)\b/i,
};
const GENDERED = /\b(women'?s|womens|ladies|girls'?|men'?s|mens|boys'?|bra|bralette|dress|skirt)\b/i;
const BEAUTY = /\b(lip|lipstick|gloss|mascara|blush|bronzer|eyeshadow|eyeliner|makeup|perfume|eau de|nail polish|curlers?|hair (clips?|ties|scrunchies)|scrunchies?|earrings?|necklace|pendant|bracelet|serum|moisturizer|face mask)\b/i;
export const holistic = { removed: 0, byRule: {}, toppedUp: 0, short: [] };
/** The holistic pass's per-pick rule (set below); the 1119e sort pass gates every row it adds with it. */
let holisticWhy = () => "";
{
  const sectionOf = new Map([...indexSrc.matchAll(/group: "([^"]+)"[^}]*?slug: "([^"]+)"/g)].map((m) => [m[2], m[1]]));
  const PET_OK = new Set([...sectionOf].filter(([, g]) => g === "Pets").map(([s]) => s).concat(["vets-and-vet-techs"]));
  const why = (slug, p) => {
    if (collectionLink(p.href)) return "collection link";
    if (placeholderName(p)) return "placeholder name";
    if (MISMATCHED_LINKS.has(p.href)) return "link opens another product";
    // Links audit r3: a dead, sold-out, UK/EU or wrong-page link (BANNED_LINKS) with no twin, and a homepage-only link
    // (a Louisiana business or a sponsor keeps its plain homepage link on purpose).
    if (bannedLink(p.href)) return `banned link: ${bannedLink(p.href)}`;
    if (homepageLink(p.href) && !HOMEPAGE_OK.has(new URL(p.href).hostname)) return "homepage link";
    if (NOT_A_GIFT_ITEM.test(`${p.name} ${p.brand ?? ""}`) && !((slug === "new-mom" || slug.startsWith("store-")) && NEW_MOM_CARE.test(p.name))) return "medical or personal care";
    if (slug.startsWith("store-")) return fitR4Why(slug, "", p);
    // Fit audit r3b (lead 11-19): utility personal care only on New Mom; giftable beauty only where it fits.
    if (utilityCare(p) && slug !== "new-mom") return "utility personal care";
    if (beautyItem(p) && !beautyGuide(slug)) return "beauty outside its guides";
    if (NEUTRAL_GUIDES.includes(slug) && ONE_GENDER.test(p.name)) return "gendered";
    if (PET_ONLY[slug] && !PET_ONLY[slug](p) && !PETS_FILL.get(slug)?.has(p.href)) return "not for this pet";
    if (PET_ITEM.test(p.name) && !PET_OK.has(slug)) return "pet item outside Pets";
    if (WORK_BOOT_OFF.includes(slug) && (WORK_BOOT.test(p.name) || DECK_BOOT.test(`${p.name} ${p.brand ?? ""}`) || /^muck boot$/i.test(p.brand ?? ""))) return "work boot";
    if (WOMEN_GUIDES.includes(slug) && mensItem(p)) return "men's item";
    if (INSTAX_OFF.includes(slug) && instaxItem(p)) return "instax";
    if (slug === "gender-neutral-teens" && GENDERED.test(p.name)) return "gendered";
    if (PRICE_CAP[slug] && typeof p.price === "number" && p.price > PRICE_CAP[slug]) return "over budget";
    // Fit audit r4 (fitR4Why): per-guide misfits, medical care, stethoscopes and nurse items off their jobs, vague names,
    // wrong colors, North Louisiana's own items; a Louisiana guide lists items, not places.
    if (LOUISIANA_GUIDES.has(slug) && placeRow(p)) return "r4: place, not an item";
    return fitR4Why(slug, sectionOf.get(slug) ?? "", p);
  };
  holisticWhy = why;
  // A Pets guide drops filler that is not for its animal, women-coded beauty first, while it keeps TOP_GIFTS picks (owner
  // 11-18: "All guides need 25"; a guide short of that animal's picks keeps some filler until it has them).
  const isFiller = (slug, p) => PET_ANIMAL[slug] && ((topCount.get(p.href) ?? 0) >= 10 || isTrending(p)) && !PET_ANIMAL[slug].test(p.name);
  const petFiller = (slug, list) => {
    if (!PET_ANIMAL[slug]) return list;
    const filler = list.filter((p) => isFiller(slug, p) && !PETS_FILL.get(slug)?.has(p.href)).sort((a, b) => Number(BEAUTY.test(b.name) || genderOfName(b.name)) - Number(BEAUTY.test(a.name) || genderOfName(a.name)));
    const drop = new Set(filler.slice(0, Math.max(0, list.length - TOP_GIFTS)));
    holistic.byRule["not for this pet"] = (holistic.byRule["not for this pet"] ?? 0) + drop.size;
    holistic.removed += drop.size;
    return list.filter((p) => !drop.has(p));
  };
  const genderOfName = (n) => /\b(women'?s|womens|ladies)\b/i.test(n);
  // Fit audit r4 (lead 11-19): the cap of 3 a brand holds in the Louisiana guides too (Dirty Coast had 10 in Louisiana Artists).
  const capped = (slug) => !slug.startsWith("store-") && slug !== "gift-cards" && slug !== "subscriptions" && slug !== SPONSORS_GUIDE;
  const keep = (slug, list, count = true) => {
    const out = [];
    const perBrand = new Map();
    const once = new Set();
    const typed = new Map();
    let beauty = 0;
    for (const p of list) {
      let r = why(slug, p);
      const b = brandKey(p.brand);
      const o = slug.startsWith("store-") ? -1 : onceKey(p);
      if (!r && o >= 0 && once.has(o)) r = "near twin";
      // Fit audit r4: one of a kind per guide (TYPE_CAPS) and one row per product (PRODUCT_TWINS).
      const caps = r ? [] : typeCaps(slug, p);
      if (!r && caps.some(([k, max]) => (typed.get(k) ?? 0) >= max)) r = "r4: type cap";
      if (!r && capped(slug) && b && !GENERIC_BRAND.test(p.brand ?? "") && (perBrand.get(b) ?? 0) >= BRAND_CAP) r = "brand cap";
      if (!r && slug === "gender-neutral-teens" && BEAUTY.test(p.name) && beauty >= BEAUTY_CAP) r = "beauty cap";
      if (r && !count) continue;
      if (r && process.env.GIFT_PICKS_VERBOSE) console.error(`HOLISTIC ${slug}: ${r}: ${p.name}`);
      if (r) { holistic.removed += 1; holistic.byRule[r] = (holistic.byRule[r] ?? 0) + 1; continue; }
      if (b) perBrand.set(b, (perBrand.get(b) ?? 0) + 1);
      if (o >= 0) once.add(o);
      for (const [k] of caps) typed.set(k, (typed.get(k) ?? 0) + 1);
      if (slug === "gender-neutral-teens" && BEAUTY.test(p.name)) beauty += 1;
      out.push(p);
    }
    return out;
  };
  for (const slug of Object.keys(pageList)) {
    // The 25 Days sponsors guide keeps every sponsor's pick (each is a sponsor commitment).
    if (slug === SPONSORS_GUIDE) continue;
    // A store page these rules empty (African Net Sponge sells only bath sponges) goes with them.
    const kept = keep(slug, petFiller(slug, pageList[slug].map((p) => {
      // A fixed link first (links audit r4: the FreeSip pin's own twins carry the same wrong JD Sports page).
      if (LINK_FIX_ROW.has(p.href)) return { ...LINK_FIX_ROW.get(p.href), ...(p.section ? { section: p.section } : {}) };
      const twin = BANNED_TWIN.get(p.href);
      if (twin && slug.startsWith("store-") && twin.store !== slug) return p;
      if (twin && process.env.GIFT_PICKS_VERBOSE) console.error(`LINKS-R3 ${slug}: ${p.name} ${p.href} -> ${twin.href}`);
      if (twin) return (linksR3.relinked += 1), { ...twin, ...(p.section ? { section: p.section } : {}) };
      return p;
    })));
    if (kept.length) pageList[slug] = noRepeats(kept);
    else delete pageList[slug];
  }
  // One beauty product on at most BEAUTY_GUIDE_MAX guides (fit audit r3b: LANEIGE's lip mask was on 14): the guides its
  // BEAUTY_PREFERRED list names first (fit audit r4: Kitsch curlers, the Airwrap), then the people guides (beautyRank).
  // The product, not its spelling: "LANEIGE Lip Sleeping Mask" and "Lip Sleeping Mask" are one.
  const beautyKey = (p) => {
    const brandWords = dedupeKey(p.brand ?? "");
    const name = dedupeKey(p.name);
    return `${brandKey(p.brand)}|${brandWords && name.startsWith(`${brandWords} `) ? name.slice(brandWords.length + 1) : name}`;
  };
  const beautySlugs = Object.keys(pageList).filter((s) => !s.startsWith("store-") && s !== SPONSORS_GUIDE);
  const beautyKeep = new Map();
  for (const slug of beautySlugs) for (const p of pageList[slug]) if (beautyItem(p)) {
    const k = beautyKey(p);
    (beautyKeep.get(k) ?? beautyKeep.set(k, []).get(k)).push([slug, beautyPreference(p, slug)]);
  }
  for (const [k, on] of beautyKeep) {
    on.sort(([a, pa], [b, pb]) => pa - pb || beautyRank(a) - beautyRank(b) || a.localeCompare(b));
    beautyKeep.set(k, new Set(on.slice(0, BEAUTY_GUIDE_MAX).map(([s]) => s)));
  }
  for (const slug of beautySlugs) {
    pageList[slug] = pageList[slug].filter((p) => {
      if (!beautyItem(p) || beautyKeep.get(beautyKey(p))?.has(slug)) return true;
      holistic.removed += 1;
      holistic.byRule["beauty on 6 guides"] = (holistic.byRule["beauty on 6 guides"] ?? 0) + 1;
      return false;
    });
    if (!pageList[slug].length) delete pageList[slug];
  }
  // North Louisiana holds North Louisiana items only (fit audit r4; fitR4Why drops the rest): every photo'd pick we carry
  // that names a North Louisiana maker, team or town joins it. The library holds very few: the guide stays small (lead 11-19).
  {
    const list = pageList[NORTH_LA_GUIDE] ?? [];
    for (const p of [...NORTH_LA_POOL, ...everyPick, ...Object.values(pageList).flat()]) {
      if (!p.image || !NORTH_LA.test(`${p.name} ${p.brand ?? ""}`) || bannedLink(p.href) || list.some((x) => x.href === p.href || dedupeKey(x.name) === dedupeKey(p.name))) continue;
      const { section: _s, ...row } = p;
      list.push(row);
    }
    if (list.length) pageList[NORTH_LA_GUIDE] = list;
    else delete pageList[NORTH_LA_GUIDE];
  }
  for (const [slug, list] of Object.entries(pageList)) {
    // No top-up from peer guides (owner 11-19: fit beats count; a short guide is listed in belong.short for research).
    if (slug.startsWith("store-") || slug === SPONSORS_GUIDE || slug === "gift-cards" || slug === "subscriptions" || list.length >= TOP_GIFTS) continue;
    holistic.short.push(`${slug}:${list.length}`);
  }
}
// A store page the links audit's removals emptied (store-selfridges: every pin opened the UK site) leaves the store
// list, the way the belong pass drops one (no picks, no deals, no pick naming it).
{
  const named = new Set(Object.values(pageList).flat().map((p) => p.store).filter(Boolean));
  for (const s of Object.keys(storeList)) {
    if (pageList[s]?.length || deals[s]?.length || named.has(s)) continue;
    delete storeList[s];
    linksR3.storesEmptied.push(s);
  }
}
// NEW APPROVALS, again (lead 11-19: "never push out Trending or the top 3"): the holistic pass can drop picks above a
// new-approval pick and lift it into the top 3; each one is taken out and put back by newApprovalSlot on the final list.
for (const [slug, hrefs] of NEW_APPROVAL_HREFS) {
  const list = pageList[slug];
  if (!list) continue;
  const mine = list.filter((p) => hrefs.has(p.href));
  const rest = list.filter((p) => !hrefs.has(p.href));
  for (const p of mine) rest.splice(newApprovalSlot(rest, isTrending, isAmazonPick), 0, p);
  pageList[slug] = rest;
}
// Removing repeats can lift a later XTRATUF boot into the top: one in the first 12, two in the first 25, again.
for (const slug of Object.keys(pageList)) {
  if (slug.startsWith("store-")) continue;
  const list = pageList[slug];
  const out = [];
  const held = [];
  for (const p of list) {
    const boots = out.filter(isXtratuf).length;
    if (isXtratuf(p) && out.length < TOP_GIFTS && boots >= (out.length < FEATURED_TOP ? 1 : 2)) held.push(p);
    else out.push(p);
  }
  // A guide of 25 or fewer has no place past its top 25 for a held boot: it leaves (fit audit r3b removals made Boater 25).
  pageList[slug] = out.length >= TOP_GIFTS ? [...out.slice(0, TOP_GIFTS), ...held, ...out.slice(TOP_GIFTS)] : out;
}
const pageRepeats = repeatsRemoved;
/** A store page's deal items never repeat its picks or each other (live audit r3 #1: Xbox, AirPods, KitchenAid twice on Walmart). */
let dealRepeats = 0;
for (const [slug, list] of Object.entries(deals)) {
  const seenHref = new Set((pageList[slug] ?? []).map((p) => p.href));
  const seenKey = new Set((pageList[slug] ?? []).map((p) => dedupeKey(p.name)).filter((k) => k.length > 3));
  for (const d of list) {
    if (!d.items) continue;
    const kept = d.items.filter((i) => {
      const k = dedupeKey(i.name);
      if (seenHref.has(i.href) || (k.length > 3 && seenKey.has(k))) return (dealRepeats += 1), false;
      seenHref.add(i.href);
      if (k.length > 3) seenKey.add(k);
      return true;
    });
    if (kept.length) d.items = kept;
    else delete d.items;
  }
}
/**
 * "Top 10 most-loved" (owner 2026-11-18): the picks listed in the most guides (store pages not counted), photos
 * first, then by how many guides list them, then by name. Counted by link (and name, for shared ShopMy links).
 */
// A researched fill row that is a product the Amazon page already lists under another link or name (same ASIN or same
// name; the page keeps one row per product) takes the page's row, so the Amazon page still lists every guide pick on Amazon.
{
  const amazonPage = pageList["store-amazon"] ?? [];
  const byAsin = new Map(amazonPage.map((x) => [asinOf(x), x]).filter(([a]) => a));
  const byName = new Map(amazonPage.map((x) => [dedupeKey(x.name), x]));
  const hrefs = new Set(amazonPage.map((x) => x.href));
  const sectionOfSlug = new Map([...indexSrc.matchAll(/group: "([^"]+)"[^}]*?slug: "([^"]+)"/g)].map((m) => [m[2], m[1]]));
  for (const [slug, fills] of BELONG_FILL_HREFS) {
    const list = pageList[slug];
    if (!list) continue;
    pageList[slug] = list.map((p) => {
      if (!fills.has(p.href) || p.store !== "store-amazon" || hrefs.has(p.href)) return p;
      // By name only the same variant (fit audit r4: Red Lover's red JBL Grip took the page's blue one, the names
      // matching once their colors were dropped).
      const byKey = byName.get(dedupeKey(p.name));
      const sameColors = (a, b) => { const x = colorsOf(a); const y = colorsOf(b); return x.size === y.size && [...x].every((c) => y.has(c)); };
      const row = byAsin.get(asinOf(p)) ?? (byKey && sameVariant(p.name, byKey.name) && sameColors(p.name, byKey.name) ? byKey : undefined);
      if (!row) {
        // Not on the page at all (a repeat pass dropped it as another guide's same-named row): it joins the page, unless the
        // page already lists another color of it (fit r4: one row per product on a page; the guide keeps its own color).
        if (!byKey && !louisianaBlocked("store-amazon", p)) {
          const section = AMAZON_SECTIONS.includes(sectionOfSlug.get(slug)) ? sectionOfSlug.get(slug) : "More finds";
          const rank = AMAZON_SECTIONS.indexOf(section);
          let at = 0;
          amazonPage.forEach((x, i) => { if (AMAZON_SECTIONS.indexOf(x.section) <= rank) at = i + 1; });
          amazonPage.splice(at, 0, { ...p, section });
          hrefs.add(p.href);
          byName.set(dedupeKey(p.name), p);
          if (asinOf(p)) byAsin.set(asinOf(p), p);
        }
        return p;
      }
      if (list.some((x) => x.href === row.href)) return p;
      const { section: _section, ...own } = row;
      return own;
    });
  }
}
// The r4 fit rules once more on every guide's final list (a row the step above swapped in is checked like any other).
{
  const sectionOfSlug = new Map([...indexSrc.matchAll(/group: "([^"]+)"[^}]*?slug: "([^"]+)"/g)].map((m) => [m[2], m[1]]));
  for (const slug of Object.keys(pageList)) {
    if (slug.startsWith("store-") || slug === SPONSORS_GUIDE) continue;
    pageList[slug] = noRepeats(pageList[slug].filter((p) => !fitR4Why(slug, sectionOfSlug.get(slug) ?? "", p) || ((holistic.removed += 1), false)));
  }
}
// Fit audit r4 names (R4_NAME_FIXES: "Salt, Fat" -> "Salt, Fat, Acid, Heat", "Venezia 18K" -> "St. Louis Venezia 18K
// Sunglasses"), on every page's final list, then one row per product again.
// Only a renamed row can newly repeat another (the same name, or the same link): that one goes; every other row stays as
// the page's own rules left it (a store page keeps its color variants).
for (const slug of Object.keys(pageList)) {
  const seen = new Set();
  pageList[slug] = pageList[slug].map((p) => { const r = r4Name(p); return r.name === p.name ? p : { ...p, ...r, renamed: true }; })
    .filter((p) => { const k = [compact(p.name), p.href]; const dup = p.renamed && k.some((x) => seen.has(x)); k.forEach((x) => seen.add(x)); return !dup; })
    .map(({ renamed: _r, ...p }) => p);
}
// The curation's removes, on the final page (so a backfill or swap cannot bring one back). A guide that would fall under
// its floor keeps its best-ranked (first-listed) removed picks until it reaches the floor.
const curationFloorHit = [];
for (const slug of Object.keys(CURATION)) {
  if (!pageList[slug]) continue;
  const list = pageList[slug];
  const kept = list.filter((p) => !curatedOut(slug, p));
  const floor = Math.min(curationFloor(slug), list.length);
  if (kept.length < floor) {
    const back = new Set(list.filter((p) => curatedOut(slug, p)).slice(0, floor - kept.length));
    curationFloorHit.push(`${slug} (${kept.length} -> ${kept.length + back.size})`);
    pageList[slug] = list.filter((p) => !curatedOut(slug, p) || back.has(p));
  } else pageList[slug] = kept;
  curationCounts[slug].removed = list.length - pageList[slug].length;
  const top = (CURATION[slug].top12 ?? []).map((n) => compact(String(n)));
  curationCounts[slug].top12 = pageList[slug].slice(0, 12).filter((p) => top.some((t) => t === compact(p.name) || sameName(t, p.name))).length;
}
console.log(`gift-guide-picks: ${movedToTreats.size} food picks moved to ${TREATS_GUIDE} (${pageList[TREATS_GUIDE]?.length ?? 0} shown there)`);
if (Object.keys(CURATION).length) console.log(`gift-guide-picks: curation ${JSON.stringify(curationCounts)}; floor kept picks on ${curationFloorHit.length ? curationFloorHit.join(", ") : "no guide"}`);
const loved = new Map();
for (const [slug, list] of Object.entries(pageList)) {
  if (slug.startsWith("store-")) continue;
  for (const p of list) {
    const key = `${p.href} ${p.name}`;
    const cur = loved.get(key) ?? { p, n: 0 };
    cur.n += 1;
    loved.set(key, cur);
  }
}
// A row is a product, not a store page or a page title ("Bass Pro Shops", "Sites-SA-Site", "... 2024 | Harry & David").
const looksLikeProduct = (p) => {
  const name = p.name.trim();
  const store = p.store ? stores.get(p.store)?.name ?? "" : "";
  if (p.brand && name.includes(" - ") && compact(name.split(" - ")[0]) === compact(p.brand)) return false; // "L.L.Bean - Outside Together ..."
  return name.length > 3 && !/^sites-|\b20\d\d\b|\|/i.test(name) && ![p.brand, store].some((x) => x && compact(x) === compact(name)) && !/^[a-z0-9]+$/.test(name);
};
const lovedTop = [...new Map([...loved.values()].filter((x) => x.n > 1 && looksLikeProduct(x.p)).map((x) => [x.p.name, x])).values()]
  .sort((a, b) => Number(Boolean(b.p.image)) - Number(Boolean(a.p.image)) || b.n - a.n || a.p.name.localeCompare(b.p.name))
  // One per brand, so the row is ten different finds.
  .filter((x, i, all) => !x.p.brand || all.findIndex((y) => y.p.brand === x.p.brand) === i)
  .map((x) => x.p);
/** Our Top 10 (owner 11-18 PM): the featured file's "top-10" ({ guide, name }) when present; the most-loved picks fill any gap. */
const featuredTop = (Array.isArray(FEATURED["top-10"]) ? FEATURED["top-10"] : [])
  .map((x) => {
    const want = String(x?.name ?? "");
    // Its guide first; a curation that moved it off that guide still finds the same name on any other guide page.
    const p = findByName(pageList[x?.guide] ?? guides[x?.guide] ?? [], want)
      ?? Object.entries(pageList).filter(([slug]) => !slug.startsWith("store-")).map(([, list]) => list.find((q) => compact(q.name) === compact(want))).find(Boolean);
    if (!p) console.warn(`gift-guide-picks: top-10 ${JSON.stringify(x)} not found`);
    // "as": the short brand-first name the Top 10 card shows (owner 11-19: "Ember Mug 2, 14 oz").
    return p && typeof x?.as === "string" && x.as.trim() ? { ...p, name: x.as.trim() } : p;
  })
  .filter(Boolean);
const topPicks = noRepeats([...featuredTop, ...lovedTop]).slice(0, 10);
// Sibling overlap (owner 11-19): mom and wife (and every pair in a family) share no top-12 pick and at most 15% overall.
{
  const key = (p) => compact(p.name) || p.href;
  const worst = () => Math.max(0, ...SIBLING_FAMILIES.flatMap((f) => f.flatMap((a) => f.filter((b) => b !== a && pageList[a] && pageList[b]).map((b) => siblingOverlap(pageList[a], pageList[b], key).share))));
  const before = worst();
  const removed = applySiblingOverlap(pageList, key);
  console.log(`gift-guide-picks: sibling overlap ${Math.round(before * 100)}% -> ${Math.round(worst() * 100)}% worst pair; removed ${JSON.stringify(removed)}`);
}
// No photo, no row on the people, kids and budget guides (lead 11-19: a "Walmart" store tile is for store pages only).
{
  const groupOfSlug = new Map([...indexSrc.matchAll(/group: "([^"]+)"[^}]*?slug: "([^"]+)"/g)].map((m) => [m[2], m[1]]));
  for (const slug of Object.keys(pageList)) {
    // Gift Cards and Subscriptions keep their store tiles (a gift card has no product photo).
    if (slug.startsWith("store-") || ["gift-cards", "subscriptions"].includes(slug) || !["By person", "For kids", "By budget"].includes(groupOfSlug.get(slug))) continue;
    pageList[slug] = pageList[slug].filter((p) => typeof p.image === "string" && p.image.startsWith("https://"));
  }
}
/**
 * FLAGGED ONCE, GONE EVERYWHERE (lead 11-19, pre-launch audit B: the one-guide rule moved flagged items to other guides).
 * Every name a removal list flags (the curation files, the taste audit, the pre-launch audits _prelaunch-audit-*.json)
 * leaves every non-store guide; a pre-launch audit's store-page removals leave that store page too.
 */
export const globalRemoveCounts = { names: 0, removed: 0 };
/** Every name a removal list flags (filled below); the brand fill reads it too. */
export const GLOBAL_FLAGGED = new Set();
{
  const flagged = new Set();
  const addName = (n) => {
    const t = String(n ?? "").trim();
    if (!t) return;
    flagged.add(compact(t));
    flagged.add(compact(t.replace(/\s*\([^)]*\)\s*$/, "")));
  };
  // A curation remove counts everywhere when its reason is about the item itself (off-brand, obscure, cheap, banned...),
  // not about fit for that one guide ("fine for stocking stuffers", "better for Home Cook"); the taste audit's always do.
  const QUALITY = /off-?brand|obscure|marketplace|owner|banned|cheap|filler|generic|knock-?off|not a (real )?gift|dated|ugly|tacky|low[- ]quality|drugstore|random|unknown|no-name|sold out|dead|broken|wrong (item|page|photo)|lifestyle photo|old model|outdated/i;
  const FIT_ONLY = /fine (for|on|in)|better (for|on|in)|belongs|keep (it )?(in|on)|instead|move(d)? to|for (this|a) /i;
  for (const c of Object.values(CURATION)) {
    for (const r of Array.isArray(c.remove) ? c.remove : []) {
      const why = String(r?.reason ?? r?.problem ?? "");
      if (/^_taste-audit-/.test(String(c.file ?? "")) || (QUALITY.test(why) && !FIT_ONLY.test(why))) addName(r?.name ?? r);
    }
  }
  const storeRemoves = new Map();
  for (const f of readdirSync(dir).filter((x) => /^_prelaunch-audit-.*\.json$/.test(x)).sort()) {
    const v = readJson(f);
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    for (const [slug, entry] of Object.entries(v)) {
      if (slug === SPONSORS_GUIDE) continue;
      const rows = Array.isArray(entry) ? entry : Array.isArray(entry?.remove) ? entry.remove : [];
      for (const r of rows) {
        if (slug.startsWith("store-")) { const set = storeRemoves.get(slug) ?? new Set(); set.add(compact(String(r?.name ?? ""))); storeRemoves.set(slug, set); }
        addName(r?.name);
      }
    }
  }
  flagged.delete("");
  for (const n of flagged) GLOBAL_FLAGGED.add(n);
  globalRemoveCounts.names = flagged.size;
  for (const slug of Object.keys(pageList)) {
    if (slug === SPONSORS_GUIDE) continue;
    const before = pageList[slug].length;
    const own = storeRemoves.get(slug);
    pageList[slug] = slug.startsWith("store-") ? pageList[slug].filter((p) => !own?.has(compact(p.name)) && !blockedBrand(p)) : pageList[slug].filter((p) => !blockedBrand(p) && (!flagged.has(compact(p.name)) || keepsCheapWalmart(slug, p)));
    globalRemoveCounts.removed += before - pageList[slug].length;
  }
  console.log(`gift-guide-picks: ${globalRemoveCounts.names} flagged names, ${globalRemoveCounts.removed} rows removed everywhere`);
}
/**
 * ONE GUIDE PER PRODUCT (owner 11-19: "really and truly they don't need to share any items"): across the non-store
 * guides every product (by link and by name) shows on exactly one guide, the one it fits best: a curated top-12 spot
 * first, then the most specific audience (a career beats a hobby, then kids' ages, colors and life moments, then the
 * people guides, then budgets), then its better rank, then the guide with fewer picks. Store pages keep their own
 * items. A guide left under UNIQUE_FLOOR picks is logged, never refilled with a repeat.
 */
export const UNIQUE_FLOOR = 8;
/** The order guides claim a shared product in (lead 11-19); a guide not named here comes after, by group. */
export const CLAIM_ORDER = ["mom", "wife", "her", "dad", "him", "boyfriend-or-husband", "girlfriend", "grandma", "grandpa", "sister", "brother", "best-friend",
  "mother-in-law", "father-in-law", "aunt", "uncle", "girls-teens", "boys-teens", "gender-neutral-teens", "girls", "boys", "gender-neutral",
  "girls-big-kids", "boys-big-kids", "gender-neutral-big-kids", "girls-little-kids", "boys-little-kids", "gender-neutral-little-kids",
  "girls-toddlers", "boys-toddlers", "gender-neutral-toddlers", "girls-babies", "boys-babies", "gender-neutral-babies", "niece", "nephew", "cousins",
  "stocking-stuffers", "under-5", "under-10", "under-15", "under-20", "under-25", "under-30", "under-40", "under-50", "under-75", "under-100", "100-and-up",
  "secret-santa", "white-elephant", "coworkers", "boss", "teachers", "neighbor"];
/** A job-specific item: it goes to a career guide that lists it, never a people guide. */
export const JOB_ITEM = /\b(scrubs?|nurs(e|es|ing)|stethoscopes?|badge (reels?|holders?)|clogs?|compression socks|penlights?|trauma shears|teacher|classroom|lineman|linemen|lineworkers?|hard ?hats?|work boots?|welding|dental|hygienist|phlebotom\w*|pharmac\w*|paramedic|emt|firefighter|police|dispatcher|barista|bartender|server apron|chef'?s?|kitchen staff|hairstylist|shears|mechanic|electrician|hvac|offshore|oilfield|pipeline|refinery|trucker|truck driver)\b/i;
export const uniqueCounts = { before: 0, after: 0, underFloor: [], colorways: 0, brandFill: 0, thinClaims: 0 };
/** Thin guides claim shared products until they hold this many, from guides holding more than THIN_DONOR_MIN (lead 11-19). */
export const THIN_CLAIM_TARGET = 10;
export const THIN_DONOR_MIN = 15;
/** Colorway repeats (owner 11-19): a family guide refills to this many picks, a product shows in at most this many guides. */
export const COLORWAY_TARGET = 40;
/** Owner 1:25 PM ("no more than 2 duplicates"): a colorway repeat brings a product to at most 2 guides. */
export const COLORWAY_MAX = DUP_GUIDE_MAX;
/** Item types that make two products of one brand + model word (core() below). */
export const CORE_KIND = [[/^(earrings?|studs?|hoops?|huggies)$/, "earring"], [/^(necklaces?|pendants?)$/, "necklace"], [/^(bracelets?|cuffs?|bangles?)$/, "bracelet"],
  [/^rings?$/, "ring"], [/^masks?$/, "mask"], [/^pillowcases?$/, "pillowcase"], [/^robes?$/, "robe"], [/^towels?$/, "towel"], [/^(blankets?|throws?)$/, "blanket"],
  [/^socks?$/, "sock"], [/^(totes?|bags?)$/, "bag"], [/^(wallets?|wristlets?|pouch|pouches)$/, "wallet"], [/^backpacks?$/, "backpack"], [/^mugs?$/, "mug"],
  [/^tumblers?$/, "tumbler"], [/^(bottles?|jugs?)$/, "bottle"], [/^coolers?$/, "cooler"], [/^(jackets?|vests?)$/, "jacket"], [/^(hoodies?|sweatshirts?|pullovers?)$/, "top"],
  [/^(pants?|joggers?|leggings?)$/, "pant"], [/^keychains?$/, "keychain"], [/^(creams?|lotions?|oils?|balms?)$/, "body"], [/^(mists?|perfumes?|parfums?)$/, "scent"],
  [/^(earbuds?|buds)$/, "earbuds"], [/^headphones?$/, "headphones"], [/^speakers?$/, "speaker"], [/^(candles?|sprays?|diffusers?)$/, "home scent"],
  [/^(wands?|rollers?|massagers?|goggles)$/, "tool"], [/^cameras?$/, "camera"], [/^(chargers?|banks?|stations?)$/, "charger"]];
export const BRAND_FILL_TARGET = 30;
export const BRAND_FILL_PER_BRAND = 3;
const WOMEN_BRANDS = /^(lululemon|ugg|kendra scott|sol de janeiro|slip|barefoot dreams|summer fridays|laneige|rare beauty|glow recipe|mejuri|baublebar|gorjana|stoney clover( lane)?|owala|stanley|kitsch|free people|anthropologie|southern marsh|comfort colors|simply southern|julie vos|spartina 449|rifle paper co\.?|tarte|charlotte tilbury|glossier|olive & june|skims|rothy'?s|madewell|lilly pulitzer|vineyard vines|hoka|on|birkenstock|new balance|adidas|nike|apple|dyson|sharkninja|shark|ninja|le creuset|our place|capri blue|voluspa|boy smells|homesick|paddywax|nest|otherland|bath & body works|tatcha|clinique|benefit|fresh|drunk elephant|beis|béis|calpak|dagne dover|kate spade( new york)?|coach|tory burch|michael kors|lake|little sleepies|brooklinen|parachute|crocs|kiehl'?s|dior|chanel|yeti|hydro flask|theragun|therabody|vuori|beyond yoga|alo|sperry|mud pie|magnolia|baggu)$/i;
const MEN_BRANDS = /^(yeti|xtratuf|muck( boot( company)?)?|huk|simms|costa|columbia|aftco|leatherman|bubba|blackstone|mossy oak|realtree|carhartt|traeger|solo stove|oklahoma joe'?s|weber|garmin|bass pro shops|cabela'?s|penn|rapala|shimano|ugly stik|hoka|brooks|heydude|ariat|justin|georgia boot|durango|under armour|the north face|patagonia|stanley|owala|hydro flask|apple|bose|jbl|sony|ray-?ban|oakley|smith|black rifle coffee( company)?|ooni|lodge|benchmade|buck|gerber|kershaw|milwaukee|dewalt|craftsman|ryobi|southern marsh|southern tide|vineyard vines|tommy bahama|magellan( outdoors)?|salt life|local boy|duck camp|bombas|theragun|therabody|nike|adidas|vuori|rhone|ten thousand|ninja|sharkninja|meater|thermacell|tractor supply)$/i;
const TEEN_GIRL_BRANDS = /^(owala|stanley|kitsch|rare beauty|glow recipe|summer fridays|lululemon|ugg|baublebar|stoney clover( lane)?|sol de janeiro|laneige|olive & june|glossier|tarte|skims|crocs|adidas|nike|new balance|apple|jellycat|kendra scott|pura vida|hydro flask|urban outfitters|free people|polaroid|fujifilm|instax|beats|skullcandy|bubble|e\.l\.f\.|elf)$/i;
const TEEN_BOY_BRANDS = /^(nike|adidas|under armour|apple|beats|jbl|sony|bose|nintendo|xbox|playstation|razer|logitech|yeti|owala|stanley|hydro flask|huk|columbia|costa|ray-?ban|the north face|crocs|heydude|new balance|hoka|carhartt|leatherman|skullcandy|polaroid|fujifilm|instax)$/i;
/** Each audience's guides and the brands its fill reads (lead 11-19; the owner's brand lists in gift-guides-holistic-design). */
const BRAND_FILL = [
  [["mom", "wife", "her", "grandma", "girlfriend", "sister", "best-friend", "mother-in-law", "aunt"], WOMEN_BRANDS],
  [["dad", "him", "boyfriend-or-husband", "grandpa", "brother", "father-in-law", "uncle"], MEN_BRANDS],
  [["girls-teens"], TEEN_GIRL_BRANDS],
  [["boys-teens"], TEEN_BOY_BRANDS],
];
{
  const groupOf = new Map([...indexSrc.matchAll(/group: "([^"]+)"[^}]*?slug: "([^"]+)"/g)].map((m) => [m[2], m[1]]));
  const guideSlugs = Object.keys(pageList).filter((slug) => !slug.startsWith("store-") && slug !== SPONSORS_GUIDE);
  // One id per product: a link and a name both point at it.
  const idOf = new Map();
  // A product's core name (pre-launch audit 11-19: "UGG Tasman" and "Women's Tasman II Slipper", four adidas Samba
  // rows): the brand, the words after its name's first comma, dash or parenthesis, gender words and sizes go.
  const GENERIC_WORD = /^(signature|classic|original|mini|large|small|medium|new|holiday|christmas|premium|deluxe|essential|essentials|everyday|smart|wireless|portable|insulated|stainless|steel|cotton|cozy|soft|plush|luxury|gift|set|sets|pack|bundle|kit|collection|edition|limited|series|personalized|custom|womens|mens|unisex|kids|girls|boys|baby|toddler|adult|sherpa|fleece|knit|leather|suede|wool|cashmere|silk|satin|black|white|pink|blue|green|grey|gray|navy|cream|brown|tan|red|purple|gold|silver|card|cards|egift|giftcard|membership|subscription|subscriptions|monthly|annual|month|months|year|class|classes|tour|tours|ticket|tickets|experience|session|package|service|services|digital|online|virtual|book|books|calendar|planner)$/;
  const core = (p) => {
    const brand = compact(p.brand ?? "");
    let n = String(p.name).toLowerCase().split(/\s[-–|]\s|,|\(/)[0].replace(/\b(women'?s|men'?s|unisex|kids'?|adults?|the|classic|original|ii|2nd gen|\d+(\.\d+)? ?(oz|qt|quart|in|inch|l|ml|pc|piece|pack|count|ct))\b/g, " ");
    // The model word: the first word after the brand ("Samba", "Tasman", "Elisa", "Baies"), unless it is generic.
    const words = n.split(/[^a-z0-9]+/).filter(Boolean).filter((w) => compact(w) !== brand && !brand.startsWith(compact(w)));
    const model = words.find((w) => w.length >= 4 && !GENERIC_WORD.test(w));
    // 1119c: the item type too, when the name ends on one (a Brooklinen Mulberry silk eye mask and pillowcase, Julie Vos
    // Cannes earrings and cuff, UGG Tasman slippers and socks are two products each); footwear keeps one key per model.
    const kind = CORE_KIND.find(([re]) => re.test(words[words.length - 1] ?? ""))?.[1] ?? "";
    return brand && model ? `c:${brand}:${model}${kind ? `:${kind}` : ""}` : "";
  };
  const productId = (p) => {
    const n = `n:${compact(p.name)}`;
    const h = `h:${p.href}`;
    const id = idOf.get(h) ?? idOf.get(n) ?? h;
    idOf.set(h, id);
    idOf.set(n, id);
    return id;
  };
  // The two new guides claim only their own file's rows (else Gift Tags won the gift cards from Gift Cards).
  for (const [slug, own] of Object.entries(OWN_FILE_HREFS)) if (pageList[slug]) pageList[slug] = pageList[slug].filter((p) => own.has(p.href));
  // Every guide's list before the pass: the colorway refill below reads it.
  const beforeUnique = Object.fromEntries(guideSlugs.map((slug) => [slug, [...pageList[slug]]]));
  const seen = new Map();
  for (const slug of guideSlugs) pageList[slug].forEach((p, i) => { const id = productId(p); seen.set(id, [...(seen.get(id) ?? []), { slug, i }]); });
  const dupes = () => { let n = 0; const c = new Map(); for (const slug of guideSlugs) for (const p of pageList[slug]) { const id = productId(p); c.set(id, (c.get(id) ?? 0) + 1); } for (const v of c.values()) n += Math.max(0, v - 1); return n; };
  uniqueCounts.before = dupes();
  const topOf = (slug) => new Set((CURATION[slug]?.top12 ?? []).map((n) => compact(String(n))));
  const tops = new Map(guideSlugs.map((slug) => [slug, topOf(slug)]));
  const nameAt = (w) => compact(pageList[w.slug][w.i].name);
  // Lead 11-19: guides claim in CLAIM_ORDER (the people guides first, careers last), so the main guides stay full;
  // a job-specific item (scrubs, nurse clogs, a lineman tool) always goes to a career guide that lists it.
  const groupRank = { "By person": 0, "For kids": 1, "By budget": 2, Hobbies: 4, Pets: 4, Colors: 5, "Life moments": 6, Louisiana: 7, "By career": 9 };
  const claimRank = (slug) => {
    const i = CLAIM_ORDER.indexOf(slug);
    if (i >= 0) return i;
    return 100 + (groupRank[groupOf.get(slug)] ?? 8) * 100 + INDEX.findIndex((g) => g.slug === slug);
  };
  const owner = new Map();
  const count = new Map(guideSlugs.map((slug) => [slug, 0]));
  const entries = [...seen].map(([id, where]) => [id, where.filter((w, k) => where.findIndex((x) => x.slug === w.slug) === k)]);
  for (const [id, where] of entries) {
    const p = pageList[where[0].slug][where[0].i];
    const careers = where.filter((w) => groupOf.get(w.slug) === "By career");
    const pool = JOB_ITEM.test(`${p.name} ${p.line ?? ""}`) && careers.length ? careers : where;
    const w = [...pool].sort((a, b) => (pool === careers ? count.get(a.slug) - count.get(b.slug) : 0) || claimRank(a.slug) - claimRank(b.slug) || a.i - b.i)[0];
    owner.set(id, w);
    count.set(w.slug, count.get(w.slug) + 1);
  }
  // THIN GUIDES FIRST (lead 11-19, 1530 train: "a guide sitting at 0-1 is worse than Mom having 30 instead of 31"): a
  // guide under THIN_CLAIM_TARGET takes back products it lists from a guide holding more than THIN_DONOR_MIN, thinnest
  // guide first, never a donor's curated top 12, and a job item only to a career guide.
  {
    const candidates = new Map(guideSlugs.map((slug) => [slug, []]));
    for (const [id, where] of entries) for (const w of where) candidates.get(w.slug)?.push([id, w]);
    const thin = guideSlugs.filter((slug) => count.get(slug) < THIN_CLAIM_TARGET).sort((a, b) => count.get(a) - count.get(b) || claimRank(a) - claimRank(b));
    for (const slug of thin) {
      for (const [id, w] of candidates.get(slug)) {
        if (count.get(slug) >= THIN_CLAIM_TARGET) break;
        const cur = owner.get(id);
        if (!cur || cur.slug === slug || count.get(cur.slug) <= THIN_DONOR_MIN || tops.get(cur.slug)?.has(nameAt(cur))) continue;
        const p = pageList[w.slug][w.i];
        if (JOB_ITEM.test(`${p.name} ${p.line ?? ""}`) && groupOf.get(slug) !== "By career") continue;
        owner.set(id, w);
        count.set(cur.slug, count.get(cur.slug) - 1);
        count.set(slug, count.get(slug) + 1);
        uniqueCounts.thinClaims += 1;
      }
    }
  }
  for (const slug of guideSlugs) {
    const used = new Set();
    pageList[slug] = pageList[slug].filter((p) => {
      const id = productId(p);
      if (used.has(id)) return false;
      used.add(id);
      return owner.get(id)?.slug === slug;
    });
  }
  // A last sweep by link and by name, so a product whose link and name were seen under two ids still shows once.
  const takenHref = new Map();
  const takenName = new Map();
  const takenCore = new Map();
  const byClaim = [...guideSlugs].sort((a, b) => claimRank(a) - claimRank(b));
  for (const slug of byClaim) for (const p of pageList[slug]) { if (!takenHref.has(p.href)) takenHref.set(p.href, slug); if (!takenName.has(compact(p.name))) takenName.set(compact(p.name), slug); const c = core(p); if (c && !takenCore.has(c)) takenCore.set(c, slug); }
  for (const slug of guideSlugs) {
    const mine = new Set();
    pageList[slug] = pageList[slug].filter((p) => {
      const c = core(p);
      if (c && mine.has(c)) return false; // the same product twice on one guide
      if (c) mine.add(c);
      return takenHref.get(p.href) === slug && takenName.get(compact(p.name)) === slug && (!c || takenCore.get(c) === slug);
    });
    if (pageList[slug].length < UNIQUE_FLOOR) uniqueCounts.underFloor.push(`${slug} (${pageList[slug].length})`);
  }
  uniqueCounts.after = dupes();
  /**
   * COLORWAY REPEATS (owner 11-19: "if you are going to use the same item for different guides, at least choose a
   * different color"): a guide in a sibling family (SIBLING_FAMILIES) under COLORWAY_TARGET picks takes back, from its
   * family's lists before the pass, another colorway of a product already shown: its own name, link and photo (never a
   * photo, link or name shown anywhere else), the product in at most COLORWAY_MAX guides, once per guide, below every
   * other guide's top 12 when it would land in this one's, no pastels on men's guides (MEN_PASTEL), cute colorways first
   * on women's.
   */
  // The same per-guide rules every guide's own picks passed above (belong, fit r4, beauty, care, Louisiana items).
  const fillFits = (slug, p) => !louisianaBlocked(slug, p) && !utilityCare(p) && (!beautyItem(p) || beautyGuide(slug))
    && !belongsWhy(slug, groupOf.get(slug) ?? "", p, { tumblers: 0 }, true) && !fitR4Why(slug, groupOf.get(slug) ?? "", p) && !LA_LINE.test(String(p.line ?? ""))
    && !(/\b(airwrap|lego)\b/i.test(`${p.name} ${p.brand ?? ""}`) && !["her", "wife", "girlfriend", "mom", "sister"].includes(slug));
  const usedImg = new Set();
  const usedHref = new Set();
  const usedName = new Set();
  const shownIn = new Map();
  const topCore = new Map();
  const keyOf = (p) => core(p) || `n:${compact(p.name)}`;
  for (const slug of guideSlugs) pageList[slug].forEach((p, i) => {
    usedImg.add(p.image); usedHref.add(p.href); usedName.add(compact(p.name));
    const k = keyOf(p);
    shownIn.set(k, new Set([...(shownIn.get(k) ?? []), slug]));
    if (i < 12) topCore.set(k, slug);
  });
  for (const family of SIBLING_FAMILIES) {
    const men = family.includes("dad");
    const pool = [];
    for (const g of family) (beforeUnique[g] ?? []).forEach((p, i) => pool.push({ p, i }));
    pool.sort((a, b) => a.i - b.i);
    const CUTE = /\b(pink|blush|rose|lavender|lilac|marshmallow|candy|peach|mint|cream|sage|coral|berry)\b/i;
    const DARK = /\b(black|navy|olive|tan|camo|realtree|mossy oak|charcoal|brown|green|stone|khaki|coyote)\b/i;
    const pref = (p) => (men ? DARK : CUTE).test(`${p.name} ${p.image ?? ""}`) ? 0 : 1;
    const ordered = [...pool].sort((a, b) => pref(a.p) - pref(b.p) || a.i - b.i);
    for (const slug of family) {
      if (!pageList[slug]) continue;
      for (const { p } of ordered) {
        if (pageList[slug].length >= COLORWAY_TARGET) break;
        const k = keyOf(p);
        const where = shownIn.get(k) ?? new Set();
        if (!where.size || where.has(slug) || where.size >= COLORWAY_MAX) continue;
        if (typeof p.image !== "string" || !p.image.startsWith("https://") || usedImg.has(p.image) || usedHref.has(p.href) || usedName.has(compact(p.name))) continue;
        if (JOB_ITEM.test(`${p.name} ${p.line ?? ""}`) || !fitsGuide(slug, p) || curatedOut(slug, p) || !fillFits(slug, p) || (men && MEN_PASTEL.test(`${p.name} ${String(p.image).replace(/[-_]/g, " ")}`))) continue;
        if (pageList[slug].length < 12 && topCore.has(k)) continue;
        pageList[slug].push(p);
        usedImg.add(p.image); usedHref.add(p.href); usedName.add(compact(p.name));
        where.add(slug); shownIn.set(k, where);
        uniqueCounts.colorways += 1;
      }
    }
  }
  console.log(`gift-guide-picks: ${uniqueCounts.colorways} colorway repeats added`);
  /**
   * BRAND FILL (lead 11-19: "FILL every guide with great picks"): a main people guide under BRAND_FILL_TARGET picks takes
   * products no non-store guide shows yet, from every pick read (guides and store pages, store audit C's DROP pages
   * excepted), made by a brand its audience loves (BRAND_FILL: the owner's lists in gift-guides-holistic-design). Each
   * product goes to ONE guide (round robin across the audience's guides), its photo, link and name unused anywhere,
   * every guide rule and removal list applied, at most BRAND_FILL_PER_BRAND of one brand per guide, never a men's item
   * on a women's guide or a women's item on a men's guide.
   */
  const dropPages = new Set(Object.entries(readJson("_prelaunch-audit-1119c.json") ?? {}).filter(([, e]) => /^drop$/i.test(String(e?.grade ?? ""))).map(([k]) => k));
  const pool = [];
  const poolSeen = new Set();
  for (const p of [...everyPick, ...Object.entries(pageList).filter(([k]) => k.startsWith("store-") && !dropPages.has(k)).flatMap(([, l]) => l)]) {
    if (!p?.href || poolSeen.has(p.href) || (p.store && dropPages.has(p.store))) continue;
    poolSeen.add(p.href);
    pool.push(p);
  }
  for (const [family, brands] of BRAND_FILL) {
    const men = family.includes("dad") || family.includes("boys-teens");
    const ok = (p) => {
      const t = `${p.name} ${p.brand ?? ""}`;
      if (!brands.test(String(p.brand ?? "").trim()) && !brands.test(brandFromName(p.name))) return false;
      if (typeof p.image !== "string" || !p.image.startsWith("https://") || brokenImage(p.image) || usedImg.has(p.image) || usedHref.has(p.href) || usedName.has(compact(p.name))) return false;
      if (bannedLink(p.href) || homepageLink(p.href) || collectionLink(p.href) || GLOBAL_FLAGGED.has(compact(p.name)) || blockedBrand(p) || JOB_ITEM.test(`${t} ${p.line ?? ""}`)) return false;
      if (shownIn.get(keyOf(p))?.size) return false;
      if (men ? /\b(women'?s|womens|ladies|girls'?)\b/i.test(t) : (/\b(men'?s|mens|boys'?)\b/i.test(t) || mensItem(p)) && !/\bwomen/i.test(t)) return false;
      if (/\b(toddler|baby|infant|newborn)\b/i.test(t) || (/\b(kids'?|youth)\b/i.test(t) && !family.some((g) => /teens/.test(g)))) return false;
      // No broken names or off-brand accessories riding on a brand's name ("Compatible with Apple Watch Bands").
      if (placeholderName(p) || /\b(generic error|compatible with|replacement|for apple|for airpods|for iphone|case for|bands? (women|men)|gift ?cards?|e-?gift|membership|subscription)\b/i.test(p.name)) return false;
      return true;
    };
    const cands = pool.filter(ok);
    const perBrand = new Map(family.map((g) => [g, new Map()]));
    let placed = true;
    while (placed) {
      placed = false;
      for (const slug of family) {
        if (!pageList[slug] || pageList[slug].length >= BRAND_FILL_TARGET) continue;
        const bc = perBrand.get(slug);
        const i = cands.findIndex((p) => !usedHref.has(p.href) && !usedImg.has(p.image) && !usedName.has(compact(p.name)) && !shownIn.get(keyOf(p))?.size
          && (bc.get(brandKey(p.brand ?? "")) ?? 0) < BRAND_FILL_PER_BRAND && fitsGuide(slug, p) && !curatedOut(slug, p) && fillFits(slug, p)
          && !pageList[slug].some((x) => keyOf(x) === keyOf(p)));
        if (i < 0) continue;
        const [p] = cands.splice(i, 1);
        pageList[slug].push(p);
        usedImg.add(p.image); usedHref.add(p.href); usedName.add(compact(p.name));
        shownIn.set(keyOf(p), new Set([slug]));
        bc.set(brandKey(p.brand ?? ""), (bc.get(brandKey(p.brand ?? "")) ?? 0) + 1);
        uniqueCounts.brandFill += 1;
        placed = true;
      }
    }
  }
  console.log(`gift-guide-picks: ${uniqueCounts.brandFill} brand-fill picks added`);
  console.log(`gift-guide-picks: repeated products across guides ${uniqueCounts.before} -> ${uniqueCounts.after}; ${uniqueCounts.thinClaims} claimed by thin guides; unused library ${unusedCounts.added} of ${unusedCounts.rows} rows added; under ${UNIQUE_FLOOR}: ${uniqueCounts.underFloor.join(", ") || "none"}`);
}
// One digital photo frame site-wide (owner 11-19), on Grandma or Grandparents.
{
  let frames = 0;
  for (const slug of ["grandma", "grandparents"]) if (pageList[slug]) pageList[slug] = pageList[slug].filter((p) => !DIGITAL_FRAME.test(`${p.name} ${p.brand ?? ""}`) || (frames += 1) === 1);
  // ... and one photo book or custom photo product (owner 11-19: "there are too many digital photobooks").
  let books = 0;
  for (const slug of PHOTO_BOOK_GUIDES) if (pageList[slug]) pageList[slug] = pageList[slug].filter((p) => !(PHOTO_PRODUCT.test(p.name) || PHOTO_PRODUCT.test(String(p.brand ?? "").trim())) || DIGITAL_FRAME.test(p.name) || (books += 1) === 1);
}
// Food subscriptions (owner 11-19): at most 2 on Treats & Food Gifts and 1 on Subscriptions.
for (const [slug, max] of Object.entries(FOOD_SUB_MAX)) {
  let n = 0;
  if (pageList[slug]) pageList[slug] = pageList[slug].filter((p) => !isFoodSub(p) || (n += 1) <= max);
}
// Jigsaw puzzles (owner 11-19: "too many puzzles"): at most PUZZLE_MAX site-wide, below a people guide's top 12.
{
  let n = 0;
  const groupOfSlug = new Map([...indexSrc.matchAll(/group: "([^"]+)"[^}]*?slug: "([^"]+)"/g)].map((m) => [m[2], m[1]]));
  for (const slug of Object.keys(pageList)) {
    if (slug.startsWith("store-")) continue;
    const list = pageList[slug].filter((p) => !JIGSAW.test(p.name) || (n += 1) <= PUZZLE_MAX);
    if (groupOfSlug.get(slug) === "By person") {
      const puzzles = list.filter((p) => JIGSAW.test(p.name));
      const rest = list.filter((p) => !JIGSAW.test(p.name));
      pageList[slug] = rest.length >= 12 ? [...rest.slice(0, 12), ...puzzles, ...rest.slice(12)] : rest;
      n -= list.length - rest.length - (rest.length >= 12 ? puzzles.length : 0);
    } else pageList[slug] = list;
  }
}
// Lashes (owner 11-19: "no need for 2 eyelash sets"): one lash item at most on a guide, below its top 12.
for (const slug of Object.keys(pageList)) {
  if (slug.startsWith("store-")) continue;
  const lashes = pageList[slug].filter((p) => LASH.test(p.name));
  if (!lashes.length) continue;
  const rest = pageList[slug].filter((p) => !LASH.test(p.name));
  pageList[slug] = rest.length >= 12 ? [...rest.slice(0, 12), lashes[0], ...rest.slice(12)] : rest;
}
// Vera Bradley (owner 11-19): at most one per guide, and none in a women's guide's top 12.
for (const slug of Object.keys(pageList)) {
  if (slug.startsWith("store-")) continue;
  const vb = pageList[slug].filter((p) => VERA_BRADLEY.test(String(p.brand ?? "").trim()));
  if (!vb.length) continue;
  const rest = pageList[slug].filter((p) => !VERA_BRADLEY.test(String(p.brand ?? "").trim()));
  const at = WOMEN_GUIDES.includes(slug) ? 12 : Math.min(pageList[slug].indexOf(vb[0]), rest.length);
  pageList[slug] = rest.length >= at ? [...rest.slice(0, at), vb[0], ...rest.slice(at)] : rest;
}
// Variety (owner 11-19): popular brands may repeat in a guide, but at most BRAND_TOP_MAX of one brand in its top 12;
// the rest move just below it.
export const BRAND_TOP_MAX = 4;
for (const slug of Object.keys(pageList)) {
  if (slug.startsWith("store-")) continue;
  const list = pageList[slug];
  const n = new Map();
  const top = [];
  const later = [];
  for (const p of list.slice(0, 12)) {
    const b = compact(p.brand ?? "");
    n.set(b, (n.get(b) ?? 0) + 1);
    (b && n.get(b) > BRAND_TOP_MAX ? later : top).push(p);
  }
  const rest = list.slice(12);
  while (top.length < 12 && rest.length) {
    const i = rest.findIndex((p) => !compact(p.brand ?? "") || (n.get(compact(p.brand ?? "")) ?? 0) < BRAND_TOP_MAX);
    if (i < 0) break;
    const [p] = rest.splice(i, 1);
    n.set(compact(p.brand ?? ""), (n.get(compact(p.brand ?? "")) ?? 0) + 1);
    top.push(p);
  }
  pageList[slug] = [...top, ...later, ...rest];
}
/**
 * OWNER FOLLOW-UP 11-19, the last word on every page (FOLLOWUP-OWNER-1119.md):
 *   - the follow-up rules (followUpOff) on every guide; the named removals and old electronics on store pages too;
 *   - store audit C (_prelaunch-audit-1119c.json): a page graded DROP lists nothing (so it shows nowhere); the duplicate
 *     slugs fold into one page (STORE_MERGES); Amazon and Walmart keep their first STORE_CAP picks; REI lists no hiking gear;
 *   - _owner-excludes.json names leave every page; _owner-picks.json leads each guide it names, exempt from every rule.
 */
export const STORE_MERGES = { "store-anker-us": "store-anker", "store-barefootdreams": "store-barefoot-dreams", "store-erincondren": "store-erin-condren",
  "store-elysebreannedesign": "store-elyse-breanne-design", "store-flauntcases": "store-flaunt", "store-glowrecipe": "store-glow-recipe", "store-rhodeskin": "store-rhode-skin",
  "store-rebeccaillustrated": "store-rebecca-illustrated", "store-mykitsch": "store-kitsch", "store-shopfavoritedaughter": "store-favorite-daughter",
  "store-katespadeoutlet": "store-kate-spade-new-york", "store-american-eagle": "store-ae",
  // 1530 train (lead 11-19: "merge duplicate store slugs into one canonical page"), found by comparing every store slug
  // with its punctuation, "saint"/"st" and "and" removed; each old slug redirects (MERGED_GUIDES in giftGuideCatalog.ts).
  "store-casemate": "store-case-mate", "store-parachutehome": "store-parachute-home", "store-melissaanddoug": "store-melissa-and-doug",
  "store-peakdesign": "store-peak-design", "store-kate-spade-outlet": "store-kate-spade-new-york", "store-warbyparker": "store-warby-parker",
  "store-southerntide": "store-southern-tide", "store-saint-bernard": "store-st-bernard", "store-stbernard": "store-st-bernard",
  "store-papersourcecom": "store-paper-source", "store-lillypulitzer": "store-lilly-pulitzer", "store-llbean": "store-ll-bean",
  "store-riflepaperco": "store-rifle-paper-co", "store-soldejaneiro": "store-sol-de-janeiro", "store-rmsbeauty": "store-rms-beauty",
  "store-kitchenaid": "store-kitchen-aid", "store-oliveandjune": "store-olive-and-june", "store-spartina449": "store-spartina-449" };
export const STORE_CAP = 15;
/** Store audit C's page changes (drop, merge, cap, REI): on (lead 11-19, 1530 train: Amazon and Walmart to the 15 best, merged slugs); GIFT_STORE_AUDIT_C=off turns them off. */
export const STORE_AUDIT_C_ON = process.env.GIFT_STORE_AUDIT_C !== "off";
export const TASTE_CUTS_FILE = "_taste-cuts-1119c.json";
export const readyCounts = { out: {}, communityCoffee: 0, capped: 0, kidsAsks: 0, ownerNoPhoto: 0, storeAdds: 0, kidsAsksHeld: 0, replaced: 0, replaceSkipped: 0, fitAudit: 0, fitMoved: 0, fitMoveSkipped: 0, storeDupes: 0 };
/** Pool rows skipped for good (lead 11-19, 1530 train): the Kendra Scott Elisa and the Benefit brow pencil. */
/** One link or one photo on at most this many guides (owner 11-19: a second guide gets another colorway); see DUP_GUIDE_MAX. */
export const SAME_ITEM_MAX = 1;
/** Rows the owner keeps on a guide whatever an audit says (owner 11-19: the Dyson Airwrap on Mom, over the $500 cap). */
// The Sam's Club Plus membership is the owner's own 11-19 add (_sams-membership-1119.json), so the fit audit's cut is not applied.
export const OWNER_KEEP = [{ guide: "mom", href: "https://go.shopmy.us/p-104050308" }, { guide: "subscriptions", href: "https://samsclub.co/4j22GdY" }];
export const POOL_SKIP = new Set(["https://go.shopmy.us/p-107927002", "https://go.shopmy.us/p-107932478"]);
/** The sort pass's counts (1119e) and what it placed, for the commission inventory. */
export const sortCounts = { crowd: 0, swapped: 0, held: 0, ownerHeld: [], brandHeld: 0, brandNoGuide: 0, ccCampaigns: 0, ccOf: 0, judged: 0, overCap: 0 };
export const SORT_POOL = [];
/**
 * Follow-up 1120: each cut owner pick's cut, by link: "firm" (her own rules), "fit" (a clear wrong fit) or "ours" (any
 * other cut: lifted). Read from every cut file's reason text (the audits, the fit audits, the judgment passes).
 */
export const OWNER_CUT_KIND_1120 = (() => {
  const FIRM = /0 ?%|commission 0|no commission|earns nothing|gift ?card|kendra|labubu|smiski|sonny angel|lovesac|fishwife|exclud|blocked|same item|also on|duplicate|already (on|in|placed)|repeat|twice|\blsu\b|\blash|non-?us|\buk\b|united kingdom|404|broken|no (image|photo)|wrong (photo|image|picture)|photo (is|shows)|sold out|dead link|not found/i;
  const FIT = /not (a|an|for) |doesn'?t fit|does not fit|wrong (guide|section)|kids?'? toy|\blego\b|fishing gear|baby item|pet item|for (men|women|kids)\b|not giftable|not a gift/i;
  const reasons = new Map();
  const add = (href, why) => { if (typeof href === "string" && why) reasons.set(href, [...(reasons.get(href) ?? []), String(why)]); };
  for (const f of readdirSync(dir).filter((x) => /^_judgment-cuts-.*\.json$/.test(x))) { try { for (const r of rowsOf(readJson(f))) if (r && !r.log_only) add(r.href, r.why ?? r.reason ?? "judgment cut"); } catch { /* mid-write: read next run */ } }
  for (const f of ["_fit-audit-big-am.json", "_fit-audit-big-nz.json"]) { try { for (const r of rowsOf(readJson(f))) if (r && r.action === "cut") add(r.href, r.reason ?? "fit audit cut"); } catch { /* mid-write: read next run */ } }
  for (const r of readAudits1120(readJson)) if (["cut", "remove", "replace_link", "replace_image"].includes(r.fix)) add(r.href, r.problem);
  const kind = new Map();
  for (const [href, list] of reasons) {
    const firm = list.find((w) => FIRM.test(w));
    const fit = list.find((w) => FIT.test(w));
    kind.set(href, firm ? { kind: "firm", why: firm } : fit ? { kind: "fit", why: fit } : { kind: "ours", why: list[0] });
  }
  return kind;
})();
/** Follow-up 1120: why each owner pick sits on none of her guides (href -> { name, reasons: [{ guide, kind, detail, holders }] }). */
export const OWNER_DIAG_1120 = new Map();
export const SORT_RANKS = [];
export const SORT_CTX = {};
/** The owner's keeps through the sort and the cap (11-19): the Dyson Airwrap on Mom, the lululemon boxers on Husband. */
/** At most this many picks of one brand on a guide in the sort pass (owner 11-19: "a range of great different gift ideas"). */
export const SORT_BRAND_MAX = 2;
/** Lists with their own order (memberships first, wrap and cards only, Mail Carrier's checked $20 picks): annotated and capped, never re-sorted or added to. */
export const SORT_FIXED = new Set(["subscriptions", "gift-cards", "gift-wrap-and-cards", "mail-carrier-and-delivery-drivers"]);
export const SORT_KEEP = [{ guide: "mom", href: "https://go.shopmy.us/p-104050308" }, { guide: "boyfriend-or-husband", href: "https://go.shopmy.us/p-107825142" },
  // Follow-up 1120 (owner 11-20 ~12:50 AM, "It's ok there's 6 over 500"): the Ooni Koda 16 stays on Home Cook.
  { guide: "home-cook", href: "https://go.shopmy.us/p-107927750" }];
export const followUpCounts = { rules: 0, dropped: [], merged: 0, capped: 0, rei: 0, excluded: 0, ownerPicks: 0 };
{
  for (const slug of Object.keys(pageList)) {
    if (slug === SPONSORS_GUIDE) continue;
    const before = pageList[slug].length;
    pageList[slug] = slug.startsWith("store-") ? pageList[slug].filter((p) => !OWNER_REMOVED(p) && !OLD_ELECTRONICS.test(String(p.name ?? ""))) : pageList[slug].filter((p) => !followUpOff(slug, p));
    followUpCounts.rules += before - pageList[slug].length;
  }
  for (const [from, to] of Object.entries(STORE_AUDIT_C_ON ? STORE_MERGES : {})) {
    // The canonical page answers for the old page's link hosts too (its picks now name it).
    if (storeList[from]) {
      storeList[to] ??= { name: stores.get(to)?.name ?? storeList[from].name, hosts: [] };
      storeList[to].hosts = [...new Set([...storeList[to].hosts, ...storeList[from].hosts])];
    }
    if (!pageList[from]?.length) continue;
    const list = (pageList[to] ??= []);
    for (const p of pageList[from]) if (!list.some((x) => x.href === p.href || compact(x.name) === compact(p.name))) { list.push({ ...p, store: to }); followUpCounts.merged += 1; }
    pageList[from] = [];
  }
  // A guide pick names its merged store's canonical page.
  if (STORE_AUDIT_C_ON) for (const slug of Object.keys(pageList)) pageList[slug] = pageList[slug].map((p) => (p.store && STORE_MERGES[p.store] ? { ...p, store: STORE_MERGES[p.store] } : p));
  // Audit C's DROP grades (229 thin pages, counted 2026-11-19) are not applied: a store page under STORE_ROW_MIN_PICKS is already unlinked
  // (lead 11-19, 1530 train: "the route stays up"), and emptying it would lose the picks; GIFT_STORE_AUDIT_C_DROP=on applies them.
  const audit = STORE_AUDIT_C_ON && process.env.GIFT_STORE_AUDIT_C_DROP === "on" ? readJson("_prelaunch-audit-1119c.json") ?? {} : {};
  for (const [slug, e] of Object.entries(audit)) if (slug.startsWith("store-") && /^drop$/i.test(String(e?.grade ?? "")) && pageList[slug]?.length) { pageList[slug] = []; followUpCounts.dropped.push(slug); }
  // Amazon and Walmart are capped after the audit cuts (the ready pass below), so the cuts never leave them under 15.
  if (STORE_AUDIT_C_ON && pageList["store-rei"]) { const n = pageList["store-rei"].length; pageList["store-rei"] = pageList["store-rei"].filter((p) => !HIKING.test(`${p.name} ${p.brand ?? ""}`) && !/\b(backpacks?|tents?|sleeping bags?|trekking|hydration pack)\b/i.test(p.name)); followUpCounts.rei = n - pageList["store-rei"].length; }
  // The two new guides hold only their own file's rows (later back-fills had added gift cards and a baby carrier).
  for (const [slug, own] of Object.entries(OWN_FILE_HREFS)) if (pageList[slug]) pageList[slug] = pageList[slug].filter((p) => own.has(p.href));
  const excludes = (readJson("_owner-excludes.json") ?? []).map((x) => String(x?.match ?? "").toLowerCase()).filter(Boolean);
  const excluded = (p) => excludes.some((m) => `${p.name} ${p.brand ?? ""}`.toLowerCase().includes(m));
  for (const slug of Object.keys(pageList)) { const n = pageList[slug].length; pageList[slug] = pageList[slug].filter((p) => !excluded(p)); followUpCounts.excluded += n - pageList[slug].length; }
  // Owner picks: first on each guide they name, in the file's order; a non-US store's price (GBP, AUD) is not shown.
  // 1119c: an owner pick with no photo, or a photo on ShopMy's dead S3 host (403 to every request), waits for a photo
  // (owner: "Items with no real photo don't go on people guides"); it is counted, never shown as a blank box.
  const livePhoto = (img) => typeof img === "string" && img.startsWith("https://") && !/^https:\/\/production-shopmyshelf-[a-z]+\.s3[.-]/.test(img);
  const ownerAll = (readJson("_owner-picks.json") ?? []).filter((r) => r && typeof r.name === "string" && /^https:\/\//.test(String(r.href ?? "")) && !excluded(r));
  const ownerRows = ownerAll.filter((r) => livePhoto(r.image));
  readyCounts.ownerNoPhoto = ownerAll.length - ownerRows.length;
  const byGuide = new Map();
  for (const r of ownerRows) {
    const usd = !nonUsUrl(String(r.destination ?? "")) && !/\.(co\.uk|com\.au|ca)\//i.test(String(r.destination ?? ""));
    const pick = { name: tidyName(String(r.name)), brand: String(r.brand ?? ""), line: String(r.why ?? r.line ?? ""), href: r.href, ownerPick: true,
      ...(typeof r.image === "string" && r.image.startsWith("https://") ? { image: r.image } : {}),
      ...(usd && typeof r.price === "number" ? { price: r.price, priceAt: String(r.added_at ?? "2026-11-19") } : {}) };
    // Its store page: the brand's own (a ShopMy link names no store); registered so the page can name it.
    const store = storeFor(String(r.brand ?? "").trim());
    if (store) {
      pick.store = store;
      storeList[store] ??= { name: stores.get(store)?.name ?? String(r.brand), hosts: [] };
      if (!storeList[store].hosts.includes(new URL(r.href).hostname)) storeList[store].hosts = [...storeList[store].hosts, new URL(r.href).hostname];
    }
    // Owner picks still go where they fit (lead 11-19): no pastel colorway on a men's guide.
    for (const g of Array.isArray(r.guides) ? r.guides : []) if (GUIDE_SLUGS.has(g) && !NOT_A_LIST.has(g) && !(MEN_COLOR_GUIDES.includes(g) && MEN_PASTEL.test(`${pick.name} ${String(pick.image ?? "").replace(/[-_]/g, " ")}`))) byGuide.set(g, [...(byGuide.get(g) ?? []), pick]);
  }
  for (const [g, picks] of byGuide) {
    const own = new Set(picks.flatMap((p) => [p.href, compact(p.name), `k:${dedupeKey(p.name)}`]));
    // 1530 train: an owner pick is exempt from the rules, so the guide's other rows make room for it: no near-twin of an
    // owner pick (variantKey: the Steady State hoodie and jogger), and on a filler guide no tumbler past TUMBLER_MAX
    // counting the owner's own (Pink Lover: two owner tumblers + two more).
    const twins = new Set(picks.map(variantKey));
    let cups = fillerGuide(g, GUIDE_GROUPS.get(g) ?? "") ? picks.filter((p) => INSULATED.test(p.name) && !FILLER_OK[g]?.test(p.name)).length : -Infinity;
    const rest = (pageList[g] ?? []).filter((p) => !own.has(p.href) && !own.has(compact(p.name)) && !own.has(`k:${dedupeKey(p.name)}`) && !twins.has(variantKey(p)))
      .filter((p) => !(INSULATED.test(p.name) && !FILLER_OK[g]?.test(p.name) && cups !== -Infinity && (cups += 1) > TUMBLER_MAX));
    // At most BRAND_TOP_MAX of one brand among a guide's leading owner picks (lead 11-19: ~4 YETI in any top 12); the
    // rest follow its top 12.
    const n = new Map();
    const lead = [];
    const later = [];
    for (const p of picks) { const b = compact(p.brand ?? ""); n.set(b, (n.get(b) ?? 0) + 1); (b && n.get(b) > BRAND_TOP_MAX ? later : lead).push(p); }
    pageList[g] = [...lead, ...rest.slice(0, Math.max(0, 12 - lead.length)), ...later, ...rest.slice(Math.max(0, 12 - lead.length))];
    followUpCounts.ownerPicks += picks.length;
  }
  /**
   * KIDS' ASKS (owner 11-19, "make sure they are on our guides"; every _fb-kids-asks-*.json: [{ name, brand, href,
   * image, price, guides }]): what Louisiana parents asked for in a Facebook thread lead the kids' age guides, Girls /
   * Boys and Stocking Stuffers they name, right after the owner's picks, marked trending. The ready pass below still
   * applies (price cap, blocked brands, the 2-guide cap).
   */
  for (const f of readdirSync(dir).filter((x) => /^_fb-kids-asks-.*\.json$/.test(x)).sort()) {
    const byKidGuide = new Map();
    for (const r of rowsOf(readJson(f))) {
      if (!r || typeof r.name !== "string" || typeof r.href !== "string" || !/^https:\/\//.test(r.href) || !livePhoto(r.image) || excluded(r)) continue;
      // An affiliate or approved link only (a plain walmart.com link earns nothing and is no allowed host).
      if (!AFFILIATE.has(new URL(r.href).hostname) && !PLAIN_OK.has(new URL(r.href).hostname)) { readyCounts.kidsAsksHeld += 1; continue; }
      const pick = { name: tidyName(r.name), brand: String(r.brand ?? ""), line: String(r.why ?? r.line ?? ""), href: r.href, image: r.image, trending: true,
        // Amazon shows no price (Associates; no PA-API yet).
        ...(typeof r.price === "number" && !AMAZON.has(new URL(r.href).hostname) ? { price: r.price, priceAt: String(r.added_at ?? "2026-11-19") } : {}) };
      // An Amazon link lists on the Amazon page; any other on its brand's store page.
      const store = AMAZON.has(new URL(r.href).hostname) ? "store-amazon" : storeFor(String(r.brand ?? "").trim());
      if (store === "store-amazon") pick.store = store;
      else if (store) {
        pick.store = store;
        storeList[store] ??= { name: stores.get(store)?.name ?? String(r.brand), hosts: [] };
        if (!storeList[store].hosts.includes(new URL(r.href).hostname)) storeList[store].hosts = [...storeList[store].hosts, new URL(r.href).hostname];
      }
      // One guide each, the first the row names (owner: the same photo never shows on two guides).
      for (const g of (Array.isArray(r.guides) ? r.guides : []).filter((x) => GUIDE_SLUGS.has(x) && !NOT_A_LIST.has(x) && !x.startsWith("store-")).slice(0, 1)) byKidGuide.set(g, [...(byKidGuide.get(g) ?? []), pick]);
    }
    for (const [g, picks] of byKidGuide) {
      const list = pageList[g] ?? [];
      const own = new Set(picks.flatMap((p) => [p.href, compact(p.name)]));
      const rest = list.filter((p) => !own.has(p.href) && !own.has(compact(p.name)));
      const lead = rest.filter((p) => p.ownerPick);
      pageList[g] = [...lead, ...picks, ...rest.filter((p) => !p.ownerPick)];
      readyCounts.kidsAsks += picks.length;
    }
    // The ask's guide is its one guide: the same product (link, name or photo) leaves every other non-store guide.
    const asked = new Map();
    for (const [g, picks] of byKidGuide) for (const p of picks) for (const k of [p.href, compact(p.name), p.image]) asked.set(k, g);
    for (const slug of Object.keys(pageList)) {
      if (slug.startsWith("store-") || slug === SPONSORS_GUIDE) continue;
      pageList[slug] = pageList[slug].filter((p) => p.ownerPick || [p.href, compact(p.name), p.image].every((k) => !k || !asked.has(k) || asked.get(k) === slug));
    }
  }
  /**
   * READY PASS 1119c (owner 11-19: the guides are "not ready for people to see"), the very last word on every page:
   *   - the dedupe file's flags: rows over $500, on a non-US store, on JD Sports, or with another product's photo (the
   *     lululemon Swiftly short-sleeve wore the long-sleeve's photo) leave every page;
   *   - no pick over PRICE_MAX, no non-gift service (nonGiftService), no JD Sports listing on a guide;
   *   - Community Coffee leaves Louisiana Made for Coffee & Beignets (food lives in the food guides);
   *   - the hand taste pass (_taste-cuts-1119c.json, { "<slug>" | "*": [{ name, reason }] }) cuts its rows;
   *   - a product (its link, or its brand + name without size and colour) shows in at most DUP_GUIDE_MAX guides: the
   *     guides an owner pick names first, then where it ranks highest.
   * Owner picks are exempt from the taste cuts only.
   */
  const flagged = (type) => DEDUPE_FLAGS.filter((x) => x.flag === type).map((x) => x.href);
  const held = new Set([...flagged("over_500"), ...flagged("non_us_store"), ...flagged("jd_sports"), ...flagged("same_image_as_different_product")]);
  const jdSports = (p) => /\bjd ?sports\b|jdsports\./i.test(`${p.retailer ?? ""} ${p.store ?? ""} ${p.href} ${p.affiliate_href ?? ""} ${p.image ?? ""}`);
  const cuts = new Map();
  // Every taste pass (_taste-cuts-1119c.json, then -1119d, ...) adds its cuts; a later file never un-cuts.
  // A list file (_taste-cuts-1119d.json: [{ guide, name, href, reason, replace_with? }]) cuts each row on EVERY guide
  // (lead 11-19: "cut those rows everywhere", so a moved repeat does not come back), and its replace_with pick takes the
  // cut row's slot on that guide.
  const tasteFiles = [...new Set([TASTE_CUTS_FILE, ...readdirSync(dir).filter((x) => /^_taste-cuts-.*\.json$/.test(x)).sort()])];
  const addCut = (k, r) => {
    const set = cuts.get(k) ?? new Set();
    const n = compact(String(r?.name ?? r?.href ?? r ?? ""));
    if (n) set.add(n);
    if (typeof r?.href === "string") set.add(compact(r.href));
    cuts.set(k, set);
  };
  const replacements = [];
  const REPLACED = new Set();
  for (const f of tasteFiles) {
    const v = readJson(f);
    if (Array.isArray(v)) {
      for (const r of v) {
        // Owner 11-19: "kitchen appliances don't need to be blocked from guides": a cut whose reason is a kitchen appliance
        // is not applied, nor a "crock-pot pattern" one (an upgraded multi-cooker is welcome); her basic slow cooker and
        // ice cream bans stay in giftGuideRules (crockPotOff, iceCreamOff).
        if (!r || typeof r !== "object" || /kitchen appliance|crock-?pot pattern/i.test(String(r.reason ?? ""))) continue;
        addCut("*", r);
        if (r.replace_with && typeof r.replace_with.href === "string" && typeof r.guide === "string") replacements.push({ guide: r.guide, cut: r, to: r.replace_with });
      }
      continue;
    }
    for (const [k, l] of Object.entries(v ?? {})) if (Array.isArray(l)) for (const r of l) addCut(k, r);
  }
  for (const href of POOL_SKIP) addCut("*", { href });
  // FIT AUDIT (owner 11-19: "really audit every item to see if they fit"; _fit-audit-1119-*.json, written as the audit
  // goes: [{ guide, section, name, href, verdict: "cut" | "move", move_to, reason }]): a cut leaves that guide; a move
  // leaves it and joins move_to. Never an owner pick (cut() skips them).
  const moves = [];
  for (const f of readdirSync(dir).filter((x) => /^_fit-audit-1119-.*\.json$/.test(x)).sort()) {
    let v;
    try { v = readJson(f); } catch { continue; /* mid-write: read on the next run */ }
    for (const r of rowsOf(v)) {
      if (!r || typeof r.guide !== "string" || !/^(cut|move)$/i.test(String(r.verdict ?? ""))) continue;
      // Owner 11-19: "you can leave the Dyson for Mom" (the Airwrap Co-Anda 2x, an owner exception to the $500 cap).
      if (OWNER_KEEP.some((k) => k.guide === r.guide && k.href === r.href)) continue;
      addCut(STORE_MERGES[r.guide] ?? r.guide, r);
      readyCounts.fitAudit += 1;
      if (/^move$/i.test(r.verdict) && typeof r.move_to === "string" && r.move_to !== r.guide) moves.push(r);
    }
  }
  // A cut matches the exact name, the link, or (20+ letters) the start of a longer name the feed spells out further.
  const cut = (slug, p) => !p.ownerPick && [cuts.get(slug), cuts.get("*")].some((c) => c && (c.has(compact(p.name)) || c.has(compact(p.href))
    || [...c].some((k) => k.length >= 20 && compact(p.name).startsWith(k))));
  const why = (slug, p) => (OWNER_KEEP.some((k) => k.guide === slug && k.href === p.href) ? "" : held.has(p.href) ? "flag" : typeof p.price === "number" && p.price > PRICE_MAX ? "over 500" : nonGiftService(slug, p) ? "non-gift" : blockedBrand(p) ? "blocked brand"
    : !slug.startsWith("store-") && jdSports(p) ? "jd sports" : !slug.startsWith("store-") && cut(slug, p) ? "taste" : !p.ownerPick && kidsToyOff(slug, p) ? "kids toy"
    // A store page takes only the cuts named for it (the fit audit's store rows), never the every-guide taste cuts.
    // By link only: an audit row that calls a page's second copy a duplicate must not take the first copy with it.
    : slug.startsWith("store-") && !p.ownerPick && Boolean(cuts.get(slug)?.has(compact(p.href))) ? "store cut" : "");
  const cutAt = new Map();
  const cutRows = new Map();
  for (const slug of Object.keys(pageList)) {
    if (slug === SPONSORS_GUIDE) continue;
    pageList[slug].forEach((p, i) => { if (!p.ownerPick && cut(slug, p)) for (const k of [compact(p.name), compact(p.href)]) if (!cutAt.has(`${slug}|${k}`)) { cutAt.set(`${slug}|${k}`, i); cutRows.set(`${slug}|${k}`, p); } });
    pageList[slug] = pageList[slug].filter((p) => {
      const w = why(slug, p);
      if (w) readyCounts.out[w] = (readyCounts.out[w] ?? 0) + 1;
      return !w;
    });
  }
  // A fit-audit move: the cut row joins its new guide (last), unless that guide already lists it or cuts it itself.
  for (const m of moves) {
    const p = cutRows.get(`${m.guide}|${compact(String(m.href ?? ""))}`) ?? cutRows.get(`${m.guide}|${compact(String(m.name ?? ""))}`);
    const to = pageList[m.move_to];
    if (!p || !to || m.move_to.startsWith("store-") || to.some((x) => x.href === p.href || compact(x.name) === compact(p.name)) || cut(m.move_to, p)
      // A move still follows the new guide's own fit rules (r4: Count Scratchula is not a Cat Person pick).
      || fitR4Why(m.move_to, GUIDE_GROUPS.get(m.move_to) ?? "", p) || R4_OFF[m.move_to]?.test(`${p.name} ${p.brand ?? ""}`)) { readyCounts.fitMoveSkipped += 1; continue; }
    to.push(p);
    readyCounts.fitMoved += 1;
  }
  // replace_with: the pool row with that link (any picks-folder file, photo required, read through the ShopMy CDN swap)
  // takes the cut row's slot, or goes last when the cut row was not on that guide. No unchecked price is shown.
  {
    const pool = new Map();
    const brandOfHref = new Map();
    // A drawable photo the page may show: https, not the dead S3 host, no AVIF / HEIF / TIFF, and an Amazon photo only on
    // an Amazon link.
    const poolImgOk = (r) => /^https:\/\//.test(r.image) && !brokenImage(r.image) && !SHOPMY_S3.test(r.image) && !/\.(avif|heic|heif)(\?|#|$)/i.test(r.image) && !isTiff(r.image)
      && (!AMAZON_IMAGE_HOST.test(new URL(r.image).hostname) || isAmazonUrl(r.href));
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      let v;
      try { v = readJson(f); } catch { continue; /* a file another agent is mid-writing: read on the next run */ }
      for (const r of rowsOf(v)) if (r && typeof r.href === "string" && typeof r.name === "string" && typeof r.image === "string" && poolImgOk(r) && !pool.has(r.href)) pool.set(r.href, r);
      // A brand-links file ({ "<brand>": [rows] }) names the brand by its key.
      if (v && typeof v === "object" && !Array.isArray(v)) for (const [b, l] of Object.entries(v)) if (Array.isArray(l)) for (const r of l) if (r && typeof r.href === "string" && typeof r.name === "string" && typeof r.image === "string" && poolImgOk(r) && !pool.has(r.href)) pool.set(r.href, { ...r, brand: r.brand || b });
      if (v && typeof v === "object" && !Array.isArray(v)) for (const [b, l] of Object.entries(v)) if (Array.isArray(l)) for (const r of l) if (r && typeof r.href === "string" && !brandOfHref.has(r.href)) brandOfHref.set(r.href, String(r.brand || b));
    }
    for (const { guide, cut: c, to } of replacements) {
      const list = pageList[guide];
      const r = pool.get(to.href);
      if (!list || !r || POOL_SKIP.has(to.href)) { readyCounts.replaceSkipped += 1; continue; }
      // The guide holds it already: it is still the pick for this guide (kept here by the one-guide cap).
      if (list.some((p) => p.href === to.href || compact(p.name) === compact(r.name))) { REPLACED.add(`${guide}|${to.href}`); readyCounts.replaced += 1; continue; }
      const rawBrand = String(r.brand || brandOfHref.get(r.href) || brandFromName(String(r.name)) || "").trim();
      // The brand's own casing (LANEIGE, REI, UGG), as every other row gets it.
      const brand = BRAND_CASE[compact(rawBrand)] ?? BRAND_NAME[compact(rawBrand)] ?? rawBrand;
      // Its store page: the brand's own, registered as the owner picks' are (a ShopMy link names no store itself).
      const store = brand && storeFor(brand);
      if (!store) { readyCounts.replaceSkipped += 1; continue; }
      const pick = { name: tidyName(String(r.name)), brand, line: "", href: r.href, image: r.image, store };
      // A replacement still follows the page rules: no blocked brand, a Louisiana item only in the Louisiana section.
      if (blockedBrand(pick) || nonGiftService(guide, pick) || (!LOUISIANA_GUIDES.has(guide) && isLouisianaItem(pick, LA_HOSTS))) { readyCounts.replaceSkipped += 1; continue; }
      storeList[store] ??= { name: stores.get(store)?.name ?? brand, hosts: [] };
      const host = new URL(r.href).hostname;
      if (!storeList[store].hosts.includes(host)) storeList[store].hosts = [...storeList[store].hosts, host];
      const at = cutAt.get(`${guide}|${compact(c.name ?? "")}`) ?? cutAt.get(`${guide}|${compact(c.href ?? "")}`);
      list.splice(Math.min(at ?? list.length, list.length), 0, pick);
      REPLACED.add(`${guide}|${to.href}`);
      readyCounts.replaced += 1;
    }
  }
  // A store page lists each product once (lead 11-19): the first row of a link or a name stays (colorways are kept;
  // the fit audit cut the hand-judged duplicates).
  for (const slug of Object.keys(pageList)) {
    if (!slug.startsWith("store-")) continue;
    const seenHere = new Set();
    const n = pageList[slug].length;
    pageList[slug] = pageList[slug].filter((p) => {
      const ks = [`h:${p.href}`, `n:${compact(p.name)}`];
      if (ks.some((k) => seenHere.has(k))) return false;
      for (const k of ks) seenHere.add(k);
      return true;
    });
    readyCounts.storeDupes += n - pageList[slug].length;
  }
  // Amazon and Walmart: the first STORE_CAP after every cut (owner's 10-15 rule; their order is the featured order).
  for (const slug of STORE_AUDIT_C_ON ? ["store-amazon", "store-walmart"] : []) if ((pageList[slug]?.length ?? 0) > STORE_CAP) { followUpCounts.capped += pageList[slug].length - STORE_CAP; pageList[slug] = pageList[slug].slice(0, STORE_CAP); }
  const coffee = (pageList["louisiana-made"] ?? []).filter((p) => /community coffee/i.test(`${p.name} ${p.brand ?? ""}`));
  if (coffee.length) {
    pageList["louisiana-made"] = pageList["louisiana-made"].filter((p) => !coffee.includes(p));
    const to = (pageList["coffee-and-beignets"] ??= []);
    for (const p of coffee) if (!to.some((x) => x.href === p.href || compact(x.name) === compact(p.name))) to.push(p);
    // An owner pick still leads (owner picks lead every guide they are on).
    pageList["coffee-and-beignets"] = [...to.filter((p) => p.ownerPick), ...to.filter((p) => !p.ownerPick)];
    readyCounts.communityCoffee = coffee.length;
  }
  // At most 3 picks of one brand on a guide outside the Louisiana section (the fit r3b rule), the last non-owner ones go.
  for (const slug of Object.keys(pageList)) {
    if (slug.startsWith("store-") || slug === SPONSORS_GUIDE || LOUISIANA_GUIDES.has(slug) || ["gift-cards", "subscriptions"].includes(slug)) continue;
    const per = new Map();
    for (const p of pageList[slug]) { const b = brandKey(p.brand ?? ""); if (b && !/affiliate|program|walmart|amazon|target|shopmy/i.test(p.brand ?? "")) per.set(b, (per.get(b) ?? 0) + 1); }
    for (const [b, n] of per) {
      let extra = n - 3;
      if (extra <= 0) continue;
      for (let i = pageList[slug].length - 1; i >= 0 && extra > 0; i--) {
        const p = pageList[slug][i];
        if (!p.ownerPick && brandKey(p.brand ?? "") === b) { pageList[slug].splice(i, 1); extra -= 1; readyCounts.out["brand cap"] = (readyCounts.out["brand cap"] ?? 0) + 1; }
      }
    }
  }
  const ownerGuides = new Map();
  for (const r of readJson("_owner-picks.json") ?? []) if (r && typeof r.href === "string" && Array.isArray(r.guides)) ownerGuides.set(r.href, r.guides);
  // Owner 2026-11-19 ("the 2 items per product should be different colors"): one link or one photo shows on ONE guide; the
  // product (brand + name key) on at most DUP_GUIDE_MAX, so a second guide gets only another colorway (its own link and
  // photo). An owner pick keeps every guide she named for it.
  const productKeys = (p) => [`h:${p.href}`, ...(p.image ? [`i:${p.image}`] : []), `k:${compact(p.brand ?? "")}|${dedupeKey(p.name)}`];
  const keyCap = (k) => (k.startsWith("k:") ? DUP_GUIDE_MAX : SAME_ITEM_MAX);
  const seen = new Map();
  for (const slug of Object.keys(pageList)) {
    if (slug.startsWith("store-") || slug === SPONSORS_GUIDE) continue;
    pageList[slug].forEach((p, i) => {
      const named = Boolean(p.ownerPick && ownerGuides.get(p.href)?.includes(slug));
      // A taste replacement keeps the guide the taste pass chose for it (after the owner's named guides).
      const rank = (named ? -1000 : REPLACED.has(`${slug}|${p.href}`) ? -500 : 0) + i;
      for (const k of productKeys(p)) seen.set(k, [...(seen.get(k) ?? []), { slug, rank, named }]);
    });
  }
  const keep = new Map();
  for (const [k, where] of seen) {
    const sorted = where.sort((a, b) => a.rank - b.rank);
    const slugsHere = [...new Set(sorted.map((x) => x.slug))];
    const cap = Math.max(keyCap(k), new Set(sorted.filter((x) => x.named).map((x) => x.slug)).size);
    if (slugsHere.length > cap) keep.set(k, new Set(slugsHere.slice(0, cap)));
  }
  for (const slug of Object.keys(pageList)) {
    if (slug.startsWith("store-") || slug === SPONSORS_GUIDE) continue;
    const n = pageList[slug].length;
    pageList[slug] = pageList[slug].filter((p) => productKeys(p).every((k) => !keep.has(k) || keep.get(k).has(slug)));
    readyCounts.capped += n - pageList[slug].length;
  }
  /**
   * SORT PASS 1119e (owner 2026-11-19 evening), the last word on every non-store guide:
   *   - every pick carries its effective `commission` (null = unknown) and its gift `type` (hidden from shoppers;
   *     scripts/giftGuideSort.mjs);
   *   - a pick whose exact product is in a live Creator Connections campaign moves to the campaign ASIN when the campaign
   *     total beats its rate by CC_SWAP_MARGIN (the old link kept in `swappedFrom`, `campaignEnds` set; the next run after
   *     the end date reads the old link again, because the swap is made fresh on each run);
   *   - the import adds the brand-link rows no guide holds yet (their placement-file guides), the Creator Connections
   *     picks (_cc-placements-1119e.json) and the editor's adds (_editor-adds-1119e.json);
   *   - guides fill in popularity order (scripts/gift-guide-popularity.json), each taking its candidates by commission,
   *     high to low, up to GUIDE_CAP, at most TYPE_MAX of one gift type and 3 of one brand; a product shows on at most
   *     DUP_GUIDE_MAX guides, its 2nd guide only with its own link and photo; overflow goes to its next fitting guide with
   *     room, else is held;
   *   - the judgment cuts (_judgment-cuts-1119e.json: [{ guide | "*", item, href?, why }]) leave their guide.
   * Owner picks have no protection (owner 11-19: "My picks can be cut"), except her three keeps (SORT_KEEP).
   */
  {
    const today = process.env.GIFT_TODAY ?? new Date().toISOString().slice(0, 10);
    const campaigns = readJson("_amazon-cc-campaigns-1119.json") ?? [];
    const rowsWithRate = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      let v;
      try { v = readJson(f); } catch { continue; /* mid-write: read on the next run */ }
      for (const r of rowsOf(v)) {
        if (!r || !(typeof r.href === "string" || typeof r.affiliate_href === "string")) continue;
        if (r.commission_pct !== undefined) rowsWithRate.push(r);
        // The big batch import files of 2026-11-20 (_thin-fill, _southern-picks) write the link's rate as `commission` (a number, in %).
        else if (typeof r.commission === "number" && /^_(thin-fill|southern-picks)-/.test(f)) rowsWithRate.push({ ...r, commission_pct: r.commission });
      }
    }
    const rateData = buildRateData({
      shopmyTsv: existsSync(join(dir, "_shopmy-mylinks-1119.tsv")) ? readFileSync(join(dir, "_shopmy-mylinks-1119.tsv"), "utf8") : "",
      rowsWithRate, campaigns, bestRates: (() => { try { return JSON.parse(readFileSync(join(LIB, "best-rates-1118.json"), "utf8")); } catch { return {}; } })(),
    });
    const ccProducts = campaigns.flatMap((c) => (Array.isArray(c?.products) ? c.products : []));
    const rate = (p) => commissionOf(p, rateData, today).pct;
    // A merged guide made new in 1120 (Pet Lovers, Fitness Lovers ...) holds only its sections: it takes no picks itself.
    const isGuide = (slug) => !slug.startsWith("store-") && slug !== SPONSORS_GUIDE && !NOT_A_LIST.has(slug) && !NEW_MERGE_PARENTS.has(slug);
    const register = (store, href) => {
      storeList[store] ??= { name: stores.get(store)?.name ?? store, hosts: [] };
      const host = new URL(href).hostname;
      if (!storeList[store].hosts.includes(host)) storeList[store].hosts = [...storeList[store].hosts, host];
    };
    const excludeIds = (readJson("_owner-excludes.json") ?? []).map((x) => String(x?.id ?? "")).filter(Boolean);
    const excludedRow = (p) => excluded(p) || excludeIds.some((id) => String(p.href ?? "").endsWith(`/${id}`));
    // JUDGMENT CUTS (owner 11-19: "actually look at the items you're listing").
    const judged = new Map();
    for (const f of readdirSync(dir).filter((x) => /^_judgment-cuts-.*\.json$/.test(x)).sort()) {
      let v;
      try { v = readJson(f); } catch { continue; }
      for (const r of rowsOf(v)) {
        // A log-only row (the owner picks the sort left off) records a cut; it makes none.
        if (!r || typeof r !== "object" || r.log_only) continue;
        const g = String(r.guide ?? "*");
        const set = judged.get(g) ?? new Set();
        if (typeof r.href === "string") set.add(`h:${r.href}`);
        if (typeof (r.item ?? r.name) === "string") set.add(`n:${compact(r.item ?? r.name)}`);
        judged.set(g, set);
      }
    }
    // The owner's swaps (_owner-swaps-1119.md swap_out): each old item leaves its guide; its new item is forced in (1120).
    for (const r of swapCuts(dir)) judged.set(r.guide, new Set([...(judged.get(r.guide) ?? []), `n:${compact(r.item)}`]));
    // The fit audits of the merged guides (AUDIT_1120): each cut leaves its old guide; the sort fills the place.
    // The owner's own keeps (OWNER_KEEP, SORT_KEEP: the Dyson, the Sam's Club membership, the lululemon boxers) stay.
    const protectedHref = new Set([...OWNER_KEEP, ...SORT_KEEP].map((k) => `h:${k.href}`));
    for (const [slug, set] of AUDIT_1120.cuts) judged.set(slug, new Set([...(judged.get(slug) ?? []), ...[...set].filter((h) => !protectedHref.has(h))]));
    for (const r of CUTS_1120) judged.set(r.guide, new Set([...(judged.get(r.guide) ?? []), `n:${compact(r.item)}`, ...(r.href ? [`h:${r.href}`] : [])]));
    // FOLLOW-UP 1120: each 0% item of the swaps file and every gift card it lists leaves its whole merged guide
    // (_zero-commission-swaps-1120.json); its earning add is placed below, so the sort refills before anything drops.
    const ZERO_1120 = zeroSwaps1120(readJson);
    for (const c of ZERO_1120.cuts) {
      // The owner's keeps stay (the Sam's Club Plus membership, OWNER_KEEP: the file swapped it for a Prime gift).
      if (protectedHref.has(`h:${c.href}`)) continue;
      const from = AUDIT_1120.oldSlug(c.guide, c.section) ?? c.guide;
      const parent = MERGED_INTO[from]?.parent ?? from;
      for (const sl of [parent, ...(GUIDE_MERGES.find((m) => m.parent === parent)?.sections ?? [])]) judged.set(sl, new Set([...(judged.get(sl) ?? []), `h:${c.href}`]));
    }
    // FOLLOW-UP 1120: no gift card and no 0% link on any guide, except a 25 Days sponsor's and the owner's keeps.
    // The memberships list (Subscriptions: Prime, Audible, Kindle Unlimited, Walmart+, Sam's Club) pays a bounty, not a rate.
    const followUpGone = (p, slug) => slug !== "subscriptions" && Boolean(followUpOut(p, { sponsor: isSponsorPick, kept: (x) => [...OWNER_KEEP, ...SORT_KEEP].some((k) => k.href === x.href) }));
    const judgedOutAny = (slug, p) => [judged.get(slug), judged.get("*")].some((s) => s && (s.has(`h:${p.href}`) || s.has(`n:${compact(p.name)}`)));
    /**
     * FOLLOW-UP 1120 (lead 11-20: "her picks beat our rules except her own firm rules"): an owner pick an audit or a
     * judgment pass cut stays cut only when the cut was for one of her firm rules (an excluded brand, a gift card, a 0%
     * link, the same item and color elsewhere, LSU or lash, a broken or wrong photo, a non-US store) or a clear wrong fit
     * (OWNER_CUT_KIND_1120 says which); every other cut of hers is lifted.
     */
    const ownerCutLifted = (p) => Boolean(p.ownerPick) && OWNER_CUT_KIND_1120.get(p.href)?.kind === "ours";
    const judgedOut = (slug, p) => judgedOutAny(slug, p) && !ownerCutLifted(p);
    sortCounts.judged = 0;
    // The owner's three keeps (11-19): the Dyson Airwrap on Mom, the lululemon boxers on Husband, the CREAMi in the Top 10.
    // Big batch 1120: each owner swap's new item (_owner-swaps-1119.md) is a keep on its guide too (her decision, item by item).
    const swapKeep = new Set();
    // Follow-up 1120 (lead 11-20): every pick the owner added herself (_owner-picks.json, her ShopMy "Gift Guide Inbox")
    // is exempt from the sort's caps on the guides she named for it (a merged guide with no list: its first old guide).
    const ownGuide1120 = (g) => (GUIDE_SLUGS.has(g) && isGuide(g) ? g : [...BASE_MERGES, ...GUIDE_MERGES].find((m) => m.parent === g)?.sections.find((x) => GUIDE_SLUGS.has(x) && isGuide(x)) ?? null);
    const ownerOn = (slug, p) => Boolean(p.ownerPick && (ownerGuides.get(p.href) ?? []).some((g) => ownGuide1120(g) === slug));
    const keepOn = (slug, p) => SORT_KEEP.some((k) => k.guide === slug && k.href === p.href) || swapKeep.has(`${slug}|${p.href}`) || (p.swappedFrom !== undefined && swapKeep.has(`${slug}|${p.swappedFrom}`));
    // Gate for a pick on a guide it did not come from: every page rule, the judgment cuts, US prices only up to PRICE_MAX.
    const gate = (slug, p) => {
      const group = GUIDE_GROUPS.get(slug) ?? "";
      return !why(slug, p) && !excludedRow(p) && fitsGuide(slug, p) && !belongsWhy(slug, group, p, { tumblers: 0 }, true) && !fitR4Why(slug, group, p)
        && !louisianaBlocked(slug, p) && !(MEN_COLOR_GUIDES.includes(slug) && MEN_PASTEL.test(`${p.name} ${String(p.image ?? "").replace(/[-_]/g, " ")}`))
        && !(typeof p.price === "number" && p.price > PRICE_MAX) && !judgedOut(slug, p) && !holisticWhy(slug, p) && !SORT_FIXED.has(slug)
        // A title cut at its comma ("Salt, Fat" by "Salt") is no product name.
        && !(p.brand && new RegExp(`^${p.brand.replace(/[^\w]/g, "\\$&")}, \\w+$`).test(p.name));
    };
    const pool = new Map();
    const want = (p, slugs, source, extra = {}) => {
      const had = pool.get(p.href);
      if (had) { for (const s of slugs) had.guides.add(s); return had; }
      const e = { p, guides: new Set(slugs), source, on: new Set(), ...extra };
      pool.set(p.href, e);
      return e;
    };
    // 1. What the guides hold now: commission, type, and the Creator Connections swap.
    for (const slug of Object.keys(pageList)) {
      if (!isGuide(slug)) continue;
      pageList[slug].forEach((p0, i) => {
        let p = p0;
        const current = rate(p);
        if (!isAmazonUrl(p.href)) {
          const twin = ccTwin(p, ccProducts, rateData, today, current ?? 0);
          if (twin) {
            const { price: _pr, priceAt: _pa, band: _b, ...rest } = p;
            p = { ...rest, href: twin.x.url, store: "store-amazon", swappedFrom: p.href, ...(current !== null ? { swappedFromPct: current } : {}), campaignEnds: twin.c.ends };
            sortCounts.swapped += 1;
          }
        }
        const e = want(p, [slug], p.ownerPick ? "owner pick" : "guide");
        e.at = Math.min(e.at ?? Infinity, i);
        e.was = [...(e.was ?? []), slug];
      });
    }
    // Every other guide a held row's source names for it (placement files, owner picks, fills) is a candidate too.
    for (const [href, slugs] of Object.entries(BRAND_PLACEMENT)) if (Array.isArray(slugs) && pool.has(href)) for (const s of slugs) if (GUIDE_SLUGS.has(s) && isGuide(s)) pool.get(href).guides.add(s);
    for (const [href, slugs] of ownerGuides) if (pool.has(href)) for (const s of slugs.map(ownGuide1120).filter(Boolean)) pool.get(href).guides.add(s);
    // 2. The brand-link rows no guide holds yet (owner: "Import ALL brand links"), to their placement-file guides.
    for (const f of ["_brand-links-1119-a.json", "_brand-links-1119-b.json"]) {
      for (const r of rowsOf(readJson(f))) {
        if (!r || typeof r.href !== "string" || pool.has(r.href)) continue;
        const slugs = (BRAND_PLACEMENT[r.href] ?? sectionGuides(r.section)).filter((s) => GUIDE_SLUGS.has(s) && isGuide(s));
        if (!slugs.length) { sortCounts.brandNoGuide += 1; continue; }
        // A ShopMy pin is the affiliate link itself.
        const p = toPick({ ...r, brand: r.brand || r._guide, affiliate_href: r.href, price: undefined }, `sort1119e ${f}`);
        if (!p || !p.image || excludedRow(p)) { sortCounts.brandHeld += 1; if (process.env.GIFT_SORT_DEBUG) console.error(`HELD ${r.name} ${p ? (p.image ? "excluded" : "no image " + r.image) : hidden[hidden.length - 1]}`); continue; }
        if (p.store) register(p.store, p.href);
        want(p, slugs, "brand link").fresh = true;
      }
    }
    // 3. Creator Connections picks (lead 11-19: the best 1-3 of each JOINED campaign), the curation fills for the guides
    // still short (_fill-1119-*.json, _fill-thin-*.json, _career-fill-*.json: rows naming their guide; lead 11-19: "fill the
    // career and military guides at 0-2 from the pools") and the editor's adds (_editor-adds-1119e.json). Each goes through
    // toPick like every other row (names, brand casing, link rules, blocked brands, checked prices); an Amazon CDN photo is
    // kept on an Amazon link only (the owner's 11-18 PM call, AMAZON_CDN_PHOTOS).
    const ccPlaced = new Set();
    const fillImgOk = (img, href) => typeof img === "string" && /^https:\/\//.test(img) && !brokenImage(img) && !SHOPMY_S3.test(img) && !isTiff(img) && !/\.(avif|heic|heif)(\?|#|$)/i.test(img)
      && (!AMAZON_IMAGE_HOST.test(new URL(img).hostname) || isAmazonUrl(href));
    const addRow = (r, href, slugsOf, source, where) => {
      if (pool.has(href) || !fillImgOk(r.image, href) || !slugsOf.length) return null;
      const amazonPhoto = new URL(r.image).hostname === "m.media-amazon.com";
      const p = toPick({ name: r.name, brand: r.brand, line: r.line ?? (source === "creator connections" ? r.why ?? "" : ""), href, ...(/^https:\/\/go\.shopmy\.us\//.test(href) || !isAmazonUrl(href) && /^https:\/\/(mavely|walmrt|www\.anrdoezrs|www\.kqzyfj|www\.jdoqocy|www\.dpbolvw|www\.awin1|click\.linksynergy)/.test(href) ? { affiliate_href: href, href: r.product_url ?? href } : {}),
        image: r.image, ...(amazonPhoto ? { image_source: "amazon-sitestripe" } : {}), retailer: r.retailer, store: r.store,
        ...(r.trending === true ? { trending: true } : {}), ...(r.tiktok === true ? { tiktok: true } : {}), ...(r.preorder === true ? { preorder: true } : {}), ...(r.raw_price !== undefined ? { raw_price: r.raw_price } : {}) }, where);
      if (!p || !p.image || excludedRow(p)) return null;
      // A national guide's line never names Louisiana (LA_LINE); the row's store page knows its link host.
      const pick = { ...p, line: p.line && LA_LINE.test(p.line) ? "" : p.line };
      if (pick.store) register(pick.store, pick.href);
      const e = want(pick, slugsOf, source);
      e.fresh = true;
      return e;
    };
    // Follow-up 1120: a row naming a merged guide with no list of its own (Cozy & Self-Care, Splurge) goes to its first old guide.
    const ownList = (s) => (GUIDE_SLUGS.has(s) && isGuide(s) ? s : [...BASE_MERGES, ...GUIDE_MERGES].find((m) => m.parent === s)?.sections.find((x) => GUIDE_SLUGS.has(x) && isGuide(x)) ?? null);
    const guidesOf = (r) => [...new Set([r.guide, ...(Array.isArray(r.guides) ? r.guides : []), r._guide].filter((s) => typeof s === "string").map(ownList).filter(Boolean))];
    for (const r of rowsOf(readJson("_cc-placements-1119e.json"))) {
      // Joined campaigns only (owner 11-19: the bonus pays only on a joined campaign; the rest wait for a later train).
      if (!r || typeof r.asin !== "string" || typeof r.name !== "string" || !rateData.cc.has(r.asin)) continue;
      const e = addRow(r, `https://www.amazon.com/dp/${r.asin}?tag=louisianahelpr-20`, guidesOf(r), "creator connections", "sort1119e creator connections");
      if (e) e.campaign = String(r.campaign_id ?? rateData.cc.get(r.asin)?.id ?? "");
    }
    for (const r of rowsOf(readJson("_editor-adds-1119e.json"))) {
      if (!r || typeof r.href !== "string" || typeof r.name !== "string") continue;
      const e = addRow(r, r.href, guidesOf(r), "editor add", "sort1119e editor add");
      if (e) e.forced = new Set(e.guides);
    }
    for (const f of readdirSync(dir).filter((x) => /^_(fill-1119-|fill-thin-|career-fill-).*\.json$/.test(x)).sort()) {
      let v;
      try { v = readJson(f); } catch { continue; /* mid-write: read on the next run */ }
      for (const r of rowsOf(v)) {
        const href = r?.affiliate_href || r?.href;
        if (!r || typeof href !== "string" || typeof r.name !== "string") continue;
        addRow(r, href, guidesOf(r), "fill", `sort1119e ${f}`);
      }
    }
    // BIG BATCH 1120 (owner 11-19 ~10 PM: "batch everything in 1 big batch"): the thin-guide fill (_thin-fill-1119.json),
    // the owner's Southern picks (_southern-picks-1119.json), the swaps' new items (_owner-swaps-1119.md ADD rows,
    // placed on their guide like an editor's add) and the rest of the joined Creator Connections campaigns
    // (_cc-placements-1120.json). Same gates as every fill; a row the owner found on TikTok wears "Trending on TikTok".
    // Follow-up 1120: a row with no photo takes the one read for it (_image-fill-1120.json: the brand's own product image
    // or Amazon's image by ASIN; lead 11-20: BedJet, Polaroid), and a forced row already in the pool is still forced.
    const IMAGE_FILL_1120 = (() => { try { return readJson("_image-fill-1120.json") ?? {}; } catch { return {}; } })();
    for (const r0 of importRows1120(readJson, rowsOf, dir)) {
      const href = r0.affiliate_href || r0.href;
      const r = r0.image || !IMAGE_FILL_1120[href] ? r0 : { ...r0, image: IMAGE_FILL_1120[href] };
      const had1120 = pool.get(href);
      const e = addRow(r, href, guidesOf(r), r._source, `big1120 ${r._file}`) ?? (r._forced && had1120 ? (guidesOf(r).forEach((g) => had1120.guides.add(g)), had1120) : null);
      if (!e) continue;
      if (r._forced) {
        // Her own swap (owner 11-19 PM): an owner pick, exempt from the page rules like her other picks.
        e.p = { ...e.p, ownerPick: true };
        e.forced = new Set(guidesOf(r).length ? guidesOf(r) : e.guides);
        for (const s of e.forced) swapKeep.add(`${s}|${href}`);
      }
      // A small shop the owner asked for by name (OWNER_SHOPS_1120) is placed on its guide like an editor's add.
      if (r._ownerShop) e.forced = new Set([...(e.forced ?? []), ...e.guides]);
      if (r.asin && rateData.cc.has(r.asin)) e.campaign = String(r.campaign_id ?? rateData.cc.get(r.asin)?.id ?? "");
    }
    // FOLLOW-UP 1120: the 0% swaps' earning adds, the earning Louisiana picks and the Louisiana Goldbelly links, each
    // placed on its guide like an editor's add (a guide named by its big-batch parent takes its first old guide).
    const LA_FOOD_FALLBACK = ["louisiana-sweets-and-bakeries", "louisiana-kitchen", TREATS_GUIDE];
    const LA_ITEM_FALLBACK = ["louisiana-made", "louisiana-pantry", "louisiana-boutiques", "louisiana-small-businesses"];
    const placeOn = (guide, section) => {
      const s0 = AUDIT_1120.oldSlug(guide, section) ?? guide;
      if (GUIDE_SLUGS.has(s0) && isGuide(s0)) return s0;
      const base = BASE_MERGES.find((m) => m.parent === s0) ?? GUIDE_MERGES.find((m) => m.parent === s0);
      return base?.sections.find((x) => GUIDE_SLUGS.has(x) && isGuide(x)) ?? null;
    };
    sortCounts.followUpAdds = 0;
    for (const a of [...ZERO_1120.adds, ...louisianaAdds1120(readJson)]) {
      const slug = placeOn(a.guide, a.section);
      const href = a.row.affiliate_href || a.row.href;
      if (!slug || typeof href !== "string") continue;
      const had = pool.get(href);
      const e = addRow({ ...a.row, line: a.row.line ?? a.row.why ?? "" }, href, [slug], "follow-up 1120", "followup1120") ?? had ?? null;
      if (process.env.GIFT_FU_DEBUG) console.error(`FUADD ${slug} ${a.row.name} -> ${e ? "pool" : "held"}`);
      if (!e) continue;
      // Placed where every page rule allows it (a food gift on a food guide, a Louisiana item in the Louisiana section):
      // its own guide, else the Louisiana sweets, kitchen or treats guide for food, else Louisiana-Made / Boutiques.
      const tries = [slug, ...(foodOff(slug, e.p) ? LA_FOOD_FALLBACK : []), ...(!LOUISIANA_GUIDES.has(slug) && isLouisianaItem(e.p, LA_HOSTS) ? LA_ITEM_FALLBACK : [])];
      // Community Coffee stays off Louisiana-Made (ready pass 1119c: it moved to the coffee and pantry guides).
      const on = tries.find((x) => GUIDE_SLUGS.has(x) && isGuide(x) && gate(x, e.p) && !(x === "louisiana-made" && /community coffee/i.test(`${e.p.name} ${e.p.brand ?? ""}`)));
      if (!on) continue;
      e.guides.add(on);
      e.forced = new Set([...(e.forced ?? []), on]);
      // The earning Louisiana picks are Louisiana businesses (KREWE, Community Coffee, Aunt Sally's on Goldbelly ...).
      if (a.file) e.p = { ...e.p, louisianaFit: true };
      sortCounts.followUpAdds += 1;
    }
    // 3a. The fit audits' moves (AUDIT_1120): the item goes to its new guide, placed there like an editor's add.
    for (const mv of AUDIT_1120.moves) {
      const e = pool.get(mv.href) ?? [...pool.values()].find((x) => x.p.swappedFrom === mv.href);
      if (!e || !GUIDE_SLUGS.has(mv.to) || !isGuide(mv.to)) continue;
      e.guides.add(mv.to);
      e.forced = new Set([...(e.forced ?? []), mv.to]);
      sortCounts.auditMoves = (sortCounts.auditMoves ?? 0) + 1;
    }
    // 3b. Every candidate (brand links, fills, the 1120 imports) of a product in a live, joined Creator Connections campaign
    // takes the campaign ASIN when it pays CC_SWAP_MARGIN more (owner 11-19 PM: "I added Kiehl's stuff on ShopMy but I
    // think their commission is better on Amazon now"; same for the other 33% beauty campaigns), as step 1 does for the
    // guides' own picks. The old link stays (swappedFrom -> fallback_href, switch_on the day after the campaign ends).
    for (const [href, e] of [...pool]) {
      if (isAmazonUrl(e.p.href) || e.p.swappedFrom) continue;
      const current = rate(e.p);
      const twin = ccTwin(e.p, ccProducts, rateData, today, current ?? 0);
      if (!twin || pool.has(twin.x.url)) continue;
      const { price: _pr, priceAt: _pa, band: _b, ...rest } = e.p;
      e.p = { ...rest, href: twin.x.url, store: "store-amazon", swappedFrom: e.p.href, ...(current !== null ? { swappedFromPct: current } : {}), campaignEnds: twin.c.ends };
      pool.delete(href);
      pool.set(twin.x.url, e);
      sortCounts.swapped += 1;
    }
    // 4. Popularity placement (owner 11-19 ~6:45 PM), the commission sort (~6:40 PM) and the 25 cap (~6:50 PM).
    const popularity = (() => { try { return JSON.parse(readFileSync(new URL("./gift-guide-popularity.json", import.meta.url), "utf8")); } catch { return {}; } })();
    const slugs = Object.keys(pageList).filter(isGuide);
    for (const e of pool.values()) for (const s of e.guides) if (!slugs.includes(s)) slugs.push(s);
    const ranks = guideRanks(popularity, slugs);
    const order = [...slugs].sort((a, b) => ranks.get(a) - ranks.get(b));
    for (const e of pool.values()) {
      e.p = { ...e.p, commission: rate(e.p), type: pickType(e.p) };
      e.pop = itemPopularity(e.p, rateData);
    }
    // The product, its maker's name left out of both halves ("3M Littmann Classic III" = "Littmann Classic III", 1120).
    const productK = (p) => productKey1120(p.brand, p.name, dedupeKey);
    const usedHref = new Set();
    const usedImage = new Set();
    const usedName = new Set();
    const productOn = new Map();
    const productColors = new Map();
    const placed = new Map(order.map((s) => [s, []]));
    const canTake = (slug, e, list) => {
      const p = e.p;
      // One link, one photo and one exact name on one guide (a 2nd guide gets another colorway: its own link, name and photo).
      if (usedHref.has(p.href) || (p.image && usedImage.has(p.image)) || usedName.has(compact(p.name))) return false;
      // No lash item and no Vera Bradley (owner 11-19: dated / not a gift here).
      if (LASH.test(p.name) || VERA_BRADLEY.test(String(p.brand ?? "").trim())) return false;
      const k = productK(p);
      if ((productOn.get(k)?.size ?? 0) >= DUP_GUIDE_MAX || productOn.get(k)?.has(slug)) return false;
      // ONE PLACE PER ITEM AND COLOR (owner 11-19 8:30 PM): a product already on another guide comes back only in a color
      // its name names and no other guide's row of it has (an unnamed color counts as the same one).
      const color = pickColor(p);
      if (productOn.has(k) && (!color || [...(productColors.get(k) ?? [])].some((c) => !c || c === color))) return false;
      // LSU at most LSU_MAX per guide section (owner 11-19: Game Day and Baton Rouge kept the best two).
      if (LSU_ITEM.test(`${p.name} ${p.brand ?? ""}`) && list.filter((x) => LSU_ITEM.test(`${x.name} ${x.brand ?? ""}`)).length >= LSU_MAX) return false;
      if (list.filter((x) => x.type === p.type).length >= typeMax(slug, p.type)) return false;
      // One row per product on a guide (variantKey: the same brand and name start), and the fit r4 kind caps (one
      // stethoscope, one toothbrush ...).
      if (list.some((x) => variantKey(x) === variantKey(p))) return false;
      for (const [kind, max] of typeCaps(slug, p)) if (list.filter((x) => typeCaps(slug, x).some(([k]) => k === kind)).length >= max) return false;
      const b = brandKey(p.brand ?? "");
      // Two of a brand (three in the Louisiana section, whose makers sell several things).
      // The By person guides (the most visited) list one per brand, for range (owner 11-19: "a range of great different gift ideas").
      const brandMax = LOUISIANA_GUIDES.has(slug) ? BRAND_CAP : GUIDE_GROUPS.get(slug) === "By person" ? 1 : SORT_BRAND_MAX;
      if (b && !["gift-cards", "subscriptions", "advent-calendars", "gift-tags"].includes(slug) && !/affiliate|program|walmart|amazon|target|shopmy/i.test(p.brand ?? "") && list.filter((x) => brandKey(x.brand ?? "") === b).length >= brandMax) return false;
      return true;
    };
    const take = (slug, e, list) => {
      list.push(e.p);
      usedHref.add(e.p.href);
      usedName.add(compact(e.p.name));
      if (e.p.image) usedImage.add(e.p.image);
      const k = productK(e.p);
      productOn.set(k, new Set([...(productOn.get(k) ?? []), slug]));
      productColors.set(k, new Set([...(productColors.get(k) ?? []), pickColor(e.p)]));
      e.on.add(slug);
    };
    /**
     * FOLLOW-UP 1120 (lead 11-20: "owner picks beat ours"): why a row cannot take a guide, as { kind, detail, holders }
     * (canTake's checks, in its order), or null when it can. A type, brand or full-list block is one an owner pick may
     * bump a lower-paying pick of ours out of; the others (one place per item and color, LSU, lash) are her firm rules.
     */
    const blockOf = (slug, e, list) => {
      const p = e.p;
      const where = (pred) => [...placed].filter(([, l]) => l.some(pred)).map(([g]) => g);
      if (usedHref.has(p.href) || (p.image && usedImage.has(p.image)) || usedName.has(compact(p.name))) return { kind: "same item", detail: "the same link, photo or name is already on a guide", holders: where((x) => x.href === p.href || (p.image && x.image === p.image) || compact(x.name) === compact(p.name)) };
      if (LASH.test(p.name)) return { kind: "lash", detail: "one lash item at most, never a top pick", holders: [] };
      if (VERA_BRADLEY.test(String(p.brand ?? "").trim())) return { kind: "vera bradley", detail: "Vera Bradley is out (owner 11-19)", holders: [] };
      const k = productK(p);
      const color = pickColor(p);
      if ((productOn.get(k)?.size ?? 0) >= DUP_GUIDE_MAX || productOn.get(k)?.has(slug) || (productOn.has(k) && (!color || [...(productColors.get(k) ?? [])].some((c) => !c || c === color)))) {
        return { kind: "same item", detail: `the same product ${color ? `in ${color} ` : "(no color named) "}is already placed`, holders: [...(productOn.get(k) ?? [])] };
      }
      if (LSU_ITEM.test(`${p.name} ${p.brand ?? ""}`) && list.filter((x) => LSU_ITEM.test(`${x.name} ${x.brand ?? ""}`)).length >= LSU_MAX) return { kind: "lsu", detail: `two LSU items already on ${slug}`, holders: list.filter((x) => LSU_ITEM.test(`${x.name} ${x.brand ?? ""}`)).map((x) => x.name) };
      // Her picks are not held to our type and kind caps: only our picks of that type are counted (and bumped).
      const mineOk = (x) => !(p.ownerPick && x.ownerPick);
      const sameType = list.filter((x) => x.type === p.type);
      if (sameType.length >= typeMax(slug, p.type) && sameType.some(mineOk)) return { kind: "type", detail: `${typeMax(slug, p.type)} "${p.type}" already on ${slug}`, holders: sameType.filter(mineOk).map((x) => x.name) };
      if (!p.ownerPick && list.some((x) => variantKey(x) === variantKey(p))) return { kind: "same item", detail: `another size or color of it is on ${slug}`, holders: list.filter((x) => variantKey(x) === variantKey(p)).map((x) => x.name) };
      for (const [kind, max] of typeCaps(slug, p)) {
        const held = list.filter((x) => typeCaps(slug, x).some(([kk]) => kk === kind));
        if (held.length >= max && held.some(mineOk)) return { kind: "type", detail: `${max} "${kind}" already on ${slug}`, holders: held.filter(mineOk).map((x) => x.name) };
      }
      const b = brandKey(p.brand ?? "");
      const brandMax = LOUISIANA_GUIDES.has(slug) ? BRAND_CAP : GUIDE_GROUPS.get(slug) === "By person" ? 1 : SORT_BRAND_MAX;
      const brandOn = list.filter((x) => brandKey(x.brand ?? "") === b);
      // Her picks: up to 2 of a brand when both are hers (lead 11-20); ours of that brand give way.
      if (b && p.ownerPick && !/affiliate|program|walmart|amazon|target|shopmy/i.test(p.brand ?? "")) {
        const ours = brandOn.filter((x) => !x.ownerPick);
        if (ours.length && brandOn.length >= Math.max(brandMax, 2)) return { kind: "brand", detail: `${p.brand} already on ${slug}`, holders: ours.map((x) => x.name) };
        if (brandOn.filter((x) => x.ownerPick).length >= 2) return { kind: "brand-hers", detail: `two of her ${p.brand} picks already on ${slug}`, holders: brandOn.filter((x) => x.ownerPick).map((x) => x.name) };
      } else if (b && !["gift-cards", "subscriptions", "advent-calendars", "gift-tags"].includes(slug) && !/affiliate|program|walmart|amazon|target|shopmy/i.test(p.brand ?? "") && brandOn.length >= brandMax) {
        return { kind: "brand", detail: `${brandMax} ${p.brand} already on ${slug}`, holders: brandOn.map((x) => x.name) };
      }
      if (list.length >= GUIDE_CAP) return { kind: "full", detail: `${slug} already holds ${GUIDE_CAP}`, holders: [] };
      return null;
    };
    /** Takes a placed pick back off a guide (its one-place keys follow what the guides still hold). */
    const untake = (slug, p, list) => {
      list.splice(list.indexOf(p), 1);
      usedHref.delete(p.href);
      usedName.delete(compact(p.name));
      if (p.image) usedImage.delete(p.image);
      const k = productK(p);
      const left = [...placed].flatMap(([g, l]) => l.filter((x) => productK(x) === k).map((x) => [g, x]));
      if (left.length) { productOn.set(k, new Set(left.map(([g]) => g))); productColors.set(k, new Set(left.map(([, x]) => pickColor(x)))); } else { productOn.delete(k); productColors.delete(k); }
      pool.get(p.href)?.on.delete(slug);
    };
    sortCounts.ownerBumped = [];
    /** An owner pick blocked by a type, brand or full-list cap takes the place of our lowest-paying pick that holds it. */
    const ownerTake = (slug, e, list) => {
      for (let tries = 0; tries < 3; tries++) {
        const why = blockOf(slug, e, list);
        if (!why) { take(slug, e, list); return true; }
        if (!["type", "brand", "full"].includes(why.kind)) return false;
        const ours = list.filter((x) => !x.ownerPick && !keepOn(slug, x) && !pool.get(x.href)?.forced?.has(slug) && !pool.get(x.href)?.campaign
          && (why.kind === "full" || why.holders.includes(x.name)));
        const victim = ours.sort((a, b) => (Number(a.commission) || 0) - (Number(b.commission) || 0))[0];
        if (!victim) return false;
        untake(slug, victim, list);
        sortCounts.ownerBumped.push(`${slug}: ${e.p.name} over ${victim.name}`);
      }
      return false;
    };
    // A forced row (an editor's add, a fit-audit move) still leaves a guide a later judgment cut names (1120 fit audits).
    const eligible = (slug, e) => e.guides.has(slug) && !jdSports(e.p) && !followUpGone(e.p, slug) && (e.was?.includes(slug) ? !judgedOut(slug, e.p) && !excludedRow(e.p) : e.forced?.has(slug) ? !holisticWhy(slug, e.p) && !judgedOut(slug, e.p) : gate(slug, e.p));
    // The keeps claim their guide first (1120): the owner's newest call wins the one place an item may show (her swap put
    // the Weezie toiletry bag on Traveler, so Sister, earlier in the order, no longer takes the same bag).
    for (const slug of order) for (const e of pool.values()) if (keepOn(slug, e.p) && !e.on.has(slug) && !SORT_FIXED.has(slug)) take(slug, e, placed.get(slug));
    for (const slug of order) {
      const list = placed.get(slug);
      const cands = [...pool.values()].filter((e) => eligible(slug, e) || keepOn(slug, e.p));
      // A list with its own order (memberships first, wrap only, Mail Carrier's checked $20 picks) keeps it, capped.
      if (SORT_FIXED.has(slug)) {
        for (const e of cands.filter((x) => x.was?.includes(slug)).sort((a, b) => a.at - b.at)) if (list.length < GUIDE_CAP) take(slug, e, list);
        continue;
      }
      // The owner's keeps first, then commission high to low (unknown last), ties by item popularity, then the old slot.
      for (const e of cands.filter((x) => keepOn(slug, x.p) && !x.on.has(slug))) take(slug, e, list);
      // A joined Creator Connections pick (lead 11-19: every joined campaign on a guide) and an editor's add claim their
      // slot before the commission order fills the rest (still one type and brand cap; the page sorts them in after).
      for (const e of cands.filter((x) => !keepOn(slug, x.p) && (x.campaign || x.forced?.has(slug)) && !ownerOn(slug, x.p))) if (canTake(slug, e, list)) take(slug, e, list);
      // The owner's own picks next: each takes its place, bumping a lower-paying pick of ours past a type, brand or full cap.
      for (const e of cands.filter((x) => !keepOn(slug, x.p) && ownerOn(slug, x.p) && !x.on.has(slug))) ownerTake(slug, e, list);
      const ranked = cands.filter((x) => !keepOn(slug, x.p) && !x.on.has(slug)).map((e) => ({ e, commission: e.p.commission, _pop: e.pop, _at: e.at ?? 999 })).sort(byCommission);
      for (const { e } of ranked) {
        if (list.length >= GUIDE_CAP) break;
        if (canTake(slug, e, list)) take(slug, e, list);
      }
    }
    // CROWD-PLEASER FILL (the judgment reviews 11-19: "need general crowd-pleasers"): a guide still under THIN_TARGET takes
    // held picks no guide shows, from recognizable brands, of the kinds anyone is glad to get (a Stanley, a Barefoot Dreams
    // throw, a Theragun Mini, Bose earbuds ...), no pastel or pink outside the women's guides, never one judged out
    // anywhere, by commission. Every page rule still gates it.
    const judgedAnywhere = (p) => [...judged.values()].some((s) => s.has(`h:${p.href}`) || s.has(`n:${compact(p.name)}`));
    const heldCrowd = [...pool.values()].filter((e) => !e.on.size && CROWD_TYPES.has(e.p.type) && (KNOWN_BRAND.test(String(e.p.brand ?? "").trim()) || e.source === "owner pick") && !judgedAnywhere(e.p) && !jdSports(e.p))
      .map((e) => ({ e, commission: e.p.commission, _pop: e.pop, _at: e.at ?? 999 })).sort(byCommission);
    for (const slug of order) {
      const list = placed.get(slug);
      if (SORT_FIXED.has(slug) || list.length >= THIN_TARGET || ["Louisiana", "Pets", "Colors", "By budget"].includes(GUIDE_GROUPS.get(slug) ?? "") || /bab(y|ies)|toddlers|little-kids|big-kids|^(kids|girls|boys|gender-neutral)$|^(advent-calendars|gift-tags|25-days-sponsors)$/.test(slug)) continue;
      const women = WOMEN_GUIDES.includes(slug) || /^(girlfriend|best-friend|mother-in-law|sister-in-law|aunt|niece|big-sisters|girls-teens)$/.test(slug);
      for (const { e } of heldCrowd) {
        if (list.length >= THIN_TARGET) break;
        if (process.env.GIFT_SORT_DEBUG === slug) console.error(`CROWD ${slug}: ${e.p.name} on=${e.on.size} pastel=${!women && MEN_PASTEL.test(e.p.name)} why=${why(slug, e.p)} fits=${fitsGuide(slug, e.p)} hol=${holisticWhy(slug, e.p)} bel=${belongsWhy(slug, GUIDE_GROUPS.get(slug) ?? "", e.p, { tumblers: 0 }, true)} r4=${fitR4Why(slug, GUIDE_GROUPS.get(slug) ?? "", e.p)} take=${canTake(slug, e, list)}`);
        if (e.on.size || (!women && MEN_PASTEL.test(`${e.p.name} ${String(e.p.image ?? "").replace(/[-_]/g, " ")}`)) || !gate(slug, e.p) || !canTake(slug, e, list)) continue;
        take(slug, e, list);
        e.crowd = true;
        sortCounts.crowd += 1;
      }
    }
    // GIFT_SORT_DUMP=<file>: each guide's placed picks and its next 15 eligible candidates (the judgment review reads it).
    if (process.env.GIFT_SORT_DUMP) {
      const dump = {};
      for (const slug of order) {
        const on = new Set(placed.get(slug).map((p) => p.href));
        const bench = [...pool.values()].filter((e) => !on.has(e.p.href) && eligible(slug, e)).map((e) => ({ e, commission: e.p.commission, _pop: e.pop, _at: e.at ?? 999 })).sort(byCommission).slice(0, 15);
        const row = (p, src) => ({ name: p.name, brand: p.brand, type: p.type, commission: p.commission, price: p.price, image: p.image, href: p.href, source: src });
        dump[slug] = { placed: placed.get(slug).map((p) => row(p, pool.get(p.href)?.source)), bench: bench.map(({ e }) => row(e.p, e.source)) };
      }
      writeFileSync(process.env.GIFT_SORT_DUMP, JSON.stringify(dump, null, 1));
    }
    for (const e of pool.values()) {
      if (e.on.size) { if (e.campaign) ccPlaced.add(e.campaign); continue; }
      sortCounts.held += 1;
      if (e.source === "owner pick") sortCounts.ownerHeld.push(e.p.name);
      for (const s of e.was ?? []) if (judgedOut(s, e.p)) sortCounts.judged += 1;
    }
    // FOLLOW-UP 1120 (lead 11-20: a clear answer for every owner pick left out): why each pick she added sits on none of
    // the guides she named, read with the same rules the sort used (OWNER_DIAG_1120, written to the Desktop report).
    {
      const gateWhy = (slug, p) => {
        const group = GUIDE_GROUPS.get(slug) ?? "";
        if (followUpGone(p, slug)) return "pays no commission (0% link)";
        if (jdSports(p)) return "JD Sports listing";
        const w = why(slug, p);
        if (w) return `page rule: ${w}`;
        if (excludedRow(p)) return "on the owner's exclude list";
        if (!fitsGuide(slug, p)) return `does not fit ${slug}`;
        const b = belongsWhy(slug, group, p, { tumblers: 0 }, true);
        if (b) return `fit rule: ${b}`;
        const r4 = fitR4Why(slug, group, p);
        if (r4) return `fit rule: ${r4}`;
        if (louisianaBlocked(slug, p)) return "a Louisiana item outside the Louisiana section";
        if (MEN_COLOR_GUIDES.includes(slug) && MEN_PASTEL.test(`${p.name} ${String(p.image ?? "").replace(/[-_]/g, " ")}`)) return "pastel on a men's guide";
        if (typeof p.price === "number" && p.price > PRICE_MAX) return "over $500";
        if (judgedOut(slug, p)) {
          const c = OWNER_CUT_KIND_1120.get(p.href);
          return c?.kind === "fit" ? `a clear wrong fit for ${slug} (audit: ${c.why})` : c?.kind === "firm" ? `cut for one of her firm rules (audit: ${c.why})` : `cut by name in an earlier pass (her swaps or a named removal)`;
        }
        const h = holisticWhy(slug, p);
        if (h) return `fit rule: ${h}`;
        return "";
      };
      for (const [href, gs] of ownerGuides) {
        const e = pool.get(href);
        if (!e) continue;
        const targets = [...new Set(gs.map(ownGuide1120).filter(Boolean))];
        if (targets.some((g) => e.on.has(g))) continue;
        const reasons = targets.map((g) => {
          if (!GUIDE_SLUGS.has(g) || !isGuide(g)) return { guide: g, kind: "no guide", detail: `${g} is no list`, holders: [] };
          const gw = gateWhy(g, e.p);
          if (gw) return { guide: g, kind: "rule", detail: gw, holders: [] };
          const blk = blockOf(g, e, placed.get(g) ?? []);
          return blk ? { guide: g, ...blk } : { guide: g, kind: "full", detail: `${g} filled before it`, holders: [] };
        });
        OWNER_DIAG_1120.set(href, { name: e.p.name, brand: e.p.brand, commission: e.p.commission, type: e.p.type, placedOn: [...e.on], reasons });
      }
    }
    for (const slug of order) pageList[slug] = SORT_FIXED.has(slug) ? placed.get(slug) : placed.get(slug).sort((a, b) => byCommission({ ...a, _pop: pool.get(a.href)?.pop }, { ...b, _pop: pool.get(b.href)?.pop }));
    sortCounts.ccCampaigns = ccPlaced.size;
    sortCounts.ccOf = campaigns.filter((c) => c?.opted_in !== false).length;
    sortCounts.overCap = order.filter((s) => pageList[s].length > GUIDE_CAP).length;
    SORT_POOL.push(...pool.values());
    SORT_CTX.rateData = rateData;
    SORT_CTX.today = today;
    SORT_CTX.campaigns = campaigns;
    SORT_CTX.popularity = popularity;
    SORT_CTX.otherRates = new Map(rowsWithRate.filter((r) => typeof r.other_rates === "string").map((r) => [r.href, r.other_rates]));
    SORT_CTX.judged = judgedOut;
    SORT_RANKS.push(...order);
    console.log(`gift-guide-picks: sort 1119e: ${pool.size} candidates, ${sortCounts.swapped} Creator Connections swaps, ${sortCounts.held} held (${sortCounts.ownerHeld.length} owner picks), ${sortCounts.crowd} crowd-pleaser fills, ${sortCounts.brandHeld} brand rows without a photo or link, ${sortCounts.brandNoGuide} with no placement guide; ${sortCounts.ccCampaigns} of ${sortCounts.ccOf} joined Creator Connections campaigns placed; ${sortCounts.judged} judgment cuts`);
  }
  // A merged store's old slug is gone: every pick (owner picks and replacements came in after the merge) names the
  // canonical page, and the old page writes no chunk and no store entry (its link redirects, MERGED_GUIDES).
  if (STORE_AUDIT_C_ON) {
    for (const slug of Object.keys(pageList)) pageList[slug] = pageList[slug].map((p) => (p.store && STORE_MERGES[p.store] ? { ...p, store: STORE_MERGES[p.store] } : p));
    for (const [from, to] of Object.entries(STORE_MERGES)) {
      if (storeList[from]) {
        storeList[to] ??= { name: stores.get(to)?.name ?? storeList[from].name, hosts: [] };
        storeList[to].hosts = [...new Set([...storeList[to].hosts, ...storeList[from].hosts])].sort();
        delete storeList[from];
      }
      delete pageList[from];
    }
  }
  // Every guide pick still lists on its store page (a late fill can bring a pick its store page never saw).
  for (const slug of Object.keys(pageList)) {
    if (slug.startsWith("store-") || slug === SPONSORS_GUIDE) continue;
    for (const p of pageList[slug]) {
      const page = p.store && pageList[p.store];
      // A page the store audit emptied stays empty; a Louisiana item stays off a national store's page.
      // Not one the fit audit cut from that page, and no store page grows past STORE_CAP this way (owner: 10-15 per store page; lead 11-19).
      if (cuts.get(p.store)?.has(compact(p.href)) || (STORE_AUDIT_C_ON && (page?.length ?? 0) >= STORE_CAP)) continue;
      if (!page?.length || page.some((x) => x.href === p.href || compact(x.name) === compact(p.name) || dedupeKey(x.name) === dedupeKey(p.name))) continue;
      if (!LOUISIANA_STORE_PAGES.has(p.store) && isLouisianaItem(p, LA_HOSTS)) continue;
      page.push(p.store === "store-amazon" ? { ...p, section: AMAZON_SECTIONS[AMAZON_SECTIONS.length - 1] } : p);
      readyCounts.storeAdds += 1;
    }
  }
  console.log(`gift-guide-picks: ready 1119c: ${readyCounts.storeAdds} guide picks added to their store page; dedupe ${dedupeCounts.dropped} rows dropped, ${dedupeCounts.slotted} kept rows slotted; out ${JSON.stringify(readyCounts.out)}; ${readyCounts.communityCoffee} Community Coffee moved; ${readyCounts.capped} past the ${DUP_GUIDE_MAX}-guide cap; ${readyCounts.kidsAsks} kids-ask rows placed (${readyCounts.kidsAsksHeld} held: no affiliate link); ${readyCounts.ownerNoPhoto} owner picks held for a photo; taste replacements ${readyCounts.replaced} placed (${readyCounts.replaceSkipped} skipped); fit audit ${readyCounts.fitAudit} rows, ${readyCounts.fitMoved} moved (${readyCounts.fitMoveSkipped} moves skipped)`);
  console.log(`gift-guide-picks: follow-up ${followUpCounts.rules} rule removals, ${followUpCounts.dropped.length} store pages dropped, ${followUpCounts.merged} merged, ${followUpCounts.capped} capped, ${followUpCounts.rei} REI hiking out, ${followUpCounts.excluded} owner excludes, ${followUpCounts.ownerPicks} owner picks placed`);
}
/**
 * GUIDE MERGES 1120 (owner pop-ups 11-19 ~8:20-9:05 PM; src/content/giftGuideMerges.mjs): each merged guide's chunk is
 * its own picks (as "Top picks"), then each old guide as a section (its title, `sectionId` = its old slug, at most
 * SECTION_CAP picks), one row per link on the page. The old guides write no chunk (their links 301 to parent#section).
 * Store pages not kept (STORE_PAGES_KEPT) write none either; their items stay in the guides.
 */
export const mergeCounts = { merged: 0, sections: 0, foldedStores: 0, swappedKept: 0 };
/** Old guide slug -> its section's id on the merged guide (written to giftGuidePicks.ts; the redirects read it). */
export const SECTION_ANCHORS = {};
{
  const entryRaw = (slug) => indexSrc.match(new RegExp(`\\{[^{}]*slug: "${slug}"[^{}]*\\}`))?.[0] ?? "";
  const sectionTitle = (slug) => {
    const raw = entryRaw(slug);
    const title = raw.match(/title: "([^"]*)"/)?.[1] ?? slug;
    const age = raw.match(/age: "([^"]*)"/)?.[1];
    return age ? `${title} (${age})` : title;
  };
  // SECTION GROUPS (owner pop-up 11-20: "Fold thin sections", "Max 6 sections per guide", "By role, not job title";
  // src/content/giftGuideMerges.mjs SECTION_GROUPS): the old guides join their role's section; each section is re-ranked
  // by commission (the 1119e order) under the same caps as a guide (SECTION_CAP picks, TYPE_MAX of a gift type, 2 of a
  // brand, one row per product); a section under SECTION_MIN folds into its closest sibling, and the two smallest
  // neighbours join while a guide has more than SECTION_MAX. Each pick keeps its old guide in `from` (never shown).
  // Follow-up 1120 (QA: clumsy section titles, "Wine Lovers & Cozy & Self-Care"): each part's own list is read word
  // group by word group, so a joined title is one list ("Wine Lovers, Cozy & Self-Care").
  const joinTitles = (parts0) => {
    const parts = parts0.length <= 1 ? parts0 : parts0.flatMap((t) => t.split(/, | & /));
    return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} & ${parts[parts.length - 1]}`;
  };
  // The small shops the owner asked for by name (BRAND_SITES, OWNER_SHOPS_1120) hold their places in a section: they
  // claim theirs first (no type or brand cap), the rest fill by commission, and the section then lists by commission.
  const ownerShop = (p) => { try { return BRANDS.has(new URL(p.href).hostname); } catch { return false; } };
  const fill = (rows, ownSlug) => {
    const out = rows.filter(ownerShop).filter((p, i, all) => all.findIndex((x) => x.href === p.href) === i).slice(0, SECTION_CAP);
    // SORT_FIXED rows keep their own order and lead; the rest by commission.
    // Follow-up 1120 (lead 11-20): the owner's own picks claim their places first; the owner's firm rules still hold
    // (one place per item and color, two of a gift type, two LSU items, one lash item), then the rest by commission.
    const ranked = rows.map((p, i) => ({ p, i })).sort((x, y) => Number(SORT_FIXED.has(y.p.from)) - Number(SORT_FIXED.has(x.p.from)) || Number(Boolean(y.p.ownerPick)) - Number(Boolean(x.p.ownerPick)) || (SORT_FIXED.has(x.p.from) && SORT_FIXED.has(y.p.from) ? x.i - y.i : byCommission({ ...x.p, _at: x.i }, { ...y.p, _at: y.i })));
    for (const { p } of ranked) {
      if (out.length >= SECTION_CAP) break;
      // Her picks are held to her own one-place rule (the same item and color), not to our name-start match.
      if (out.some((x) => x.href === p.href || (!p.ownerPick && variantKey(x) === variantKey(p)) || (p.ownerPick && compact(x.name) === compact(p.name)))) continue;
      // A list with its own order (memberships, gift cards, wrap, Mail Carrier: SORT_FIXED) keeps every row it had.
      if (SORT_FIXED.has(p.from)) { out.push(p); continue; }
      const type = p.type ?? "other";
      // Her picks (follow-up 1120, lead 11-20) skip our type cap, and a brand may show twice when both picks are hers.
      if (!p.ownerPick && out.filter((x) => (x.type ?? "other") === type).length >= typeMax(p.from ?? ownSlug, type)) continue;
      const b = brandKey(p.brand ?? "");
      const brandMax = p.ownerPick ? Math.max(2, LOUISIANA_GUIDES.has(p.from ?? ownSlug) ? BRAND_CAP : SORT_BRAND_MAX) : LOUISIANA_GUIDES.has(p.from ?? ownSlug) ? BRAND_CAP : SORT_BRAND_MAX;
      if (b && !/affiliate|program|walmart|amazon|target|shopmy/i.test(p.brand ?? "") && out.filter((x) => brandKey(x.brand ?? "") === b).length >= brandMax) continue;
      if (LSU_ITEM.test(`${p.name} ${p.brand ?? ""}`) && out.filter((x) => LSU_ITEM.test(`${x.name} ${x.brand ?? ""}`)).length >= LSU_MAX) continue;
      out.push(p);
    }
    return out.map((p, i) => ({ p, i })).sort((x, y) => Number(SORT_FIXED.has(y.p.from)) - Number(SORT_FIXED.has(x.p.from)) || (SORT_FIXED.has(x.p.from) && SORT_FIXED.has(y.p.from) ? x.i - y.i : byCommission({ ...x.p, _at: x.i }, { ...y.p, _at: y.i }))).map((x) => x.p);
  };
  for (const m of GUIDE_MERGES) {
    const spec = SECTION_GROUPS[m.parent];
    const own = NEW_MERGE_PARENTS.has(m.parent) ? [] : (pageList[m.parent] ?? []).map((p) => ({ ...p, from: m.parent }));
    const listOf = (slug) => (pageList[slug] ?? []).map((p) => ({ ...p, from: slug }));
    // The starting groups: the table's, else one per old guide; the guide's own picks lead as "Top picks" unless the
    // table names their section.
    let groups = spec
      ? spec.groups.map((g) => ({ id: g.id, parts: [g.title], from: [...g.from], rows: g.from.flatMap(listOf) }))
      : m.sections.map((sl) => ({ id: sl, parts: [sectionTitle(sl)], from: [sl], rows: listOf(sl) }));
    const ownGroup = spec?.own && groups.find((g) => g.id === spec.own);
    if (ownGroup) ownGroup.rows = [...own, ...ownGroup.rows];
    else if (own.length) groups = [{ id: "top-picks", parts: ["Top picks"], from: [m.parent], rows: own }, ...groups];
    // Pinned products move to their section before the caps run.
    for (const pin of spec?.pins ?? []) {
      const to = groups.find((g) => g.id === pin.group);
      if (!to) continue;
      for (const g of groups) if (g !== to) { const moved = g.rows.filter((p) => pin.name.test(p.name)); g.rows = g.rows.filter((p) => !pin.name.test(p.name)); to.rows.push(...moved.map((p) => ({ ...p, pinned: true }))); }
    }
    const capped = () => groups.forEach((g) => { g.picks = fill(g.rows, g.from[0]); });
    capped();
    if (process.env.GIFT_SECTIONS_DEBUG) console.error(`SECTIONS ${m.parent}: ${groups.map((g) => `${g.id}=${g.picks.length}/${g.rows.length}`).join(" ")}`);
    groups = groups.filter((g) => g.picks.length);
    // Fold a thin section into its closest sibling (the next; the last one into the one before), then cap the count.
    const join = (i, j) => {
      const [x, y] = i < j ? [groups[i], groups[j]] : [groups[j], groups[i]];
      const keep = groups[j];
      // A thin "Top picks" joins its neighbour under the neighbour's name (and id).
      const parts = [...x.parts, ...y.parts].filter((t, k, all) => t !== "Top picks" || all.length === 1);
      const id = keep.id === "top-picks" ? (x === keep ? y.id : x.id) : keep.id;
      const merged = { id, parts, from: [...x.from, ...y.from], rows: [...x.rows, ...y.rows] };
      merged.picks = fill(merged.rows, merged.from[0]);
      groups.splice(Math.max(i, j), 1);
      groups.splice(Math.min(i, j), 1, merged);
    };
    for (let guard = 0; guard < 50 && groups.length > 1; guard++) {
      const i = groups.findIndex((g) => g.picks.length < SECTION_MIN);
      if (i === -1) break;
      join(i, i + 1 < groups.length ? i + 1 : i - 1);
    }
    while (groups.length > SECTION_MAX) {
      let best = 0;
      for (let i = 1; i < groups.length - 1; i++) if (groups[i].picks.length + groups[i + 1].picks.length < groups[best].picks.length + groups[best + 1].picks.length) best = i;
      join(best + 1, best);
    }
    // One page, one row per link (a section's caps never see the others').
    const seen = new Set();
    const tag = (p, g) => {
      const { pinned: _p, ...rest } = p;
      return { ...rest, section: joinTitles(g.parts), sectionId: g.id };
    };
    const final = groups.map((g) => ({ ...g, picks: g.picks.filter((p) => (seen.has(p.href) ? false : (seen.add(p.href), true))) }));
    // One section left is a plain list (no heading); otherwise every pick names its section.
    pageList[m.parent] = final.length > 1 ? final.flatMap((g) => g.picks.map((p) => tag(p, g))) : (final[0]?.picks ?? []).map(({ pinned: _p, ...p }) => p);
    // An old slug opens its section (none when the guide folded to one plain list: it opens the guide's top).
    if (final.length > 1) {
      for (const g of final) for (const sl of g.from) if (sl !== m.parent) SECTION_ANCHORS[sl] = g.id;
      for (const sl of m.sections) if (!SECTION_ANCHORS[sl]) SECTION_ANCHORS[sl] = final[0].id;
    }
    for (const sl of m.sections) delete pageList[sl];
    mergeCounts.merged += 1;
    mergeCounts.sections += final.length;
  }
  // The fit audits' store-page cuts and moves (AUDIT_1120): another store's item, a repeat or filler leaves the page; a
  // move (YETI items on REI and Tractor Supply) joins its own store's page while that page has room (STORE_CAP).
  const storeMoved = [];
  for (const slug of Object.keys(pageList)) {
    if (!slug.startsWith("store-")) continue;
    for (const p of pageList[slug]) {
      const to = AUDIT_1120.storeMoves.get(`${slug}|${p.href}`);
      if (to) storeMoved.push({ to, p });
    }
    pageList[slug] = pageList[slug].filter((p) => !AUDIT_1120.storeCuts.has(`${slug}|${p.href}`));
  }
  for (const { to, p } of storeMoved) if (pageList[to] && pageList[to].length < STORE_CAP && !pageList[to].some((x) => x.href === p.href || compact(x.name) === compact(p.name))) pageList[to].push({ ...p, store: to });
  for (const slug of new Set([...Object.keys(pageList), ...Object.keys(deals)])) {
    if (!isFoldedStore(slug)) continue;
    delete pageList[slug];
    delete deals[slug];
    mergeCounts.foldedStores += 1;
  }
  // A Creator Connections swap keeps its old link to switch back to the day after the campaign ends (owner 11-19 PM,
  // Kiehl's: "their commission is better on Amazon now"; after the end Amazon drops to ~3% and ShopMy wins again).
  const dayAfter = (d) => new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  for (const slug of Object.keys(pageList)) {
    pageList[slug] = pageList[slug].map((p) => (p.swappedFrom && p.campaignEnds && /^\d{4}-\d{2}-\d{2}$/.test(p.campaignEnds)
      ? (mergeCounts.swappedKept += 1, { ...p, fallback_href: p.swappedFrom, switch_on: dayAfter(p.campaignEnds) }) : p));
  }
  console.log(`gift-guide-picks: fit audits 1120: ${AUDIT_1120.rows} rows, ${[...AUDIT_1120.cuts.values()].reduce((n, x) => n + x.size, 0)} guide cuts, ${AUDIT_1120.storeCuts.size} store-page cuts, ${sortCounts.auditMoves ?? 0} moves placed of ${AUDIT_1120.moves.length}, skipped ${AUDIT_1120.skipped.length}`);
  console.log(`gift-guide-picks: merges 1120: ${mergeCounts.merged} merged guides, ${mergeCounts.sections} sections, ${mergeCounts.foldedStores} store pages folded, ${mergeCounts.swappedKept} campaign swaps with a fallback link`);
}
/**
 * FOLLOW-UP 1120, after the merges (scripts/giftGuideFollowUp1120.mjs; FOLLOWUP-OWNER-1119.md from "MORE GUIDE MERGES"):
 *   - EVERY confirmed Louisiana 25 Days sponsor (src/content/giftGuideSmallBiz.json: the Small Business Saturday cards)
 *     on Shop Small Louisiana, in two sponsor sections, with the "25 Days sponsor" badge, linking their website or
 *     Facebook (owner 11-20 ~12:40 AM; 0% is fine for sponsors); one with no link is named only (NAME_ONLY_SPONSORS);
 *     never a giveaway day (the cards carry none);
 *   - the hard rules on every page: no gift card and no 0% pick except a sponsor's or the owner's keeps, no blocked or
 *     excluded brand (Kendra Scott, Labubu, Smiski, Sonny Angel, Lovesac, Fishwife: giftGuideBlocklist.mjs);
 *   - ONE Weber griddle site-wide (owner 11-20 ~12:55 AM: "We only need 1 Weber griddle"), the best-paying one;
 *   - names: each audit rename (the name it spells out, else its brand first), then every name brand first (QA: 344).
 */
export const followUpCounts1120 = { sponsors: 0, namedOnly: 0, out: {}, griddles: 0, renamed: 0, brandFirst: 0 };
{
  const SHOP_SMALL = "shop-small-louisiana";
  const biz = JSON.parse(readFileSync(new URL("../src/content/giftGuideSmallBiz.json", import.meta.url), "utf8"));
  const groups = SPONSOR_SECTIONS_1120.map((g) => ({ ...g, rows: biz.filter((b) => g.categories.includes(b.category)) }));
  const list = pageList[SHOP_SMALL] ?? [];
  // The guide's own picks keep their sections (a single list takes one, so the sponsor sections sit beside it).
  const own = list.map((p) => (p.sectionId ? p : { ...p, section: "Louisiana-Made, Boutiques & Artists", sectionId: "louisiana-made" }));
  if (!list.some((p) => p.sectionId)) for (const m of GUIDE_MERGES.filter((x) => x.parent === SHOP_SMALL)) for (const sl of m.sections) SECTION_ANCHORS[sl] = "louisiana-made";
  // A sponsor whose link another guide already shows (Dupuy's gift certificate on Louisiana by Region) stays there: one place.
  const seen = new Set([...own, ...Object.entries(pageList).filter(([s]) => !s.startsWith("store-") && s !== SPONSORS_GUIDE).flatMap(([, l]) => l)].map((p) => p.href));
  const add = [];
  for (const g of groups) {
    for (const b of g.rows.slice(0, SECTION_CAP)) {
      const name = String(b.name).replace(/\s*\([^)]*\)\s*$/, "");
      // No link, or no logo (owner 11-19: no row without a real photo), is named only (NAME_ONLY_SPONSORS).
      if (!b.href || !/^https:\/\//.test(b.href) || !b.logo) { NAME_ONLY.push({ guide: SHOP_SMALL, brand: name }); followUpCounts1120.namedOnly += 1; continue; }
      if (seen.has(b.href)) continue;
      seen.add(b.href);
      add.push({ name, brand: name, line: String(b.description ?? ""), href: b.href, ...(b.logo ? { image: `https://www.louisianahelpr.com${b.logo}` } : {}),
        store: "sponsor", sponsor: true, louisianaFit: true, commission: 0, type: "sponsor", from: SPONSORS_GUIDE, section: g.title, sectionId: g.id });
      followUpCounts1120.sponsors += 1;
    }
  }
  pageList[SHOP_SMALL] = [...own, ...add];
  // The franchise sponsors in their region on Louisiana by Region (FRANCHISE_SPONSORS_1120), its section when it has some.
  {
    const REGION = "louisiana-by-region";
    const sponsorsGuide = pageList[SPONSORS_GUIDE] ?? [];
    const region = pageList[REGION] ?? [];
    for (const f of FRANCHISE_SPONSORS_1120) {
      const image = f.image ?? sponsorsGuide.find((p) => p.href === f.href)?.image;
      // No photo (no row without one): the sponsor is named on the page instead (NAME_ONLY_SPONSORS).
      if (!image) { NAME_ONLY.push({ guide: REGION, brand: f.brand }); followUpCounts1120.namedOnly += 1; continue; }
      if (region.some((p) => p.href === f.href)) continue;
      const at = region.find((p) => p.sectionId && (SECTION_ANCHORS[f.region] === p.sectionId));
      const row = { name: f.name, brand: f.brand, line: f.line, href: f.href, image, store: "sponsor", sponsor: true, louisianaFit: true, commission: 0, type: "sponsor", from: SPONSORS_GUIDE,
        ...(at ? { section: at.section, sectionId: at.sectionId } : {}) };
      // Listed by commission like every pick: after the paying ones, before any whose rate is unknown.
      const runEnd = (id) => { let k = -1; region.forEach((p, i) => { if ((p.sectionId ?? "") === (id ?? "")) k = i; }); return k; };
      const firstUnknown = region.findIndex((p) => (p.sectionId ?? "") === (row.sectionId ?? "") && typeof p.commission !== "number");
      region.splice(firstUnknown >= 0 ? firstUnknown : runEnd(row.sectionId) + 1 || region.length, 0, row);
      followUpCounts1120.sponsors += 1;
    }
    // Each section stays one run (a sponsor joins its region's run).
    if (region.some((p) => p.sectionId)) {
      const order = [...new Set(region.map((p) => p.sectionId))];
      pageList[REGION] = order.flatMap((id) => region.filter((p) => p.sectionId === id));
    } else pageList[REGION] = region;
  }

  const kept = (p) => [...OWNER_KEEP, ...SORT_KEEP].some((k) => k.href === p.href);
  const excludes = (readJson("_owner-excludes.json") ?? []).map((x) => String(x?.match ?? "").toLowerCase()).filter(Boolean);
  for (const slug of Object.keys(pageList)) {
    // The sponsors guide lists each sponsor as they gave it (a sponsor's gift card included).
    if (slug === SPONSORS_GUIDE) continue;
    pageList[slug] = pageList[slug].filter((p) => {
      const w = (p.from === "subscriptions" ? "" : followUpOut(p, { sponsor: isSponsorPick, kept })) || (blockedBrand(p) ? "blocked" : "") || (excludes.some((m) => `${p.name} ${p.brand ?? ""}`.toLowerCase().includes(m)) ? "excluded" : "")
        || (p.from === "louisiana-made" && /community coffee/i.test(`${p.name} ${p.brand ?? ""}`) ? "community coffee off louisiana-made" : "");
      if (w) followUpCounts1120.out[w] = (followUpCounts1120.out[w] ?? 0) + 1;
      return !w;
    });
  }
  // THE STORE PAGES (owner pop-up 11-20 ~2:45 AM, FINAL STORE LIST; ~/Desktop/Gift-guide-picks/_store-fill-1120.json):
  // each kept page takes its fill rows (that store's best-paying, most popular items), one row per link and name, best
  // commission first, at most STORE_CAP; a new page (Old Navy, Dick's, JCPenney, TJ Maxx & Marshalls ...) is registered.
  {
    let fill = [];
    try { fill = readJson("_store-fill-1120.json")?.items ?? []; } catch { fill = []; /* mid-write: read on the next run */ }
    const STORE_NAMES_1120 = { "store-old-navy": "Old Navy", "store-dicks-sporting-goods": "Dick's Sporting Goods", "store-jcpenney": "JCPenney", "store-tj-maxx-marshalls": "TJ Maxx & Marshalls", "store-sams-club": "Sam's Club", "store-at-home": "At Home", "store-nike": "Nike" };
    const pct = (c) => (typeof c === "number" ? c : Number.parseFloat(String(c ?? "")) || null);
    followUpCounts1120.storeFill = 0;
    for (const r of Array.isArray(fill) ? fill : []) {
      const slug = String(r?.store_slug ?? "");
      if (!STORE_PAGES_KEPT.includes(slug) || typeof r.href !== "string" || !/^https:\/\//.test(r.href) || typeof r.name !== "string") continue;
      // A Louisiana item (LSU slides on Nike) stays in the Louisiana section (owner rule 11-18 PM).
      if (typeof r.image !== "string" || !/^https:\/\//.test(r.image) || brokenImage(r.image) || blockedBrand(r) || isLouisianaItem(r, LA_HOSTS)) continue;
      // No price in a name ("Best of Beauty Holiday Box ($225 Value)": the value aside goes; any other "$" keeps it out).
      r.name = String(r.name).replace(/\s*\([^)]*\$[^)]*\)/g, "").trim();
      if (/\$\s?\d/.test(r.name)) continue;
      let host;
      try { host = new URL(r.href).hostname; } catch { continue; }
      if (!AFFILIATE.has(host) && !PLAIN_OK.has(host)) continue;
      storeList[slug] ??= { name: STORE_NAMES_1120[slug] ?? slug.slice(6), hosts: [] };
      if (!storeList[slug].hosts.includes(host)) storeList[slug].hosts = [...storeList[slug].hosts, host].sort();
      const list = pageList[slug] ?? [];
      if (list.some((p) => p.href === r.href || compact(p.name) === compact(r.name))) continue;
      pageList[slug] = [...list, { name: brandFirst(tidyName(r.name), r.brand), brand: String(r.brand ?? ""), line: /\$\s?\d/.test(String(r.why ?? "")) ? "" : String(r.why ?? ""), href: r.href, image: r.image, store: slug, commission: pct(r.commission), ...(r.type ? { type: String(r.type) } : {}) }];
      followUpCounts1120.storeFill += 1;
    }
    for (const slug of STORE_PAGES_KEPT) {
      if (!pageList[slug] || slug === "store-amazon") continue;
      pageList[slug] = pageList[slug].map((p, i) => ({ p, i })).sort((a, b) => (Number(b.p.commission) || 0) - (Number(a.p.commission) || 0) || a.i - b.i).slice(0, STORE_CAP).map((x) => x.p);
    }
  }
  // One Weber griddle: the best-paying one stays (a guide before a store page on a tie).
  const griddles = Object.entries(pageList).flatMap(([slug, l]) => l.filter((p) => /\bweber\b/i.test(`${p.brand ?? ""} ${p.name}`) && /\bgriddle\b/i.test(p.name)).map((p) => ({ slug, p })));
  const best = griddles.sort((a, b) => (Number(b.p.commission) || 0) - (Number(a.p.commission) || 0) || Number(a.slug.startsWith("store-")) - Number(b.slug.startsWith("store-")))[0];
  for (const { slug, p } of griddles) if (p !== best?.p) { pageList[slug] = pageList[slug].filter((x) => x !== p); followUpCounts1120.griddles += 1; }
  // Names: the audits' renames, then brand first.
  for (const slug of Object.keys(pageList)) {
    pageList[slug] = pageList[slug].map((p) => {
      let name = p.name;
      const r = AUDIT_1120.renames?.get(p.href);
      if (r) { const n = renameOf(r, name, p.brand); if (n && n !== name) { name = n; followUpCounts1120.renamed += 1; } }
      if (!p.sponsor && slug !== SPONSORS_GUIDE) { const n = brandFirst(name, p.brand); if (n !== name) { name = n; followUpCounts1120.brandFirst += 1; } }
      // A 25 Days sponsor's pick wears the sponsor badge wherever it shows (Dupuy's on Louisiana by Region).
      const sponsor = !slug.startsWith("store-") && !p.sponsor && isSponsorPick(p) ? { sponsor: true } : {};
      return name === p.name && !sponsor.sponsor ? p : { ...p, name, ...sponsor };
    });
  }
  console.log(`gift-guide-picks: follow-up 1120: ${followUpCounts1120.sponsors} sponsors on ${SHOP_SMALL} (${followUpCounts1120.namedOnly} named only), out ${JSON.stringify(followUpCounts1120.out)}, ${followUpCounts1120.griddles} extra Weber griddles out, ${followUpCounts1120.renamed} audit renames, ${followUpCounts1120.brandFirst} names brand first, ${sortCounts.followUpAdds ?? 0} earning adds placed in the pool, audits ${JSON.stringify(AUDIT_1120.followUp)}`);
}
/**
 * PRICE BACKFILL (train 1120c, owner 11-20 12:32 PM: "the guides also need to show prices"): several import paths (the
 * brand links, the Creator Connections / fill rows, the big batch rows) drop a row's file price, because a research
 * price is never shown unchecked. A price ~/Desktop/Link-library checked (price_currency, price_checked_at,
 * price_source on ANY row of ANY picks file with the same link) is a checked price: every shown non-Amazon pick without
 * one takes it here, under the same verifiedPrice rules (fresh, USD, never Amazon).
 */
const checkedPrices = (() => {
  const checked = new Map();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    let v;
    try { v = readJson(f); } catch { continue; /* mid-write: read on the next run */ }
    const walk = (o) => {
      if (Array.isArray(o)) { for (const x of o) walk(x); return; }
      if (!o || typeof o !== "object") return;
      if (o.price_checked_at && o.price_source) for (const k of ["href", "affiliate_href"]) if (typeof o[k] === "string" && !checked.has(o[k])) checked.set(o[k], o);
      for (const x of Object.values(o)) if (x && typeof x === "object") walk(x);
    };
    walk(v);
  }
  return checked;
})();
/**
 * PRICE CACHE (gg-live-1120, live check 11-20: Mom showed 11 non-Amazon picks with no price): a pick that came in
 * through an extras file (_later.json, a brand-links file, a fill row) or a train pass (the sponsors) has no row
 * fill_prices.py writes to, so the checked price it found sits only in ~/Desktop/Link-library/price-cache.json, keyed by
 * product URL (a short link's product URL under "short:<link>"; Chrome-read prices for bot-walled stores come in through
 * fill_prices.py --import-browser). That entry is a checked price too: same verifiedPrice rules (fresh, USD, never
 * Amazon), and gift cards are excluded (a chosen amount, as fill_prices.py skips them).
 */
const PRICE_CACHE = (() => { try { return deskJson(join(LIB, "price-cache.json")); } catch { return {}; /* no cache yet: file prices only */ } })();
const cachedPrice = (p) => {
  const product = PRICE_CACHE[`short:${p.href}`]?.final ?? p.href;
  const c = PRICE_CACHE[product];
  if (!c?.price || !c.checked_at || /gift-?card|e-?gift/i.test(product)) return undefined;
  let hosts;
  try { hosts = [new URL(p.href).hostname, new URL(product).hostname]; } catch { return undefined; /* no URL: no price */ }
  return verifiedPrice({ price: c.price, price_currency: c.currency, price_checked_at: c.checked_at, price_source: c.source_url || product }, hosts, p.store);
};
/** Every shown pick without a price takes a checked one: a picks-file row with its link first, then the price cache. */
const fillPrices = () => {
  const n = { rows: 0, cache: 0 };
  for (const slug of Object.keys(pageList)) {
    pageList[slug] = pageList[slug].map((p) => {
      if (p.price != null) return p;
      let priced;
      if (checkedPrices.has(p.href)) {
        let host = "";
        try { host = new URL(p.href).hostname; } catch { return p; /* no URL: no price */ }
        priced = verifiedPrice(checkedPrices.get(p.href), [host], p.store);
        if (priced) n.rows += 1;
      }
      if (!priced) { priced = cachedPrice(p); if (priced) n.cache += 1; }
      if (!priced) return p;
      return { ...p, ...priced, ...(p.band ? {} : { band: budgetBand(priced.price) }) };
    });
  }
  return n;
};
{
  const n = fillPrices();
  console.log(`gift-guide-picks: price backfill ${n.rows} picks from ${checkedPrices.size} checked rows, ${n.cache} from the price cache`);
}
/**
 * TRAIN 1120b (lead 44, 2026-11-20): the re-audit's fixes, the national 25 Days sponsors' one spot each, the Walmart
 * deals box cleanup and the Georgia Boot sale, applied last to the finished pages (scripts/giftGuideTrain1120b.mjs,
 * rules in scripts/gift-guide-train-1120b.json). A rule that finds nothing is printed, never dropped silently.
 */
{
  const spec = JSON.parse(readFileSync(new URL("./gift-guide-train-1120b.json", import.meta.url), "utf8"));
  const t = applyTrain1120b(pageList, deals, spec, { sponsorsGuide: SPONSORS_GUIDE, readJson, sales, storePages: [...STORE_PAGES_KEPT] });
  console.log(`gift-guide-picks: train 1120b ${JSON.stringify(t.counts)}${t.missing.length ? `; NOT FOUND (${t.missing.length}): ${t.missing.join(" | ")}` : ""}`);
}
/**
 * TRAIN 1120c (lead 44, 2026-11-20): the owner's adds, the unplaced Creator Connections campaigns, the XTRATUF XT25
 * code, the $500 cap and the store refills (scripts/giftGuideTrain1120c.mjs, rules in scripts/gift-guide-train-1120c.json).
 */
{
  const spec = JSON.parse(readFileSync(new URL("./gift-guide-train-1120c.json", import.meta.url), "utf8"));
  const t = applyTrain1120c(pageList, deals, spec, { sponsorsGuide: SPONSORS_GUIDE, readJson, sales, storePages: [...STORE_PAGES_KEPT] });
  console.log(`gift-guide-picks: train 1120c ${JSON.stringify(t.counts)}${t.missing.length ? `; NOT FOUND (${t.missing.length}): ${t.missing.join(" | ")}` : ""}`);
}
// The train passes add picks (sponsors, campaign adds) after the backfill: they take their checked prices here.
{
  const n = fillPrices();
  console.log(`gift-guide-picks: late price fill ${n.rows} from picks files, ${n.cache} from the price cache`);
}
// BUDGET CAPS (gg-live-1120): last, once every price is in (scripts/giftGuideBudgetCaps.mjs).
{
  const spec = JSON.parse(readFileSync(new URL("./gift-guide-budget-1120.json", import.meta.url), "utf8"));
  const t = applyBudgetCaps(pageList, spec);
  console.log(`gift-guide-picks: budget caps ${JSON.stringify(t.counts)}${t.missing.length ? `; NOT DONE (${t.missing.length}): ${t.missing.join(" | ")}` : ""}`);
}
/**
 * TRAIN 1120d (holiday design audit A, 11-20): type fixes, swaps, Splurge without its under-$100 section, the PAGE caps
 * (max 2 of a gift type per page, one of a brand's same type), thin sections folded into a sibling, then the late price
 * fill and the budget caps once more for anything it added (scripts/giftGuideTrain1120d.mjs, rules in
 * scripts/gift-guide-train-1120d.json). SECTION_ALIASES: a folded section's old id -> its new one, per guide.
 */
export const SECTION_ALIASES = {};
{
  const spec = JSON.parse(readFileSync(new URL("./gift-guide-train-1120d.json", import.meta.url), "utf8"));
  const t = applyTrain1120d(pageList, spec, { sponsorsGuide: SPONSORS_GUIDE, anchors: SECTION_ANCHORS, parentOf: (k) => MERGED_INTO[k]?.parent, fixedOrder: [...SORT_FIXED] });
  Object.assign(SECTION_ALIASES, t.aliases);
  console.log(`gift-guide-picks: train 1120d ${JSON.stringify(t.counts)}${t.missing.length ? `; NOT FOUND (${t.missing.length}): ${t.missing.join(" | ")}` : ""}`);
  const n = fillPrices();
  const b = applyBudgetCaps(pageList, {});
  console.log(`gift-guide-picks: 1120d late price fill ${n.rows + n.cache}, budget caps ${JSON.stringify(b.counts)}`);
}
/**
 * TOP 10 THIS WEEK (owner-approved 11-19 9:05 PM): the landing strip, ranked by go-link clicks over the last 7 days
 * (scripts/gift-guide-go-clicks.json, measured from prod analytics), then effective commission x item popularity, among
 * the picks the guides show now, with a product photo, one per brand. The owner's keep, the Ninja CREAMi, stays in it.
 * BALANCE (holiday audit A #8: 7 of 10 were women's beauty, 4 Amazon skincare in a row, nothing for men): at most
 * TOP10_BEAUTY_MAX beauty picks, at least TOP10_MEN_MIN from Dad/Him and TOP10_KIDS_MIN from Kids; the strip then reads
 * by the same score. The CREAMi takes its checked price like every pick.
 */
/** Top 10 balance (holiday audit A #8). */
export const TOP10_BEAUTY_MAX = 3;
export const TOP10_MEN_MIN = 2;
export const TOP10_KIDS_MIN = 1;
const TOP10_MEN_GUIDES = new Set(["dad", "him"]);
/** The beauty gift types (the import's `type`). */
export const TOP10_BEAUTY = /^(skincare|makeup|lip|fragrance|hair-care|haircare|hair-tool|hair-accessory|beauty-device|body-care|bath|nails|gift-set|lash|sleep-mask)$/;
export const weeklyTop = (() => {
  let goClicks = {};
  let goMap = {};
  try { goClicks = JSON.parse(readFileSync(new URL("./gift-guide-go-clicks.json", import.meta.url), "utf8")).clicks ?? {}; } catch { /* no record yet: commission x popularity alone */ }
  try { goMap = JSON.parse(readFileSync(new URL("../src/content/goLinks.json", import.meta.url), "utf8")); } catch { /* no go links: commission x popularity alone */ }
  const clicksOf = new Map();
  for (const [slug, n] of Object.entries(goClicks)) if (goMap[slug]?.url) clicksOf.set(goMap[slug].url, Number(n) || 0);
  const popOf = new Map(SORT_POOL.map((e) => [e.p.href, e.pop ?? 0]));
  const guideOf = new Map();
  const cands = Object.entries(pageList).filter(([slug]) => !slug.startsWith("store-") && slug !== SPONSORS_GUIDE).flatMap(([slug, list]) => list.map((p) => (guideOf.has(p) ? p : (guideOf.set(p, slug), p))))
    .filter((p) => p.image && looksLikeProduct(p));
  const score = (p) => (clicksOf.get(p.href) ?? 0) * 1000 + (typeof p.commission === "number" ? p.commission : 0) * (1 + (popOf.get(p.href) ?? 0) / 10);
  const keep = topPicks.filter((p) => /\bCREAMi\b/i.test(p.name)).slice(0, 1).map((p) => (p.price != null ? p : { ...p, ...(cachedPrice(p) ?? {}) }));
  const out = [...keep];
  const brands = new Set(keep.map((p) => compact(p.brand ?? "")));
  // A card's name: brand first, no trailing spec after a comma, at most 40 letters (else the next pick); no work gear
  // (the owner's 11-19 Top 10: holiday best-sellers, no career items).
  const cardName = (p) => {
    const base = p.name.split(",")[0].trim();
    return p.brand && !base.toLowerCase().startsWith(String(p.brand).toLowerCase()) && !/^(amazon|walmart|target|shopmy)/i.test(p.brand) ? `${p.brand} ${base}` : base;
  };
  const CAREER = /\b(nurs\w*|scrubs?|compression|dansko|bombas|clogs?|stethoscope|badge reel|teacher|shift)\b/i;
  const ranked = [...cands].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  const chosen = [];
  const ok = (p) => {
    const b = compact(p.brand ?? "");
    const name = cardName(p);
    return !(b && brands.has(b)) && !out.some((x) => x.href === p.href) && !chosen.some((x) => x.href === p.href) && name.length <= 40 && !CAREER.test(`${name} ${p.line ?? ""}`);
  };
  const beauty = (p) => TOP10_BEAUTY.test(p.type ?? "");
  const take = (p) => { brands.add(compact(p.brand ?? "")); chosen.push(p); };
  // The quotas first (men's, kids'), each its best-scoring picks; then the rest by score, beauty capped.
  for (const [want, n] of [[(p) => TOP10_MEN_GUIDES.has(guideOf.get(p)) && !beauty(p), TOP10_MEN_MIN], [(p) => guideOf.get(p) === "kids", TOP10_KIDS_MIN]]) {
    let got = 0;
    for (const p of ranked) { if (got >= n) break; if (want(p) && ok(p)) { take(p); got += 1; } }
  }
  for (const p of ranked) {
    if (out.length + chosen.length >= 10) break;
    if (!ok(p) || (beauty(p) && chosen.filter(beauty).length >= TOP10_BEAUTY_MAX)) continue;
    take(p);
  }
  for (const p of chosen.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))) {
    // Only what a Top 10 card shows (the rate, type and origin stay in the sort; members never read a commission).
    const { section: _s, sectionId: _i, commission: _c, type: _t, from: _f, swappedFrom: _sf, swappedFromPct: _sp, campaignEnds: _ce, fallback_href: _fh, switch_on: _so, band: _b, ...rest } = p;
    out.push({ ...rest, name: cardName(p) });
  }
  return out;
})();
rmSync(chunkDir, { recursive: true, force: true });
mkdirSync(chunkDir, { recursive: true });
const chunkSlugs = [...new Set([...Object.keys(pageList), ...Object.keys(deals).filter((s) => storeList[s])])].sort();
for (const slug of chunkSlugs) {
  writeFileSync(new URL(`${slug}.json`, chunkDir), `${JSON.stringify({ picks: pageList[slug] ?? [], ...(deals[slug]?.length ? { deals: deals[slug] } : {}) })}\n`);
}
writeFileSync(
  out,
  `/** GENERATED by scripts/gift-guide-picks.mjs from ~/Desktop/Gift-guide-picks (re-run it after any change there). Do not edit. */\n` +
    `export interface ResearchedPick { name: string; brand: string; line: string; href: string; image?: string; price?: number; priceAt?: string; store?: string; section?: string; louisianaFit?: true; trending?: true; shipsFast?: true; localPickup?: true; sponsor?: true; ownerPick?: true; commission?: number | null; type?: string; swappedFrom?: string; swappedFromPct?: number; campaignEnds?: string; fallback_href?: string; switch_on?: string; sectionId?: string; from?: string; band?: 25 | 50 | 100 | 500; preorder?: true; code?: string; codeEnds?: string; tiktok?: true }\n` +
    `export interface StoreDeal { title: string; href: string; ends?: string; items?: { name: string; href: string }[] }\n` +
    `export interface Sale { store: string; slug: string; offer: string; ends: string; href: string }\n` +
    `/** One guide's chunk (src/content/giftGuidePicks/<slug>.json): its final picks and, on a store page, its deal sections. */\n` +
    `export interface PickChunk { picks: ResearchedPick[]; deals?: StoreDeal[] }\n` +
    `/** Sponsors listed by name only on their guide (their pick is left out). */\n` +
    `export const NAME_ONLY_SPONSORS: Record<string, string[]> = ${JSON.stringify(Object.fromEntries(NAME_ONLY.map((x) => [x.guide, NAME_ONLY.filter((y) => y.guide === x.guide).map((y) => y.brand)])))};\n` +
    `/** Every store page (slug -> the name shown and the link hosts its picks use). */\n` +
    `export const RESEARCHED_STORES: Record<string, { name: string; hosts: string[] }> = ${JSON.stringify(storeList)};\n` +
    `/** The guides with a researched chunk: their list (and deals) come only from it. */\n` +    `/** How many picks each chunk holds (the By store row lists a store page from 4 picks; lead 2026-11-18). */\n` +
    `export const CHUNK_PICK_COUNTS: Record<string, number> = ${JSON.stringify(Object.fromEntries(chunkSlugs.map((x) => [x, pageList[x]?.length ?? 0])))};\n` +
    `export const CHUNK_SLUGS: readonly string[] = ${JSON.stringify(chunkSlugs)};\n` +
    `/** Old guide slug -> its section's id on its merged guide (1120 section groups; the redirects and age links read it). */\n` +
    `export const SECTION_ANCHORS: Record<string, string> = ${JSON.stringify(SECTION_ANCHORS)};\n` +
    `/** A folded section's old id -> its new one, per guide (train 1120d), so an old #section link still opens it ("" = the guide's top). */\n` +
    `export const SECTION_ALIASES: Record<string, Record<string, string>> = ${JSON.stringify(SECTION_ALIASES)};\n` +
    `/** How many picks each merged guide's section holds (1120: old slug -> count), so a link to an empty section is never drawn. */\n` +
    `export const SECTION_PICK_COUNTS: Record<string, number> = ${JSON.stringify(Object.fromEntries(Object.values(pageList).flat().filter((p) => p.sectionId && p.sectionId !== "top-picks").reduce((m, p) => m.set(p.sectionId, (m.get(p.sectionId) ?? 0) + 1), new Map())))};\n` +
    `/** Codes the researched deals name (the sidebar's Discount codes, after the owner's; each hidden after its end date). */\n` +
    `export const DEAL_CODES: { rank: number; store: string; code: string; offer: string; expires?: string }[] = ${JSON.stringify(dealCodes)};\n` +
    `/** The landing's "Top 10 This Week": go-link clicks first, then commission x popularity (scripts/gift-guide-picks.mjs weeklyTop). */\n` +
    `export const TOP_PICKS: ResearchedPick[] = ${JSON.stringify(weeklyTop)};\n` +
    `/** The sidebar's Sales (each hidden after its end date). */\n` +
    `export const SALES: Sale[] = ${JSON.stringify(sales)};\n` +
    `/** Each guide's chunk, fetched only when its page opens (Vite splits every file into its own chunk). */\n` +
    `export const PICK_CHUNKS = import.meta.glob<PickChunk>("./giftGuidePicks/*.json", { import: "default" });\n`,
);
/**
 * The guides search engines see (SEO): each with a chunk holding picks, minus the removed and folded guides
 * (giftGuideCatalog.ts) and store pages under STORE_ROW_MIN_PICKS. Each gets one name, unique across them:
 * "Gifts for Mom", "Gifts for girls, toddlers (ages 1–3)", "Walmart gift guide".
 */
const catalogSrc = readFileSync(new URL("../src/content/giftGuideCatalog.ts", import.meta.url), "utf8");
const removedGuides = [...(catalogSrc.match(/export const REMOVED_GUIDES = \[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const mergedGuides = [...(catalogSrc.match(/export const MERGED_GUIDES[^=]*= \{([^}]*)\}/)?.[1] ?? "").matchAll(/"([^"]+)": \[/g)].map((m) => m[1]);
/** A guide with fewer picks than this is hidden from rows, search and search engines (lead 11-19); giftGuideCatalog.ts. */
/** Hub guides (a parent of other guides) show while any child holds picks, whatever their own count. */
const HUB_SLUGS = new Set([...indexSrc.matchAll(/slug: "([^"]+)"[^}]*?parent: "([^"]+)"/g)]
  .filter((m) => (pageList[m[1]]?.length ?? 0) >= Number(catalogSrc.match(/export const GUIDE_MIN_PICKS = (\d+);/)?.[1] ?? 6)).map((m) => m[2]));
const GUIDE_MIN_PICKS = Number(catalogSrc.match(/export const GUIDE_MIN_PICKS = (\d+);/)?.[1] ?? 6);
const minStorePicks = Number(catalogSrc.match(/export const STORE_ROW_MIN_PICKS = (\d+);/)?.[1]);
if (!removedGuides.length || !mergedGuides.length || !minStorePicks) throw new Error("gift-guide-picks: could not read REMOVED_GUIDES / MERGED_GUIDES / STORE_ROW_MIN_PICKS");
const entryOf = (slug) => {
  const raw = indexSrc.match(new RegExp(`\\{[^{}]*slug: "${slug}"[^{}]*\\}`))?.[0];
  if (!raw) return null;
  const field = (k) => raw.match(new RegExp(`${k}: "([^"]*)"`))?.[1];
  return { title: field("title"), lead: field("lead") ?? "", age: field("age") };
};
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
const seo = {};
const usedNames = new Set();
for (const slug of chunkSlugs) {
  const n = pageList[slug]?.length ?? 0;
  if (n === 0 || (!slug.startsWith("store-") && n < GUIDE_MIN_PICKS && !HUB_SLUGS.has(slug)) || removedGuides.includes(slug) || mergedGuides.includes(slug) || (slug.startsWith("store-") && n < minStorePicks)) continue;
  const e = entryOf(slug) ?? { title: storeList[slug]?.name, lead: "shop", age: undefined };
  if (!e.title) continue;
  let named = /^gifts$/i.test(e.lead) ? `Gifts ${e.title.charAt(0).toLowerCase()}${e.title.slice(1)}` : /^gifts for\b/i.test(e.lead) || /\bgifts$/i.test(e.lead)
    ? (e.age ? `${cap(e.lead)}, ${e.title.toLowerCase()} (${e.age})` : /^gifts for$/i.test(e.lead) ? `Gifts for ${e.title}`
      // "Gifts for the Coffee Lover", never "Gifts for the: Coffee Lover" (batch 11-19: the og:title read "the: ...").
      : /^gifts for (the|a)$/i.test(e.lead) ? `${cap(e.lead)} ${e.title}` : `${cap(e.lead)}: ${e.title}`)
    : `${e.title} gift guide`;
  if (usedNames.has(named.toLowerCase())) named = `${named} (${slug.startsWith("store-") ? "store" : slug})`;
  usedNames.add(named.toLowerCase());
  seo[slug] = named;
}
writeFileSync(
  seoOut,
  `/** GENERATED by scripts/gift-guide-picks.mjs (the gift guides search engines see, and each one's name). Do not edit. */\n` +
    `export const GIFT_GUIDE_SEO = ${JSON.stringify(seo)};\n`,
);

// GIFT_SORT_REPORT=<file.md>: the owner's commission inventory, and the owner picks the sort left off every guide
// (logged, log_only, in _judgment-cuts-1119e-owner.json beside the picks; owner 11-19: "Log any cut owner picks").
if (process.env.GIFT_SORT_REPORT && SORT_CTX.rateData) {
  const { commissionInventory } = await import("./giftGuideSortReport.mjs");
  writeFileSync(process.env.GIFT_SORT_REPORT, commissionInventory({ pool: SORT_POOL, ranks: SORT_RANKS, ctx: SORT_CTX, counts: sortCounts, generatedAt: new Date().toISOString() }));
  const ownerLog = SORT_POOL.filter((e) => e.source === "owner pick" && !e.on.size).map((e) => {
    const judgedOn = [...e.guides].filter((s) => SORT_CTX.judged(s, e.p));
    return { log_only: true, guide: [...e.guides].join(", "), section: "list", item: e.p.name, href: e.p.href,
      why: judgedOn.length ? `judgment cut on ${judgedOn.join(", ")}` : `below the top ${GUIDE_CAP} by commission, or its type/brand cap was full, on ${[...e.guides].join(", ")}` };
  });
  writeFileSync(join(dir, "_judgment-cuts-1119e-owner.json"), `${JSON.stringify(ownerLog, null, 1)}\n`);
}
if (process.env.GIFT_PICKS_VERBOSE) console.error(`RELINK SKIPPED:\n${earnings.relinkSkipped.join("\n")}\nSWAP SKIPPED:\n${earnings.swapSkipped.join("\n")}`);
for (const { slug } of INDEX) {
  if (slug.startsWith("store-") || slug === SPONSORS_GUIDE || NOT_A_LIST.has(slug)) continue;
  const n = pageList[slug]?.length ?? 0;
  if (n < BELONG_SHORT) belong.short.push(`${slug}:${n}`);
}
console.log(`gift-guide-picks: ${pageRepeats} repeats removed from pages, ${dealRepeats} from deal items; ${Object.keys(guides).length} guides, ${Object.values(guides).flat().length} picks, ${chunkSlugs.length} chunks, ${Object.keys(storeList).length} store pages, ${sales.length} sales; ${hidden.length} hidden (GIFT_PICKS_VERBOSE=1 lists them); ${photoless} photo-less rows removed, ${MISSING_IMAGES.size} found photos read; ${suspectPhotos.images} shared photos on two products, ${suspectPhotos.cleared} rows cleared; ${rateSwitches.switched} links moved to a better-paying network; shopmy upgrades: ${shopmyUpgrades.rows} rows on ${shopmyUpgrades.links} links (${shopmyUpgrades.skipped} skipped); earnings: ${earnings.tailRemoved} tail misfits out, ${earnings.filler} filler replaced, ${earnings.swaps} swaps (${earnings.swapSkipped.length} skipped), ${earnings.relinks} relinks (${earnings.relinkSkipped.length} skipped), ${earnings.adds} adds, ${earnings.boots} boots; holistic: ${holistic.removed} out (${Object.entries(holistic.byRule).map(([k, n]) => `${k} ${n}`).join(", ")}), ${holistic.toppedUp} topped up${holistic.short.length ? `, short: ${holistic.short.join(" ")}` : ""}; store fills: ${fillCounts.noCommission} no-commission pins skipped, ${fillCounts.rows} rows, ${fillCounts.store} on store pages, ${fillCounts.guides} in guides${fillCounts.noStore.size ? `, no store page: ${[...fillCounts.noStore].join(" ")}` : ""}; non-US store links: ${NON_US_LINKS.size} (${nonUs.relinked} rows moved to a US link, ${nonUs.hidden} hidden); late fills: ${Object.entries(lateFillCounts).map(([f, c]) => `${f} ${c.rows} rows, ${c.added} placed`).join(", ")}; belong: ${belong.audit} audit removals, rules ${JSON.stringify(belong.rules)}, ${belong.wrap} non-wrap, ${belong.mail} over $20 or unpriced on Mail Carrier, ${belong.fills} fills added (${belong.fillSkipped} skipped), ${belong.lines} lines neutralized, ${soldout.swapped} sold-out links swapped; new approvals: ${newApprovals.rows} rows, ${newApprovals.placed} placed, ${newApprovals.skipped.length} skipped${newApprovals.skipped.length ? ` (${newApprovals.skipped.join("; ")})` : ""}, ${linkUpgrades.rows} rows on an upgraded link; links r3: ${linksR3.relinked} picks moved to a twin link, ${holistic.byRule["homepage link"] ?? 0} homepage links and ${Object.entries(holistic.byRule).filter(([k]) => k.startsWith("banned link")).reduce((n, [, v]) => n + v, 0)} banned links removed, ${linksR3.deals} deals and ${linksR3.dealItems} deal items dropped${linksR3.storesEmptied.length ? `, store pages emptied: ${linksR3.storesEmptied.join(" ")}` : ""}${belong.short.length ? `, under ${BELONG_SHORT}: ${belong.short.join(" ")}` : ""}`);

/**
 * FOLLOW-UP 1120 (lead 11-20): the owner's picks that show on no page, each with the rule that kept it off and a one-tap
 * suggestion, grouped by reason (true duplicates last, "already on the guides"). Written to the Desktop only when asked:
 *   with GIFT_OWNER_REPORT set to "1", the import writes ~/Desktop/Gift-guide-picks/_owner-picks-unplaced-1120.md (added 2026-11-20)
 */
if (process.env.GIFT_OWNER_REPORT === "1") {
  const shown = new Map();
  for (const [slug, list] of Object.entries(pageList)) for (const p of list) shown.set(p.href, [...(shown.get(p.href) ?? []), slug]);
  const label = (g) => (MERGED_INTO[g] ? `${MERGED_INTO[g].parent} (${g})` : g);
  const owner = (readJson("_owner-picks.json") ?? []).filter((r) => r && typeof r.href === "string" && typeof r.name === "string");
  const exc = (readJson("_owner-excludes.json") ?? []).map((x) => String(x?.match ?? "").toLowerCase()).filter(Boolean);
  const groups = new Map();
  const add = (group, line) => groups.set(group, [...(groups.get(group) ?? []), line]);
  let unplaced = 0;
  for (const r of owner) {
    if (shown.has(r.href)) continue;
    unplaced += 1;
    const item = `${r.name}${r.brand && !String(r.name).toLowerCase().includes(String(r.brand).toLowerCase()) ? ` (${r.brand})` : ""}`;
    const guidesNamed = (Array.isArray(r.guides) ? r.guides : []).map(label).join(", ") || "no guide named";
    const d = OWNER_DIAG_1120.get(r.href);
    const sorted = SORT_POOL.find((x) => x.p.href === r.href);
    if (!d && sorted?.on.size) {
      // Placed by the sort, then left out when its old guide joined a merged guide's section (the section's own caps).
      const g = [...sorted.on][0];
      const parent = MERGED_INTO[g]?.parent ?? g;
      const sec = (pageList[parent] ?? []).filter((x) => x.from === g || x.sectionId === SECTION_ANCHORS[g]);
      const run = (pageList[parent] ?? []).filter((x) => x.sectionId && x.sectionId === sec[0]?.sectionId);
      const sameBrand = run.filter((x) => x.ownerPick && compact(x.brand ?? "") === compact(sorted.p.brand ?? "")).map((x) => x.name);
      const why = sameBrand.length >= 2 ? `two of her ${sorted.p.brand} picks already in that section (${sameBrand.slice(0, 3).join("; ")})`
        : run.length >= SECTION_CAP ? `that section already holds ${SECTION_CAP} (her picks first, then ours by commission)` : `that section kept another row of the same item`;
      add("Left out when its section merged", `| ${item} | ${guidesNamed} | ${label(g)}: ${why} | swap for ${sameBrand[sameBrand.length - 1] ?? run[run.length - 1]?.name ?? "the lowest-paying pick"} in ${label(g)} |`);
      continue;
    }
    if (!d) {
      const img = String(r.image ?? "");
      if (!img.startsWith("https://") || /^https:\/\/production-shopmyshelf-[a-z]+\.s3[.-]/.test(img)) add("No product photo", `| ${item} | ${guidesNamed} | no photo on the row (no row ships without one) | add a product photo in ShopMy, then it places on the next run |`);
      else if (exc.some((m) => `${r.name} ${r.brand ?? ""}`.toLowerCase().includes(m))) add("On the exclude list", `| ${item} | ${guidesNamed} | on _owner-excludes.json | remove it from the exclude list to show it |`);
      else if (blockedBrand(r)) add("Blocked brand", `| ${item} | ${guidesNamed} | its brand is on the blocklist | none (blocked by the owner) |`);
      else add("Not imported", `| ${item} | ${guidesNamed} | the import held it before placing (its guide is gone, or its link is not an earning link on an allowed host) | re-add it on a current guide with an earning ShopMy or Amazon link |`);
      continue;
    }
    const first = d.reasons[0] ?? { guide: "", kind: "full", detail: "no guide named", holders: [] };
    const holders = (first.holders ?? []).slice(0, 4);
    const kind = d.reasons.every((x) => x.kind === "same item") ? "same item" : (d.reasons.find((x) => x.kind !== "same item") ?? first).kind;
    const why = d.reasons.map((x) => `${label(x.guide)}: ${x.detail}${x.holders?.length ? ` (${x.holders.slice(0, 4).join("; ")})` : ""}`).join(" · ");
    if (kind === "same item") {
      const where = [...new Set(d.reasons.flatMap((x) => x.holders ?? []))].map(label).join(", ");
      add("Already on the guides (true duplicates)", `| ${item} | ${guidesNamed} | ${why} | none: it is already on ${where || "another guide"} |`);
    } else if (kind === "type" || kind === "brand") {
      const x = d.reasons.find((y) => y.kind === kind);
      add(kind === "type" ? "Two of that gift type already on her guide" : "That brand already on her guide", `| ${item} | ${guidesNamed} | ${why} | swap for ${x.holders?.[x.holders.length - 1] ?? "one of them"} in ${label(x.guide)} (the picks holding it are hers, keeps or a joined Amazon campaign; ours were already bumped) |`);
    } else if (kind === "brand-hers") {
      add("Two of her picks of that brand already on that guide", `| ${item} | ${guidesNamed} | ${why} | swap for ${holders[holders.length - 1] ?? "one of them"} in ${label(first.guide)} |`);
    } else if (kind === "lsu" || kind === "lash" || kind === "vera bradley") {
      add("LSU / lash / Vera Bradley caps", `| ${item} | ${guidesNamed} | ${why} | swap for ${holders[holders.length - 1] ?? "the one there"} in ${label(first.guide)} |`);
    } else if (kind === "rule") {
      add("A page rule keeps it off that guide", `| ${item} | ${guidesNamed} | ${why} | move it to a guide where it fits, or say "keep it" and it is placed as a must-have |`);
    } else {
      add("Guide or section full", `| ${item} | ${guidesNamed} | ${why} | say "must-have" and it bumps the lowest-paying pick there |`);
    }
  }
  const order = [...groups.keys()].sort((a, b) => Number(a.startsWith("Already")) - Number(b.startsWith("Already")));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const lines = [`# Owner picks not on the guides (${today})`, "",
    `${owner.length} picks in _owner-picks.json; ${owner.length - unplaced} show on a page, ${unplaced} do not. Each row: the item, the guides she named, the rule that kept it off (the picks holding the place), and a one-tap suggestion. Generated by scripts/gift-guide-picks.mjs (GIFT_OWNER_REPORT=1).`, ""];
  for (const g of order) lines.push(`## ${g} (${groups.get(g).length})`, "", "| Item | Her guides | Why it is not shown | Suggestion |", "|---|---|---|---|", ...groups.get(g), "");
  writeFileSync(join(dir, "_owner-picks-unplaced-1120.md"), `${lines.join("\n")}\n`);
  console.log(`gift-guide-picks: owner picks ${owner.length - unplaced} of ${owner.length} shown; ${unplaced} listed in _owner-picks-unplaced-1120.md; ${sortCounts.ownerBumped?.length ?? 0} of ours bumped for hers`);
}
