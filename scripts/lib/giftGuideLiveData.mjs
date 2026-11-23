/**
 * The live gift-guide data files (owner 2026-11-23: the app's guides pull the latest gifts, prices and deals from the
 * website). Read by the build (vite.config.ts, plugin lh-gift-guide-live-data), which emits each as
 * dist/gift-guides/data/<name>.<hash>.json plus dist/gift-guides/data/manifest.json. The page side is
 * src/lib/liveGuideData.ts. Guard: src/test/liveGuideData1123.test.ts.
 *
 * The set: each live guide's picks chunk (src/content/giftGuidePicks/<slug>.json for every slug in LIVE_GUIDES_1121
 * that has one: picks, prices, as-of dates, sections, codes, its deal sections), the deals days' cards
 * (src/content/giftGuideDeals.json), the Kids filter tags (src/content/giftGuideKidsTags.json, once that file
 * exists), the owner's dupes (src/content/giftGuideDupes.json, read by giftGuideCatalog.ts loadGuidePicks) and the
 * deals pages' store codes and no-code sales (src/content/giftGuideCodes.json, read by GiftGuideDeals.tsx).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LIVE_GUIDES_1121 } from "../../src/content/giftGuideLive.mjs";
import { LIVE_DATA_DIR, LIVE_DATA_VERSION, liveDataHash, liveDataPath } from "../../src/lib/giftGuideLiveDataShared.mjs";

/**
 * Every live data name and the source file it is read from (relative to the repo root); a file that does not exist
 * is left out.
 * @param {string} root
 * @returns {{ name: string, file: string }[]}
 */
export function liveDataSources(root) {
  const out = [
    ...LIVE_GUIDES_1121.map((slug) => ({ name: `picks/${slug}`, file: `src/content/giftGuidePicks/${slug}.json` })),
    { name: "deals", file: "src/content/giftGuideDeals.json" },
    { name: "kidsTags", file: "src/content/giftGuideKidsTags.json" },
    { name: "dupes", file: "src/content/giftGuideDupes.json" },
    { name: "codes", file: "src/content/giftGuideCodes.json" },
  ];
  return out.filter((s) => existsSync(path.join(root, s.file)));
}

/**
 * The manifest and every data file, ready to emit. `builtAt` is the build's own stamp (__APP_BUILT_AT__), so a page
 * takes a copy only from a site built after the bundle it runs.
 * @param {string} root
 * @param {string} builtAt
 */
export function buildLiveData(root, builtAt) {
  /** @type {Record<string, { hash: string, path: string }>} */
  const files = {};
  /** @type {{ fileName: string, source: string }[]} */
  const assets = [];
  for (const { name, file } of liveDataSources(root)) {
    const value = JSON.parse(readFileSync(path.join(root, file), "utf8"));
    const hash = liveDataHash(value);
    const at = liveDataPath(name, hash);
    files[name] = { hash, path: at };
    assets.push({ fileName: at.slice(1), source: JSON.stringify(value) });
  }
  const manifest = { v: LIVE_DATA_VERSION, builtAt, files };
  assets.push({ fileName: `${LIVE_DATA_DIR}/manifest.json`, source: JSON.stringify(manifest) });
  return { manifest, assets };
}
