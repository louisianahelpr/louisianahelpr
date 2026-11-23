/**
 * Live gift-guide data (owner 2026-11-23 ~11:15 AM: "make the app's guides pull the latest gifts, prices and deals from
 * the website, so later edits show up without new reviews"). The build (vite.config.ts, plugin lh-gift-guide-live-data;
 * scripts/lib/giftGuideLiveData.mjs) writes each guide data file the pages read as static JSON under
 * /gift-guides/data/, plus /gift-guides/data/manifest.json naming each file's content hash. The page code
 * (src/lib/liveGuideData.ts) renders its bundled copy first, then reads the manifest from the live site and swaps in a
 * newer valid copy. JSON data only, never code (App Store guideline 2.5.2). This file is shared by the build and the
 * page so both hash the same way. Guard: src/test/liveGuideData1123.test.ts.
 */

/** The live site: the installed app (capacitor://localhost, https://localhost) reads the data from here. */
export const LIVE_DATA_ORIGIN = "https://www.louisianahelpr.com";
/** Where the data files are served (no leading slash: a Vite asset fileName). */
export const LIVE_DATA_DIR = "gift-guides/data";
/** The manifest's path on the site. */
export const LIVE_DATA_MANIFEST = `/${LIVE_DATA_DIR}/manifest.json`;
/** The manifest's shape version; a page refuses a manifest with any other. */
export const LIVE_DATA_VERSION = 1;

/**
 * A short content hash of a parsed JSON value: two FNV-1a 32-bit passes (different offsets) over JSON.stringify, as 16
 * hex digits. The build hashes JSON.parse(file); the page hashes the module Vite bundled from the same file, which
 * stringifies to the same text (key order is kept), so equal data gives equal hashes on both sides.
 * @param {unknown} value
 * @returns {string}
 */
export function liveDataHash(value) {
  const text = JSON.stringify(value) ?? "";
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 15);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/**
 * A data name's file on the site: "picks/her" with hash h is /gift-guides/data/picks-her.h.json.
 * @param {string} name
 * @param {string} hash
 * @returns {string}
 */
export function liveDataPath(name, hash) {
  return `/${LIVE_DATA_DIR}/${name.replace(/\//g, "-")}.${hash}.json`;
}
