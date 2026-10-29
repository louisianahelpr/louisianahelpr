/**
 * Porch weekdays (migration 20261029161347; owner 2026-10-29, builder 23's leftover). The days a buyer
 * is OFFERED (declutter_porch_days) and the days a booking ACCEPTS (declutter_book_porch_day) must come
 * from the same rule, or a day the screen offers is refused at booking. Both newest definitions call
 * the one helper declutter_is_porch_day and neither reads the pickup windows on its own; the helper is
 * internal; the setter is behind the 'declutter' switch and the ban check. Behaviour per account:
 * src/test/pglite/declutterPorchWeekdays.pglite.mjs.
 *
 * @mutate supabase/migrations/20261029161347_declutter_porch_weekdays.sql |        AND public.declutter_is_porch_day(o.seller_id, extract(dow FROM d::date)::smallint) |        AND EXISTS (SELECT 1 FROM public.declutter_pickup_windows w WHERE w.seller_id = o.seller_id AND w.weekday = extract(dow FROM d::date)::smallint)
 * @mutate supabase/migrations/20261029161347_declutter_porch_weekdays.sql |   IF NOT public.declutter_is_porch_day(o.seller_id, extract(dow FROM p_day)::smallint) THEN |   IF false THEN
 * @mutate supabase/migrations/20261029161347_declutter_porch_weekdays.sql | REVOKE ALL ON FUNCTION public.declutter_is_porch_day(uuid, smallint) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.declutter_is_porch_day(uuid, smallint) FROM PUBLIC, anon;
 * @mutate supabase/migrations/20261029161347_declutter_porch_weekdays.sql |   PERFORM public.require_feature('declutter');\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  IF p_weekdays | IF p_weekdays
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const DEFS = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const body = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "").replace(/\s+/g, " ");
const MIG = blankSqlComments(readFileSync(join(process.cwd(), "supabase/migrations/20261029161347_declutter_porch_weekdays.sql"), "utf8")).replace(/\s+/g, " ");

describe("porch days: offered and accepted share one rule", () => {
  it("reads the newest definitions (floors)", () => {
    for (const fn of ["declutter_porch_days", "declutter_book_porch_day", "declutter_is_porch_day", "declutter_set_porch_days"]) {
      expect(body(fn).length, fn).toBeGreaterThan(300);
    }
  });

  it("both porch functions use declutter_is_porch_day and never read the pickup windows themselves", () => {
    for (const fn of ["declutter_porch_days", "declutter_book_porch_day"]) {
      expect(body(fn), fn).toMatch(/public\.declutter_is_porch_day\(o\.seller_id, extract\(dow FROM/);
      expect(body(fn), fn).not.toMatch(/declutter_pickup_windows/);
    }
    expect(body("declutter_book_porch_day")).toMatch(/IF NOT public\.declutter_is_porch_day\(o\.seller_id, extract\(dow FROM p_day\)::smallint\) THEN RAISE EXCEPTION 'invalid_day'/);
  });

  it("the helper: the seller's picked days, else the pickup-time days; internal only", () => {
    const h = body("declutter_is_porch_day");
    expect(h).toMatch(/declutter_seller_porch_days/);
    expect(h).toMatch(/ELSE EXISTS \(SELECT 1 FROM public\.declutter_pickup_windows w WHERE w\.seller_id = p_seller AND w\.weekday = p_dow\)/);
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.declutter_is_porch_day(uuid, smallint) FROM PUBLIC, anon, authenticated;");
  });

  it("the setter is the caller's own row, behind the switch and the ban check; anon cannot call it", () => {
    const s = body("declutter_set_porch_days");
    expect(s).toMatch(/PERFORM public\.require_feature\('declutter'\); IF public\.is_caller_banned\(\) THEN RAISE EXCEPTION 'account_restricted'/);
    expect(s).toMatch(/VALUES \(v_uid, v_days\)/);
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.declutter_set_porch_days(smallint[]) FROM PUBLIC, anon;");
    expect(MIG).toContain("REVOKE INSERT, UPDATE, DELETE ON public.declutter_seller_porch_days FROM authenticated;");
  });
});
