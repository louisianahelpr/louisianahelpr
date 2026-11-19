#!/usr/bin/env node
/**
 * IndexNow (SEO P1, owner 11-19: "if there are other ways for us to appear in searches ... do it"): tell Bing (and
 * Yandex, Seznam, Naver, which share the protocol) which public URLs exist, with no account. Bing's index also feeds
 * DuckDuckGo and ChatGPT search.
 *
 * Reads the URLs from public/sitemap.xml (the indexable set: no unknown or noindex URL is ever in it), keeps only
 * https://www.louisianahelpr.com URLs, and POSTs them in batches of up to 10,000 to https://api.indexnow.org/indexnow
 * with the key whose file is public/<key>.txt (INDEXNOW_KEY below; the protocol verifies the key by fetching that
 * file from our own host).
 *
 * Run by .github/workflows/prod-deploy.yml after a deploy on main went out, never from a laptop against production.
 *
 *   node scripts/indexnow-ping.mjs --dry-run   # print what would be sent, send nothing
 *   node scripts/indexnow-ping.mjs             # send (CI only)
 *
 * Exit 0 on success or a dry run; 1 on a refused submission (a 4xx other than 429), so the step shows red. A 429 or a
 * network failure is reported and exits 0: IndexNow is a hint, and a busy endpoint must never fail a deploy.
 * Guard: src/test/indexNowPing.test.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const INDEXNOW_KEY = "222098277d6bb0beba7129d600ee8185";
export const INDEXNOW_HOST = "www.louisianahelpr.com";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const BATCH = 10_000;

/** The sitemap's <loc> URLs on our host, de-duplicated, in order. */
export function sitemapUrls(xml) {
  const urls = [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  return [...new Set(urls.filter((u) => {
    try {
      const x = new URL(u);
      return x.protocol === "https:" && x.host === INDEXNOW_HOST;
    } catch {
      // Not a URL: never submitted.
      return false;
    }
  }))];
}

/** The request bodies IndexNow takes (one per batch). */
export function indexNowBodies(urls) {
  const bodies = [];
  for (let i = 0; i < urls.length; i += BATCH) {
    bodies.push({ host: INDEXNOW_HOST, key: INDEXNOW_KEY, keyLocation: `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`, urlList: urls.slice(i, i + BATCH) });
  }
  return bodies;
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const keyFile = path.join(root, "public", `${INDEXNOW_KEY}.txt`);
  if (!existsSync(keyFile) || readFileSync(keyFile, "utf8").trim() !== INDEXNOW_KEY) {
    console.error(`indexnow: public/${INDEXNOW_KEY}.txt is missing or does not hold the key`);
    process.exit(1);
  }
  const urls = sitemapUrls(readFileSync(path.join(root, "public", "sitemap.xml"), "utf8"));
  if (urls.length === 0) {
    console.error("indexnow: the sitemap lists no URL on our host; nothing sent");
    process.exit(1);
  }
  const bodies = indexNowBodies(urls);
  if (dry) {
    console.log(`indexnow (dry run): ${urls.length} URL(s) in ${bodies.length} request(s) to ${INDEXNOW_ENDPOINT}; first: ${urls[0]}`);
    return;
  }
  for (const body of bodies) {
    let res;
    try {
      res = await fetch(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      console.warn(`indexnow: request failed (${e instanceof Error ? e.message : "network"}); a hint only, the deploy stands`);
      return;
    }
    console.log(`indexnow: ${body.urlList.length} URL(s) -> HTTP ${res.status}`);
    if (res.status === 429) {
      console.warn("indexnow: rate limited; try again on the next deploy");
      return;
    }
    if (res.status >= 400) process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
