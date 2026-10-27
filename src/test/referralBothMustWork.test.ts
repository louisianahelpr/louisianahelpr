/**
 * Owner 2026-10-27: a referral pays NEITHER person until BOTH have a completed
 * job of their own (posted or worked); then both get $5 together.
 * PGlite: src/test/pglite/referralBothMustWork.pglite.mjs (ALL PASS; 2 FAIL without the migration).
 *
 * @mutate supabase/migrations/20261027201034_referral_bonus_needs_a_job_from_each.sql |     CONTINUE WHEN NOT (public.referral_member_has_completed_job(v_ref.referrer_id) |     CONTINUE WHEN NOT (true
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(join(__dirname, "..", "..", "supabase", "migrations"));

describe("referral bonus: both people must finish a job first", () => {
  it("the job-completed trigger settles each party through referral_settle_for", () => {
    const body = blankSqlComments(defs.get("check_referral_bonus")?.stmt ?? "");
    expect(body).toMatch(/referral_settle_for\(NEW\.helper_id, NEW\.id\)/);
    expect(body).toMatch(/referral_settle_for\(NEW\.customer_id, NEW\.id\)/);
    expect(body).not.toMatch(/INSERT INTO public\.referral_credits/);
  });

  it("nothing is paid unless BOTH the referrer and the referred member have a completed job", () => {
    const body = blankSqlComments(defs.get("referral_settle_for")?.stmt ?? "");
    expect(body).toMatch(/CONTINUE WHEN NOT \(public\.referral_member_has_completed_job\(v_ref\.referrer_id\)\s+AND public\.referral_member_has_completed_job\(v_ref\.referred_id\)\)/);
  });
});
