#!/usr/bin/env node
/**
 * LIVE (OA-018): what happens in OUR database when GoTrue links — or refuses
 * to link — an Apple/Google identity to an existing email account.
 *
 * Runs scripts/sql/identity-linking-scenarios.sql, which performs GoTrue's own
 * row writes for four cases (verified email -> link; unconfirmed email -> link
 * + password wipe + confirm; Apple private relay -> new account; unverified
 * provider email colliding -> email-less user) and asserts on the rows our
 * triggers leave behind: no second profile, no lost signup data, the relay
 * account routed to /complete-profile, no server error on an email-less user. The SQL
 * always ends in RAISE EXCEPTION, so it writes nothing that persists — on prod
 * included. See that file for what GoTrue does and where it was read from.
 *
 * With credentials it also reads the project's auth config, because the
 * linking behaviour rests on it: `mailer_autoconfirm` must stay false (true
 * makes GoTrue treat EVERY provider email as verified, and auto-confirms email
 * signups, so an unverified address could be linked into), and both providers
 * must be enabled.
 *
 * What it cannot do: drive a real Apple/Google consent screen. Those steps are
 * docs/OPEN.md Q446 (owner, on a device).
 *
 * Usage:
 *   node scripts/check-identity-linking.mjs            prod, via the Management API
 *       env SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (LH_SUPABASE_API_BASE for tests)
 *   node scripts/check-identity-linking.mjs --psql     the database psql's PG* env points at
 *       (db-smoke.yml: the replayed schema)
 * Exit status: zero when every check passes, one when a check failed, two when
 * it could not run (never reported clean).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "sql/identity-linking-scenarios.sql"), "utf8");
const CASES = ["A", "B", "C", "D"];
const usePsql = process.argv.includes("--psql");

function couldNot(msg) {
  console.error(`::error::could not run the identity-linking scenarios: ${msg}`);
  process.exit(2);
}

/** The verdict rides in the exception text; anything else is "could not run". */
export function parseVerdict(raw) {
  // The Management API wraps the Postgres error in {"message": "..."}.
  let text = raw;
  try {
    const j = JSON.parse(raw);
    if (typeof j?.message === "string") text = j.message;
  } catch {
    // Silent by design: not JSON means psql's plain stderr, read as is.
  }
  const i = text.indexOf("OA018_RESULT:");
  if (i < 0) return null;
  const rest = text.slice(i + "OA018_RESULT:".length);
  const end = rest.lastIndexOf("}");
  if (end < 0) return null;
  try {
    return JSON.parse(rest.slice(0, end + 1));
  } catch {
    // Silent by design: an unparseable verdict is returned as null, and the
    // caller turns null into exit 2 ("refusing to report clean").
    return null;
  }
}

