#!/usr/bin/env node
/**
 * NO REPEATS WITHIN A GIFT GUIDE SECTION (owner 11-18: "No duplicates on cover", then "no repeats within a section"):
 * every product drawn on a cover (scripts/gift-guide-cover-items.json, written by scripts/gift-guide-photo-covers.py,
 * { slug: { section, items: [{ name, key }] } }) is on at most one cover of its landing section (By person, By budget,
 * By store, For kids, ...); it may show again in another section. A product counts by its `key` (brand or product line
 * plus kind: any Stanley tumbler, any Squishmallow plush) and by its normalised name. Exits 1 and lists each repeat.
 * Guard: src/test/giftGuideCoversNoDuplicates.test.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MANIFEST = "scripts/gift-guide-cover-items.json";

const norm = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Each product key or name on more than one cover of the same section, as "<section> <what>: slug-a, slug-b". */
export function coverDuplicates(manifest) {
  const where = new Map();
  for (const [slug, cover] of Object.entries(manifest)) {
    for (const item of cover.items) {
      for (const k of new Set([`${cover.section} key ${item.key}`, `${cover.section} name ${norm(item.name)}`])) {
        const seen = where.get(k);
        if (seen && !seen.includes(slug)) seen.push(slug);
        else if (!seen) where.set(k, [slug]);
      }
    }
  }
  return [...where].filter(([, slugs]) => slugs.length > 1).map(([k, slugs]) => `${k}: ${slugs.join(", ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const dups = coverDuplicates(manifest);
  const items = Object.values(manifest).reduce((n, c) => n + c.items.length, 0);
  if (dups.length) {
    console.error(`gift guide covers: ${dups.length} repeat(s) within a section\n  ${dups.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`gift guide covers: ${items} products on ${Object.keys(manifest).length} covers, no repeats within a section`);
}
