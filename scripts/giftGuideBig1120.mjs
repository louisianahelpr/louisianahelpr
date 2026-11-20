/**
 * BIG BATCH 1120 (owner 2026-11-19 ~10 PM: "batch everything in 1 big batch"): the rows scripts/gift-guide-picks.mjs
 * imports on top of the 1119e sort, read from ~/Desktop/Gift-guide-picks:
 *   - _thin-fill-1119.json (the thin-guide fill, parts 1 and 2) and _southern-picks-1119.json (the owner's Southern,
 *     preppy and TikTok picks, incl. her 11-19 PM ShopMy links);
 *   - _owner-swaps-1119.md: each swap's new item is placed on its guide (forced, like an editor's add) and each
 *     swap_out line becomes a judgment cut on that guide;
 *   - scripts/gift-guide-cc-placements-1120.json (in the repo): the best 1-3 products of each joined Creator Connections
 *     campaign the 1119e placements left out (17 campaigns with product data; 13 joined campaigns list no product titles
 *     or photos in _amazon-cc-campaigns-1119.json, so nothing of theirs can be placed yet).
 * Rules applied here, before the import's own gates (owner 11-19 PM):
 *   - the same item in the same color in ONE place: a thin-fill row and a Southern row of the same product and color
 *     (Johnnie-O Sully, Autry Medalist, Duck Camp Mallard hat, Barbour Finn, Turtlebox Ranger) keep the higher
 *     commission, else the thin-fill one; a different color stays;
 *   - no Dr. Woof (0%, Australian); the old Ember Mug 2 is out; a 0% link never shows (owner TikTok picks only when we earn);
 *   - a row the owner found on TikTok (or a viral item) carries `tiktok` ("Trending on TikTok"); 21 Collective rows carry `preorder` (they
 *     ship up to 5 weeks) and its code COLLECTIVE10.
 * Guard: src/test/giftGuideMerges1120.test.ts.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const compact = (s) => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

/** Words that never tell two products apart ("Men's", "Quarter" in "Quarter Zip" = "1/4 Zip"). */
const STOPWORDS = new Set(["men", "mens", "women", "womens", "the", "quarter", "1", "4", "x"]);
/** A name's words after the brand and the color part ("Johnnie-O Sully 1/4 Zip Pullover" -> sully, zip, pullover). */
const nameWordsOf = (r) => {
  const b = compact(r.brand);
  const words = String(r.name ?? "").split(",")[0].toLowerCase().replace(/['’]s\b/g, "s").split(/[^a-z0-9]+/).filter((w) => w && !STOPWORDS.has(w));
  return new Set(words.filter((w, i) => !(b && b.includes(w) && i < 3)));
};
/**
 * The same product: the same brand, and the shorter name's words (two or more) all in the longer one ("Autry Medalist
 * Low Sneakers" = "Autry Men's Medalist Low Leather Sneakers"; a Mallard tumbler is not the Mallard can cooler).
 */
export const sameProduct = (a, b) => {
  if (compact(a.brand) !== compact(b.brand) || !compact(a.brand)) return false;
  const [x, y] = [nameWordsOf(a), nameWordsOf(b)].sort((p, q) => p.size - q.size);
  return x.size >= 2 && [...x].every((w) => y.has(w));
};
/** Its color: the row's `color`, else the name's last comma part ("Scrub Top, Navy"); "" when unknown. */
export const colorOf = (r) => {
  if (r.color && !/as pictured/i.test(r.color)) return compact(r.color);
  const parts = String(r.name ?? "").split(",");
  return parts.length > 1 ? compact(parts[parts.length - 1]) : "";
};

/** Rows that never show (owner 11-19 PM). */
export const BIG1120_DROP = [/\bdr\.? woof\b/i, /\bember mug 2\b/i];
/** The pre-order brands (FOLLOWUP item 70: 21 Collective mocknecks ship up to 5 weeks). */
export const PREORDER_BRANDS = ["21 Collective"];
/** Discount codes shown on a brand's cards (FOLLOWUP item 89: 21 Collective, COLLECTIVE10, 10% off). */
export const BRAND_CODES = { "21 Collective": { code: "COLLECTIVE10", offer: "10% off" } };
/** Names that read the same for two different products, made specific (both placed by title only; photos checked 11-20). */
export const RENAME_1120 = { "https://go.shopmy.us/p-108116720": "Maisonette Girl Mom Bracelet", "https://go.shopmy.us/p-108116454": "Maisonette Boy Mom Bracelet" };

/** The swaps file: [{ guide, remove, add }] and its swap_out list. */
export const parseSwaps = (text) => {
  const swaps = [];
  for (const m of String(text ?? "").matchAll(/^- ([a-z0-9-]+) \| REMOVE (.+?) \| ADD (.+?) \|/gm)) swaps.push({ guide: m[1], remove: m[2].trim(), add: m[3].trim() });
  const out = [];
  const tail = String(text ?? "").split(/^## swap_out\s*$/m)[1] ?? "";
  for (const m of tail.split(/^## /m)[0].matchAll(/^- ([a-z0-9-]+): (.+)$/gm)) out.push({ guide: m[1], item: m[2].trim() });
  return { swaps, out };
};

/** The repo's placements for the joined campaigns the 1119e file left out. */
export const CC_1120 = "gift-guide-cc-placements-1120.json";

/** Each row to import, in file order, with `_file`, `_source` and (a swap's new item) `_forced`. */
export function importRows1120(readJson, rowsOf, dir) {
  const swapsText = dir && existsSync(join(dir, "_owner-swaps-1119.md")) ? readFileSync(join(dir, "_owner-swaps-1119.md"), "utf8") : "";
  const { swaps } = parseSwaps(swapsText);
  const forced = new Set(swaps.map((s) => `${s.guide}|${compact(s.add)}`));
  const files = [["_thin-fill-1119.json", "fill"], ["_southern-picks-1119.json", "owner pick"], [CC_1120, "creator connections"]];
  const rows = [];
  for (const [file, source] of files) {
    let v = null;
    try { v = file === CC_1120 ? JSON.parse(readFileSync(new URL(`./${CC_1120}`, import.meta.url), "utf8")) : readJson(file); } catch { continue; /* mid-write: read on the next run */ }
    for (const r0 of rowsOf(v)) {
      if (!r0 || typeof r0.name !== "string") continue;
      const href = r0.asin ? `https://www.amazon.com/dp/${r0.asin}?tag=louisianahelpr-20` : r0.affiliate_href || r0.href;
      if (typeof href !== "string" || BIG1120_DROP.some((re) => re.test(`${r0.brand ?? ""} ${r0.name}`))) continue;
      // Owner 8:35 PM: a pick only where we earn. A plain 0% link (21 Collective, Dr. Woof) never shows.
      if (r0.commission === 0 && !/^https:\/\/(www\.)?amazon\.com\//.test(href)) continue;
      const brand = String(r0.brand ?? "");
      const r = {
        ...r0, href, name: RENAME_1120[href] ?? r0.name, line: r0.line ?? "", _file: file, _source: source,
        // "Trending on TikTok" (owner-approved 9:05 PM): the owner's TikTok finds and the viral items.
        ...(/tiktok|viral/i.test(String(r0.why ?? "")) || r0.tiktok === true ? { tiktok: true } : {}),
        ...(r0.trending === true ? { trending: true } : {}),
        ...(PREORDER_BRANDS.includes(brand) ? { preorder: true } : {}),
        ...(BRAND_CODES[brand] ? { code: BRAND_CODES[brand].code } : {}),
        ...([r0.guide, ...(Array.isArray(r0.guides) ? r0.guides : [])].some((g) => forced.has(`${g}|${compact(r0.name)}`)) ? { _forced: true } : {}),
      };
      // The price is never shown unchecked (scripts/giftGuidePrice.mjs); the import keeps only its budget band.
      if (typeof r0.price === "string" || typeof r0.price === "number") r.raw_price = r0.price;
      delete r.price;
      rows.push(r);
    }
  }
  // One place per product and color: the higher commission wins, a tie keeps the earlier file (the thin fill). A row with
  // no known color is the same item as any color of its product.
  // Rows are compared within their brand only (a few hundred rows, a few per brand).
  const byBrand = new Map();
  rows.forEach((r, i) => { const b = compact(r.brand); byBrand.set(b, [...(byBrand.get(b) ?? []), { r, i }]); });
  const winners = new Set();
  for (const list of byBrand.values()) {
    const kept = [];
    for (const { r } of [...list].sort((x, y) => (Number(y.r.commission) || 0) - (Number(x.r.commission) || 0) || x.i - y.i)) {
      if (kept.some((k) => sameProduct(k, r) && (!colorOf(k) || !colorOf(r) || colorOf(k) === colorOf(r)))) continue;
      kept.push(r);
      winners.add(r);
    }
  }
  return rows.filter((r) => winners.has(r));
}

/**
 * Cuts the 1120 batch makes itself (FOLLOWUP item 67): Red Lover's "Marshall Pill" shows a Beats Pill photo (the name
 * and the photo disagree, so it is dropped); Purple Lover's "Le Creuset Artisan 7-Quart" showed a Crock-Pot.
 */
export const CUTS_1120 = [
  { guide: "*", href: "https://www.amazon.com/dp/B0D4STD5ZC?tag=louisianahelpr-20", item: "Marshall Pill", why: "photo is a Beats Pill" },
  { guide: "*", item: "Le Creuset Artisan 7-Quart", why: "photo is a Crock-Pot" },
];

/** The swaps' swap_out lines as judgment cuts ({ guide, item, why }). */
export const swapCuts = (dir) => {
  const p = join(dir, "_owner-swaps-1119.md");
  if (!existsSync(p)) return [];
  return parseSwaps(readFileSync(p, "utf8")).out.map((x) => ({ ...x, why: "owner swap 11-19 PM" }));
};

/** A raw price ("$75.00", 75) as the budget band a guide's filter reads: 25, 50, 100 or 500 (over $100). */
export const budgetBand = (raw) => {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[$,\s]/g, ""));
  if (!(n > 0)) return undefined;
  return n <= 25 ? 25 : n <= 50 ? 50 : n <= 100 ? 100 : 500;
};

/**
 * The sort's one-place key (1120): the brand and the name without its color and size words (dedupeKey), the maker's
 * words and a leading "3M" left out of both, so "3M Littmann Classic III Stethoscope, Caribbean Blue" and "Littmann
 * Classic III Stethoscope, Caribbean Blue" are one product (their color decides whether a second one may show).
 */
export const productKey1120 = (brand, name, dedupeKey) => {
  const b = String(brand ?? "").toLowerCase().replace(/^3m\s+/, "").trim();
  let n = String(name ?? "").toLowerCase().replace(/^3m\s+/, "");
  if (b && n.startsWith(b)) n = n.slice(b.length);
  return `${compact(b)}|${dedupeKey(n)}`;
};
