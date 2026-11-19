#!/usr/bin/env node
/**
 * ShopMy photo host move (lead 11-19, 1530 train): ShopMy's old S3 buckets answer 403 to every request, but the same
 * file is served from its current CDN at the same key:
 *   production-shopmyshelf-uploads.s3.us-east-2.amazonaws.com/<key> -> static.shopmy.us/uploads/<key>
 *   production-shopmyshelf-pins.s3.us-east-2.amazonaws.com/<key>    -> static.shopmy.us/pins/<key>
 * This scans every JSON in the picks folder for an old S3 photo, fetches the CDN copy (first 1 KB), and records it in
 * _shopmy-cdn-photos.json ({ old: new }) only when it answers 200/206 with an image a browser can draw (HEIF/HEIC and
 * TIFF are left out: Chrome cannot show them). scripts/gift-guide-picks.mjs swaps only the URLs listed there, so an
 * unchecked photo is never shown. Re-runnable: a URL already listed is not fetched again.
 * Usage: node scripts/gift-guide-shopmy-cdn.mjs [<picks dir>]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SHOPMY_S3, shopmyCdnUrl } from "./giftGuideRules.mjs";

const dir = process.argv[2] ?? join(homedir(), "Desktop", "Gift-guide-picks");
const mapFile = join(dir, "_shopmy-cdn-photos.json");
const map = existsSync(mapFile) ? JSON.parse(readFileSync(mapFile, "utf8")) : {};
const found = new Set();
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && x !== "_shopmy-cdn-photos.json")) {
  for (const m of readFileSync(join(dir, f), "utf8").matchAll(new RegExp(SHOPMY_S3.source + "[^\"\\s]*", "g"))) found.add(m[0]);
}
const todo = [...found].filter((u) => !map[u] && shopmyCdnUrl(u));
const DRAWABLE = /^(image\/)?(jpe?g|png|webp|gif|avif)$/i;
const counts = { checked: 0, ok: 0, bad: 0 };
const check = async (u) => {
  const next = shopmyCdnUrl(u);
  try {
    const r = await fetch(next, { headers: { Range: "bytes=0-1023" }, signal: AbortSignal.timeout(20000) });
    const type = (r.headers.get("content-type") ?? "").split(";")[0].trim();
    await r.body?.cancel();
    counts.checked += 1;
    if ((r.status === 200 || r.status === 206) && DRAWABLE.test(type)) { map[u] = next; counts.ok += 1; } else counts.bad += 1;
  } catch {
    // A timeout or reset: not listed, so the photo stays held; the next run tries again.
    counts.bad += 1;
  }
};
for (let i = 0; i < todo.length; i += 16) await Promise.all(todo.slice(i, i + 16).map(check));
writeFileSync(mapFile, `${JSON.stringify(Object.fromEntries(Object.entries(map).sort()), null, 1)}\n`);
console.log(`ShopMy S3 photos found ${found.size}, newly checked ${counts.checked} (ok ${counts.ok}, not drawable or failed ${counts.bad}), listed ${Object.keys(map).length}`);
