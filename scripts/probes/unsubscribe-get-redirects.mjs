#!/usr/bin/env node
/**
 * Q1655 + Q?unsub-page-raw-html, LIVE: an email's unsubscribe link, as a mail
 * client or a person opens it.
 *
 * The bug (measured 2026-10-14 with `curl -sD -`): a GET of the deployed
 * email-unsubscribe function answered 200 `content-type: text/plain` with the
 * function's `<!DOCTYPE html>` page as the body (Supabase serves a function's
 * HTML as text/plain), and a valid link wrote the opt-out on that GET.
 *
 * This GETs the deployed function with a token that cannot verify (so nothing
 * could be written even by the old code) and requires:
 *   - a 302 whose Location is the app's /unsubscribe page, carrying the token in its fragment (never the query, which servers log);
 *   - no HTML body.
 * Fail-closed: no answer, any other status, or a missing Location exits 1.
 * Runs weekly in edge-function-smoke.yml (and on dispatch).
 *
 *   node scripts/probes/unsubscribe-get-redirects.mjs
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.LH_SUPABASE_FUNCTIONS_BASE ?? "https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1";
const APP = process.env.LH_APP_URL ?? "https://www.louisianahelpr.com";

/** Grade one answer. Returns the list of problems; empty means it passed. */
export function gradeUnsubscribeGet({ status, location, contentType, body }) {
  const problems = [];
  if (status !== 302) problems.push(`GET answered HTTP ${status}, not a 302 redirect`);
  let to = null;
  try {
    to = location ? new URL(location) : null;
  } catch {
    to = null;
  }
  if (!to) problems.push(`no usable Location header (${JSON.stringify(location)})`);
  else {
    if (`${to.origin}${to.pathname}` !== `${APP}/unsubscribe`) problems.push(`redirects to ${to.origin}${to.pathname}, not ${APP}/unsubscribe`);
    if (new URLSearchParams(to.hash.slice(1)).get("sig") !== "probe-invalid") problems.push("the redirect dropped the signed token from its fragment");
    if (to.search) problems.push("the token rides in the query string, where server logs keep it");
  }
  if (/<!DOCTYPE html|<html/i.test(body ?? "")) {
    problems.push(`the GET still returns an HTML page as ${contentType ?? "no content-type"} (shown as raw markup)`);
  }
  return problems;
}

async function main() {
  const url = `${BASE}/email-unsubscribe?e=probe&sig=probe-invalid`;
  let res;
  try {
    res = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    console.error(`✗ could not reach email-unsubscribe: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  const body = await res.text().catch(() => "");
  const problems = gradeUnsubscribeGet({
    status: res.status,
    location: res.headers.get("location"),
    contentType: res.headers.get("content-type"),
    body,
  });
  if (problems.length) {
    console.error("✗ email-unsubscribe GET is not the safe redirect:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`✓ email-unsubscribe GET writes nothing and redirects to ${APP}/unsubscribe`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
