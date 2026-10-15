#!/usr/bin/env node
/**
 * Q1737, LIVE: a file under /assets/ or /fonts/ that the deploy does not have
 * answers 404 that nobody caches.
 *
 * The bug (measured on www 2026-10-12 with `curl -sI`): vercel.json stamps
 * every response under those paths `Cache-Control: public, max-age=31536000,
 * immutable`, found or not, so a missing chunk's 404 carried a one-year
 * immutable header and a browser could keep it after the chunk appeared.
 * The fix rewrites a missing file there to api/missing-file.ts (404,
 * `no-store`). The source guard (src/test/immutablePathsNeverServeTheSpa.test.ts)
 * proves the config; only this can prove what the CDN actually sends, because
 * a vercel.json header rule and a function's own header meet at Vercel.
 *
 * This GETs one made-up file name per path (unique per run, so no cache in
 * between can answer) and requires, for each: HTTP 404; a Cache-Control with
 * no-store and no `immutable`, no positive max-age; a body that is not the SPA
 * page. Fail-closed: no answer, or any other answer, exits 1.
 * Runs hourly in prod-freshness.yml's served-commit job, once prod serves a
 * commit that carries the rewrite (two GETs of a few bytes per run).
 *
 *   node scripts/probes/missing-asset-not-cached.mjs
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = process.env.LH_SITE_URL ?? "https://www.louisianahelpr.com";
const PATHS = ["assets", "fonts"];

/** Grade one answer. Returns the list of problems; empty means it passed. */
export function gradeMissingAsset({ status, cacheControl, body }) {
  const problems = [];
  if (status !== 404) problems.push(`answered HTTP ${status}, not 404`);
  const cc = (cacheControl ?? "").toLowerCase();
  if (!/\bno-store\b/.test(cc)) problems.push(`Cache-Control is ${JSON.stringify(cacheControl)}, without no-store`);
  if (/\bimmutable\b/.test(cc)) problems.push("Cache-Control still says immutable");
  const maxAge = /\b(?:s-)?max-age=(\d+)/.exec(cc);
  if (maxAge && Number(maxAge[1]) > 0) problems.push(`Cache-Control lets it be cached for ${maxAge[1]}s`);
  if (/<!DOCTYPE html|<html/i.test(body ?? "")) problems.push("the body is an HTML page (the SPA), not a plain 404");
  return problems;
}

async function main() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let failed = false;
  for (const dir of PATHS) {
    const url = `${SITE}/${dir}/q1737-probe-missing-${stamp}.js`;
    let res;
    try {
      res = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      console.error(`✗ ${url}: no answer (${err instanceof Error ? err.message : String(err)})`);
      failed = true;
      continue;
    }
    const body = await res.text().catch(() => "");
    const problems = gradeMissingAsset({ status: res.status, cacheControl: res.headers.get("cache-control"), body });
    if (problems.length) {
      failed = true;
      console.error(`✗ /${dir}/<missing file> is not an uncached 404:`);
      for (const p of problems) console.error(`  - ${p}`);
    } else {
      console.log(`✓ /${dir}/<missing file>: 404, cache-control ${res.headers.get("cache-control")}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
