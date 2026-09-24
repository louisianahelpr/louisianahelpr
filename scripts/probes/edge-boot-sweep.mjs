#!/usr/bin/env node
/**
 * EF-028: the edge smoke probed ONE function (health-check) of every one
 * deployed. This sends a CORS preflight (OPTIONS — no body, no auth, no side
 * effect) to EVERY function directory in supabase/functions and fails on any
 * 5xx or unreachable function: a boot error (503 BOOT_ERROR), a worker crash
 * (546) or a function missing from prod all surface here.
 *
 * What it cannot see: a function that boots but fails on a real POST (a
 * missing secret read per request, the EF-023 class). That needs a per-function
 * signed probe; this is the floor under it, not the whole of it.
 *
 *   node scripts/probes/edge-boot-sweep.mjs
 */
import { readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = "https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1";

export function functionSlugs(dir = resolve(ROOT, "supabase/functions")) {
  return readdirSync(dir)
    .filter((f) => !f.startsWith("_") && !f.startsWith("."))
    .filter((f) => existsSync(resolve(dir, f, "index.ts")))
    .sort();
}

/** 0 = network failure. Anything below 500 means the worker booted and answered. */
export function isBroken(code) {
  return code === 0 || code >= 500;
}

async function probe(slug) {
  try {
    const r = await fetch(`${BASE}/${slug}`, {
      method: "OPTIONS",
      headers: { Origin: "https://www.louisianahelpr.com", "Access-Control-Request-Method": "POST" },
      signal: AbortSignal.timeout(20_000),
    });
    return r.status;
  } catch {
    return 0;
  }
}

async function main() {
  const slugs = functionSlugs();
  const results = [];
  for (let i = 0; i < slugs.length; i += 8) {
    const batch = slugs.slice(i, i + 8);
    const codes = await Promise.all(batch.map(probe));
    batch.forEach((s, j) => results.push([s, codes[j]]));
  }
  const broken = results.filter(([, c]) => isBroken(c));
  const tally = {};
  for (const [, c] of results) tally[c] = (tally[c] ?? 0) + 1;
  console.log(`edge boot sweep: ${results.length} function(s) probed — ${JSON.stringify(tally)}`);
  for (const [s, c] of broken) console.log(`  ✗ ${s}: ${c === 0 ? "no response" : `HTTP ${c}`}`);
  if (broken.length) process.exit(1);
  console.log("✓ every deployed function booted and answered");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
