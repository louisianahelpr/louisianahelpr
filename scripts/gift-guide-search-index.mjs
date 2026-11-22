#!/usr/bin/env node
/**
 * The gift-guide item search index (holistic review 11-18 H5: "airpods" found nothing because search read only guide
 * names). Reads every guide's picks chunk (src/content/giftGuidePicks/<slug>.json, written by
 * scripts/gift-guide-picks.mjs) and writes src/content/giftGuideSearchIndex.json: one row per product name,
 * [name, the guide it sits in], the guide being the first non-store guide that lists it (else its store page), plus
 * [..., price, priceAt] when the pick has a checked price (null, null when it has none), then its photo (holiday audit 1121 #7: "under $25" lists the gifts under
 * $25; the page shows a price only while pickPriceShown says it is fresh).
 * The page imports it lazily, only once a shopper types in search, so it costs nothing on the landing's first paint.
 * Registered in scripts/check-generated-current.mjs (gift-guide-search-index): `npm run inventories:refresh` rewrites
 * it after any picks change. Guard: src/test/giftGuidesUiB9.test.tsx.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isLiveGuide } from "../src/content/giftGuideLive.mjs";

const REPO = resolve(import.meta.dirname, "..");
const DIR = join(REPO, "src/content/giftGuidePicks");
const OUT = join(REPO, "src/content/giftGuideSearchIndex.json");

/** The rows: non-store guides first (by slug), then store pages; the first occurrence of a name wins. */
export function buildIndex() {
  // Owner 11-21: only the live guides' chunks (src/content/giftGuideLive.mjs); a retired guide's file stays on disk unlisted.
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json") && isLiveGuide(f.slice(0, -5))).sort();
  const slugs = [...files.filter((f) => !f.startsWith("store-")), ...files.filter((f) => f.startsWith("store-"))].map((f) => f.slice(0, -5));
  const seen = new Set();
  const rows = [];
  for (const slug of slugs) {
    const chunk = JSON.parse(readFileSync(join(DIR, `${slug}.json`), "utf8"));
    for (const p of chunk.picks ?? []) {
      const name = String(p.name).trim().replace(/\s+/g, " ");
      const key = name.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const priced = typeof p.price === "number" && typeof p.priceAt === "string";
      // Guides audit 1122 #21: a small photo beside each result. Our own images are stored as paths (shorter), others whole.
      const image = typeof p.image === "string" && p.image ? p.image.replace(/^https:\/\/www\.louisianahelpr\.com\//, "/") : null;
      const row = priced ? [name, slug, p.price, p.priceAt] : [name, slug];
      if (image) row.push(...(priced ? [] : [null, null]), image);
      rows.push(row);
    }
  }
  return rows;
}

/** The file's exact text: one row per line, so a picks change reads as a small diff. */
export const indexText = (rows) => `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = buildIndex();
  writeFileSync(OUT, indexText(rows));
  console.log(`gift-guide-search-index: ${rows.length} items -> src/content/giftGuideSearchIndex.json`);
}
