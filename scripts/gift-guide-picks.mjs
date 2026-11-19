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
import { BRAND_CASE, NOT_LOUISIANA_BUSINESS, brokenImage, fitsGuide, isLouisianaItem, productName, tidyName } from "./giftGuideRules.mjs";

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
/** A TIFF photo, unless the server converts it (KitchenAid's ".tif?fmt=png" is served as a PNG, ShopMy's mirror as JPEG). */
// ShopMy's static.shopmy.us mirror sends JPEG bytes under a ".tif" name (checked 11-18 PM: a 600x600 baseline JPEG).
const isTiff = (u) => /\.tiff?(\?|#|$)/i.test(u) && !/[?&]fmt=(png|jpe?g|webp)\b/i.test(u) && !/^https:\/\/static\.shopmy\.us\//.test(u);
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
  const rawName = RENAMED[p.href] ?? RENAMED[p.affiliate_href] ?? (LOUISIANA.has(host) || SPONSORS.has(host) ? p.name : productName(p.name, [p.brand, typeof p.store === "string" ? cleanName(p.store) : "", p.retailer, store && stores.get(store)?.name], domainCore(host)));
  const name = rawName && tidyName(rawName);
  if (!name) return hidden.push(`${where}: "${p.name}" is a page title, store name or promo, not a product`), null;
  if (store) stores.get(store).hosts.add(host);
  const flags = Object.fromEntries(["trending", "shipsFast", "localPickup"].filter((k) => p[k] === true).map((k) => [k, true]));
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
    || (byName && brandInSource(p.brand, byName.from) ? byName.image : undefined) || undefined;
  // The owner approved Amazon product images for these (11-18 PM): the CDN photo, on an Amazon link only (Associates).
  const amazonFound = Boolean(found) && AMAZON_IMAGE_HOST.test(new URL(found).hostname);
  const image = ownImage ?? (found && found.startsWith("https://") && !brokenImage(found) && !isTiff(found)
    && (!amazonFound || (new URL(found).hostname === "m.media-amazon.com" && (AMAZON.has(host) || AMAZON.has(plainHost)))) ? found : undefined);
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
      if (OTHER_RETAILER.test(p.image) || /\b(printfresh|loft)\.com\b/i.test(p.note ?? "")) continue;
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
  if (MOVED_TO_LOUISIANA.includes(slug) || !Array.isArray(a?.final_top25) || !a.final_top25.length) continue;
  FEATURED[slug] = a.final_top25.filter((n) => typeof n === "string");
}
/** The Louisiana section's guides (giftGuideIndex.ts group "Louisiana"): the only guides that hold Louisiana items. */
const LOUISIANA_GUIDES = new Set([...indexSrc.matchAll(/group: "Louisiana"[^}]*?slug: "([^"]+)"/g)].map((m) => m[1]));
const LA_HOSTS = new Set([...LOUISIANA, ...SPONSORS]);
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
  subscriptions: ["Walmart+ membership", "Gift Prime (3-month gift membership)", "Gift an Audible membership (1, 3, 6 or 12 months)",
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
    const image = typeof r.image === "string" && r.image.startsWith("https://") && !isTiff(r.image) && !brokenImage(r.image)
      && !/^https:\/\/production-shopmyshelf-[a-z]+\.s3[.-]/.test(r.image) ? r.image : undefined;
    if (!image) { shopmyUpgrades.skipped += 1; continue; }
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
    shopmyUpgrades.rows += 1;
    const { price: _p, priceAt: _a, ...rest } = p;
    if (u.store) stores.get(u.store).hosts.add(u.host);
    return { ...rest, href: u.href, image: u.image, store: u.store ?? (rest.store === "store-amazon" ? undefined : rest.store) };
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
 * 2. FILLER (GUIDE_FILLER): Her/Mom filler the trending list put in a hobby guide's top 25 is replaced by fitting picks
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
  "fish-lover": { out: ["UGG Women's Disquette", "Sol de Janeiro Perfume Cheirosa 62 Perfume Eau de Parfum", "Theragun Mini", "LANEIGE Lip Sleeping Mask", "e.l.f. Glow Reviver Lip Oil"],
    from: ["fishermen", "commercial-fishermen-and-shrimpers", "boater", "store-simms-fishing"], fits: /\b(fish\w*|rods?|reels?|tackle|lures?|angl\w+|casting|pliers|waders?|bait|simms|penn|kastking|plano|bobbers?|hooks?)\b/i },
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
  pageList[slug] = out.length >= TOP_GIFTS ? [...out.slice(0, TOP_GIFTS), ...held, ...out.slice(TOP_GIFTS)] : [...out, ...held];
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

if (process.env.GIFT_PICKS_VERBOSE) console.error(`RELINK SKIPPED:\n${earnings.relinkSkipped.join("\n")}\nSWAP SKIPPED:\n${earnings.swapSkipped.join("\n")}`);
console.log(`gift-guide-picks: ${pageRepeats} repeats removed from pages, ${dealRepeats} from deal items; ${Object.keys(guides).length} guides, ${Object.values(guides).flat().length} picks, ${chunkSlugs.length} chunks, ${Object.keys(storeList).length} store pages, ${sales.length} sales; ${hidden.length} hidden (GIFT_PICKS_VERBOSE=1 lists them); ${photoless} photo-less rows removed, ${MISSING_IMAGES.size} found photos read; ${suspectPhotos.images} shared photos on two products, ${suspectPhotos.cleared} rows cleared; ${rateSwitches.switched} links moved to a better-paying network; shopmy upgrades: ${shopmyUpgrades.rows} rows on ${shopmyUpgrades.links} links (${shopmyUpgrades.skipped} skipped); earnings: ${earnings.tailRemoved} tail misfits out, ${earnings.filler} filler replaced, ${earnings.swaps} swaps (${earnings.swapSkipped.length} skipped), ${earnings.relinks} relinks (${earnings.relinkSkipped.length} skipped), ${earnings.adds} adds, ${earnings.boots} boots; store fills: ${fillCounts.noCommission} no-commission pins skipped, ${fillCounts.rows} rows, ${fillCounts.store} on store pages, ${fillCounts.guides} in guides${fillCounts.noStore.size ? `, no store page: ${[...fillCounts.noStore].join(" ")}` : ""}`);
