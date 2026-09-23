#!/usr/bin/env node
/**
 * Nightly-safe: fails if any SHARED test account carries a strike.
 *
 * 2026-09-13: poster-e2e showed "Final warning: one more violation = 7-day
 * suspension" because race probes and journeys left user_strikes /
 * user_violations rows behind. One more harness-made violation would have
 * suspended the account every prod workflow signs in as. This check makes
 * that state red the night it appears instead of the day a journey breaks.
 *
 * Load: 3 service-role REST reads (profiles, user_strikes, user_violations),
 * each filtered to the six accounts below. No writes.
 *
 *   node scripts/check-test-account-strikes.mjs        # exit 1 on any strike
 *
 * Env: .env (VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) locally, or
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in CI.
 *
 * The account list is the shared set scripts/test-signin-link.mjs mints for
 * (e2e/journeys/fixtures.ts roles poster/helper/admin/incomplete plus the two
 * older audit accounts). The prod-seed banned/restricted fixtures are
 * deliberately NOT here: their violations are the state they exist to show.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SHARED_TEST_ACCOUNTS = [
  "helpr-e2e-poster-0902@mailinator.com",
  "helpr-e2e-helper-0902@mailinator.com",
  "helpr-audit-web-0824@mailinator.com",
  "eli.test.helper@louisianahelpr.com",
  "helpr-seed-incomplete-0912@mailinator.com",
  "helpr-seed-admin-0912@louisianahelpr.com",
];

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEnv() {
  const env = { ...process.env };
  const p = path.join(REPO, ".env");
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

/** Pure: which accounts are dirty, given the three row sets. Exported for the unit test. */
export function findStrikes(profiles, strikes, violations) {
  const problems = [];
  for (const p of profiles) {
    const s = strikes.filter((r) => r.user_id === p.user_id);
    const v = violations.filter((r) => r.user_id === p.user_id);
    const status = p.ban_status ?? "active";
    if (s.length || v.length || status !== "active") {
      problems.push({ email: p.email, user_id: p.user_id, ban_status: status, strikes: s, violations: v });
    }
  }
  return problems;
}

async function main() {
  const env = readEnv();
  const base = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    console.error("[test-account-strikes] missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(2);
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const get = async (q) => {
    const r = await fetch(`${base}/rest/v1/${q}`, { headers, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`GET ${q.split("?")[0]} → ${r.status} ${await r.text()}`);
    return r.json();
  };

  const emails = SHARED_TEST_ACCOUNTS.map((e) => `"${e}"`).join(",");
  const profiles = await get(`profiles?email=in.(${encodeURIComponent(emails)})&select=user_id,email,ban_status`);
  if (profiles.length === 0) throw new Error("no shared test account profiles found — wrong project?");
  const ids = profiles.map((p) => p.user_id).join(",");
  const strikes = await get(`user_strikes?user_id=in.(${ids})&select=id,user_id,reason,severity,job_id,created_at,expires_at`);
  const violations = await get(`user_violations?user_id=in.(${ids})&select=id,user_id,violation_type,action_taken,job_id,created_at`);

  const problems = findStrikes(profiles, strikes, violations);
  const missing = SHARED_TEST_ACCOUNTS.filter((e) => !profiles.some((p) => p.email?.toLowerCase() === e));
  console.log(`[test-account-strikes] ${profiles.length} shared accounts checked${missing.length ? ` (not on this project: ${missing.join(", ")})` : ""}.`);
  // FLOOR (Q52, 2026-09-23). A missing account used to be a printed note and a
  // PASS, so a read that returned 1 of 6 profiles graded the other 5 clean.
  // All six exist on prod (measured 2026-09-23: profiles by email = 6), so a
  // shortfall is a failed or wrong-project read — "could not check", exit 2.
  if (missing.length) {
    throw new Error(`${missing.length} of ${SHARED_TEST_ACCOUNTS.length} shared test accounts were not returned (${missing.join(", ")}) — their strikes were NOT checked`);
  }
  if (problems.length === 0) {
    console.log("[test-account-strikes] OK: no strikes, no violations, every account active.");
    return;
  }
  for (const p of problems) {
    console.error(`\n✗ ${p.email} (${p.user_id}) ban_status=${p.ban_status}`);
    for (const s of p.strikes) console.error(`   strike ${s.id} sev=${s.severity} "${s.reason}" job=${s.job_id} ${s.created_at}`);
    for (const v of p.violations) console.error(`   violation ${v.id} ${v.violation_type}/${v.action_taken} job=${v.job_id} ${v.created_at}`);
  }
  console.error("\n[test-account-strikes] FAIL: a harness left a strike on a shared test account. Delete the test-owned rows and fix the harness cleanup that made them.");
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`[test-account-strikes] could not check: ${e.message}`);
    process.exit(2);
  });
}
