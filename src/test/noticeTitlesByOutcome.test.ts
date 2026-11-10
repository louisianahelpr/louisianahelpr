/**
 * Whole-app audit 11-10 (Worker 6), wording only (migration 20261110202142):
 *   F503 the Declutter decision notices used ONE title, "Louisiana Helpr decided", for four outcomes; each outcome now
 *        has its own title (<=40 characters), and declutter_notice_type keeps them on declutter_refunds.
 *   F478 "or Helpr support steps in" says what happens; F480 "counter" -> "send a different price";
 *   F505 no "Elite shield" metaphor.
 * Reads the NEWEST definition of each function (effectiveDefs), comments blanked.
 *
 * @mutate supabase/migrations/20261110202142_notice_titles_by_outcome_plain_words.sql | PERFORM public.declutter_notify(o.buyer_id, 'payment', 'We reviewed your delivery problem', | PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Louisiana Helpr decided',
 * @mutate supabase/migrations/20261110202142_notice_titles_by_outcome_plain_words.sql | 'Sale is final', 'The free handover stands', 'Free pickup cancelled', | 'The free handover stands', 'Free pickup cancelled',
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const code = (fn: string) => {
  const s = blankSqlComments(defs.get(fn)?.stmt ?? "");
  expect(s.length, fn).toBeGreaterThan(200);
  return s;
};
const TITLES = ["Sale is final", "The free handover stands", "Free pickup cancelled", "Part refund on your Declutter order",
  "Refund on your Declutter order", "We reviewed your delivery problem"];

describe("11-10 notice wording", () => {
  it("F503: no decision notice is titled 'Louisiana Helpr decided'; each outcome has its own short title", () => {
    const problem = code("declutter_admin_decide_problem");
    const damage = code("declutter_admin_decide_delivery_damage");
    for (const s of [problem, damage]) expect(s).not.toMatch(/declutter_notify\([^,]+,\s*'payment',\s*'Louisiana Helpr decided'/);
    for (const t of TITLES.slice(0, 5)) expect(problem).toContain(`'${t}'`);
    expect((damage.match(/'We reviewed your delivery problem'/g) ?? []).length).toBe(2);
    for (const t of TITLES) expect(t.length).toBeLessThanOrEqual(40);
  });

  it("F503: declutter_notice_type files every new title under declutter_refunds", () => {
    const nt = code("declutter_notice_type");
    const refunds = /WHEN p_title IN \(([^)]*'Louisiana Helpr decided'[^)]*)\)\s*THEN 'declutter_refunds'/.exec(nt)?.[1] ?? "";
    expect(refunds.length).toBeGreaterThan(100);
    for (const t of TITLES) expect(refunds).toContain(`'${t}'`);
  });

  it("F478/F480/F505: plain words", () => {
    expect(code("notify_poster_on_status_change")).not.toContain("steps in");
    expect((code("notify_poster_on_status_change").match(/our team reviews it and tells you what happens next/g) ?? []).length).toBe(2);
    for (const fn of ["declutter_make_offer", "declutter_respond_offer", "declutter_wanted_reply"]) {
      expect(code(fn)).toContain("send a different price within 48 hours");
      expect(code(fn)).not.toMatch(/counter (within|or decline)/);
    }
    expect(code("apply_job_denial_consequence")).not.toContain("shield absorbed");
    expect(code("apply_job_denial_consequence")).toContain("'Elite protection covered this strike'");
  });
});
