/**
 * Audit 1c D3-2: two deliveries from one seller sent the Helpr there twice, with a drop-off in between. Migration
 * 20261030152601: helpr_route_plan joins a same-point pickup whose Picked up is open by then into one visit, and the
 * accept card offers the Helpr's own time at this seller (helpr_task_same_pickup_slot, which answers exactly who
 * helpr_task_pickup_windows answers). Backend proof: src/test/pglite/helprRouteSameSellerVisit.pglite.mjs (3x; red with
 * NEW_MIGRATION=skip, and each planted defect red).
 *
 * Reads the EFFECTIVE definitions.
 */
// @mutate supabase/migrations/20261030152601_helpr_route_same_seller_visit.sql | (v_s->>'slot')::timestamptz - interval '30 minutes' <= v_visit | true
// @mutate supabase/migrations/20261030152601_helpr_route_same_seller_visit.sql |            AND v_s->>'seller' = v_seller\n |
// @mutate supabase/migrations/20261030152601_helpr_route_same_seller_visit.sql | (v_s->>'lat')::numeric, (v_s->>'lng')::numeric) <= 50 | (v_s->>'lat')::numeric, (v_s->>'lng')::numeric) = 0
// @mutate supabase/migrations/20261030152601_helpr_route_same_seller_visit.sql |         'seller', t.pickup_contact_id)); |         'nobody', t.pickup_contact_id));
// @mutate supabase/migrations/20261031085000_helpr_same_pickup_slot_hides_backed_out.sql |      AND x.pickup_contact_id = t.pickup_contact_id\n |
// @mutate supabase/migrations/20261031085000_helpr_same_pickup_slot_hides_backed_out.sql |      AND NOT public.are_users_blocked(v_uid, x.pickup_contact_id)\n |
// @mutate src/components/declutter/DeclutterPickupWindows.tsx |       {same.data && ( |       {false && (
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "").replace(/\s+/g, " ");

describe("one seller, one visit", () => {
  const plan = flat("helpr_route_plan");
  const same = flat("helpr_task_same_pickup_slot");
  const windows = flat("helpr_task_pickup_windows");
  const picked = flat("helpr_task_picked_up");

  it("reads the definitions (floor)", () => {
    expect(plan.length).toBeGreaterThan(1500);
    expect(same.length).toBeGreaterThan(800);
    expect(picked.length).toBeGreaterThan(500);
  });

  it("a pickup joins a visit only at the accept card's own rule (same seller, within 50 m), and only once Picked up would be open", () => {
    expect(plan).toContain("v_s->>'seller' = v_seller");
    expect(plan).toContain("public.helpr_task_distance_m(v_lat, v_lng, (v_s->>'lat')::numeric, (v_s->>'lng')::numeric) <= 50");
    expect(same).toContain("public.helpr_task_distance_m(x.pickup_lat, x.pickup_lng, t.pickup_lat, t.pickup_lng) <= 50");
    expect(flat("helpr_my_route")).toContain("'seller', t.pickup_contact_id");
    expect(plan).toContain("(v_s->>'slot')::timestamptz - interval '30 minutes' <= v_visit");
    // The window it assumes is helpr_task_picked_up's own.
    expect(picked).toMatch(/interval '30 minutes'/);
  });

  it("the accept card's time answers exactly who the pickup-times read answers", () => {
    const filter = (f: string) => f.slice(f.indexOf("SELECT * INTO t FROM public.helpr_tasks x"), f.indexOf("IF t.id IS NULL"));
    expect(filter(same).length).toBeGreaterThan(300);
    expect(filter(same)).toBe(filter(windows));
    expect(same).toContain("PERFORM public.helpr_task_source_require_feature('declutter_delivery');");
    expect(same).toContain("v_uid := public.helpr_task_assert_helpr();");
  });

  it("only the caller's own pickup at this seller, and only a time the accept would take", () => {
    expect(same).toContain("x.helpr_id = v_uid AND x.status = 'accepted'");
    expect(same).toContain("x.pickup_contact_id = t.pickup_contact_id");
    expect(same).toContain("public.helpr_task_source_slot_ok(t.source_kind, t.source_id, x.pickup_slot_start)");
    expect(same).toContain("LEAST(t.latest_pickup_at, o.paid_at + interval '7 days')");
  });

  it("the accept card offers it", () => {
    const card = blankComments(readFileSync(resolve(__dirname, "../components/declutter/DeclutterPickupWindows.tsx"), "utf8"));
    expect(card).toContain("fetchSamePickupSlot(taskId)");
    expect(card).toContain("{same.data && (");
  });
});
