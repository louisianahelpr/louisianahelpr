/**
 * "My route" (owner request 2026-10-27, multi-stop Declutter delivery): helpr_my_route lists the
 * caller's own deliveries in hand as ordered stops, and helpr_route_plan orders them. Reads the
 * NEWEST definition of each (effectiveDefs replays every migration, any dollar-quote tag) and pins
 * the rules a later restatement must keep:
 *   - a drop-off is not free to visit while its own pickup is left (pickup before drop-off);
 *   - a booked pickup's 30-minute time bounds every detour taken before it;
 *   - only the caller's own deliveries ('accepted', 'picked_up');
 *   - the pickup address once the delivery is the caller's; the drop-off by ONE rule,
 *     helpr_task_dropoff_shows_at (owner decided issue #3684, 2026-10-27): at accept for a Helpr with a
 *     finished delivery, else 2 hours before the booked pickup or after Picked up; in the route (a
 *     drop-off not shown yet is placed at its ~1 km point) and in helpr_task_view, and to nobody else;
 *   - the member switch is checked; the plan and items helpers are service_role only.
 * Backend proof, with nine planted defects each RED: src/test/pglite/helprMyRoute.pglite.mjs.
 *
 * @mutate supabase/migrations/20261030152601_helpr_route_same_seller_visit.sql |       CONTINUE WHEN v_s->>'kind' = 'dropoff' AND EXISTS ( |       CONTINUE WHEN false AND EXISTS (
 * @mutate supabase/migrations/20261030152601_helpr_route_same_seller_visit.sql |       'address', CASE WHEN p->>'kind' = 'pickup' THEN t.pickup_address WHEN v_shown THEN t.dropoff_address END, |       'address', CASE WHEN p->>'kind' = 'pickup' THEN t.pickup_address ELSE t.dropoff_address END,
 * @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |   v_drop_shown := v_role = 'helpr' AND v_active |   v_drop_shown := v_active
 * @mutate supabase/migrations/20261027194235_helpr_my_route.sql |     ELSE p_slot - interval '2 hours' END; |     ELSE p_slot - interval '0 hours' END;
 * @mutate supabase/migrations/20261030152601_helpr_route_same_seller_visit.sql |             WHERE x.helpr_id = v_uid AND x.status IN ('accepted', 'picked_up') |             WHERE x.status IN ('accepted', 'picked_up')
 * @mutate supabase/migrations/20261030152601_helpr_route_same_seller_visit.sql |          > (v_fixed->>'slot')::timestamptz + interval '30 minutes' THEN |          > 'infinity'::timestamptz THEN
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
/** Every grant/revoke line naming a function, across all migrations, comments blanked. */
const grants = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8"))).join("\n");

describe("My route (helpr_my_route, helpr_route_plan)", () => {
  it("the inventory read something: both functions and the leg helper exist", () => {
    for (const fn of ["helpr_my_route", "helpr_route_plan", "helpr_route_leg_miles", "helpr_task_items"]) {
      expect(body(fn).length, fn).toBeGreaterThan(150);
    }
  });

  it("a drop-off waits for its own pickup, and a booked pickup bounds every detour before it", () => {
    const plan = body("helpr_route_plan");
    expect(plan).toMatch(/CONTINUE WHEN v_s->>'kind' = 'dropoff' AND EXISTS \( SELECT 1 FROM unnest\(v_left\) o WHERE o->>'kind' = 'pickup' AND o->>'task' = v_s->>'task'\)/);
    expect(plan).toMatch(/> \(v_fixed->>'slot'\)::timestamptz \+ interval '30 minutes' THEN CONTINUE;/);
    expect(plan).toMatch(/greatest\(v_arrive, COALESCE\(v_slot, v_arrive\)\)/);
  });

  it("only the caller's own deliveries in hand", () => {
    expect(body("helpr_my_route")).toMatch(/WHERE x\.helpr_id = v_uid AND x\.status IN \('accepted', 'picked_up'\)/);
  });

  it("the drop-off follows ONE rule (issue #3684) in the route and the view, and is nobody else's", () => {
    const rule = body("helpr_task_dropoff_shows_at");
    expect(rule).toContain("WHEN p_status IN ('picked_up', 'delivered') THEN '-infinity'::timestamptz");
    expect(rule).toContain("WHEN EXISTS (SELECT 1 FROM public.helpr_tasks x WHERE x.helpr_id = p_helpr AND x.status = 'confirmed') THEN '-infinity'::timestamptz");
    expect(rule).toContain("ELSE p_slot - interval '2 hours' END;");
    const route = body("helpr_my_route");
    expect(route).toMatch(/'address', CASE WHEN p->>'kind' = 'pickup' THEN t\.pickup_address WHEN v_shown THEN t\.dropoff_address END/);
    expect(route).toContain("'lat', CASE WHEN v_shown THEN t.dropoff_lat ELSE round(t.dropoff_lat, 2) END");
    expect(route).not.toMatch(/pay_cents|fee_cents|take_home/);
    const view = body("helpr_task_view");
    expect(view).toContain("v_drop_shown := v_role = 'helpr' AND v_active AND COALESCE(now() > public.helpr_task_dropoff_shows_at(t.helpr_id, t.status, t.pickup_slot_start), false);");
    expect(route).toContain("v_shown := COALESCE(now() > public.helpr_task_dropoff_shows_at(v_uid, t.status, t.pickup_slot_start), false);");
    expect(route).not.toMatch(/now\(\) >= (public\.helpr_task_dropoff_shows_at|v_shows)/);
    for (const col of ["dropoff_address", "dropoff_lat", "dropoff_lng"]) expect(view, col).toContain(`'${col}', CASE WHEN v_drop_shown THEN t.${col} END`);
    for (const col of ["pickup_address", "pickup_lat", "pickup_lng"]) expect(view, col).toContain(`'${col}', CASE WHEN v_role = 'helpr' AND v_active THEN t.${col} END`);
  });

  it("the member switch is checked and the helpers are not callable by members", () => {
    expect(body("helpr_my_route")).toMatch(/PERFORM public\.helpr_task_source_require_feature\('declutter_delivery'\)/);
    for (const sig of ["helpr_route_plan\\(jsonb, numeric, numeric, timestamptz\\)", "helpr_route_leg_miles\\(numeric, numeric, numeric, numeric\\)", "helpr_task_items\\(text, uuid\\)"]) {
      expect(grants).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM PUBLIC, anon, authenticated;`));
      expect(grants).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO [^;]*authenticated`));
    }
    expect(grants).toMatch(/REVOKE ALL ON FUNCTION public\.helpr_my_route\(numeric, numeric\) FROM PUBLIC, anon;/);
  });

  it("the items helper has no definer rights, and the stop re-read keeps the ownership filter (lh-authz-rls review #3, #4)", () => {
    expect(body("helpr_task_items")).not.toMatch(/SECURITY DEFINER/);
    expect(body("helpr_my_route")).toMatch(/WHERE id = \(p->>'task'\)::uuid AND helpr_id = v_uid AND status IN \('accepted', 'picked_up'\)/);
  });
});
