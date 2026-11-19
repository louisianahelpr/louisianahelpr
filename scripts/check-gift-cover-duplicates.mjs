#!/usr/bin/env node
/**
 * NO DUPLICATES ON GIFT GUIDE COVERS (owner 11-18: "No duplicates on cover"): every product drawn on a cover
 * (scripts/gift-guide-cover-items.json, written by scripts/gift-guide-photo-covers.py) is on exactly one cover. A
 * product counts by its `key` (brand or product line plus kind: any Stanley tumbler, any Squishmallow plush) and by its
 * normalised name. Exits 1 and lists each duplicate. Guard: src/test/giftGuideCoversNoDuplicates.test.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MANIFEST = "scripts/gift-guide-cover-items.json";

const norm = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Each product key or name found on more than one cover, as "<what>: slug-a, slug-b". */
export function coverDuplicates(manifest) {
  const where = new Map();
  for (const [slug, items] of Object.entries(manifest)) {
    for (const item of items) {
      for (const k of new Set([`key ${item.key}`, `name ${norm(item.name)}`])) {
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
  const items = Object.values(manifest).reduce((n, l) => n + l.length, 0);
  if (dups.length) {
    console.error(`gift guide covers: ${dups.length} duplicate(s) across covers\n  ${dups.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`gift guide covers: ${items} products on ${Object.keys(manifest).length} covers, no duplicates`);
}
