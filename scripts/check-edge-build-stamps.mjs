#!/usr/bin/env node
/**
 * BR-024: is every deployed edge function serving the build HEAD says it should?
 *
 * The Management API's `version` / `ezbr_sha256` cannot answer that for about
 * forty functions (the platform re-stamps them with no deploy; see
 * scripts/verify-functions-deployed.mjs). This asks the RUNNING function: an
 * OPTIONS request with `x-lh-build-probe` is answered by
 * supabase/functions/_shared/buildStamp.ts with the `x-lh-build` header the
 * deploy wrote into that function's bundle, before the function's own handler
 * runs. That value is compared with the stamp computed from the checked-out
 * repo (scripts/lib/edgeBuildStamp.mjs) for EVERY function directory, not only
 * the ones this run deployed: a function a previous run failed to land is
 * caught here too.
 *
 * Usage:
 *   node scripts/check-edge-build-stamps.mjs [--functions "a b"] [--wait-seconds N]
 *        [--mismatch-file <path>]
 * Env: SUPABASE_URL, or SUPABASE_PROJECT_REF (-> https://<ref>.supabase.co).
 *      Optional VITE_SUPABASE_PUBLISHABLE_KEY (sent as apikey; the probe does
 *      not need it: the gateway passes OPTIONS through unauthenticated).
 * Exit: 0 every function answered HEAD's stamp; 1 otherwise (names written to
 *       --mismatch-file, one per line, for the workflow to redeploy).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUILD_HEADER, BUILD_PROBE_HEADER, compareStamps, expectedStamp, listFunctions } from "./lib/edgeBuildStamp.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};

const fail = (msg) => {
  console.error(`::error::${msg}`);
  process.exit(1);
};

const BASE = (
  process.env.SUPABASE_URL || (process.env.SUPABASE_PROJECT_REF ? `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co` : "")
).replace(/\/+$/, "");
if (!BASE) fail("could not probe the functions: SUPABASE_URL or SUPABASE_PROJECT_REF is required");

const WAIT_MS = Number(opt("wait-seconds", "120")) * 1000;
if (!Number.isFinite(WAIT_MS) || WAIT_MS < 0) fail("--wait-seconds must be a non-negative number");
const MISMATCH_FILE = opt("mismatch-file", null);
const ALL = listFunctions(ROOT);
const only = (opt("functions", "") || "").split(/\s+/).filter(Boolean);
const unknown = only.filter((fn) => !ALL.includes(fn));
if (unknown.length) fail(`not functions under supabase/functions: ${unknown.join(", ")}`);
const TARGETS = only.length ? only : ALL;
if (TARGETS.length === 0) fail("found no functions under supabase/functions — refusing to report clean");

const expected = Object.fromEntries(TARGETS.map((fn) => [fn, expectedStamp(ROOT, fn)]));
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";

/** What `fn` answers to the build probe: the header value, or null with the reason. */
async function probe(fn) {
  const headers = { [BUILD_PROBE_HEADER]: "1" };
  if (KEY) Object.assign(headers, { apikey: KEY, Authorization: `Bearer ${KEY}` });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(`${BASE}/functions/v1/${fn}`, { method: "OPTIONS", headers, signal: ctl.signal });
    await res.arrayBuffer().catch(() => null);
    const stamp = res.headers.get(BUILD_HEADER);
    return { stamp, why: stamp ? null : `HTTP ${res.status}, no ${BUILD_HEADER} header` };
  } catch (e) {
    return { stamp: null, why: `probe failed: ${e.name === "AbortError" ? "timed out after 20 s" : e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

const observed = {};
const why = {};
async function probeAll(fns) {
  for (const fn of fns) {
    const r = await probe(fn);
    observed[fn] = r.stamp;
    why[fn] = r.why;
  }
}

const deadline = Date.now() + WAIT_MS;
await probeAll(TARGETS);
let result = compareStamps(expected, observed);
// A just-deployed function can answer from a warm worker on the old build for
// a short while. Re-probe only the mismatches until the wait runs out.
while (result.mismatched.length && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, Math.min(15_000, Math.max(0, deadline - Date.now()))));
  await probeAll(result.mismatched.map((m) => m.fn));
  result = compareStamps(expected, observed);
}

if (MISMATCH_FILE) writeFileSync(MISMATCH_FILE, result.mismatched.map((m) => m.fn).join("\n") + (result.mismatched.length ? "\n" : ""));

console.log(`Build stamps: ${result.ok.length} of ${TARGETS.length} function(s) serve HEAD's build (${BASE}).`);
if (result.mismatched.length) {
  for (const m of result.mismatched) {
    console.error(`::error::${m.fn}: serving ${m.observed ?? "nothing"} (${why[m.fn] ?? "stamp differs"}); HEAD builds ${m.expected}`);
  }
  fail(`${result.mismatched.length} function(s) are not serving the build HEAD says they should — prod is running other code for them.`);
}
