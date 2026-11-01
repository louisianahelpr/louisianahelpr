/**
 * A strike for a proven false report (Declutter anti-lying #5, owner 2026-10-28; migration
 * 20261029000048_declutter_false_report_strike). When an admin decides a reported problem was false, the REPORTER
 * gets a Declutter strike, reason 'false_report', through the existing system (3 active = locked out). Read from
 * the NEWEST definitions (effectiveDefs) and the newest strike-reason CHECK, comments blanked, so a later
 * restatement that drops the strike, its guard rails or the grant fails here.
 *
 * Behaviour (30 checks, applied 3x; NEW_MIGRATION=skip = 19 FAIL; 7 planted defects each caught, measured
 * 2026-10-28): src/test/pglite/declutterFalseReportStrike.pglite.mjs. The admin screen's explicit choice:
 * src/components/admin/settings/DeclutterProblemsCard.test.tsx.
 *
 * @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |   IF p_false_report THEN\n    UPDATE public.declutter_problems SET strike_given = true | IF false THEN\n    UPDATE public.declutter_problems SET strike_given = true
 * @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |     PERFORM public.declutter_give_strike(p.reporter_id, p.reporter_side, 'false_report', |     PERFORM public.declutter_give_strike(o.buyer_id, 'buyer', 'false_report',
 * @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |                          OR p_fault IS DISTINCT FROM p.reporter_side\n | \n
 * @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |                          OR p_decision IS DISTINCT FROM CASE p.reporter_side WHEN 'buyer' THEN 'pay_seller' ELSE 'refund_buyer' END) THEN | ) THEN
 * @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |      OR p_false_report IS NULL OR (p_false_report AND p_strike) THEN |      OR (p_false_report AND p_strike) THEN
 * @mutate supabase/migrations/20261029000048_declutter_false_report_strike.sql |     'not_as_described', 'fake_offer', 'false_report')); |     'not_as_described', 'fake_offer'));
 * @mutate supabase/migrations/20261029000048_declutter_false_report_strike.sql | boolean) FROM PUBLIC, anon; | boolean) FROM PUBLIC;
 * @mutate src/lib/declutter/handover.ts |     ...(falseReport ? { p_false_report: true } : {}), |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const SIG6 = "declutter_admin_decide_problem(uuid, text, text, boolean, text, boolean)";

/** Every migration, comments blanked, in order. */
const MIGS = migrationFiles(MIG_DIR).map((f) => ({ f, sql: blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8")) }));

describe("a strike for a proven false report (AL-5)", () => {
  const def = DEFS.get("declutter_admin_decide_problem");
  const body = flat(blankSqlComments(def?.stmt ?? ""));

  it("the newest decision takes the explicit choice, never NULL, never with a second strike on top", () => {
    // The newest definition is this migration or a later restatement of it (D2-5 20261029224147, D2-14 20261029231235).
    expect((def?.file ?? "") >= "20261029000048_declutter_false_report_strike.sql").toBe(true);
    expect(body).toContain("p_strike boolean, p_note text, p_false_report boolean DEFAULT false");
    expect(body).toContain("OR p_false_report IS NULL OR (p_false_report AND p_strike) THEN RAISE EXCEPTION 'invalid_decision'");
  });

  it("goes against the reporter only: a buyer's or seller's report, their side at fault, the other decision", () => {
    expect(body).toContain(
      "IF p_false_report AND (p.reporter_side NOT IN ('buyer', 'seller') OR p.reporter_id IS NULL OR p_fault IS DISTINCT FROM p.reporter_side "
      + "OR p_decision IS DISTINCT FROM CASE p.reporter_side WHEN 'buyer' THEN 'pay_seller' ELSE 'refund_buyer' END) THEN RAISE EXCEPTION 'false_report_mismatch'");
    // Checked before anything changes: before the problem is marked decided.
    expect(body.indexOf("'false_report_mismatch'")).toBeLessThan(body.indexOf("SET status = 'decided'"));
  });

  it("the REPORTER gets the strike, reason false_report, after the decision, and it is recorded", () => {
    const strike = body.indexOf("PERFORM public.declutter_give_strike(p.reporter_id, p.reporter_side, 'false_report',");
    expect(strike).toBeGreaterThan(body.indexOf("SET status = 'decided'"));
    expect(body).toContain("IF p_false_report THEN UPDATE public.declutter_problems SET strike_given = true WHERE id = p.id;");
    expect(body).toContain("'false_report', p_false_report,");
    // The existing system decides the lock-out: 3 active strikes (declutter_assert_member).
    expect(flat(blankSqlComments(DEFS.get("declutter_assert_member")?.stmt ?? ""))).toContain(
      "IF public.declutter_active_strike_count(v_uid) >= 3 THEN RAISE EXCEPTION 'declutter_strikes_blocked'");
  });

  it("the newest strike-reason CHECK allows false_report and keeps every reason before it", () => {
    let last: string | null = null;
    for (const { sql } of MIGS) {
      for (const m of sql.matchAll(/(?:ADD CONSTRAINT declutter_strikes_reason_check CHECK|reason text NOT NULL CHECK) \(reason IN \(([^)]*)\)\)/g)) {
        if (m[0].startsWith("reason text") && !/declutter_strikes/.test(sql.slice(Math.max(0, m.index! - 400), m.index!))) continue;
        last = m[1];
      }
    }
    const reasons = [...(last ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(reasons.length).toBeGreaterThan(7);
    expect(reasons).toEqual(["cancelled_after_offers", "fake_offer", "false_report", "item_gone_after_sale", "missed_checkout",
      "not_as_described", "not_picked_up", "seller_no_show"]);
  });

  it("one function for PostgREST, closed to anon, open to the signed-in admin screen", () => {
    const mine = MIGS.find((m) => m.f === "20261029000048_declutter_false_report_strike.sql")!.sql;
    expect(mine).toContain("DROP FUNCTION IF EXISTS public.declutter_admin_decide_problem(uuid, text, text, boolean, text);");
    expect(mine).toContain(`REVOKE ALL ON FUNCTION public.${SIG6} FROM PUBLIC, anon;`);
    expect(mine).toContain(`GRANT EXECUTE ON FUNCTION public.${SIG6} TO authenticated, service_role;`);
    // No later migration brings back the five-argument function.
    const later = MIGS.filter((m) => m.f > "20261029000048_declutter_false_report_strike.sql");
    expect(later.filter((m) => /FUNCTION public\.declutter_admin_decide_problem\(p_problem_id uuid, p_decision text, p_fault text,\s*p_strike boolean, p_note text\)/.test(m.sql))).toEqual([]);
  });

  it("the client sends the choice only when it is made (the five old arguments otherwise)", () => {
    const src = flat(blankComments(readFileSync(join(process.cwd(), "src/lib/declutter/handover.ts"), "utf8")));
    expect(src).toContain("...(falseReport ? { p_false_report: true } : {}),");
  });
});
