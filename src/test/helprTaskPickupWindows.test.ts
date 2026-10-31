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
// @mutate supabase/migrations/20261031082821_helpr_open_count_and_windows_hide_backed_out.sql |      AND NOT public.are_users_blocked(v_uid, x.pickup_contact_id)\n |
// @mutate supabase/migrations/20261031082821_helpr_open_count_and_windows_hide_backed_out.sql | LEAST(t.latest_pickup_at, o.paid_at + interval '7 days') | t.latest_pickup_at
// @mutate supabase/migrations/20261031082821_helpr_open_count_and_windows_hide_backed_out.sql |   v_uid := public.helpr_task_assert_helpr();\n  -- helpr_tasks_open_near's own filter |   v_uid := (SELECT auth.uid());\n  -- helpr_tasks_open_near's own filter
// @mutate supabase/migrations/20261031082821_helpr_open_count_and_windows_hide_backed_out.sql |      AND NOT public.helpr_task_source_held(x.source_kind, x.source_id); |      AND true;
// @mutate supabase/migrations/20261031082821_helpr_open_count_and_windows_hide_backed_out.sql | e.task_id = x.id AND e.actor_id = v_uid | e.task_id = x.id AND e.actor_id IS NULL
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
    expect(read).toContain("LEAST(t.latest_pickup_at, o.paid_at + interval '7 days')");
  });
});
