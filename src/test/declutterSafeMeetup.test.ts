/**
 * Q2425 Declutter safe meetup spots (owner 2026-10-27).
 *
 * Admin-curated public places (police "safe exchange" lots, busy stores) per parish; a buyer picks "Meet at a safe
 * spot" and one near the items; the spot is frozen on the order; the seller's home address is NEVER shared for a
 * meetup; both sides tap "I'm here" (from an hour before), then the existing handover confirm finishes it.
 *
 * Behaviour: src/test/pglite/declutterSafeMeetup.pglite.mjs (78 PASS with 20261027204500 applied 3x on PROD's
 * bodies, 7 md5-checked; RED with it absent (39 FAIL), with the address exclusion planted out (2), the miles check
 * planted out, Picked up door-only (2), and the admin check planted out).
 *
 * @mutate supabase/migrations/20261027204500_declutter_safe_meetup.sql |           AND public.declutter_miles_between(i.area_lat, i.area_lng, s.lat, s.lng)\n              > (public.declutter_meetup_rules() ->> 'max_miles')::numeric); |           AND false);
 * @mutate supabase/migrations/20261027204500_declutter_safe_meetup.sql |   IF v_uid IS NULL OR NOT COALESCE(public.has_role(v_uid, 'admin'::public.app_role), false) THEN\n    RAISE EXCEPTION 'admin_only' |   IF v_uid IS NULL THEN\n    RAISE EXCEPTION 'admin_only'
 * @mutate supabase/migrations/20261027204500_declutter_safe_meetup.sql |   IF now() < v_slot - make_interval(mins => (public.declutter_meetup_rules() ->> 'here_from_minutes_before')::integer) THEN |   IF false THEN
 * @mutate supabase/migrations/20261101191500_declutter_checkout_pickup_time.sql |     AND (p_handover <> 'meetup' OR v_existing.meetup_spot IS NOT DISTINCT FROM v_spot.id) |     AND true
 * @mutate supabase/functions/declutter-checkout/index.ts |         if (!chosen) return json({ error: "meetup_spot_needed" }, 400); |
 * @mutate supabase/functions/declutter-checkout/index.ts |     spotChanged = frozenSpot !== pickedSpot; |     spotChanged = false; void pickedSpot;
 * @mutate src/components/admin/settings/FeatureSwitchesCard.tsx |     <MeetupSpotsCard />\n |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newestFunction } from "./helpers/parityReaders";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const FILE = "20261027204500";
const code = (name: string) => blankSqlComments(newestFunction(name).body).replace(/\s+/g, " ");
const read = (p: string) => blankComments(readFileSync(p, "utf8")).replace(/\s+/g, " ");

describe("Q2425 safe meetup spots: the server", () => {
  it("reads the newest definitions (floor)", () => {
    const names = ["declutter_meetup_spots_near", "declutter_set_meetup_spot", "declutter_meetup_here", "admin_declutter_save_meetup_spot",
      "declutter_meetup_spot_near_lines", "declutter_seller_picked_up"];
    // declutter_address_access: restated by handover money (20261031004529_declutter_handover_both_confirm.sql) with the meetup exclusion kept (asserted below).
    expect(newestFunction("declutter_address_access").file).toContain("20261031004529_declutter_handover_both_confirm.sql");
    // declutter_start_checkout: restated again by Q2427 (20261027211754) with the meetup lines kept (asserted below).
    expect(newestFunction("declutter_start_checkout").file >= FILE).toBe(true);
    // declutter_seller_picked_up: restated by anti-lying #1 (20261028235709, its photo taken at the spot) with the
    // meetup lines kept (asserted below).
    for (const n of names) {
      if (n === "declutter_seller_picked_up") expect(newestFunction(n).file >= FILE, n).toBe(true);
      else expect(newestFunction(n).file, n).toContain(FILE);
    }
    expect(names.length).toBeGreaterThan(5);
  });

  it("a spot is offered and accepted only while active and within the rule's miles of every item", () => {
    const near = code("declutter_meetup_spot_near_lines");
    expect(near).toContain("EXISTS (SELECT 1 FROM public.declutter_meetup_spots s WHERE s.id = p_spot_id AND s.active)");
    expect(near).toContain("AND public.declutter_miles_between(i.area_lat, i.area_lng, s.lat, s.lng) > (public.declutter_meetup_rules() ->> 'max_miles')::numeric);");
    expect(code("declutter_meetup_rules")).toContain("'max_miles', 25");
    expect(code("declutter_set_meetup_spot")).toContain("IF NOT public.declutter_meetup_spot_near_lines(p_spot_id, public.declutter_my_cart_lines(v_uid, p_seller_id)) THEN");
  });

  it("checkout 'meetup' needs the switch and the chosen spot, freezes a snapshot, and is idempotent on the spot", () => {
    const sc = code("declutter_start_checkout");
    expect(sc).toContain("IF p_handover = 'meetup' THEN PERFORM public.require_feature('declutter'); END IF;");
    expect(sc).toContain("AND public.declutter_meetup_spot_near_lines(s.id, v_lines); IF v_spot.id IS NULL THEN RAISE EXCEPTION 'meetup_spot_needed'");
    expect(sc).toContain("AND (p_handover <> 'meetup' OR v_existing.meetup_spot IS NOT DISTINCT FROM v_spot.id)");
    expect(sc).toContain("INSERT INTO public.declutter_order_meetups (order_id, spot_id, spot_name, spot_address, spot_lat, spot_lng) VALUES (v_order, v_spot.id, v_spot.name, v_spot.address, v_spot.lat, v_spot.lng);");
  });

  it("the home address is never shared for a meetup; Picked up works at a meetup", () => {
    expect(code("declutter_address_access")).toContain("AND o.handover NOT IN ('seller_delivery', 'meetup', 'ship')) THEN 'paid_buyer'");
    expect(code("declutter_seller_picked_up")).toContain("IF o.handover NOT IN ('pickup_home', 'meetup') THEN RAISE EXCEPTION 'not_a_door_pickup'");
  });

  it("I'm here: a paid meetup, booked, from an hour before, once per side; admin-only spot writes, audited", () => {
    const here = code("declutter_meetup_here");
    expect(here).toContain("IF o.status <> 'paid' OR o.handover <> 'meetup' THEN");
    expect(here).toContain("IF now() < v_slot - make_interval(mins => (public.declutter_meetup_rules() ->> 'here_from_minutes_before')::integer) THEN");
    expect(code("declutter_meetup_rules")).toContain("'here_from_minutes_before', 60");
    const admin = code("admin_declutter_save_meetup_spot");
    expect(admin).toContain("IF v_uid IS NULL OR NOT COALESCE(public.has_role(v_uid, 'admin'::public.app_role), false) THEN RAISE EXCEPTION 'admin_only'");
    expect(admin).toContain("INSERT INTO public.admin_audit_log");
  });

  it("members never read the spots table, the choices or another order's meetup", () => {
    const sql = blankSqlComments(readFileSync(`supabase/migrations/${FILE}_declutter_safe_meetup.sql`, "utf8")).replace(/\s+/g, " ");
    expect(sql).toContain(`CREATE POLICY "meetup spots: admins read" ON public.declutter_meetup_spots FOR SELECT TO authenticated USING (COALESCE(public.has_role((SELECT auth.uid()), 'admin'::public.app_role), false));`);
    expect(sql).toContain("REVOKE ALL ON TABLE public.declutter_meetup_choices FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(/GRANT [^;]* ON TABLE public\.declutter_meetup_choices TO [^;]*authenticated/);
    expect(sql).toContain("WHERE o.id = order_id AND (SELECT auth.uid()) IN (o.buyer_id, o.seller_id)");
  });
});

describe("Q2425 safe meetup spots: the edge function and the admin screen", () => {
  it("declutter-checkout keeps an open payment page when a switch to meetup has no spot chosen", () => {
    const s = read("supabase/functions/declutter-checkout/index.ts");
    const at = s.indexOf('if (handover === "meetup") {');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(s.indexOf("await stripeOf(open.stripe_checkout_session_id).checkout.sessions.expire("));
    expect(s).toContain('if (!chosen) return json({ error: "meetup_spot_needed" }, 400);');
  });

  it("a changed spot closes the old payment page before the order is replaced (lh-authz-rls review #2)", () => {
    const s = read("supabase/functions/declutter-checkout/index.ts");
    expect(s).toContain("spotChanged = frozenSpot !== pickedSpot;");
    expect(s).toContain('if (page.status === "open" && (open.handover !== handover || slotChanged || spotChanged || bundleChanged || pickupChanged)) {');
  });

  it("Admin settings shows the meetup spots card", () => {
    expect(read("src/components/admin/settings/FeatureSwitchesCard.tsx")).toContain("<MeetupSpotsCard />");
  });
});
