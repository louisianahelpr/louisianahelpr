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
import { verifiedPrice } from "./giftGuidePrice.mjs";
import { BRAND_CASE, NOT_LOUISIANA_BUSINESS, brokenImage, fitsGuide, productName, tidyName } from "./giftGuideRules.mjs";

const dir = process.argv[2] ?? join(homedir(), "Desktop", "Gift-guide-picks");
const out = new URL("../src/content/giftGuidePicks.ts", import.meta.url);
/** One lazy chunk per guide (PERF, follow-up 11-18: the single file grew to ~245 KB gz; the index page loads none). */
const chunkDir = new URL("../src/content/giftGuidePicks/", import.meta.url);
/** The indexed guides' names (SEO, follow-up 11-18): read by the sitemap, the server head (api/share.ts) and the page. */
const seoOut = new URL("../src/content/giftGuideSeo.mjs", import.meta.url);
const content = readFileSync(new URL("../src/content/giftGuides.ts", import.meta.url), "utf8");
const indexSrc = readFileSync(new URL("../src/content/giftGuideIndex.ts", import.meta.url), "utf8");
const listed = (name) => [...(content.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`))?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const AMAZON = new Set(["www.amazon.com", "amazon.com", "amzn.to"]);
const LOUISIANA = new Set(listed("LOUISIANA_SHOPS"));
const SPONSORS = new Set(listed("SPONSOR_SITES"));
const BRANDS = new Set(listed("BRAND_SITES"));
/** Hosts a plain (non-affiliate) link may use. */
const PLAIN_OK = new Set([...AMAZON, "shopmy.us", ...LOUISIANA, ...SPONSORS, ...BRANDS]);
const AFFILIATE = new Set([...listed("AFFILIATE_HOSTS"), ...AMAZON, "shopmy.us"]);

const readJson = (f) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), "utf8")) : null);
/** A list file: a plain array, or a research file still in progress ({ _progress, links: [...] }). */
const readList = (f) => {
  const v = readJson(f);
  return Array.isArray(v) ? v : Array.isArray(v?.links) ? v.links : [];
};

/** The guide slugs and store-page titles on the owner's list (giftGuideIndex.ts). */
const INDEX = [...indexSrc.matchAll(/slug: "([^"]+)", title: "([^"]+)"/g)].map((m) => ({ slug: m[1], title: m[2] }));
const GUIDE_SLUGS = new Set(INDEX.map((g) => g.slug));
const compact = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const STORE_BY_COMPACT = new Map(INDEX.filter((g) => g.slug.startsWith("store-")).flatMap((g) => [[compact(g.title), g], [compact(g.slug.slice(6)), g]]));
const slugify = (s) => s.toLowerCase().replace(/&/g, "and").replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const cleanName = (s) => s.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+(US|USA)$/, "").replace(/\s+Affiliate Program$/i, "").trim();
const domainCore = (d) => d.replace(/^(www|shop|us)\./, "").replace(/\.(com|us|co|net|org)(\.[a-z]+)?$/, "");

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
    return JSON.parse(readFileSync(join(LIB, f), "utf8"));
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
function toPick(p, where) {
  if (blockedBrand(p)) return hidden.push(`${where}: ${p.name} is a blocked brand`), null;
  const fixed = withAmazonFixes(p);
  // A swap is a different product: the blocklist reads it too.
  if (fixed !== p && blockedBrand(fixed)) return hidden.push(`${where}: ${fixed.name} (swap) is a blocked brand`), null;
  p = fixed;
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
  const rawName = LOUISIANA.has(host) || SPONSORS.has(host) ? p.name : productName(p.name, [p.brand, typeof p.store === "string" ? cleanName(p.store) : "", p.retailer, store && stores.get(store)?.name], domainCore(host));
  const name = rawName && tidyName(rawName);
  if (!name) return hidden.push(`${where}: "${p.name}" is a page title, store name or promo, not a product`), null;
  if (store) stores.get(store).hosts.add(host);
  const flags = Object.fromEntries(["trending", "shipsFast", "localPickup"].filter((k) => p[k] === true).map((k) => [k, true]));
  // No Amazon-hosted product photo is hotlinked (Associates rules: Amazon images only through SiteStripe or its API);
  // those picks get the store tile on the page. AMAZON_CDN_PHOTOS lets the SiteStripe-tagged ones through.
  const amazonHosted = typeof p.image === "string" && p.image.startsWith("https://") && AMAZON_IMAGE_HOST.test(new URL(p.image).hostname);
  // A TIFF photo shows blank in every browser (affiliate sweep 11-18: 279 ShopMy "_fpx.tif" images): dropped, so the
  // pick is swapped for a photo'd one in a mixed guide or draws its store tile.
  const tiff = typeof p.image === "string" && /\.tiff?(\?|#|$)/i.test(p.image);
  // ShopMy's own S3 photos answer 403 AccessDenied (all 639 distinct URLs, curl 11-18 PM): dropped like the TIFFs, so
  // mixed guides swap in photo'd picks and no row makes a failed request.
  const deadHost = typeof p.image === "string" && /^https:\/\/production-shopmyshelf-[a-z]+\.s3[.-]/.test(p.image);
  const image = !tiff && !deadHost && !(typeof p.image === "string" && brokenImage(p.image)) && typeof p.image === "string" && p.image.startsWith("https://") && (!amazonHosted || (AMAZON_CDN_PHOTOS && p.image_source === "amazon-sitestripe" && new URL(p.image).hostname === "m.media-amazon.com")) ? p.image : undefined;
  // PRICES (owner 11-18): only a checked, fresh, non-Amazon price (scripts/giftGuidePrice.mjs).
  const priced = verifiedPrice(p, [host, plainHost], store);
  const brand = BRAND_CASE[compact(p.brand ?? "")] ?? p.brand ?? "";
  const louisianaFit = p.louisianaFit && ![p.brand, p.store, p.retailer].some((x) => typeof x === "string" && NOT_LOUISIANA_BUSINESS.test(x.trim()));
  return {
    name, brand, line: stockLine(p.line) ? "" : (p.line ?? ""), href,
    ...(image ? { image } : {}), ...(priced ?? {}), ...(store ? { store } : {}), ...(louisianaFit ? { louisianaFit: true } : {}), ...flags,
  };
}

/** The 25 Days sponsors guide: every pick there is a sponsor's (lead 2026-11-18: each gets the sponsor badge). */
export const SPONSORS_GUIDE = "25-days-sponsors";
/** Picks left out by the lead, by guide and brand, the brand kept by name only (Hilma's probiotic, a health product). */
export const NAME_ONLY = [{ guide: SPONSORS_GUIDE, brand: "Hilma" }];
const nameOnly = (slug, p) => NAME_ONLY.some((x) => x.guide === slug && x.brand === p.brand);

/** Near-duplicate variants (design audit r2 #7: "…Coffee Pods, 12 Boxes" and "…Coffee Pods"): same brand, same first 24 letters. */
const variantKey = (p) => `${compact(p.brand ?? "")} ${compact(p.name).slice(0, 24)}`;
const guides = {};
const add = (slug, raw, where) => {
  const p = toPick(raw, where);
  if (!p) return;
  if (!fitsGuide(slug, p)) return hidden.push(`${where}: ${p.name} does not fit ${slug}`);
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
  for (const p of JSON.parse(readFileSync(join(dir, file), "utf8"))) if (!nameOnly(slug, p)) add(slug, p, file);
}
/** Extras that name their guides (`fits`); each also lands on its store page. */
for (const f of ["_awin.json", "_cj.json", "_impact.json", "_shopify-collabs.json", "_later.json", "_later-mylinks.json", "_later-brands.json"]) {
  for (const p of readList(f)) for (const slug of p.fits ?? []) if (GUIDE_SLUGS.has(slug)) add(slug, p, f);
}
/** Store extras: the store page, and for Warby Parker the guides the owner named (11-18). */
const WARBY_GUIDES = ["her", "him", "coworkers", "rns", "girls-teens", "boys-teens"];
const storeExtras = [["_xtratuf.json", []], ["_warby-parker.json", WARBY_GUIDES], ["_walmart.json", []], ["_tiktok-shop.json", []], ["_amazon-trending.json", []], ["_later.json", []], ["_awin.json", []], ["_cj.json", []], ["_impact.json", []], ["_shopify-collabs.json", []], ["_later-mylinks.json", []], ["_later-brands.json", []]];
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
/**
 * FEATURED ORDER (owner 11-18 PM: "This can't possibly be the top gifts you're recommending"): _featured-order.json,
 * { "<slug>": [pick names or { name, from }, up to 25], "top-10": [{ guide, name }] }, from bestseller research over existing picks only.
 * A guide's featured picks lead in that order, then the rest by the photos-first order above. Optional file.
 */
const FEATURED = (() => {
  const v = readJson("_featured-order.json");
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
})();
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
  subscriptions: ["Walmart+ membership", "Gift Prime (3-month gift membership)", "Gift an Audible membership (1, 3, 6 or 12 months)",
    "Gift Kindle Unlimited (6, 12 or 24 months)", "Audible Premium Plus annual membership"],
};
const featuredEntries = (slug) => [...(PINNED_TOP[slug] ?? []), ...(Array.isArray(FEATURED[slug]) ? FEATURED[slug] : [])]
  .filter((x) => typeof x === "string" || (x && typeof x === "object" && typeof x.name === "string"));
const featuredNames = (slug) => featuredEntries(slug).map((x) => (typeof x === "string" ? x : x.name));
const resolveFeatured = (slug, list, e) => {
  if (typeof e === "string") return findByName(list, e);
  const own = findByName(list, e.name);
  if (own) return own;
  const from = typeof e.from === "string" && e.from !== slug ? guides[e.from] : undefined;
  const p = from ? findByName(from, e.name) : undefined;
  return p && fitsGuide(slug, p) ? p : undefined;
};
const featuredFirst = (slug, list) => {
  const lead = featuredEntries(slug).map((e) => resolveFeatured(slug, list, e)).filter(Boolean);
  const ordered = [...new Set([...lead, ...list])];
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
  return [...head, ...later.sort((a, b) => ordered.indexOf(a) - ordered.indexOf(b))];
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
for (const slug of Object.keys(guides)) guides[slug] = featuredFirst(slug, withTrending(slug, guides[slug]));

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

/** Each store page's live deal sections (title, affiliate link, end date, items for Walmart's collections). */
const deals = {};
const addDeal = (slug, d) => {
  if (blockedBrand(d) || (stores.get(slug) && blockedBrand({ store: stores.get(slug).name }))) return hidden.push(`deal ${slug}: ${d.title} is a blocked brand`);
  if (!okLink(d.href) || !noPrice(d.title)) return hidden.push(`deal ${slug}: ${d.title} (no affiliate link or a price)`);
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
for (const f of ["_later-deals.json", "_later-promos.json"]) {
  for (const d of readList(f)) {
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
const everyPick = [...sortedGuides.flatMap(([, l]) => l), ...swappedOut];
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
  if (firstWins.length) pageList[slug] = [...firstWins.filter((p) => p.image), ...firstWins.filter((p) => !p.image)];
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
    // A ShopMy collection link is shared by several products: those match by name only.
    const shared = new URL(p.href).hostname === "shopmy.us";
    const at = (!shared && seenHref.has(p.href) ? seenHref.get(p.href) : undefined) ?? (key.length > 3 ? seenKey.get(key) : undefined);
    if (at !== undefined) {
      repeatsRemoved += 1;
      if (process.env.GIFT_PICKS_VERBOSE) console.error(`REPEAT: "${p.name}" = "${out[at].name}"`);
      if (!out[at].image && p.image) out[at] = p;
      continue;
    }
    if (!shared) seenHref.set(p.href, out.length);
    if (key.length > 3) seenKey.set(key, out.length);
    out.push(p);
  }
  return out;
};
for (const slug of Object.keys(pageList)) pageList[slug] = noRepeats(pageList[slug]);
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
  .map((x) => findByName(pageList[x?.guide] ?? guides[x?.guide] ?? [], String(x?.name ?? "")))
  .filter(Boolean);
const topPicks = noRepeats([...featuredTop, ...lovedTop]).slice(0, 10);
rmSync(chunkDir, { recursive: true, force: true });
mkdirSync(chunkDir, { recursive: true });
const chunkSlugs = [...new Set([...Object.keys(pageList), ...Object.keys(deals).filter((s) => storeList[s])])].sort();
for (const slug of chunkSlugs) {
  writeFileSync(new URL(`${slug}.json`, chunkDir), `${JSON.stringify({ picks: pageList[slug] ?? [], ...(deals[slug]?.length ? { deals: deals[slug] } : {}) })}\n`);
}
writeFileSync(
  out,
  `/** GENERATED by scripts/gift-guide-picks.mjs from ~/Desktop/Gift-guide-picks (re-run it after any change there). Do not edit. */\n` +
    `export interface ResearchedPick { name: string; brand: string; line: string; href: string; image?: string; price?: number; priceAt?: string; store?: string; section?: string; louisianaFit?: true; trending?: true; shipsFast?: true; localPickup?: true; sponsor?: true }\n` +
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
    `/** Codes the researched deals name (the sidebar's Discount codes, after the owner's; each hidden after its end date). */\n` +
    `export const DEAL_CODES: { rank: number; store: string; code: string; offer: string; expires?: string }[] = ${JSON.stringify(dealCodes)};\n` +
    `/** The landing's "Top 10 most-loved" row: the picks the most guides list, photos first. */\n` +
    `export const TOP_PICKS: ResearchedPick[] = ${JSON.stringify(topPicks)};\n` +
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
  if (n === 0 || removedGuides.includes(slug) || mergedGuides.includes(slug) || (slug.startsWith("store-") && n < minStorePicks)) continue;
  const e = entryOf(slug) ?? { title: storeList[slug]?.name, lead: "shop", age: undefined };
  if (!e.title) continue;
  let named = /^gifts$/i.test(e.lead) ? `Gifts ${e.title.charAt(0).toLowerCase()}${e.title.slice(1)}` : /^gifts for\b/i.test(e.lead) || /\bgifts$/i.test(e.lead)
    ? (e.age ? `${cap(e.lead)}, ${e.title.toLowerCase()} (${e.age})` : /^gifts for$/i.test(e.lead) ? `Gifts for ${e.title}` : `${cap(e.lead)}: ${e.title}`)
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

console.log(`gift-guide-picks: ${pageRepeats} repeats removed from pages, ${dealRepeats} from deal items; ${Object.keys(guides).length} guides, ${Object.values(guides).flat().length} picks, ${chunkSlugs.length} chunks, ${Object.keys(storeList).length} store pages, ${sales.length} sales; ${hidden.length} hidden (GIFT_PICKS_VERBOSE=1 lists them)`);
