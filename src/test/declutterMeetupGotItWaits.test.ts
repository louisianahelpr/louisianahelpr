/**
 * A meeting-spot or door-pickup "I got it" waits for the booked time (Declutter audit 1030, buying DB-3; migration
 * 20261030061753). At a safe meeting spot the buyer could tap "I got it" days before the booked time, which handed
 * the order over and started the seller's payout clock before anyone met; a door pickup had the same hole (lead
 * decision 2026-10-30). declutter_confirm_handover now refuses either with no booked time (not_booked_yet) and
 * before the hour "I'm here" opens (got_it_too_early), reading the same rule (declutter_meetup_rules()
 * here_from_minutes_before).
 * Reads the EFFECTIVE definition. Backend proof: src/test/pglite/declutterMeetupGotItWaits.pglite.mjs (3x; RED on
 * prod's body with NEW_MIGRATION=skip; RED with the hour check, the booking check or the door planted out).
 * Client half: declutterHandoverViews.test.tsx ("DB-3: the buyer's I got it waits until an hour before").
 */
// @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |   IF o.handover IN ('meetup', 'pickup_home') THEN |   IF false THEN
// @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |   IF o.handover IN ('meetup', 'pickup_home') THEN |   IF o.handover IN ('meetup') THEN
// @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |     IF now() < v_slot - make_interval(mins => (public.declutter_meetup_rules() ->> 'here_from_minutes_before')::integer) THEN |     IF now() < v_slot - make_interval(mins => 1440) THEN
// @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |     IF v_slot IS NULL THEN\n      RAISE EXCEPTION 'not_booked_yet' |     IF false THEN\n      RAISE EXCEPTION 'not_booked_yet'
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = blankSqlComments(DEFS.get("declutter_confirm_handover")?.stmt ?? "").replace(/\s+/g, " ");

describe("a meeting-spot or door-pickup \"I got it\" waits for a booked time and the hour before it", () => {
  it("reads the definition (floor)", () => {
    expect(flat.length).toBeGreaterThan(800);
  });

  it("refuses with no booked time and before the hour \"I'm here\" opens, then pays only through complete_handover", () => {
    expect(flat).toContain("IF o.handover IN ('meetup', 'pickup_home') THEN SELECT b.slot_start INTO v_slot FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL; IF v_slot IS NULL THEN RAISE EXCEPTION 'not_booked_yet'");
    expect(flat).toContain("IF now() < v_slot - make_interval(mins => (public.declutter_meetup_rules() ->> 'here_from_minutes_before')::integer) THEN RAISE EXCEPTION 'got_it_too_early'");
    // After the side check (the seller is refused first) and before the one call that pays.
    expect(flat.indexOf("'wrong_side'")).toBeLessThan(flat.indexOf("'got_it_too_early'"));
    expect(flat.indexOf("'got_it_too_early'")).toBeLessThan(flat.indexOf("RETURN public.declutter_complete_handover(o.id, p_method);"));
  });

  it("uses the same hour as \"I'm here\" (one rule, 60 minutes)", () => {
    const here = blankSqlComments(DEFS.get("declutter_meetup_here")?.stmt ?? "").replace(/\s+/g, " ");
    expect(here).toContain("make_interval(mins => (public.declutter_meetup_rules() ->> 'here_from_minutes_before')::integer)");
    expect(blankSqlComments(DEFS.get("declutter_meetup_rules")?.stmt ?? "")).toContain("'here_from_minutes_before', 60");
  });
});
