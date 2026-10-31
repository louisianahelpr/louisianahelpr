/**
 * "On your way" (owner request 2026-10-27): helpr_route_suggestions suggests open deliveries that
 * add little to a Helpr's route. Reads the NEWEST definition (effectiveDefs, any dollar-quote tag)
 * and pins what a later restatement must keep:
 *   - the caller is judged by helpr_task_assert_helpr behind the member switch;
 *   - a candidate passes every check helpr_tasks_open_near applies, plus the ones helpr_task_accept
 *     would refuse on (backed out of / missed, an open problem);
 *   - a viewed delivery is one the caller could take, else task_not_found;
 *   - nothing is suggested past the two-not-picked-up cap;
 *   - the caller's position is not an input; a candidate's pickup is scored at its 2-decimal point
 *     and its drop-off at its 1-decimal point, and no address or point is returned;
 *   - the suggested pickup time is inside the seller's pickup times, searched for 3 hours at most
 *     (an unbounded search traced a seller's private windows: lh-authz-rls review #1).
 * Backend proof, six planted defects each RED: src/test/pglite/helprRouteSuggestions.pglite.mjs.
 *
 * @mutate supabase/migrations/20261031102758_helpr_backout_after_seller_move_is_free.sql |        AND NOT public.are_users_blocked(v_uid, x.customer_id)\n |        AND true\n
 * @mutate supabase/migrations/20261031102758_helpr_backout_after_seller_move_is_free.sql |   IF v_held + (CASE WHEN p_with_task IS NULL THEN 0 ELSE 1 END) >= 2 THEN |   IF false THEN
 * @mutate supabase/migrations/20261031102758_helpr_backout_after_seller_move_is_free.sql | 'kind', 'pickup', 'lat', round(t.pickup_lat, 2), 'lng', round(t.pickup_lng, 2)) | 'kind', 'pickup', 'lat', t.pickup_lat, 'lng', t.pickup_lng)
 * @mutate supabase/migrations/20261031102758_helpr_backout_after_seller_move_is_free.sql |       IF public.helpr_task_source_slot_ok(t.source_kind, t.source_id, v_slot) THEN |       IF true THEN
 * @mutate supabase/migrations/20261031102758_helpr_backout_after_seller_move_is_free.sql | WHILE v_found IS NULL AND i <= 12 AND | WHILE v_found IS NULL AND i < 7 * 24 * 4 AND
 * @mutate supabase/migrations/20261031102758_helpr_backout_after_seller_move_is_free.sql |       'lat', CASE WHEN v_own_shown THEN t.dropoff_lat ELSE round(t.dropoff_lat, 2) END, |       'lat', t.dropoff_lat,
 * @mutate supabase/migrations/20261031102758_helpr_backout_after_seller_move_is_free.sql | 'kind', 'dropoff', 'lat', round(t.dropoff_lat, 1), 'lng', round(t.dropoff_lng, 1))) | 'kind', 'dropoff', 'lat', round(t.dropoff_lat, 2), 'lng', round(t.dropoff_lng, 2)))
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
const grants = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8"))).join("\n");

describe("On your way (helpr_route_suggestions)", () => {
  const fn = body("helpr_route_suggestions");

  it("the inventory read something", () => {
    expect(fn.length).toBeGreaterThan(1500);
    expect(body("helpr_route_cost").length).toBeGreaterThan(300);
  });

  it("the caller is the delivery gate's, behind the member switch", () => {
    expect(fn).toMatch(/PERFORM public\.helpr_task_source_require_feature\('declutter_delivery'\); v_uid := public\.helpr_task_assert_helpr\(\);/);
    expect(fn).toMatch(/CREATE OR REPLACE FUNCTION public\.helpr_route_suggestions\(p_with_task uuid\)/);
    expect(fn).not.toMatch(/\bp_lat\b|\bp_lng\b/);
  });

  it("every candidate passes open_near's checks and the accept's refusals", () => {
    for (const clause of [
      "x.status = 'open' AND x.open_until > now()",
      "v_uid IS DISTINCT FROM x.customer_id AND v_uid IS DISTINCT FROM x.pickup_contact_id",
      "public.helpr_task_vehicle_fits(v_uid, x.size)",
      "NOT public.are_users_blocked(v_uid, x.customer_id)",
      "NOT public.are_users_blocked(v_uid, x.pickup_contact_id)",
      "public.helpr_task_same_stripe_mode(v_uid, x.customer_id)",
      "NOT public.helpr_task_source_held(x.source_kind, x.source_id)",
      "e.task_event IN ('released', 'helpr_no_show')",
    ]) expect(fn, clause).toContain(clause);
  });

  it("a viewed delivery must be one the caller could take; the two-not-picked-up cap holds", () => {
    expect(fn).toMatch(/IF NOT FOUND OR w\.status <> 'open' OR w\.open_until <= now\(\) OR v_uid IN \(w\.customer_id, w\.pickup_contact_id\)/);
    expect(fn).toMatch(/RAISE EXCEPTION 'task_not_found'/);
    expect(fn).toMatch(/IF v_held \+ \(CASE WHEN p_with_task IS NULL THEN 0 ELSE 1 END\) >= 2 THEN/);
  });

  it("candidates are scored at their ~1 km points and nothing exact is returned", () => {
    expect(fn).toContain("'kind', 'pickup', 'lat', round(t.pickup_lat, 2), 'lng', round(t.pickup_lng, 2))");
    expect(fn).toContain("'kind', 'dropoff', 'lat', round(t.dropoff_lat, 1), 'lng', round(t.dropoff_lng, 1))");
    expect(fn).toContain("'kind', 'dropoff', 'lat', round(w.dropoff_lat, 1), 'lng', round(w.dropoff_lng, 1))");
    // The caller's own drop-off: exact only once it is theirs to read (issue #3684), else ~1 km.
    expect(fn).toContain("v_own_shown := COALESCE(now() > public.helpr_task_dropoff_shows_at(v_uid, t.status, t.pickup_slot_start), false);");
    expect(fn).toContain("'lat', CASE WHEN v_own_shown THEN t.dropoff_lat ELSE round(t.dropoff_lat, 2) END");
    const out = fn.slice(fn.indexOf("v_out := v_out ||"));
    expect(out).not.toMatch(/address|_lat|_lng|pay_cents|fee_cents/);
  });

  it("the pickup time is inside the seller's pickup times; grants by role name", () => {
    expect(fn).toContain("IF public.helpr_task_source_slot_ok(t.source_kind, t.source_id, v_slot) THEN");
    expect(fn).toContain("WHILE v_found IS NULL AND i <= 12 AND");
    expect(grants).toMatch(/REVOKE ALL ON FUNCTION public\.helpr_route_suggestions\(uuid\) FROM PUBLIC, anon;/);
    expect(grants).toMatch(/REVOKE ALL ON FUNCTION public\.helpr_route_cost\(jsonb, numeric, numeric, timestamptz\) FROM PUBLIC, anon, authenticated;/);
  });
});
