#!/usr/bin/env node
/**
 * The Black Friday & Cyber Monday deals guide's data (owner 2026-11-19). Reads the lead's checked deals in
 * ~/Desktop/Gift-guide-picks/_bfcm-deals-1119.json and writes src/content/giftGuideDeals.json, one deal per line:
 *   - only READY deals: an affiliate link we hold (no `needs_link`) that reaches the brand's sale
 *     (`deal_works_on_our_link` is not false). A deal whose link goes to another store takes the brand's own-store link
 *     from _brand-links-1119-*.json when one exists, else it is dropped. The held/expired list is never read.
 *   - no deal whose `ends` day is already past in Louisiana (the page hides those too, at view time);
 *   - each category sorted by our commission, high to low (then brand name), at most DEALS_PER_SECTION;
 *   - never a price (the page shows none, Amazon least of all).
 * Commission: the brand-links file's rate for that exact link, else the Amazon Creator Connections campaign's total
 * for that ASIN (_amazon-cc-campaigns-1119.json), else NETWORK_RATES (CJ/Rakuten, ~/Desktop/Affiliate-rates-by-brand-1118.md),
 * else the brand's best brand-links rate, else 0. Rates stay in this script: the shipped JSON carries only the order.
 * Not in CI (it reads the lead's folder): registered in scripts/check-generated-current.mjs (gift-guide-deals).
 * Guard: src/test/giftGuideDeals1119.test.tsx.
 *
 *   node scripts/gift-guide-deals.mjs            write the file and print what was skipped
 *   node scripts/gift-guide-deals.mjs --dry      print only
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DEAL_CATEGORIES, DEALS_PER_SECTION, louisianaDay } from "../src/content/giftGuideDeals.mjs";

const REPO = resolve(import.meta.dirname, "..");
const OUT = join(REPO, "src/content/giftGuideDeals.json");
const DIR = join(homedir(), "Desktop/Gift-guide-picks");

/** CJ and Rakuten rates from the networks' dashboards (Affiliate-rates-by-brand-1118.md, read 2026-11-19). */
const NETWORK_RATES = { Magnifique: 10, Tushbaby: 7, "Durango Boots": 6, "Muck Boot": 4 };

/**
 * Display fixes, never new claims: the shopper is not "the owner", so "owner code" reads "our code"; Camp Snap's row
 * named a personal code with no stated discount, so it shows the code the brand gave us with its stated 7% (the same
 * code and offer as the Discount codes list in src/content/giftGuides.ts).
 */
const OVERRIDES = { "Camp Snap": { deal: "7% off with our code LEXILOMBAS7", code: "LEXILOMBAS7" } };
const tidy = (text) => text.replace(/\bowner code\b/gi, (m) => (m[0] === "O" ? "Our code" : "our code"));

const pct = (v) => {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    // Not a URL (a blank or a free-text store name): no host to compare.
    return "";
  }
};
const asinOf = (href) => /amazon\.com\/(?:.*\/)?dp\/([A-Z0-9]{10})/.exec(href)?.[1] ?? null;
const isAmazon = (href) => /(^|\.)amazon\.com$|^amzn\.to$/.test(host(href));

export function loadSources(dir = DIR) {
  const read = (f) => JSON.parse(readFileSync(join(dir, f), "utf8"));
  const brandLinks = {};
  for (const f of ["_brand-links-1119-a.json", "_brand-links-1119-b.json"]) {
    if (!existsSync(join(dir, f))) continue;
    for (const [brand, list] of Object.entries(read(f))) brandLinks[brand] = [...(brandLinks[brand] ?? []), ...(Array.isArray(list) ? list : [list])];
  }
  const campaigns = existsSync(join(dir, "_amazon-cc-campaigns-1119.json")) ? read("_amazon-cc-campaigns-1119.json") : [];
  const cdn = existsSync(join(dir, "_shopmy-cdn-photos.json")) ? read("_shopmy-cdn-photos.json") : {};
  return { deals: read("_bfcm-deals-1119.json"), brandLinks, campaigns: Array.isArray(campaigns) ? campaigns : (campaigns.campaigns ?? []), cdn };
}

/**
 * ShopMy's old S3 photo URLs answer 403 (lead 11-19): read each as its checked static.shopmy.us copy
 * (_shopmy-cdn-photos.json, the map scripts/gift-guide-picks.mjs uses); an unchecked S3 photo is dropped (the card
 * draws the brand tile instead).
 */
