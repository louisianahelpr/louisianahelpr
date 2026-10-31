/**
 * LEAD-MOVE-BACKOUT (lead decision 10-31, after BUY-42): a Helpr who backs out after the seller moved the pickup gets
 * no strike, and that back-out does not count toward the 3-in-7-days pause (20261031102758).
 * Behaviour: src/test/pglite/helprBackoutAfterSellerMove.pglite.mjs (21 PASS, applied 3x; skip red; 4 mutants red).
 * This guard pins the rule on the newest definitions of helpr_task_release, helpr_task_accept and
 * helpr_route_suggestions.
 *
 * @mutate supabase/migrations/20261031102758_helpr_backout_after_seller_move_is_free.sql |   v_late := NOT v_moved AND now() |   v_late := now()
 * @mutate supabase/migrations/20261031102758_helpr_backout_after_seller_move_is_free.sql | AND e.actor_id = t.pickup_contact_id | AND true
 * @mutate supabase/migrations/20261031102758_helpr_backout_after_seller_move_is_free.sql |     CASE WHEN v_moved THEN 'seller_moved' WHEN v_late | CASE WHEN v_late
 */
import { describe, expect, it } from "vitest";
import { newestFunction } from "./helpers/parityReaders";
import { blankSqlComments } from "./helpers/blankNonCode";

const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const PAUSE_COUNT =
  "WHERE e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show') AND e.detail IS DISTINCT FROM 'seller_moved' AND e.created_at > now() - interval '7 days') >= 3 THEN";

describe("LEAD-MOVE-BACKOUT: backing out after the seller's move is free", () => {
  it("helpr_task_release: no strike and a 'seller_moved' release once the seller moved this booking", () => {
    const fn = newestFunction("helpr_task_release");
    const body = flat(fn.body);
    expect(fn.file).toContain("20261031102758");
    expect(body.length).toBeGreaterThan(800);
    expect(body).toContain(
      "v_moved := EXISTS (SELECT 1 FROM public.helpr_task_events e WHERE e.task_id = t.id AND e.task_event = 'pickup_moved' AND e.actor_id = t.pickup_contact_id AND e.created_at >= t.accepted_at);",
    );
    expect(body).toContain("v_late := NOT v_moved AND now() > t.pickup_slot_start - interval '2 hours';");
    expect(body).toContain("PERFORM public.helpr_task_reopen(t.id, 'released', v_uid, CASE WHEN v_moved THEN 'seller_moved' WHEN v_late THEN 'late' END);");
    expect(body).toContain("IF v_late THEN PERFORM public.helpr_task_give_job_strike(v_uid, 'delivery_backed_out'");
  });

  it("helpr_task_accept and helpr_route_suggestions: the weekly pause skips seller_moved back-outs", () => {
    for (const name of ["helpr_task_accept", "helpr_route_suggestions"]) {
      const fn = newestFunction(name);
      const body = flat(fn.body);
      expect(fn.file, name).toContain("20261031102758");
      expect(body.length, name).toBeGreaterThan(2000);
      expect(body, name).toContain(PAUSE_COUNT);
      // The per-delivery "never take back what you backed out of" filters still count every release.
      expect(body, name).toContain("e.actor_id = v_uid AND e.task_event IN ('released', 'helpr_no_show'))");
    }
  });
});
