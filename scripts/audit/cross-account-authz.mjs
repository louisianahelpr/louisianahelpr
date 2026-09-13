#!/usr/bin/env node
/**
 * CROSS-ACCOUNT AUTHZ — can one signed-in member read another's rows?
 *
 * Not a policy READ. Two real sessions, real tokens, real PostgREST. CLAUDE.md
 * is explicit that a policy can look correct and still not do what you think,
 * so this asks the database the question a hostile user would ask.
 *
 * The helper asks for rows belonging to the poster. Anything that comes back
 * and should not have is a leak.
 */
import { execSync } from "node:child_process";

const SUPABASE_URL = "https://fncmgoasalhdgfwzhsqa.supabase.co";
const ANON = "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP";
const mint = (who) => JSON.parse(execSync(`node scripts/test-signin-link.mjs ${who} --session --json`,
  { cwd: "/Users/lexilombas/louisianahelpr", encoding: "utf8", maxBuffer: 1 << 24 }));

const poster = mint("poster-e2e");
const helper = mint("helper-e2e");
const POSTER = JSON.parse(poster.value).user.id;
const HELPER = JSON.parse(helper.value).user.id;

const as = async (session, path) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${JSON.parse(session.value).access_token}` },
  });
  const body = await r.json().catch(() => null);
  return { status: r.status, rows: Array.isArray(body) ? body.length : (body ? "obj" : 0), body };
};

// Each probe: the helper asking for the POSTER's rows. `expect` is how many
// rows a correct database returns.
// Each probe: the helper asking for rows that are NOT hers.
//
// SCOPE MATTERS MORE THAN THE TABLE NAME. The first version of this file
// reported five leaks and every one was its own fault: it asked for a column
// that does not exist (`payout_transfers.amount` → 400), a table that does not
// exist (`id_verifications`, it is `helper_verifications` → 404), and — the
// instructive ones — `user_roles` and `tips` and `disputes` WITHOUT excluding
// the helper's own rows. Every row that came back was hers: her own role, tips
// on jobs she worked, disputes she is a party to. RLS was right each time.
// A probe that cannot tell "your row" from "someone else's row" cannot report
// a leak, only noise.
const probes = [
  ["payout_transfers not mine", `payout_transfers?select=id&helper_id=neq.${HELPER}&limit=5`, 0],
  ["payment_refunds", `payment_refunds?select=id&limit=5`, 0],
  ["tips on jobs I did not work", `tips?select=id,amount&job_id=not.in.(${"__MYJOBS__"})&limit=5`, "skip-if-no-control"],
  ["disputes I am not party to", `disputes?select=id,reason&job_id=not.in.(${"__MYJOBS__"})&limit=5`, "skip-if-no-control"],
  ["gift_cards not mine", `gift_cards?select=id&recipient_id=neq.${HELPER}&limit=5`, 0],
  ["helper_w9_records not mine", `helper_w9_records?select=id&helper_id=neq.${HELPER}&limit=5`, 0],
  ["helper_verifications not mine", `helper_verifications?select=id,user_id&user_id=neq.${HELPER}&limit=5`, 0],
  ["user_roles of OTHER people", `user_roles?select=user_id,role&user_id=neq.${HELPER}&limit=5`, 0],
  ["platform_settings (fee config)", `platform_settings?select=*&limit=5`, 0],
  ["error_logs", `error_logs?select=id&limit=5`, 0],
  ["push_tokens not mine", `push_tokens?select=id&user_id=neq.${HELPER}&limit=5`, 0],
  ["saved_searches of the poster", `saved_searches?select=id&user_id=eq.${POSTER}`, 0],
  ["favorite_helpers of the poster", `favorite_helpers?select=id&customer_id=eq.${POSTER}`, 0],
  ["notifications of the poster", `notifications?select=id&user_id=eq.${POSTER}`, 0],
  ["messages the poster sent to someone else", `messages?select=id&sender_id=eq.${POSTER}&receiver_id=neq.${HELPER}&limit=5`, 0],
  ["poster's email via profiles", `profiles?select=email&user_id=eq.${POSTER}`, "no-email"],
  ["poster's exact address via jobs", `jobs?select=location,latitude,longitude&customer_id=eq.${POSTER}&helper_id=is.null&limit=3`, "no-precise-location"],
];

// Jobs the helper legitimately worked — needed so the tips/disputes probes can
// ask for rows that are NOT hers. Without this the probe compares against
// nothing and a pass means only that she has rows.
const mine = await as(helper, `jobs?select=id&helper_id=eq.${HELPER}&limit=100`);
const myJobIds = Array.isArray(mine.body) ? mine.body.map((j) => j.id) : [];

let leaks = 0;
for (const [name, rawPath, expect] of probes) {
  const path = rawPath.replace("__MYJOBS__", myJobIds.join(",") || "00000000-0000-0000-0000-000000000000");
  const r = await as(helper, path);
  let ok;
  if (expect === "no-email") {
    ok = !(Array.isArray(r.body) && r.body.some((x) => x && x.email));
  } else if (expect === "no-precise-location") {
    // A job she has not been hired for must not hand her a precise pin.
    ok = !(Array.isArray(r.body) && r.body.some((x) => x && x.latitude != null && x.longitude != null));
  } else if (expect === "skip-if-no-control" && !myJobIds.length) {
    console.log(`skip  ${name.padEnd(44)} (no control rows — cannot distinguish mine from yours)`);
    continue;
  } else {
    ok = r.status === 401 || r.status === 403 || r.rows === 0;
  }
  // A 400 or 404 means the PROBE is wrong — a missing column or table — not
  // that the database leaked. Say so instead of counting it as a finding.
  if (r.status === 400 || r.status === 404) {
    console.log(`probe ${name.padEnd(44)} HTTP ${r.status} — probe is wrong, not the database: ${JSON.stringify(r.body).slice(0, 90)}`);
    continue;
  }
  if (!ok) leaks++;
  console.log(`${ok ? "ok   " : "LEAK "} ${name.padEnd(44)} HTTP ${r.status}  rows=${r.rows}${ok ? "" : "  <-- " + JSON.stringify(r.body).slice(0, 120)}`);
}

// And the inverse control: the helper CAN see their own rows, so a blanket
// "everything returns zero" cannot pass this suite vacuously.
const own = await as(helper, `profiles?select=user_id&user_id=eq.${HELPER}`);
console.log(`\ncontrol — helper can read their OWN profile: HTTP ${own.status}, rows=${own.rows} ${own.rows === 1 ? "(good: the suite is not vacuous)" : "(!! the suite may be passing because nothing works)"}`);
console.log(`\n${leaks === 0 ? "NO LEAKS" : leaks + " LEAK(S)"} across ${probes.length} probes`);
