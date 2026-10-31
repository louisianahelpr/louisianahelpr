/**
 * The Helpr choosing a pickup time for an open delivery reads the seller's pickup times, to exactly the members
 * helpr_tasks_open_near shows that delivery to (lead 2026-10-28; migration 20261028232930).
 *
 * Reads the EFFECTIVE definitions: every eligibility predicate of helpr_tasks_open_near's WHERE (status open, open
 * window, not the buyer or seller, vehicle fits, not blocked either way, same Stripe mode) is in
 * helpr_task_pickup_windows' filter, so the read can never answer someone the list would not show; it is behind
 * the Declutter switch and helpr_task_assert_helpr; and its deadline is both bounds helpr_task_accept checks.
 * Backend proof: src/test/pglite/helprTaskPickupWindows.pglite.mjs (3x; RED without it and on 4 planted defects).
 */
// @mutate supabase/migrations/20261031145652_declutter_place_hours.sql |      AND NOT public.are_users_blocked(v_uid, x.pickup_contact_id)\n |
// @mutate supabase/migrations/20261031145652_declutter_place_hours.sql | SELECT w.weekday, w.starts_local, w.ends_local, LEAST(t.latest_pickup_at, o.paid_at + interval '7 days') | SELECT w.weekday, w.starts_local, w.ends_local, t.latest_pickup_at
// @mutate supabase/migrations/20261031145652_declutter_place_hours.sql |              LEAST(t.latest_pickup_at, o.paid_at + interval '7 days')\n        FROM jsonb_array_elements(v_hours) e | t.latest_pickup_at\n        FROM jsonb_array_elements(v_hours) e
// @mutate supabase/migrations/20261031145652_declutter_place_hours.sql |   SELECT hp.windows INTO v_hours FROM public.declutter_order_porch_places hp WHERE hp.order_id = o.id; |   v_hours := NULL;
// @mutate supabase/migrations/20261031145652_declutter_place_hours.sql | AND public.declutter_order_slot_in_windows(o.id, o.seller_id, p_start)); | AND public.declutter_slot_in_windows(o.seller_id, p_start));
// @mutate supabase/migrations/20261031145652_declutter_place_hours.sql |   v_uid := public.helpr_task_assert_helpr();\n  -- helpr_tasks_open_near's own filter |   v_uid := (SELECT auth.uid());\n  -- helpr_tasks_open_near's own filter
// @mutate supabase/migrations/20261031145652_declutter_place_hours.sql |      AND NOT public.helpr_task_source_held(x.source_kind, x.source_id); |      AND true;
// @mutate supabase/migrations/20261031145652_declutter_place_hours.sql | e.task_id = x.id AND e.actor_id = v_uid | e.task_id = x.id AND e.actor_id IS NULL
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "").replace(/\s+/g, " ");

describe("the Helpr reads an open delivery's pickup times only where the open list shows it", () => {
  const near = flat("helpr_tasks_open_near");
  const read = flat("helpr_task_pickup_windows");
  const accept = flat("helpr_task_accept");

  it("reads the definitions (floor)", () => {
    expect(near.length).toBeGreaterThan(800);
    expect(read.length).toBeGreaterThan(800);
  });

  it("every eligibility predicate of the open list is in the read's filter", () => {
    const where = near.slice(near.indexOf("FROM public.helpr_tasks t WHERE"), near.indexOf("ORDER BY"));
    const preds = where.replace("FROM public.helpr_tasks t WHERE ", "").split(/ AND /).map((p) => p.trim().replace(/\bt\./g, "x."));
    expect(preds.length).toBeGreaterThan(6);
    const missing = preds.filter((p) => !read.includes(p));
    expect(missing).toEqual([]);
  });

  it("behind the switch and the Helpr check, as the open list is", () => {
    for (const f of [near, read]) {
      expect(f).toContain("PERFORM public.helpr_task_source_require_feature('declutter_delivery');");
      expect(f).toContain("v_uid := public.helpr_task_assert_helpr();");
    }
  });

  it("its deadline is both bounds the accept checks", () => {
    expect(accept).toContain("p_pickup_slot_start + interval '30 minutes' > t.latest_pickup_at");
    expect(flat("declutter_delivery_slot_ok")).toContain("p_start + interval '30 minutes' <= o.paid_at + interval '7 days'");
    // Both answers (the frozen place hours and the usual times) carry the deadline.
    expect(read.split("LEAST(t.latest_pickup_at, o.paid_at + interval '7 days')").length - 1).toBe(2);
  });

  // LEAD-PLACE-TIMES review (2026-10-31): a delivery whose buyer picked a place uses that place's hours, frozen on the
  // order, for the times the Helpr sees and the time the Helpr may set. Backend proof: src/test/pglite/helprPlaceHours.pglite.mjs.
  it("reads the order's frozen place hours, else the usual times", () => {
    expect(read).toContain("FROM public.declutter_order_porch_places hp WHERE hp.order_id = o.id;");
    expect(read).toContain("FROM public.declutter_pickup_windows w WHERE w.seller_id = o.seller_id");
    expect(flat("declutter_delivery_slot_ok")).toContain("public.declutter_order_slot_in_windows(o.id, o.seller_id, p_start)");
  });
});
