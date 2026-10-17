#!/usr/bin/env node
/**
 * Q1737 live check: on the served site, a MISSING file under /assets/ or
 * /fonts/ answers 404 with no long-lived freshness, and a REAL hashed asset
 * still answers 200 immutable.
 *
 *   SITE=<the served origin> node scripts/check-missing-asset-headers.mjs
 *
 * Run by prod-freshness.yml's served-commit job once prod serves the commit,
 * so it measures the deployed config, not the repo. Fails closed: a fetch
 * that errors, an index.html with no /assets/ script to compare against, or
 * any wrong header exits 1.
 *
 * Why the real-asset half: a fix that dropped the immutable rule would also
 * turn the missing-file half green; the check must see both.
 * Guard: src/test/immutablePathsNeverServeTheSpa.test.ts.
 */
import { pathToFileURL } from "node:url";

/** Is this Cache-Control safe on a 404 (nothing a browser may keep)? */
export function cacheControlKeepsNothing(value) {
  const v = String(value ?? "").toLowerCase();
  if (!v) return false; // no header leaves freshness to heuristics: not proven safe
  if (/\bimmutable\b/.test(v)) return false;
  if (/\bno-store\b/.test(v)) return true;
  const age = /\b(?:s-)?max-age=(\d+)/g;
  let m;
  let any = false;
  while ((m = age.exec(v))) {
    any = true;
    if (Number(m[1]) > 0) return false;
  }
  return any || /\bno-cache\b/.test(v);
}

/**
 * Pure verdict over measured responses. `real` is the hashed asset index.html
 * names; `missing` are the made-up paths. Returns the failure lines (empty =
 * pass).
 */
export function judgeMissingAssetHeaders({ real, missing }) {
  const bad = [];
  if (!real) bad.push("no real /assets/ file was measured (index.html named none)");
  else {
    if (real.status !== 200) bad.push(`real asset ${real.path} answered ${real.status}, expected 200`);
    if (!/\bimmutable\b/i.test(real.cacheControl ?? "")) bad.push(`real asset ${real.path} lost its immutable header: "${real.cacheControl}"`);
  }
  if (!missing?.length) bad.push("no missing path was measured");
  for (const m of missing ?? []) {
    if (m.status !== 404) bad.push(`missing ${m.path} answered ${m.status}, expected 404`);
    if (!cacheControlKeepsNothing(m.cacheControl)) bad.push(`missing ${m.path} answered with a cacheable header: "${m.cacheControl}"`);
  }
  return bad;
}

async function measure(site, path) {
  const r = await fetch(`${site}${path}`, { headers: { "cache-control": "no-cache", pragma: "no-cache" }, redirect: "manual" });
  await r.arrayBuffer();
  return { path, status: r.status, cacheControl: r.headers.get("cache-control") ?? "" };
}

async function main() {
  const site = (process.env.SITE || "").replace(/\/$/, "");
  if (!/^https?:\/\//.test(site)) {
    console.error("FAIL: SITE must be the served origin (https://...), as prod-freshness.yml sets it");
    process.exit(1);
  }
  const page = await fetch(`${site}/?_q1737=${Date.now()}`, { headers: { "cache-control": "no-cache" } });
  if (!page.ok) throw new Error(`index.html: HTTP ${page.status}`);
  const html = await page.text();
  const src = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  const real = src ? await measure(site, src) : null;
  const tag = `${Date.now()}`;
  const missing = [];
  for (const path of [`/assets/missing-Q1737-${tag}.js`, `/assets/sub/missing-Q1737-${tag}.css`, `/fonts/missing-Q1737-${tag}.woff2`]) {
    missing.push(await measure(site, path));
  }
  for (const m of [real, ...missing].filter(Boolean)) console.log(`${m.status} ${m.path}  cache-control: ${m.cacheControl}`);
  const bad = judgeMissingAssetHeaders({ real, missing });
  if (bad.length) {
    for (const b of bad) console.log(`::error title=Missing-asset headers (Q1737)::${b}`);
    process.exit(1);
  }
  console.log("OK: missing /assets/ and /fonts/ files answer 404 with nothing cacheable; real assets stay immutable.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