export function photoOf(image, cdn = {}) {
  if (!image) return undefined;
  if (!/\.s3\.[a-z0-9-]+\.amazonaws\.com\//.test(image)) return image;
  return Object.prototype.hasOwnProperty.call(cdn, image) ? cdn[image] : undefined;
}

/** Our commission (%) on a deal's link; see the header for the order of sources. */
export function commissionOf(d, { brandLinks, campaigns }) {
  const all = Object.values(brandLinks).flat();
  const exact = all.find((p) => p.href === d.href && p.commission_pct);
  if (exact) return pct(exact.commission_pct);
  const asin = asinOf(d.href);
  if (asin) {
    const c = campaigns.find((x) => (x.asins ?? []).includes(asin));
    if (c) return c.total_pct ?? pct(/(\d+(?:\.\d+)?)%/.exec(c.campaign ?? "")?.[1]);
  }
  if (NETWORK_RATES[d.brand] != null) return NETWORK_RATES[d.brand];
  const own = brandLinks[d.brand] ?? [];
  return own.length ? Math.max(...own.map((p) => pct(p.commission_pct))) : 0;
}

/** A link of the brand's own store from the brand-links files (the store's host is the deal's source site), or null. */
export function ownStoreLink(d, brandLinks) {
  const site = host(d.source);
  if (!site) return null;
  const base = site.split(".").slice(-2).join(".");
  return (brandLinks[d.brand] ?? []).find((p) => p.href && (host(`https://${String(p.store ?? "").replace(/^https?:\/\//, "")}`).endsWith(base))) ?? null;
}

/** The page's deals plus what was left out and why. */
export function buildDeals(src, today) {
  const kept = [];
  const skipped = { noLink: [], otherStore: [], ended: [] };
  for (const [category, list] of Object.entries(src.deals.categories)) {
    if (!DEAL_CATEGORIES.includes(category)) throw new Error(`gift-guide-deals: unknown category ${category}`);
    for (const raw of list) {
      if (raw.needs_link || !raw.href) {
        skipped.noLink.push(raw.brand);
        continue;
      }
      let d = raw;
      if (raw.deal_works_on_our_link === false) {
        const own = ownStoreLink(raw, src.brandLinks);
        if (!own) {
          skipped.otherStore.push(raw.brand);
          continue;
        }
        d = { ...raw, href: own.href, image: own.image ?? raw.image, featured_item: own.name ?? raw.featured_item };
      }
      if (d.ends && d.ends < today) {
        skipped.ended.push(d.brand);
        continue;
      }
      const over = OVERRIDES[d.brand] ?? {};
      const amazon = isAmazon(d.href);
      const image = photoOf(d.image, src.cdn);
      kept.push({
        commission: commissionOf(d, src),
        deal: {
          brand: d.brand.replace(/\s*\(Amazon\)$/, ""),
          category,
          deal: over.deal ?? tidy(d.deal_text),
          href: d.href,
          ...(image ? { image } : {}),
          ...(d.featured_item ? { item: d.featured_item } : {}),
          ...((over.code ?? d.code) ? { code: over.code ?? d.code } : {}),
          ...(d.starts ? { starts: d.starts } : {}),
          ...(d.ends ? { ends: d.ends } : {}),
          status: d.status === "announced" ? "announced" : "live",
          ...(amazon ? { store: "Amazon" } : {}),
        },
      });
    }
  }
  const deals = DEAL_CATEGORIES.flatMap((category) =>
    kept
      .filter((k) => k.deal.category === category)
      .sort((a, b) => b.commission - a.commission || a.deal.brand.localeCompare(b.deal.brand))
      .slice(0, DEALS_PER_SECTION),
  );
  return { deals: deals.map((k) => k.deal), order: deals.map((k) => [k.deal.category, k.deal.brand, k.commission]), skipped };
}

/** The file's exact text: one deal per line, so a change reads as a small diff. */
export const dealsText = (deals) => `[\n${deals.map((d) => JSON.stringify(d)).join(",\n")}\n]\n`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const today = louisianaDay(new Date());
  const { deals, order, skipped } = buildDeals(loadSources(), today);
  for (const [c, b, r] of order) console.log(`${c.padEnd(15)} ${String(r).padStart(5)}%  ${b}`);
  console.log(`\n${deals.length} deals (as of ${today}).`);
  console.log(`No affiliate link yet (${skipped.noLink.length}): ${skipped.noLink.join(", ")}`);
  console.log(`Link goes to another store, no own-store link (${skipped.otherStore.length}): ${skipped.otherStore.join(", ")}`);
  console.log(`Already ended (${skipped.ended.length}): ${skipped.ended.join(", ") || "none"}`);
  if (!process.argv.includes("--dry")) writeFileSync(OUT, dealsText(deals));
}
