#!/usr/bin/env node
/**
 * BR-024: write a function's build stamp into supabase/functions/_shared/buildStamp.ts
 * right before `supabase functions deploy <fn>` bundles it.
 *
 *   node scripts/edge-build-stamp.mjs write <fn>   # stamp for <fn>, printed
 *   node scripts/edge-build-stamp.mjs reset        # back to the committed placeholder
 *   node scripts/edge-build-stamp.mjs expected [fn ...]  # JSON { fn: stamp } (default: every function)
 *
 * The verifier is scripts/check-edge-build-stamps.mjs; the rules are in
 * scripts/lib/edgeBuildStamp.mjs.
 */
import { resolve } from "node:path";
import { PLACEHOLDER, expectedStamp, listFunctions, writeStamp } from "./lib/edgeBuildStamp.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const [cmd, ...rest] = process.argv.slice(2);

try {
  if (cmd === "write") {
    if (rest.length !== 1) throw new Error("usage: edge-build-stamp.mjs write <fn>");
    const fn = rest[0];
    if (!listFunctions(ROOT).includes(fn)) throw new Error(`${fn} is not a function under supabase/functions`);
    console.log(writeStamp(ROOT, fn));
  } else if (cmd === "reset") {
    writeStamp(ROOT, "reset", PLACEHOLDER);
    console.log(PLACEHOLDER);
  } else if (cmd === "expected") {
    const fns = rest.length ? rest : listFunctions(ROOT);
    console.log(JSON.stringify(Object.fromEntries(fns.map((fn) => [fn, expectedStamp(ROOT, fn)])), null, 2));
  } else {
    throw new Error("usage: edge-build-stamp.mjs write <fn> | reset | expected [fn ...]");
  }
} catch (e) {
  console.error(`::error::edge-build-stamp: ${e.message}`);
  process.exit(1);
}
