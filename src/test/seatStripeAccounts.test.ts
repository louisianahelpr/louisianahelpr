/*
 * CLASS GUARD: the shared test accounts hold no Stripe Connect account, and
 * every sweep says so by name when one does.
 *
 * nightly-red #2436 (e2e-journeys 38749234414, 38882683467): helper-e2e
 * was given a half-onboarded TEST-mode Express account
 * (acct_1UQigP3qNyg1xGcp, created 2026-10-15 07:02Z by a stripe-connect POST
 * from a local node script). helper_accept_missing's is_seed carve-out only
 * holds with NO Stripe account, so accept_job_offer answered pending_setup
 * {payout_setup, stripe_id}: hire-settle-tip failed, and every settle-forward
 * of a stranded escrow job with it. The runs failed on those symptoms; the
 * cause was named nowhere (seedStateFixtures.mjs printed a NOTE, CI never ran it).
 *
 *   1. stripeSeatViolations flags exactly the measured incident row (the
 *      fixture half-onboarded), and allows only the sanctioned TEST-mode
 *      fixture pair once payout-ready (Q?journeys-tip-fixture, lead decision
 *      2026-10-17): any other account on any seat, or the fixture on another
 *      seat, or a column the read did not return, is still a violation.
 *   2. The sweeper reads BOTH seats with their own tokens and fails on a
 *      violation in every phase (pre and teardown), not only teardown.
 *   3. --restore is the reset stripe-connect does, scoped to the id it read
 *      and to is_seed rows, and touches nothing at Stripe.
 *   4. e2e-journeys runs the roster check before its pre sweep.
 */

