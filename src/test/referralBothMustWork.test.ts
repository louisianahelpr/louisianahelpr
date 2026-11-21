/**
 * Owner 2026-10-27: a referral pays NEITHER person until BOTH have a completed
 * job of their own (posted or worked); then both get $5 together.
 * PGlite: src/test/pglite/referralBothMustWork.pglite.mjs (ALL PASS; 2 FAIL without the migration).
 *
 * @mutate supabase/migrations/20261121035500_referral_bonus_counts_declutter.sql |     CONTINUE WHEN NOT (public.referral_member_has_completed_job(v_ref.referrer_id) |     CONTINUE WHEN NOT (true
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

  // Audit 11-20 night #23 (owner 2026-11-19): a paid, handed-over Declutter order counts too.
  // PGlite: src/test/pglite/referralCountsDeclutter.pglite.mjs (ALL PASS; 5 FAIL without 20261121035500).
  it("a handed-over paid Declutter order qualifies, and handing one over settles both parties", () => {
    const has = blankSqlComments(defs.get("referral_member_has_completed_job")?.stmt ?? "");
    expect(has).toMatch(/FROM public\.jobs j/);
    expect(has).toMatch(/FROM public\.declutter_orders o\s+WHERE o\.status = 'handed_over' AND o\.items_cents > 0 AND NOT o\.is_seed/);
    const trg = blankSqlComments(defs.get("check_referral_bonus_declutter")?.stmt ?? "");
    expect(trg).toMatch(/referral_settle_for\(NEW\.buyer_id, NULL\)/);
    expect(trg).toMatch(/referral_settle_for\(NEW\.seller_id, NULL\)/);
  });
});
