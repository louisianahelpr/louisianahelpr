/**
 * Q2416 (owner 2026-10-27, issue #3675): anyone eligible may see and take a Declutter delivery
 * WITHOUT payout setup; the pay waits for the account, the same rule as a hired Helpr
 * (payout_after_hire). Measured on prod before the fix: helpr_task_assert_helpr refused everyone
 * helper_award_block_reason blocked (payout setup only), 233 of 234 non-seed members.
 *
 * Reads the NEWEST definition (effectiveDefs replays every migration, any dollar-quote tag) of the
 * one gate every delivery RPC calls, and pins that its payout read is helper_accept_missing's
 * 'payout_setup' step (which honours payout_after_hire), never helper_award_block_reason.
 * Backend proof: src/test/pglite/deliveryTakeWithoutPayoutSetup.pglite.mjs (3x replay; NEW_MIGRATION=skip RED).
 *
 * @mutate supabase/migrations/20261027165232_delivery_take_without_payout_setup.sql |   v_missing := public.helper_accept_missing(v_uid);\n  IF 'unknown' = ANY (v_missing) OR 'payout_setup' = ANY (v_missing) THEN |   IF public.helper_award_block_reason(v_uid) IS NOT NULL THEN
 * @mutate supabase/migrations/20261027165232_delivery_take_without_payout_setup.sql |   IF public.declutter_active_strike_count(v_uid) >= 3 THEN |   IF false THEN
 */
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const DEFS = effectiveDefs(join(REPO, "supabase", "migrations"));
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

describe("a Declutter delivery is taken without payout setup (Q2416)", () => {
  it("the inventory read something: the gate and its callers exist", () => {
    const callers = [...DEFS.keys()].filter((n) => /\bhelpr_task_assert_helpr\s*\(\s*\)/.test(body(n)) && n !== "helpr_task_assert_helpr");
    expect(callers.length).toBeGreaterThan(2);
    expect(body("helpr_task_assert_helpr").length).toBeGreaterThan(200);
  });

  it("the gate reads payout readiness only through helper_accept_missing (payout_after_hire), never helper_award_block_reason", () => {
    const gate = body("helpr_task_assert_helpr");
    expect(gate).not.toMatch(/helper_award_block_reason\s*\(/);
    expect(gate).toMatch(/helper_accept_missing\s*\(\s*v_uid\s*\)/);
    expect(gate).toMatch(/'payout_setup'\s*=\s*ANY/);
  });

  it("the other refusals stay: no session, banned, under 18, 3 Declutter strikes", () => {
    const gate = body("helpr_task_assert_helpr");
    for (const code of ["not_authenticated", "account_restricted", "under_18", "declutter_strikes_blocked"]) expect(gate).toContain(`'${code}'`);
    expect(gate).toMatch(/declutter_active_strike_count\(v_uid\)\s*>=\s*3/);
  });

  it("the accept still reads the ONE accept helper (the ID step), unchanged", () => {
    expect(body("helpr_task_accept")).toMatch(/helper_accept_block_reason\s*\(\s*v_uid\s*\)/);
  });
});
