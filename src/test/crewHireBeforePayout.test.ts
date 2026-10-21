/**
 * Anyone can be hired; payout setup comes after the accept (owner, 2026-10-06:
 * "you can offer job to anyone, they would set it up after accepting. this is
 * not an exception, it's the rule"; "should also be set this way for
 * recurring"). Migration 20261007011530.
 *
 * Behaviour (red before, 3x replay): src/test/pglite/crewHireBeforePayout.pglite.mjs
 * (pglite is not a dependency, so CI holds the shape here). *
 * @mutate src/lib/crewLifecycle.ts | answer.action === "pending_setup" | answer.action === "pending"
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");
// The NEWEST definition of each function (20261020043346, ID once, restated
// the member's Confirm and its completion on the one accept helper).
const DEFS = effectiveDefs(join(REPO, "supabase", "migrations"));
const fn = (name: string) => {
  const d = DEFS.get(name);
  expect(d, `${name} is defined`).toBeTruthy();
  return d!.stmt;
};
// The migration that created crew_confirm_pending (20261007011530), found by the
// newest definer of the roster gate it also restated, never pinned by name.
const MIG = read(`supabase/migrations/${DEFS.get("enforce_group_roster_award_gate")!.file}`);
const NEWEST_TRIGGER_SQL = read(`supabase/migrations/${DEFS.get("complete_pending_crew_confirms_on_setup")!.file}`);
const code = (s: string) => s.replace(/--.*$/gm, "");

describe("a crew hire is an offer: the payout gate is at the member's Confirm", () => {
  it("reads the real migration (inventory floor)", () => {
    expect(MIG.length).toBeGreaterThan(4000);
    expect(MIG.match(/CREATE OR REPLACE FUNCTION public\./g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("the roster's hire gate keeps the funding check and no longer judges payouts", () => {
    const g = code(fn("enforce_group_roster_award_gate"));
    expect(g).toMatch(/job_payment_is_funded\(v_payment\)/);
    expect(g).not.toMatch(/helper_award_block_reason|helper_accept_block_reason/);
  });

  it("an unready member's Confirm is recorded and answers pending_setup, never stamped", () => {
    const c = code(fn("rpc_group_member_confirm"));
    // ID once (20261020043346): judged by the one accept helper (payouts AND ID).
    expect(c).toMatch(/v_reason := public\.helper_accept_block_reason\(v_uid\);[\s\S]*IF v_reason IS NOT NULL THEN\s+INSERT INTO public\.crew_confirm_pending[\s\S]*RETURN jsonb_build_object\('action', 'pending_setup'/);
  });

  it("payouts ready completes the recorded Confirm from the profiles trigger, and the table is server-only", () => {
    expect(code(fn("complete_pending_crew_confirms_on_setup"))).toMatch(/SET helper_confirmed_at = now\(\)/);
    expect(code(fn("complete_pending_crew_confirms_on_setup"))).toMatch(/IF public\.helper_accept_block_reason\(NEW\.user_id\) IS NOT NULL THEN/);
    expect(NEWEST_TRIGGER_SQL).toMatch(/CREATE TRIGGER trg_profiles_complete_pending_crew_confirms\s+AFTER UPDATE OF stripe_account_id, stripe_payouts_enabled, stripe_identity_verified, idv_status ON public\.profiles/);
    expect(MIG).toMatch(/ALTER TABLE public\.crew_confirm_pending ENABLE ROW LEVEL SECURITY/);
    expect(MIG).toMatch(/REVOKE ALL ON public\.crew_confirm_pending FROM PUBLIC, anon, authenticated/);
  });

  it("the app opens the Set up payouts pop-up on a pending crew Confirm", () => {
    expect(read("src/lib/crewLifecycle.ts")).toMatch(/answer\.action === "pending_setup"/);
    const ui = read("src/pages/jobs/appliedJobCard/CrewMemberSection.tsx");
    expect(ui).toMatch(/"pendingMissing" in r/);
    expect(ui).toMatch(/<AwardGateDialog[\s\S]*pendingMissing=\{setupMissing\}/);
  });
});
