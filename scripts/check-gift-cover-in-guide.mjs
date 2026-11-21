#!/usr/bin/env node
/**
 * Every product on a gift guide cover is in that guide right now, with the same photo, and is never an Amazon photo
 * (owner 11-20: "The covers need to have correct pictures": the Dad cover still showed a slide she had removed, and
 * store covers drew bestseller photos of products the page never listed). Reads the manifest the cover script writes
 * (scripts/gift-guide-cover-items.json: each cover's products, by name and photo) against the guide's pick file.
 *   node scripts/check-gift-cover-in-guide.mjs   exits 1 and lists each cover product that is not in its guide.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const MANIFEST = join(ROOT, "scripts", "gift-guide-cover-items.json");
export const PICKS_DIR = join(ROOT, "src", "content", "giftGuidePicks");

const AMAZON = /(^|\.)(amazon\.[a-z.]+|media-amazon\.com|ssl-images-amazon\.com|images-amazon\.com|amzn\.to|a\.co)$/i;
const host = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};
export const isAmazonPhoto = (u) => AMAZON.test(host(u || ""));

const INDEX = join(ROOT, "src", "content", "giftGuideIndex.ts");
const ownPicks = (slug, dir) => {
  const f = join(dir, `${slug}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).picks ?? [] : [];
};
/** The guides nested in a hub (`parent: "<slug>"` rows of the guide index). */
const childrenOf = (slug) => [...readFileSync(INDEX, "utf8").matchAll(/slug: "([^"]+)"[^}]*parent: "([^"]+)"/g)].filter((m) => m[2] === slug).map((m) => m[1]);

/** The guide's picks ({ name, image, href }[]). A hub with no list of its own shows its child guides' picks, as its cover does. */
export const guidePicks = (slug, dir = PICKS_DIR) => {
  const own = ownPicks(slug, dir);
  return own.length ? own : childrenOf(slug).flatMap((c) => ownPicks(c, dir));
};

/**
 * The owner's stand-in cover photos (scripts/gift-guide-cover-pins.json, owner 11-21: an Amazon-linked pick may be on its
 * cover with the same product's photo from another store, cut out; Amazon's own photo never): { slug: { name: url } }.
 */
export const PINS_FILE = join(ROOT, "scripts", "gift-guide-cover-pins.json");
export const pinnedPhotos = () => {
  const pins = existsSync(PINS_FILE) ? JSON.parse(readFileSync(PINS_FILE, "utf8")) : {};
  return Object.fromEntries(Object.entries(pins).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, v.photos ?? {}]));
};

/** One line per cover product that is not in its guide (by name and photo), or is an Amazon photo or pick. */
export function coverStrays(manifest, picksOf = guidePicks, standIns = pinnedPhotos()) {
  const out = [];
  for (const [slug, cover] of Object.entries(manifest)) {
    const picks = picksOf(slug);
    for (const item of cover.items ?? []) {
      const named = picks.filter((p) => p.name === item.name);
      // An Amazon-linked pick on its cover only through the owner's stand-in photo, which is never Amazon's.
      const standIn = standIns[slug]?.[item.name];
      if (!named.length) out.push(`${slug}: "${item.name}" is not in the guide`);
      else if (!item.image) out.push(`${slug}: "${item.name}" has no photo in the manifest`);
      else if (standIn && item.image === standIn && !isAmazonPhoto(standIn)) continue;
      else if (!named.some((p) => p.image === item.image)) out.push(`${slug}: "${item.name}" shows a photo the guide does not use`);
      else if (isAmazonPhoto(item.image) || named.every((p) => isAmazonPhoto(p.href) || p.store === "store-amazon")) out.push(`${slug}: "${item.name}" is an Amazon photo`);
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const strays = coverStrays(JSON.parse(readFileSync(MANIFEST, "utf8")));
  for (const s of strays) console.error(s);
  console.log(strays.length ? `${strays.length} cover product(s) not in their guide` : "every cover product is in its guide");
  process.exit(strays.length ? 1 : 0);
}
