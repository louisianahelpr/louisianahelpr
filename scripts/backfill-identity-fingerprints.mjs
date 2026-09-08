#!/usr/bin/env node
/**
 * One-off: give already-verified accounts the identity fingerprint they never got.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `profiles.identity_sha256` is written by `stripe-idv-webhook` at the moment a
 * Stripe Identity session verifies (20260908002148). That only helps accounts
 * that verify AFTER that deploy — everyone already verified carries no identity
 * key, so the strongest ban-evasion layer does not bind for them.
 *
 * It IS backfillable, because we store the session id: `profiles.idv_session_id`
 * has held the `vs_…` id since long before this change. Stripe will return
 * `verified_outputs` for a session that completed in the past, so the
 * fingerprint can be recomputed exactly as the webhook computes it.
 *
 * ── Deliberately a script, not a migration ──────────────────────────────────
 *
 * A migration cannot reach Stripe, must be replay-safe, and would re-run in CI
 * and PGlite where neither Stripe nor the Vault salt exists. This is a one-time
 * data repair against live third-party state — the owner or the orchestrator
 * runs it, once, and reads the output.
 *
 * ── What it does NOT do ─────────────────────────────────────────────────────
 *
 * It never writes a name, a date of birth or a document number anywhere. It
 * passes them to `identity_fingerprint()` over the wire, which salts them with
 * the Vault secret and returns a SHA-256; only that hash is stored. It also
 * never overwrites an existing `identity_sha256` — a value already on file was
 * written by the webhook from the same inputs and is authoritative.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *
 *   node scripts/backfill-identity-fingerprints.mjs            # dry run (default)
 *   node scripts/backfill-identity-fingerprints.mjs --apply    # actually write
 *
 * Requires in the environment (or .env): VITE_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY.
 *
 * The Stripe key decides TEST vs LIVE by itself — `sk_test_…` reads test-mode
 * sessions, `sk_live_…` reads live ones. The script prints which mode it is in
 * before it does anything, because running it against the wrong mode produces
 * "session not found" for every row and looks like a data problem.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");

// .env is gitignored and not exported into a plain `node` run.
for (const line of (() => {
  try { return readFileSync(resolve(ROOT, ".env"), "utf8").split("\n"); } catch { return []; }
})()) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const URL_ = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SECRET_KEY;
const STRIPE = process.env.STRIPE_SECRET_KEY;

const missing = [!URL_ && "VITE_SUPABASE_URL", !KEY && "SUPABASE_SERVICE_ROLE_KEY", !STRIPE && "STRIPE_SECRET_KEY"]
  .filter(Boolean);
if (missing.length) {
  console.error(`Missing required environment: ${missing.join(", ")}`);
  process.exit(1);
}

const mode = STRIPE.startsWith("sk_live") ? "LIVE" : STRIPE.startsWith("sk_test") ? "TEST" : "UNKNOWN";
console.log(`Stripe mode: ${mode}   |   ${APPLY ? "APPLY — will write" : "DRY RUN — no writes"}\n`);
if (mode === "UNKNOWN") {
  console.error("STRIPE_SECRET_KEY is neither sk_test_ nor sk_live_. Refusing to guess.");
  process.exit(1);
}

const sb = (path, init = {}) =>
  fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

/** Same shape the webhook uses: YYYY-MM-DD from Stripe's {day,month,year}. */
const dobOf = (d) =>
  d?.year && d?.month && d?.day
    ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`
    : null;

const rows = await sb(
  "profiles?select=user_id,email,idv_session_id,identity_sha256&idv_status=eq.verified&idv_session_id=not.is.null&identity_sha256=is.null",
).then((r) => r.json());

if (!Array.isArray(rows)) {
  console.error("Could not read profiles:", rows);
  process.exit(1);
}
console.log(`${rows.length} verified profile(s) with a session id and no fingerprint.\n`);

let done = 0, skipped = 0, failed = 0;

for (const p of rows) {
  const label = `${p.email ?? p.user_id} (${p.idv_session_id})`;
  try {
    // `verified_outputs` is redacted unless expanded — without this the outputs
    // are simply absent and every row would "have no name/DOB".
    const res = await fetch(
      `https://api.stripe.com/v1/identity/verification_sessions/${encodeURIComponent(p.idv_session_id)}` +
        `?expand[]=verified_outputs&expand[]=last_verification_report`,
      { headers: { Authorization: `Bearer ${STRIPE}` } },
    );
    const session = await res.json();
    if (!res.ok) {
      console.log(`  SKIP  ${label} — Stripe ${res.status}: ${session?.error?.message ?? "unknown"}`);
      skipped++;
      continue;
    }

    const out = session.verified_outputs ?? null;
    const doc = session.last_verification_report?.document ?? null;
    const firstName = out?.first_name ?? doc?.first_name ?? null;
    const lastName = out?.last_name ?? doc?.last_name ?? null;
    const dob = dobOf(out?.dob) ?? dobOf(doc?.dob);
    const docNumber = doc?.number ?? null;

    if (!firstName || !lastName || !dob) {
      // Not a failure. An older session may have been redacted, or the document
      // type may not have carried these. A missing fingerprint is the state we
      // are already in — never guess one from partial data.
      console.log(`  SKIP  ${label} — no name/DOB in verified_outputs`);
      skipped++;
      continue;
    }

    // The hash is computed by the DATABASE, not here: the Vault salt never
    // leaves Postgres, and using the same function the webhook uses is what
    // guarantees a backfilled hash matches a freshly written one.
    const fpRes = await fetch(`${URL_}/rest/v1/rpc/identity_fingerprint`, {
      method: "POST",
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_first_name: firstName, p_last_name: lastName, p_dob: dob, p_doc_number: docNumber }),
    });
    const fingerprint = await fpRes.json();
    if (!fpRes.ok || typeof fingerprint !== "string") {
      console.log(`  FAIL  ${label} — identity_fingerprint: ${JSON.stringify(fingerprint)}`);
      failed++;
      continue;
    }

    if (!APPLY) {
      console.log(`  would set ${label} → ${fingerprint.slice(0, 12)}…`);
      done++;
      continue;
    }

    // `identity_sha256=is.null` in the filter as well as the query: another run
    // (or the webhook) may have filled it in between the read and this write,
    // and the value already there is the authoritative one.
    const upd = await sb(
      `profiles?user_id=eq.${p.user_id}&identity_sha256=is.null`,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ identity_sha256: fingerprint }) },
    );
    const updated = await upd.json();
    // A PATCH matching zero rows returns [] with no error — that is a no-op, not
    // a success, and it must not be counted as one.
    if (!upd.ok || !Array.isArray(updated) || updated.length === 0) {
      console.log(`  FAIL  ${label} — wrote no row (${upd.status}) ${JSON.stringify(updated).slice(0, 120)}`);
      failed++;
      continue;
    }
    console.log(`  set   ${label} → ${fingerprint.slice(0, 12)}…`);
    done++;
  } catch (e) {
    console.log(`  FAIL  ${label} — ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

console.log(
  `\n${APPLY ? "Wrote" : "Would write"} ${done}   |   skipped ${skipped}   |   failed ${failed}` +
    (APPLY ? "" : "\n\nRe-run with --apply to write."),
);
process.exit(failed > 0 ? 1 : 0);
