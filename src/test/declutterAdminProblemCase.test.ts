/**
 * AL-4 (owner 2026-10-28 anti-lying measures, "One dispute screen for admin"): for a reported Declutter problem an
 * admin reads the order's own step facts and the Helpr's pickup and drop-off photos with their times and the drop-off
 * distance (migration 20261029011313, declutter_admin_problem_case). Reads the EFFECTIVE definition.
 *
 * Behaviour on a real database: src/test/pglite/declutterHandoverChoices.pglite.mjs T10 (3x; AL4_MIGRATION=skip 8 FAIL;
 * RED on 5 planted defects: no admin check, the drop-off distance dropped, anon granted, the Helpr task not joined,
 * an unknown problem answered).
 *
 * Pinned, each shown red by the @mutate below it:
 *   1. admins only, checked FIRST; no switch gate (row 62);
 *   2. the columns: facts and photo paths only, never a name, id, address or the drop-off code;
 *   3. the facts come from the order's own rows (booking, seller delivery, the Helpr task through the order's delivery);
 *   4. never PUBLIC or anon;
 *   5. B48 (20261101020052, lead 10-31): one more column, helpr_has_delivery_strike, a yes/no only: the ids it reads stay
 *      inside its EXISTS (the same test helpr_task_give_job_strike uses). Proof: declutterAdminHelprFault.pglite.mjs.
 * @mutate supabase/migrations/20261101020052_helpr_task_released_helpr.sql |                AND v.violation_type = 'delivery_no_show' |                AND v.violation_type = 'delivery_damage'
 * @mutate supabase/migrations/20261101020052_helpr_task_released_helpr.sql |   IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN | IF false THEN
 * @mutate supabase/migrations/20261101020052_helpr_task_released_helpr.sql | t.delivered_at, t.dropoff_photo_path, t.dropoff_distance_m | t.delivered_at, t.dropoff_photo_path, t.dropoff_code
 * @mutate supabase/migrations/20261101020052_helpr_task_released_helpr.sql |       LEFT JOIN public.helpr_tasks t ON t.id = od.task_id |       LEFT JOIN public.helpr_tasks t ON t.source_id = o.id
 * @mutate supabase/migrations/20261101020052_helpr_task_released_helpr.sql | REVOKE ALL ON FUNCTION public.declutter_admin_problem_case(uuid) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_admin_problem_case(uuid) FROM PUBLIC;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = resolve(__dirname, "../../supabase/migrations");
const DEFS = effectiveDefs(MIG);
const def = DEFS.get("declutter_admin_problem_case");
const flat = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ");
const grants = blankSqlComments(def ? readFileSync(join(MIG, def.file.split("/").pop()!), "utf8") : "").replace(/\s+/g, " ");

describe("AL-4: an admin reads a reported problem's order facts and Helpr photos", () => {
  it("reads the newest definition (floor)", () => {
    expect(def?.file ?? "").toContain("20261101020052_helpr_task_released_helpr.sql");
    expect(flat.length).toBeGreaterThan(900);
  });

  it("admins only, checked first; no switch gate (row 62)", () => {
    expect(flat).toMatch(/AS \$fn\$ BEGIN IF NOT public\.has_role\(\(SELECT auth\.uid\(\)\), 'admin'::public\.app_role\) THEN RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';/);
    expect(flat).not.toContain("require_feature");
    expect(flat).toContain("SECURITY DEFINER SET search_path TO 'public', 'pg_temp'");
  });

  it("returns facts and photo paths only, never a name, id, address or code", () => {
    const table = /RETURNS TABLE\((.*?)\) LANGUAGE/.exec(flat)?.[1] ?? "";
    const cols = table.split(",").map((c) => c.trim().split(" ")[0]);
    expect(cols).toEqual(["handover", "order_status", "slot_start", "pickup_day", "seller_delivery_status", "seller_delivery_slot_start",
      "seller_delivered_at", "helpr_accepted_at", "helpr_picked_up_at", "helpr_pickup_photo_path", "helpr_delivered_at",
      "helpr_dropoff_photo_path", "helpr_dropoff_distance_m", "helpr_has_delivery_strike"]);
    expect(table).toContain("helpr_has_delivery_strike boolean");
    // The select list itself (between RETURN QUERY SELECT and its FROM): no person, place or code column. The last
    // column is a yes/no whose ids stay inside its EXISTS; cut it out first, then check what is left.
    const whole = flat.slice(flat.indexOf("RETURN QUERY SELECT"), flat.indexOf(" FROM public.declutter_problems p JOIN"));
    const STRIKE = /, \(t\.id IS NOT NULL AND EXISTS \( SELECT 1 FROM public\.user_violations v WHERE v\.user_id = COALESCE\(t\.helpr_id, t\.released_helpr_id\) AND v\.violation_type = 'delivery_no_show' AND v\.description LIKE '%\(task ' \|\| t\.id::text \|\| '\)'\)\)$/;
    expect(whole).toMatch(STRIKE);
    const select = whole.replace(STRIKE, "");
    expect(select.split(",").length).toBe(13);
    expect(select).not.toMatch(/_id\b|address|dropoff_code|full_name|email/);
  });

  it("the facts are the order's own rows", () => {
    expect(flat).toContain("FROM public.declutter_problems p JOIN public.declutter_orders o ON o.id = p.order_id LEFT JOIN public.declutter_bookings b ON b.order_id = o.id LEFT JOIN public.declutter_seller_deliveries sd ON sd.order_id = o.id LEFT JOIN public.declutter_order_deliveries od ON od.order_id = o.id LEFT JOIN public.helpr_tasks t ON t.id = od.task_id WHERE p.id = p_problem_id;");
  });

  it("never PUBLIC or anon", () => {
    expect(grants).toContain("REVOKE ALL ON FUNCTION public.declutter_admin_problem_case(uuid) FROM PUBLIC, anon;");
    expect(grants).toContain("GRANT EXECUTE ON FUNCTION public.declutter_admin_problem_case(uuid) TO authenticated, service_role;");
  });
});
