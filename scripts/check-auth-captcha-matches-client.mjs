#!/usr/bin/env node
/**
 * LIVE (docs/OPEN.md item "captcha switch matches what the deployed clients send"): Supabase Auth's captcha
 * switch agrees with the deployed web build.
 *
 * Reads GET /v1/projects/{ref}/config/auth (security_captcha_enabled,
 * security_captcha_provider) through the Management API, then the live site:
 * index.html, then the chunks it references, breadth first, until the one
 * holding the Turnstile loader. That chunk carries the site-key literal only
 * when the build had VITE_TURNSTILE_ENABLED=true (scripts/lib/authCaptcha.mjs).
 * Fails when captcha is ON and the web sends no token, or the reverse.
 *
 * Native builds are pinned to Turnstile ON at build time
 * (src/test/nativeBuildTurnstile.test.ts); this reads the web, the one client
 * whose flag lives in a dashboard (Vercel) and can change without a commit.
 *
 * READ ONLY: one Management API GET, then plain GETs of public assets.
 *
 * Usage:
 *   node scripts/check-auth-captcha-matches-client.mjs
 *       env SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF
 *       (LH_SUPABASE_API_BASE / LH_WEB_BASE: loopback stubs for tests only)
 * Exit status: zero when they agree, one when they disagree, two when it
 * could not check (never clean on a failed or empty read).
 *
 * Runs hourly in .github/workflows/prod-errors.yml (ledger job), so a deploy
 * or a dashboard flip is caught within the hour. Not in prod-deploy.yml: a
 * prod token there makes it a prod-hitting workflow under
 * src/test/prodWorkflowSpacing.test.ts's rules, which a 20-minute cron breaks.
 * Guard: src/test/authCaptchaMatchesClient.test.ts.
 */
import { apiBase } from "./lib/apiBase.mjs";
import { TURNSTILE_LOADER, captchaVerdict, referencedChunks, siteKeysIn } from "./lib/authCaptcha.mjs";

/** The live site has ~380 chunks; the loader sits one hop from the entry (measured 2026-10-15). */
const MAX_FETCHES = 60;

function couldNot(msg) {
  console.error(`::error::could not check auth captcha against the web build: ${msg} — refusing to report clean`);
  process.exit(2);
}

if (!process.env.SUPABASE_ACCESS_TOKEN || !process.env.SUPABASE_PROJECT_REF) {
  couldNot("SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required");
}

let api;
let web;
try {
  api = apiBase(process.env.LH_SUPABASE_API_BASE, "https://api.supabase.com");
  web = apiBase(process.env.LH_WEB_BASE, "https://www.louisianahelpr.com");
} catch (e) {
  couldNot(e instanceof Error ? e.message : "bad base");
}

async function getText(url, headers = {}) {
  let r;
  try {
    r = await fetch(url, { headers, redirect: "follow" });
  } catch (e) {
    couldNot(`${url}: ${e instanceof Error ? e.message : "request failed"}`);
  }
  const text = await r.text();
  if (!r.ok) couldNot(`${url}: HTTP ${r.status} ${text.slice(0, 200)}`);
  return text;
}

const raw = await getText(`${api}/v1/projects/${process.env.SUPABASE_PROJECT_REF}/config/auth`, {
  Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
});
let config;
try {
  config = JSON.parse(raw);
} catch {
  couldNot("auth config: response was not JSON");
}

const page = await getText(`${web}/`);
const queue = referencedChunks(page);
if (queue.length === 0) couldNot(`${web}/ references no assets/*.js chunk`);
const seen = new Set();
let loaderChunk = null;
while (queue.length && seen.size < MAX_FETCHES) {
  const path = queue.shift();
  if (seen.has(path)) continue;
  seen.add(path);
  const text = await getText(`${web}/${path}`);
  if (text.includes(TURNSTILE_LOADER)) {
    loaderChunk = { path, text };
    break;
  }
  for (const next of referencedChunks(text)) if (!seen.has(next)) queue.push(next);
}
if (!loaderChunk) couldNot(`no chunk among the ${seen.size} read carries the Turnstile loader (${TURNSTILE_LOADER})`);

const keys = siteKeysIn(loaderChunk.text);
let verdict;
try {
  verdict = captchaVerdict(config, keys);
} catch (e) {
  couldNot(e instanceof Error ? e.message : "verdict failed");
}
console.log(`read ${seen.size} chunk(s); Turnstile loader in ${loaderChunk.path}; site keys: ${keys.join(", ") || "none"}`);
console.log(`auth config: security_captcha_enabled=${config.security_captcha_enabled} provider=${config.security_captcha_provider ?? "(none)"}`);
if (!verdict.ok) {
  console.log(`FAIL ${verdict.detail}`);
  console.error(`::error::auth captcha and the deployed web build disagree: ${verdict.detail}. docs/OPEN.md item "captcha switch matches what the deployed clients send".`);
  process.exit(1);
}
console.log(`OK: ${verdict.detail}.`);
