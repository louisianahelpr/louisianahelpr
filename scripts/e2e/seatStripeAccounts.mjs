#!/usr/bin/env node
/**
 * seatStripeAccounts — the shared test accounts hold NO Stripe Connect account.
 *
 * WHY (nightly-red #2436, 2026-10-17): helper-e2e (7b923b19) was given a
 * TEST-mode Express account (acct_1UQigP3qNyg1xGcp) on 2026-10-15 07:02Z by a
 * stripe-connect POST from a local node script. An is_seed account is a
 * ready Helpr only while it has NO Stripe account (helper_accept_missing's
 * fixture carve-out, 20261003193541); with a half-onboarded one,
 * accept_job_offer answers `pending_setup` {payout_setup, stripe_id}, so every
 * journey that hires (and every settle-forward of a stranded escrow job)
 * failed, and the money-safety layer seedStateFixtures.mjs relies on ("no test
 * account has a Stripe account", so no transfer has a destination) no longer
 * held.
 *
 *   node scripts/e2e/seatStripeAccounts.mjs            # check (exit 1 on any)
 *   node scripts/e2e/seatStripeAccounts.mjs --restore  # clear, then re-check
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. --restore clears the link
 * the way stripe-connect's `reset` does (stripe_account_id, payouts, charges,
 * identity_verified), scoped to the id it read, only on is_seed accounts
 * enrolled in public.test_accounts, and prints every row before and after.
 * It never touches Stripe: the account object stays at Stripe, unlinked.
 *
 * The sweeper (prod-lifecycle-sweeper.mjs) checks the two seats it holds on
 * every pre and teardown sweep, with the seats' own tokens; this script is the
 * whole-roster check and the one sanctioned way to put a seat back.
 * Guard: src/test/seatStripeAccounts.test.ts.
 */
import { pathToFileURL } from "node:url";

/** The fields stripe-connect `reset` clears, and what it clears them to. */
export const RESET_FIELDS = Object.freeze({
  stripe_account_id: null,
  stripe_payouts_enabled: false,
  stripe_charges_enabled: false,
  stripe_identity_verified: false,
});

/** One line per test account that holds a Stripe account (empty = clean). */
export function stripeSeatViolations(rows) {
  return rows
    .filter((r) => r && r.stripe_account_id)
    .map((r) => `${r.email ?? r.user_id} (${r.user_id}) holds Stripe account ${r.stripe_account_id}`);
}

async function main() {
  const base = (process.env.SUPABASE_URL || "https://fncmgoasalhdgfwzhsqa.supabase.co").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!key) {
    console.error("FAIL: SUPABASE_SERVICE_ROLE_KEY is required (the whole test roster is read server-side).");
    process.exit(1);
  }
  const restore = process.argv.includes("--restore");
  const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const get = async (path) => {
    const r = await fetch(`${base}/rest/v1/${path}`, { headers: H });
    if (!r.ok) throw new Error(`GET ${path.split("?")[0]}: HTTP ${r.status} ${await r.text()}`);
    return r.json();
  };

  const roster = await get("test_accounts?select=user_id");
  if (roster.length === 0) throw new Error("public.test_accounts is empty: nothing to check is not a clean check");
  const ids = roster.map((r) => r.user_id).join(",");
  const read = () =>
    get(`profiles?select=user_id,email,is_seed,stripe_account_id,stripe_payouts_enabled,stripe_charges_enabled,stripe_identity_verified&user_id=in.(${ids})`);
  let rows = await read();
  console.log(`test accounts read: ${rows.length} of ${roster.length} enrolled`);
  let bad = stripeSeatViolations(rows);

  if (bad.length && restore) {
    for (const row of rows.filter((r) => r.stripe_account_id)) {
      if (row.is_seed !== true) {
        console.log(`::error title=Not restored::${row.user_id} is enrolled but not is_seed; refusing to touch it`);
        continue;
      }
      console.log(`before ${JSON.stringify(row)}`);
      const r = await fetch(
        `${base}/rest/v1/profiles?user_id=eq.${row.user_id}&stripe_account_id=eq.${encodeURIComponent(row.stripe_account_id)}&is_seed=is.true&select=user_id,stripe_account_id,stripe_payouts_enabled,stripe_charges_enabled,stripe_identity_verified`,
        { method: "PATCH", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(RESET_FIELDS) },
      );
      const body = await r.text();
      if (!r.ok) throw new Error(`restore ${row.user_id}: HTTP ${r.status} ${body}`);
      const after = JSON.parse(body);
      // Zero rows is NOT a restore: the id changed under us. Say so and fail below.
      if (after.length !== 1) console.log(`::error title=Restore matched ${after.length} rows::${row.user_id} ${row.stripe_account_id}`);
      console.log(`after  ${body}`);
      console.log(`restored ${row.email} (${row.user_id}): unlinked ${row.stripe_account_id} (the account object stays at Stripe)`);
    }
    rows = await read();
    bad = stripeSeatViolations(rows);
  }

  if (bad.length) {
    for (const b of bad) {
      console.log(
        `::error title=A shared test account holds a Stripe account::${b}. An is_seed Helpr with a Stripe account is not ready ` +
          "(accept_job_offer: pending_setup), and seedStateFixtures' money safety assumes none has one. " +
          "Put it back with: node scripts/e2e/seatStripeAccounts.mjs --restore (service role).",
      );
    }
    process.exit(1);
  }
  console.log(`OK: none of the ${rows.length} test accounts holds a Stripe account`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
