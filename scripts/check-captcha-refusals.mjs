#!/usr/bin/env node
/**
 * LIVE ALERT (docs/OPEN.md "auth-captcha-matches-client"): email auth calls
 * that Supabase Auth refused for captcha (`error_code` captcha_failed in
 * auth_logs) from SEVERAL networks in the last window.
 *
 * Why addresses, not a raw count: every captcha_failed on prod from
 * 2026-10-12 to 2026-10-15 (auth_logs, one 24-hour query a day) came from ONE
 * address a day, this Mac's: sec-a's 60-try Q1121 probe, a node script and the
 * lead's browser tests. Counting those as users raised a false outage on
 * 2026-10-15. One address is a person retrying or one of our own probes;
 * refusals from MIN_ADDRESSES or more networks in one window are people, and
 * the message says only that (counts, never "outage").
 *
 * auth_logs carries no user-agent, and a probe that sends a Referer looks like
 * a browser there (the Q1121 probe did), so the network is the discriminator.
 *
 * READ ONLY: two Management API log queries.
 *
 * Usage:
 *   node scripts/check-captcha-refusals.mjs
 *       env SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF, WINDOW_MINUTES (default 65)
 *       (LH_SUPABASE_API_BASE: a loopback stub for tests only)
 * Exit status: zero when quiet, one on refusals from several networks, two
 * when it could not read (never quiet on a failed or empty read).
 *
 * Runs hourly in .github/workflows/prod-errors.yml (ledger job).
 * Guard: src/test/authCaptchaMatchesClient.test.ts.
 */
import { apiBase } from "./lib/apiBase.mjs";
import { refusalVerdict } from "./lib/authCaptcha.mjs";
import { logsQueryUrl } from "./lib/supabaseLogs.mjs";

const MIN_ADDRESSES = 2;

function couldNot(msg) {
  console.error(`::error::could not read the captcha refusals: ${msg} — refusing to report quiet`);
  process.exit(2);
}

const { SUPABASE_ACCESS_TOKEN: TOKEN, SUPABASE_PROJECT_REF: REF } = process.env;
if (!TOKEN || !REF) couldNot("SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required");
const WINDOW_MIN = Number(process.env.WINDOW_MINUTES ?? 65);
if (!Number.isFinite(WINDOW_MIN) || WINDOW_MIN <= 0 || WINDOW_MIN > 1440) couldNot(`WINDOW_MINUTES ${process.env.WINDOW_MINUTES} is not 1..1440`);

let base;
try {
  base = apiBase(process.env.LH_SUPABASE_API_BASE, "https://api.supabase.com");
} catch (e) {
  couldNot(e instanceof Error ? e.message : "bad base");
}

/** The `result` rows of one logs query, or exit 2 — never an empty list on a failed read. */
async function rows(sql, minutes) {
  const now = Date.now();
  const url = logsQueryUrl({ ref: REF, sql, start: new Date(now - minutes * 60_000).toISOString(), end: new Date(now).toISOString(), base });
  let r;
  try {
    r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  } catch (e) {
    couldNot(`logs query: ${e instanceof Error ? e.message : "request failed"}`);
  }
  const text = await r.text();
  if (!r.ok) couldNot(`logs query: Management API ${r.status} ${text.slice(0, 200)}`);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    couldNot("logs query: response was not JSON");
  }
  if (body?.error) couldNot(`logs query error: ${JSON.stringify(body.error).slice(0, 200)}`);
  if (!Array.isArray(body?.result)) couldNot("logs query: no result list in the answer");
  return body.result;
}

// Floor: auth_logs is never empty for a whole day (token refreshes; the
// quietest hour of 2026-10-14..15 still had 2 rows, every day had hundreds).
// Zero means the source name or the endpoint changed, not a quiet prod.
const [day] = await rows("select count() as n from logs where source = 'auth_logs'", 1440);
const dayRows = Number(day?.n);
if (!Number.isFinite(dayRows) || dayRows <= 0) couldNot(`auth_logs returned ${JSON.stringify(day)} rows for the last 24 hours`);

const refused = await rows(
  "select JSONExtractString(event_message, 'remote_addr') as remote_addr, count() as n from logs" +
    " where source = 'auth_logs' and JSONExtractString(event_message, 'error_code') = 'captcha_failed'" +
    " group by remote_addr",
  WINDOW_MIN,
);
let v;
try {
  v = refusalVerdict(refused, MIN_ADDRESSES);
} catch (e) {
  couldNot(e instanceof Error ? e.message : "bad rows");
}
console.log(`auth_logs: ${dayRows} row(s) in 24 h; captcha_failed in the last ${WINDOW_MIN} min: ${v.refusals} from ${v.addresses} address(es)`);
if (v.fire) {
  console.error(
    `::error::${v.refusals} email sign-in/sign-up/reset call(s) were refused for captcha from ${v.addresses} different networks in the last ${WINDOW_MIN} min (threshold ${MIN_ADDRESSES}). Our own probes come from one address; check whether a shipped client stopped sending Turnstile tokens (node scripts/check-auth-captcha-matches-client.mjs). docs/OPEN.md "auth-captcha-matches-client".`,
  );
  process.exit(1);
}
console.log(`OK: below the ${MIN_ADDRESSES}-network threshold.`);
