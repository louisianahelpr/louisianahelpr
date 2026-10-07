/**
 * Anyone can be hired; payout setup comes after the accept (owner, 2026-10-06:
 * "you can offer job to anyone, they would set it up after accepting. this is
 * not an exception, it's the rule"; "should also be set this way for
 * recurring"). Migration 20261007011530.
 *
 * Behaviour (red before, 3x replay): src/test/pglite/crewHireBeforePayout.pglite.mjs
 * (pglite is not a dependency, so CI holds the shape here).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");
const MIG = read("supabase/migrations/20261007011530_crew_hire_before_payout_setup.sql");
const fn = (name: string) => {
  const i = MIG.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(i, `${name} is restated`).toBeGreaterThan(-1);
  return MIG.slice(i, MIG.indexOf("$function$;", i));
};
const code = (s: string) => s.replace(/--.*$/gm, "");

describe("a crew hire is an offer: the payout gate is at the member's Confirm", () => {
  it("the roster's hire gate keeps the funding check and no longer judges payouts", () => {
    const g = code(fn("enforce_group_roster_award_gate"));
    expect(g).toMatch(/job_payment_is_funded\(v_payment\)/);
    expect(g).not.toMatch(/helper_award_block_reason|helper_accept_block_reason/);
  });

  it("an unready member's Confirm is recorded and answers pending_setup, never stamped", () => {
    const c = code(fn("rpc_group_member_confirm"));
    expect(c).toMatch(/helper_award_block_reason\(v_uid\) IS NOT NULL[\s\S]*INSERT INTO public\.crew_confirm_pending[\s\S]*RETURN jsonb_build_object\('action', 'pending_setup'/);
  });

  it("payouts ready completes the recorded Confirm from the profiles trigger, and the table is server-only", () => {
    expect(code(fn("complete_pending_crew_confirms_on_setup"))).toMatch(/SET helper_confirmed_at = now\(\)/);
    expect(MIG).toMatch(/CREATE TRIGGER trg_profiles_complete_pending_crew_confirms\s+AFTER UPDATE OF stripe_account_id, stripe_payouts_enabled ON public\.profiles/);
    expect(MIG).toMatch(/ALTER TABLE public\.crew_confirm_pending ENABLE ROW LEVEL SECURITY/);
    expect(MIG).toMatch(/REVOKE ALL ON public\.crew_confirm_pending FROM PUBLIC, anon, authenticated/);
  });

  it("the app opens the Set Up Payouts pop-up on a pending crew Confirm", () => {
    expect(read("src/lib/crewLifecycle.ts")).toMatch(/answer\.action === "pending_setup"/);
    const ui = read("src/pages/jobs/appliedJobCard/CrewMemberSection.tsx");
    expect(ui).toMatch(/"pendingMissing" in r/);
    expect(ui).toMatch(/<AwardGateDialog[\s\S]*pendingMissing=\{setupMissing\}/);
  });
});

describe("recurring: an unready Helpr picks up a vacated visit, confirmed once payouts are set up", () => {
  it("the pick-up confirms only a ready Helpr and records the accept otherwise", () => {
    const c = code(fn("claim_series_dates"));
    expect(c).toMatch(/v_ready := public\.helper_accept_block_reason\(v_uid\) IS NULL/);
    expect(c).toMatch(/helper_confirmed_at = CASE WHEN v_ready THEN now\(\) END/);
    expect(c).toMatch(/INSERT INTO public\.job_accept_pending \(job_id, helper_id\)/);
    expect(c).toMatch(/'pending_setup', to_jsonb\(v_pending\)/);
    // its answer-by time is the visit's start, so it expires unconfirmed then
    expect(c).toMatch(/ELSE \(v_d \+ COALESCE\(v_child_start, '00:00'::time\)\) AT TIME ZONE 'America\/Chicago' END/);
  });

  it("an unconfirmed pick-up that is reopened gives the date back (no stranded hold)", () => {
    expect(code(fn("release_series_hold_on_reopen"))).toMatch(/public\.series_release_dates\(NEW\.parent_job_id, OLD\.helper_id, ARRAY\[NEW\.date_needed\]/);
    expect(MIG).toMatch(/CREATE TRIGGER trg_release_series_hold_on_reopen\s+AFTER UPDATE OF helper_id ON public\.jobs[\s\S]*?OLD\.helper_confirmed_at IS NULL\)/);
  });

  it("the app reads pending_setup and opens the pop-up", () => {
    expect(read("src/lib/seriesDates.ts")).toMatch(/pendingSetup: r\.pending_setup \?\? \[\]/);
    expect(read("src/components/series/SeriesDatesPanel.tsx")).toMatch(/if \(r\.pendingSetup\.length > 0\) setSetupOpen\(true\)/);
  });
});
