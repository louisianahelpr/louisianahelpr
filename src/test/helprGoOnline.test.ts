/**
 * "Go online for deliveries" (Q2440, owner-approved 2026-10-27). Reads the NEWEST definitions
 * (effectiveDefs, any dollar-quote tag) and pins what a later restatement must keep:
 *   - going online passes the delivery gate (helpr_task_assert_helpr) behind the member switch;
 *   - the stored point is never finer than 2 decimals (the table CHECK and the RPC both);
 *   - an offer goes only to a Helpr online NOW, within their radius of the ~1 km pickup point, who
 *     could take the delivery (re-checked at offer time);
 *   - the offer names pay, miles and the pickup area only, and never blocks the task's creation;
 *   - members read only their own row and write none.
 * Backend proof, six planted defects each RED: src/test/pglite/helprGoOnline.pglite.mjs.
 *
 * @mutate supabase/migrations/20261027203030_helpr_go_online_for_deliveries.sql |      WHERE h.online_until > now() AND h.near_lat IS NOT NULL |      WHERE h.near_lat IS NOT NULL
 * @mutate supabase/migrations/20261027203030_helpr_go_online_for_deliveries.sql |        AND NOT public.are_users_blocked(h.user_id, NEW.customer_id)\n |        AND true\n
 * @mutate supabase/migrations/20261027203030_helpr_go_online_for_deliveries.sql |     v_lat := round(p_lat, 2); |     v_lat := p_lat;
 * @mutate supabase/migrations/20261027203030_helpr_go_online_for_deliveries.sql |   v_uid := public.helpr_task_assert_helpr();\n  IF p_hours |   v_uid := (SELECT auth.uid());\n  IF p_hours
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const DEFS = effectiveDefs(MIG);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const all = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8"))).join("\n").replace(/\s+/g, " ");

describe("Go online for deliveries", () => {
  it("the inventory read something", () => {
    for (const fn of ["helpr_go_online", "helpr_task_offer_online"]) expect(body(fn).length, fn).toBeGreaterThan(300);
  });

  it("going online passes the delivery gate behind the member switch; going offline never needs it", () => {
    const fn = body("helpr_go_online");
    expect(fn.indexOf("helpr_task_source_require_feature('declutter_delivery')")).toBeGreaterThan(0);
    expect(fn).toMatch(/v_uid := public\.helpr_task_assert_helpr\(\); IF p_hours/);
    expect(fn).toMatch(/IF NOT p_on THEN .* UPDATE public\.helpr_delivery_online SET online_until = NULL, near_lat = NULL, near_lng = NULL/);
    // Going offline needs no switch; going online does (lh-authz-rls review #2).
    expect(fn.indexOf("IF NOT p_on THEN")).toBeLessThan(fn.indexOf("helpr_task_source_require_feature('declutter_delivery')"));
  });

  it("the stored point is never finer than ~1 km", () => {
    expect(body("helpr_go_online")).toMatch(/v_lat := round\(p_lat, 2\); v_lng := round\(p_lng, 2\);/);
    expect(all).toContain("near_lat numeric CHECK (near_lat IS NULL OR (near_lat BETWEEN -90 AND 90 AND near_lat = round(near_lat, 2)))");
    expect(all).toContain("near_lng numeric CHECK (near_lng IS NULL OR (near_lng BETWEEN -180 AND 180 AND near_lng = round(near_lng, 2)))");
  });

  it("an offer goes only to an online, nearby Helpr who could take it, names no address, and never blocks the task", () => {
    const t = body("helpr_task_offer_online");
    expect(t).toContain("WHERE h.online_until > now() AND h.near_lat IS NOT NULL");
    expect(t).toContain("round(NEW.pickup_lat, 2), round(NEW.pickup_lng, 2)) <= h.radius_miles * 1609.344");
    expect(t).toMatch(/format\('\$%s · %s mi · pickup in %s', \(v_pay \/ 100\)::text, NEW\.trip_miles, NEW\.pickup_area\)/);
    expect(t).not.toMatch(/pickup_address|dropoff_address|dropoff_area|_lat::text|fee_cents\)::text/);
    expect(t).toMatch(/EXCEPTION WHEN OTHERS THEN RAISE WARNING/);
    for (const clause of ["NOT public.member_under_18(h.user_id)", "public.declutter_active_strike_count(h.user_id) < 3", "'payout_setup' = ANY (public.helper_accept_missing(h.user_id))",
      "public.helpr_task_vehicle_fits(h.user_id, NEW.size)", "NOT public.are_users_blocked(h.user_id, NEW.customer_id)", "NOT public.are_users_blocked(h.user_id, NEW.pickup_contact_id)",
      "public.helpr_task_same_stripe_mode(h.user_id, NEW.customer_id)", "h.user_id IS DISTINCT FROM NEW.customer_id AND h.user_id IS DISTINCT FROM NEW.pickup_contact_id",
      "NOT IN ('banned', 'temp_banned', 'permanently_banned')", "public.feature_enabled_for_user('declutter', h.user_id)"]) {
      expect(t, clause).toContain(clause);
    }
  });

  it("members read only their own row and write none; the RPC is not anon's", () => {
    expect(all).toContain("REVOKE ALL ON TABLE public.helpr_delivery_online FROM PUBLIC, anon, authenticated; GRANT SELECT ON TABLE public.helpr_delivery_online TO authenticated;");
    expect(all).toContain("FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()))");
    expect(all).toContain("REVOKE ALL ON FUNCTION public.helpr_go_online(boolean, integer, numeric, numeric, integer) FROM PUBLIC, anon;");
  });
});
