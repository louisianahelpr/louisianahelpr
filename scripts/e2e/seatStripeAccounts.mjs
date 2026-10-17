#!/usr/bin/env node
/**
 * seatStripeAccounts — a shared test account holds NO Stripe Connect account,
 * except the ONE sanctioned TEST-mode fixture, and only while it is payout-ready.
 *
 * WHY (nightly-red #2436, 2026-10-17): helper-e2e (7b923b19) was given a
 * TEST-mode Express account (acct_1UQigP3qNyg1xGcp) on 2026-10-15 07:02Z by a
 * stripe-connect POST from a local node script, and its onboarding was never
 * finished. An is_seed account is a ready Helpr while it has NO Stripe account
 * (helper_accept_missing's fixture carve-out, 20261003193541) or, like any
 * Helpr, once payouts are enabled and identity is verified; half-onboarded it
 * is neither, so accept_job_offer answered `pending_setup` {payout_setup,
 * stripe_id} and every journey that hires (and every settle-forward of a
 * stranded escrow job) failed.
 *
 * THE SANCTIONED FIXTURE (lead decision on Q?journeys-tip-fixture, option (a),
 * 2026-10-17): the journeys' tip leg needs a Helpr with a payout account
 * (create-payment refuses a tip without one). That same TEST-mode account was
 * onboarded with Stripe's published test data only and re-linked to
 * helper-e2e. It is allowed ONLY as that exact (user, account) pair and ONLY
 * while payout-ready the way helper_accept_missing reads it
 * (stripe_payouts_enabled AND identity verified). Money on it can only ever be
 * TEST money: every party of a helper-e2e job is a test account, so
 * _shared/stripeMode.ts runs it on the test key, a mixed job is refused, and
 * the live key cannot see a test-mode account at all.
 *
 *   node scripts/e2e/seatStripeAccounts.mjs            # check (exit 1 on any)
 *   node scripts/e2e/seatStripeAccounts.mjs --restore  # unlink violators, then re-check
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. --restore unlinks ONLY a
 * violating row (an unsanctioned account, or the fixture while not ready) the
 * way stripe-connect's `reset` does (stripe_account_id, payouts, charges,
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
import { supabaseBase } from "../lib/apiBase.mjs";

/** The fields stripe-connect `reset` clears, and what it clears them to. */
export const RESET_FIELDS = Object.freeze({
  stripe_account_id: null,
  stripe_payouts_enabled: false,
  stripe_charges_enabled: false,
  stripe_identity_verified: false,
});

/**
 * The ONLY Stripe account a test seat may hold: helper-e2e's TEST-mode Express
 * fixture (user_id -> account id). Exact pairs, so a second account made for
 * any seat, or this account linked to another seat, is still a violation.
 */
export const SANCTIONED_TEST_CONNECT_ACCOUNTS = Object.freeze({
  "7b923b19-aba5-44cb-8730-8c33ba2b9321": "acct_1UQigP3qNyg1xGcp",
});

/** The profile columns a seat check must read (stripeSeatViolations needs all of them). */
export const SEAT_COLUMNS = "user_id,email,is_seed,stripe_account_id,stripe_payouts_enabled,stripe_charges_enabled,stripe_identity_verified,idv_status";

/**
 * Payout-ready as helper_accept_missing reads it (payouts enabled AND identity
 * verified: idv_status 'verified' OR stripe_identity_verified), plus charges
 * enabled, which release-payout and execute-dispute-split also require before
 * a transfer (lh-money-escrow review, #3). A column the read did not return is
 * NOT ready.
 */
export function seatPayoutReady(r) {
  return r.stripe_payouts_enabled === true && r.stripe_charges_enabled === true &&
    (r.idv_status === "verified" || r.stripe_identity_verified === true);
}

/** Why one row violates the rule, or null when it is clean. */
function seatViolation(r) {
  if (!r || !r.stripe_account_id) return null;
  const who = `${r.email ?? r.user_id} (${r.user_id}) holds Stripe account ${r.stripe_account_id}`;
  if (SANCTIONED_TEST_CONNECT_ACCOUNTS[r.user_id] !== r.stripe_account_id) return `${who}, which is not the sanctioned test-mode fixture`;
  // A fixture that lost is_seed would be paid on the LIVE key (stripeMode.ts
  // reads test_accounts + is_seed), and stripe-connect would clear it as an
  // unusable account (lh-money-escrow review, #2).
  if (r.is_seed !== true) return `${who}, the sanctioned test-mode fixture, but the seat is not is_seed`;
  if (!seatPayoutReady(r)) {
    return `${who}, the sanctioned test-mode fixture, but it is not payout-ready ` +
      `(stripe_payouts_enabled=${r.stripe_payouts_enabled}, stripe_charges_enabled=${r.stripe_charges_enabled}, stripe_identity_verified=${r.stripe_identity_verified}, idv_status=${r.idv_status})`;
  }
  return null;
}

/** One line per test account that breaks the rule (empty = clean). */
export function stripeSeatViolations(rows) {
  return rows.map(seatViolation).filter((v) => v !== null);
}

async function main() {
  // The service-role key only ever goes to the project's own host (or a loopback stub).
  const base = supabaseBase(process.env.SUPABASE_URL || "https://fncmgoasalhdgfwzhsqa.supabase.co").replace(/\/$/, "");
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
    get(`profiles?select=${SEAT_COLUMNS}&user_id=in.(${ids})`);
  let rows = await read();
  console.log(`test accounts read: ${rows.length} of ${roster.length} enrolled`);
  let bad = stripeSeatViolations(rows);

  if (bad.length && restore) {
    for (const row of rows.filter((r) => seatViolation(r) !== null)) {
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
        `::error title=A shared test account holds a Stripe account it may not::${b}. A seat Helpr with a half-set-up Stripe account cannot be hired (accept_job_offer: pending_setup), ` +
          "and no seat may hold any account but the sanctioned test-mode fixture. " +
          "Put it back with: node scripts/e2e/seatStripeAccounts.mjs --restore (service role; unlinks only violators).",
      );
    }
    process.exit(1);
  }
  const fixture = rows.filter((r) => r.stripe_account_id).map((r) => `${r.email} -> ${r.stripe_account_id} (payout-ready)`);
  console.log(`OK: none of the ${rows.length} test accounts holds a Stripe account it may not${fixture.length ? `; sanctioned test-mode fixture: ${fixture.join(", ")}` : ""}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