async function mgmt(path, init = {}) {
  const base = process.env.LH_SUPABASE_API_BASE ?? "https://api.supabase.com";
  const res = await fetch(`${base}/v1/projects/${process.env.SUPABASE_PROJECT_REF}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  });
  return { status: res.status, ok: res.ok, text: await res.text() };
}

let text;
let config = null;
if (usePsql) {
  try {
    execFileSync("psql", ["-At", "-v", "ON_ERROR_STOP=1", "-c", SQL], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    couldNot("the scenario block returned without its verdict exception");
  } catch (e) {
    text = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
    if (!text.includes("OA018_RESULT:")) couldNot(`psql: ${text.trim().slice(0, 500) || e.message}`);
  }
} else {
  if (!process.env.SUPABASE_ACCESS_TOKEN || !process.env.SUPABASE_PROJECT_REF) {
    couldNot("SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required (or --psql)");
  }
  const cfg = await mgmt("/config/auth").catch((e) => couldNot(`auth config: ${e.message}`));
  if (!cfg.ok) couldNot(`auth config: Management API ${cfg.status} ${cfg.text.slice(0, 200)}`);
  try {
    config = JSON.parse(cfg.text);
  } catch {
    couldNot("auth config: response was not JSON");
  }
  const q = await mgmt("/database/query", { method: "POST", body: JSON.stringify({ query: SQL }) }).catch((e) =>
    couldNot(`query: ${e.message}`),
  );
  // The block ALWAYS raises, so a 2xx means it did not run as written.
  if (q.ok || !q.text.includes("OA018_RESULT:")) couldNot(`query: Management API ${q.status} ${q.text.slice(0, 500)}`);
  text = q.text;
}

const verdict = parseVerdict(text);
const checks = Array.isArray(verdict?.checks) ? verdict.checks : [];
const seen = new Set(checks.map((c) => c.case));
if (checks.length < 12 || CASES.some((c) => !seen.has(c))) {
  couldNot(`expected >= 12 checks over cases ${CASES.join(",")}, got ${checks.length} — refusing to report clean`);
}

// On prod the identity rows ARE the point: a trigger added to auth.identities
// by a dashboard edit is what the live run exists to catch. If the table did
// not resolve for this role, every identity write was skipped and a pass
// would say nothing (lh-silent-failure review of #1806). The replayed schema
// (--psql) has no auth.identities, so there the skip is expected.
if (!usePsql && verdict.identities_table !== true) {
  couldNot("auth.identities did not resolve for this role, so the identity writes were skipped — refusing to report clean");
}

let failed = false;
if (config) {
  const want = [
    ["mailer_autoconfirm", false, "GoTrue would treat every provider email as verified and link into unverified accounts"],
    ["external_google_enabled", true, "Continue with Google is offered on /login and /signup"],
    ["external_apple_enabled", true, "Sign in with Apple is offered on /login and /signup"],
  ];
  for (const [key, value, why] of want) {
    const ok = config[key] === value;
    if (!ok) failed = true;
    console.log(`${ok ? "PASS" : "FAIL"} config ${key} = ${JSON.stringify(config[key])} (want ${value}: ${why})`);
  }
  // GoTrue links on ANY enabled provider's `email_verified` (linking.go). One
  // that reports unverified addresses as verified would link straight into a
  // victim's CONFIRMED account, so the enabled set is pinned to what the app
  // actually offers: email + Apple + Google (no phone, anonymous or other
  // provider sign-in exists in src/ or supabase/functions; lh-authz-rls review
  // of #1806).
  const EXPECTED_SIGN_IN_METHODS = ["external_apple_enabled", "external_email_enabled", "external_google_enabled"];
  const externalKeys = Object.keys(config).filter((k) => /^external_[a-z0-9_]+_enabled$/.test(k));
  if (externalKeys.length < 5) {
    couldNot(`auth config lists only ${externalKeys.length} external_*_enabled keys — refusing to report clean`);
  }
  // Exact, both ways: an extra method widens who can link in; a missing one
  // means a button on /login and /signup that no longer works.
  const enabled = externalKeys.filter((k) => config[k] === true).sort();
  const extra = enabled.filter((k) => !EXPECTED_SIGN_IN_METHODS.includes(k));
  const missing = EXPECTED_SIGN_IN_METHODS.filter((k) => !enabled.includes(k));
  if (extra.length || missing.length) failed = true;
  console.log(
    `${extra.length || missing.length ? "FAIL" : "PASS"} config enabled sign-in methods = ${enabled.join(", ") || "none"} (want exactly ${EXPECTED_SIGN_IN_METHODS.join(", ")}; extra: ${extra.join(", ") || "none"}, missing: ${missing.join(", ") || "none"}; ${externalKeys.length} checked)`,
  );
  console.log(`info config security_manual_linking_enabled = ${JSON.stringify(config.security_manual_linking_enabled)}`);
}
console.log(`auth.identities present: ${verdict.identities_table}${verdict.identities_table ? "" : " (replayed schema: identity rows skipped, user/profile writes still run)"}`);
for (const c of checks) {
  if (!c.ok) failed = true;
  console.log(`${c.ok ? "PASS" : "FAIL"} ${c.case} ${c.check}${c.ok ? "" : ` — got ${JSON.stringify(c.got)}`}`);
}
if (failed) {
  console.error("::error::identity linking: a check failed (see FAIL lines). OA-018 / docs/OPEN.md Q446.");
  process.exit(1);
}
console.log(`OK: ${checks.length} identity-linking checks passed${config ? " + auth config" : ""}.`);