// @mutate scripts/e2e/seatStripeAccounts.mjs |   if (!r \|\| !r.stripe_account_id) return null; |   if (!r \|\| !r.stripe_account_id \|\| r.stripe_payouts_enabled) return null;
// @mutate scripts/e2e/seatStripeAccounts.mjs |   if (SANCTIONED_TEST_CONNECT_ACCOUNTS[r.user_id] !== r.stripe_account_id) return |   if (!Object.values(SANCTIONED_TEST_CONNECT_ACCOUNTS).includes(r.stripe_account_id)) return
// @mutate scripts/e2e/seatStripeAccounts.mjs |   return r.stripe_payouts_enabled === true && r.stripe_charges_enabled === true && |   return r.stripe_payouts_enabled === true &&
// @mutate scripts/e2e/seatStripeAccounts.mjs |   if (r.is_seed !== true) return | if (false) return
// @mutate scripts/e2e/seatStripeAccounts.mjs |     for (const row of rows.filter((r) => seatViolation(r) !== null)) { |     for (const row of rows.filter((r) => r.stripe_account_id)) {
// @mutate scripts/e2e/prod-lifecycle-sweeper.mjs | &select=${SEAT_COLUMNS}` | &select=user_id,email,stripe_account_id`
// @mutate scripts/e2e/prod-lifecycle-sweeper.mjs |   failures.push(`seat Stripe account: ${v}`); |   if (PHASE === "teardown") failures.push(`seat Stripe account: ${v}`);
// @mutate scripts/e2e/prod-lifecycle-sweeper.mjs |   if (HELPER_TOKEN) seats.push([HELPER_TOKEN, HELPER_ID]); |   void HELPER_ID;
// @mutate scripts/e2e/seatStripeAccounts.mjs | &stripe_account_id=eq.${encodeURIComponent(row.stripe_account_id)}&is_seed=is.true& | &
// @mutate .github/workflows/e2e-journeys.yml |         run: node scripts/e2e/seatStripeAccounts.mjs $RESTORE |         run: echo skipped

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { RESET_FIELDS, SANCTIONED_TEST_CONNECT_ACCOUNTS, SEAT_COLUMNS, stripeSeatViolations } from "../../scripts/e2e/seatStripeAccounts.mjs";
import { blankComments } from "./helpers/blankNonCode";
import { ACCOUNTS } from "../../scripts/test-signin-link.mjs";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("nightly-red #2436: a test seat with a Stripe account is named, in every sweep", () => {
  it("flags the measured incident row and nothing else", () => {
    // profiles read on prod 2026-10-17 (two of the test_accounts roster).
    const rows = [
      { user_id: ACCOUNTS["helper-e2e"].userId, email: ACCOUNTS["helper-e2e"].email, stripe_account_id: "acct_1UQigP3qNyg1xGcp" },
      { user_id: ACCOUNTS["poster-e2e"].userId, email: ACCOUNTS["poster-e2e"].email, stripe_account_id: null },
    ];
    const bad = stripeSeatViolations(rows);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toContain("acct_1UQigP3qNyg1xGcp");
    expect(bad[0]).toContain(ACCOUNTS["helper-e2e"].email);
    expect(stripeSeatViolations([rows[1]])).toEqual([]);
  });

  it("allows only the sanctioned TEST-mode fixture pair, and only while payout-ready", () => {
    const helper = ACCOUNTS["helper-e2e"];
    const poster = ACCOUNTS["poster-e2e"];
    // Exactly one pair, and it is helper-e2e's own account.
    expect(SANCTIONED_TEST_CONNECT_ACCOUNTS).toEqual({ [helper.userId]: "acct_1UQigP3qNyg1xGcp" });
    const ready = { user_id: helper.userId, email: helper.email, is_seed: true, stripe_account_id: "acct_1UQigP3qNyg1xGcp", stripe_payouts_enabled: true, stripe_charges_enabled: true, stripe_identity_verified: true, idv_status: "not_started" };
    expect(stripeSeatViolations([ready]), "the ready fixture is allowed").toEqual([]);
    // idv_status 'verified' is identity too (identity_is_verified).
    expect(stripeSeatViolations([{ ...ready, stripe_identity_verified: false, idv_status: "verified" }])).toEqual([]);
    // Half-onboarded (the incident), each half alone, or a column not read: a violation.
    for (const bad of [
      { ...ready, stripe_payouts_enabled: false },
      { ...ready, stripe_charges_enabled: false },
      { ...ready, stripe_identity_verified: false },
      { ...ready, stripe_payouts_enabled: undefined },
      { user_id: helper.userId, email: helper.email, is_seed: true, stripe_account_id: "acct_1UQigP3qNyg1xGcp" },
    ]) {
      const v = stripeSeatViolations([bad]);
      expect(v, JSON.stringify(bad)).toHaveLength(1);
      expect(v[0]).toContain("not payout-ready");
    }
    // A seat that lost is_seed would be paid on the live key: a violation.
    expect(stripeSeatViolations([{ ...ready, is_seed: false }])[0]).toContain("not is_seed");
    expect(stripeSeatViolations([{ ...ready, is_seed: undefined }])[0]).toContain("not is_seed");
    // Another account on the fixture's seat, or the fixture on another seat: a violation even when ready.
    expect(stripeSeatViolations([{ ...ready, stripe_account_id: "acct_1SomeOtherAcct00" }])[0]).toContain("not the sanctioned");
    expect(stripeSeatViolations([{ ...ready, user_id: poster.userId, email: poster.email }])[0]).toContain("not the sanctioned");
  });

  it("every seat read selects every column the rule needs", () => {
    for (const col of ["is_seed", "stripe_account_id", "stripe_payouts_enabled", "stripe_charges_enabled", "stripe_identity_verified", "idv_status"]) {
      expect(SEAT_COLUMNS.split(","), col).toContain(col);
    }
    const sweeper = blankComments(read("scripts/e2e/prod-lifecycle-sweeper.mjs"));
    expect(sweeper).toContain("&select=${SEAT_COLUMNS}`");
    const seat = blankComments(read("scripts/e2e/seatStripeAccounts.mjs"));
    expect(seat).toContain("profiles?select=${SEAT_COLUMNS}&");
    // --restore unlinks violators only, never the ready fixture.
    expect(seat).toContain("rows.filter((r) => seatViolation(r) !== null)");
  });

  it("restore clears exactly what stripe-connect's reset clears", () => {
    const connect = read("supabase/functions/stripe-connect/index.ts");
    const resetBlock = connect.slice(connect.indexOf("const resetClear"), connect.indexOf(".eq(\"user_id\", user.id)", connect.indexOf("const resetClear")));
    for (const [k, v] of Object.entries(RESET_FIELDS)) expect(resetBlock, `reset clears ${k}`).toContain(`${k}: ${String(v)}`);
    expect(Object.keys(RESET_FIELDS)).toHaveLength(4);
  });

  it("restore is scoped to the id it read and to is_seed rows, and never calls Stripe", () => {
    const src = blankComments(read("scripts/e2e/seatStripeAccounts.mjs"));
    expect(src).toMatch(/stripe_account_id=eq\.\$\{encodeURIComponent\(row\.stripe_account_id\)\}&is_seed=is\.true/);
    expect(src).not.toMatch(/api\.stripe\.com|stripe\.accounts/);
    expect(src).toMatch(/if \(bad\.length\) \{[\s\S]*process\.exit\(1\)/);
  });

  it("the sweeper reads both seats and fails on a violation in every phase", () => {
    const src = blankComments(read("scripts/e2e/prod-lifecycle-sweeper.mjs"));
    expect(src).toContain("if (HELPER_TOKEN) seats.push([HELPER_TOKEN, HELPER_ID]);");
    const at = src.indexOf("for (const v of await seatStripeViolations())");
    expect(at, "the sweeper never checks the seats").toBeGreaterThan(0);
    const body = src.slice(at, src.indexOf("\n}", at) + 2);
    expect(body).toContain("failures.push(`seat Stripe account: ${v}`);");
    expect(body, "the seat check must not be teardown-only").not.toMatch(/PHASE/);
    // Before the sweep's verdict, so it reaches the exit code.
    expect(at).toBeLessThan(src.indexOf("if (failures.length)"));
  });

  it("e2e-journeys checks the roster before its pre sweep", () => {
    const wf = parse(read(".github/workflows/e2e-journeys.yml")) as { jobs: Record<string, { steps?: Array<{ name?: string; run?: string; env?: Record<string, string> }> }> };
    let checked = 0;
    for (const job of Object.values(wf.jobs)) {
      const steps = job.steps ?? [];
      const check = steps.findIndex((s) => /node scripts\/e2e\/seatStripeAccounts\.mjs/.test(s.run ?? ""));
      const pre = steps.findIndex((s) => s.env?.SWEEP_PHASE === "pre");
      if (check < 0) continue;
      checked++;
      expect(pre, "the roster check runs before the pre sweep").toBeGreaterThan(check);
    }
    expect(checked).toBeGreaterThan(0);
  });
});
