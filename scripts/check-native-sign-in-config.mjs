#!/usr/bin/env node
/**
 * LIVE (docs/OPEN.md Q1323 part 1): prod Supabase Auth accepts every Apple and
 * Google client id the app's sign-in code passes.
 *
 * Derives the ids from the shipped source (scripts/lib/nativeSignInIds.mjs:
 * src/lib/socialAuth.ts, capacitor.config.ts, the Xcode project and
 * Info.plist), reads GET /v1/projects/{ref}/config/auth through the Management
 * API, and asserts: every Apple id (Services ID and the App ID com.Helpr) is in
 * external_apple_client_id; external_google_client_id lists the web client
 * first and every native client after it; the first Google id is not the old
 * Desktop client; external_google_skip_nonce_check is true; both providers on.
 *
 * READ ONLY: one GET. It never PATCHes the auth config.
 *
 * Usage:
 *   node scripts/check-native-sign-in-config.mjs
 *       env SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (LH_SUPABASE_API_BASE for tests)
 * Exit status: 0 when every check passes, 1 when a check failed, 2 when it
 * could not run (no credentials, the config could not be read, or the source
 * no longer derives any id). Never reported clean on a failed read.
 *
 * Nightly: .github/workflows/db-drift-detect.yml ("Native sign-in client ids
 * are accepted by prod auth"). Guard: src/test/nativeSignInConfig.test.ts.
 */
import { apiBase } from "./lib/apiBase.mjs";
import { checkAuthConfig, deriveSignInIds, idList, readSignInSources } from "./lib/nativeSignInIds.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function couldNot(msg) {
  console.error(`::error::could not check the native sign-in client ids: ${msg}`);
  process.exit(2);
}

let ids;
try {
  ids = deriveSignInIds(readSignInSources(ROOT));
} catch (e) {
  couldNot(`deriving the ids from source failed: ${e instanceof Error ? e.message : "unknown error"} — refusing to report clean`);
}

if (!process.env.SUPABASE_ACCESS_TOKEN || !process.env.SUPABASE_PROJECT_REF) {
  couldNot("SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required");
}

let res;
try {
  const base = apiBase(process.env.LH_SUPABASE_API_BASE, "https://api.supabase.com");
  const r = await fetch(`${base}/v1/projects/${process.env.SUPABASE_PROJECT_REF}/config/auth`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` },
  });
  res = { ok: r.ok, status: r.status, text: await r.text() };
} catch (e) {
  couldNot(`auth config: ${e instanceof Error ? e.message : "request failed"}`);
}
if (!res.ok) couldNot(`auth config: Management API ${res.status} ${res.text.slice(0, 200)}`);

let config;
try {
  config = JSON.parse(res.text);
} catch {
  couldNot("auth config: response was not JSON");
}
// An empty or reshaped answer has no client-id lists to compare against; a
// missing key is "could not read", never "nothing to check".
if (!config || typeof config !== "object" || Array.isArray(config)) {
  couldNot("auth config: response was not a config object — refusing to report clean");
}
for (const key of ["external_apple_client_id", "external_google_client_id"]) {
  if (idList(config[key]) === null) couldNot(`auth config has no string ${key} — refusing to report clean`);
}
if (!("external_google_skip_nonce_check" in config)) {
  couldNot("auth config has no external_google_skip_nonce_check key — refusing to report clean");
}

const results = checkAuthConfig(config, ids);
// Floor: the Services ID, the App ID, the web-first rule, the Desktop pin, one
// native Google id and the nonce flag are six checks at the very least.
if (results.length < 6) couldNot(`only ${results.length} checks were built from the source — refusing to report clean`);

console.log(
  `derived from source: apple ${[...ids.appleServiceIds, ...ids.bundleIds].map((x) => x.id).join(", ")}; google native ${[...new Set(ids.googleNative.map((x) => x.id))].join(", ")}${ids.googleWeb.length ? `; google web ${ids.googleWeb.map((x) => x.id).join(", ")}` : ""}`,
);
let failed = false;
for (const r of results) {
  if (!r.ok) failed = true;
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.check} (${r.detail})`);
}
if (failed) {
  console.error("::error::native sign-in: prod Supabase Auth would refuse a client id the app passes, or a required setting drifted (see FAIL lines). docs/OPEN.md Q1323.");
  process.exit(1);
}
console.log(`OK: ${results.length} native sign-in config checks passed.`);
