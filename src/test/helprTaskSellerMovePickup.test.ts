/**
 * BUY-42 (buying audit 10-30 #42): the seller can move a booked Helpr's pickup once (helpr_task_seller_move_pickup,
 * 20261031095846). Behaviour: src/test/pglite/helprTaskSellerMovePickup.pglite.mjs (29 PASS, applied 3x; skip red).
 * This guard pins the rules on the newest definition: seller only, booked and not handed over, not held, before the
 * booked time, once per booking, the accept's slot rules plus 2 hours' notice, the Helpr and buyer told, grants.
 *
 * @mutate supabase/migrations/20261031095846_helpr_task_seller_move_pickup.sql |   IF t.pickup_contact_id IS DISTINCT FROM v_uid THEN |   IF t.customer_id IS DISTINCT FROM v_uid THEN
 * @mutate supabase/migrations/20261031095846_helpr_task_seller_move_pickup.sql | AND e.created_at >= t.accepted_at) THEN | ) THEN
 * @mutate supabase/migrations/20261031095846_helpr_task_seller_move_pickup.sql | p_pickup_slot_start < now() + interval '2 hours' | p_pickup_slot_start < now()
 * @mutate supabase/migrations/20261031095846_helpr_task_seller_move_pickup.sql |   IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN |   IF false THEN
 * @mutate supabase/migrations/20261031095846_helpr_task_seller_move_pickup.sql | REVOKE ALL ON FUNCTION public.helpr_task_seller_move_pickup(uuid, timestamptz) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.helpr_task_seller_move_pickup(uuid, timestamptz) FROM PUBLIC;
 * @mutate supabase/migrations/20261031095846_helpr_task_seller_move_pickup.sql |   'unfilled', 'cancelled', 'failed', 'pickup_no_show', 'handed_over', 'pickup_moved')); |   'unfilled', 'cancelled', 'failed', 'pickup_no_show', 'pickup_moved'));
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newestFunction } from "./helpers/parityReaders";
import { blankSqlComments } from "./helpers/blankNonCode";

const FILE = "supabase/migrations/20261031095846_helpr_task_seller_move_pickup.sql";
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

describe("BUY-42: helpr_task_seller_move_pickup", () => {
  const fn = newestFunction("helpr_task_seller_move_pickup");
  const body = flat(fn.body);

  it("reads the newest definition", () => {
    expect(fn.file).toContain("20261031095846");
    expect(body.length).toBeGreaterThan(1000);
  });

  it("only the seller, only a booked Helpr not yet handed over, not while held, before the booked time", () => {
    expect(body).toContain("t := public.helpr_task_lock(p_task_id); IF t.pickup_contact_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'task_not_found'");
    expect(body).toContain("IF t.status <> 'accepted' OR t.helpr_id IS NULL OR (t.handed_over_at IS NOT NULL AND t.handed_over_to = t.helpr_id) THEN RAISE EXCEPTION 'task_not_active'");
    expect(body).toContain("IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN RAISE EXCEPTION 'problem_open'");
    expect(body).toContain("IF t.pickup_slot_start <= now() THEN RAISE EXCEPTION 'too_late'");
    expect(body).toContain("IF public.is_caller_banned() THEN RAISE EXCEPTION 'account_restricted'");
  });

  it("once per Helpr booking", () => {
    expect(body).toContain("WHERE e.task_id = t.id AND e.task_event = 'pickup_moved' AND e.actor_id = v_uid AND e.created_at >= t.accepted_at) THEN RAISE EXCEPTION 'already_moved'");
  });

  it("the accept's slot rules, a real change, and 2 hours' notice", () => {
    expect(body).toContain("IF p_pickup_slot_start IS NULL OR p_pickup_slot_start < now() + interval '2 hours' OR p_pickup_slot_start = t.pickup_slot_start OR p_pickup_slot_start + interval '30 minutes' > t.latest_pickup_at OR NOT public.helpr_task_source_slot_ok(t.source_kind, t.source_id, p_pickup_slot_start) THEN RAISE EXCEPTION 'invalid_slot'");
  });

  it("logs the move and tells the Helpr (Deliver) and the buyer (Buying), naming the item", () => {
    expect(body).toContain("PERFORM public.helpr_task_log(t.id, 'pickup_moved', v_uid,");
    expect(body).toContain("PERFORM public.declutter_notify(t.helpr_id, 'info', 'Pickup time changed', format('The seller moved the pickup of %s to %s.', t.title, v_when), '/declutter?tab=deliver', v_uid);");
    expect(body).toContain("PERFORM public.declutter_notify(t.customer_id, 'info', 'Pickup time changed',");
    expect(body).toContain("'/declutter?tab=buying', v_uid);");
  });

  it("definer, pinned search_path, revoked from anon by name; the event CHECK keeps every earlier event", () => {
    const sql = flat(readFileSync(FILE, "utf8"));
    expect(sql).toContain("SECURITY DEFINER SET search_path TO 'public', 'pg_temp'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.helpr_task_seller_move_pickup(uuid, timestamptz) FROM PUBLIC, anon;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.helpr_task_seller_move_pickup(uuid, timestamptz) TO authenticated, service_role;");
    expect(sql).toContain("'created', 'accepted', 'released', 'helpr_no_show', 'picked_up', 'delivered', 'wrong_code', 'confirmed', 'unfilled', 'cancelled', 'failed', 'pickup_no_show', 'handed_over', 'pickup_moved'));");
  });
});
