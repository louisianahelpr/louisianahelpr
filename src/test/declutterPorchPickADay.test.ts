/**
 * Owner 2026-10-28: "make porch just pick a day but they also need to know once it's on the porch so they
 * don't show up and it's not there". Behaviour on real Postgres (applied 3x, red without the migration and
 * on each planted defect): src/test/pglite/declutterPorchPickADay.pglite.mjs. This file holds the NEWEST
 * definitions (any dollar tag, via effectiveDefs): the day RPCs, and the money rules keyed off the END of
 * a porch day (the buyer's no-show report and the 24 h auto-pay), never its 00:00 start.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

// @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql | AND b.slot_start IS NOT NULL AND public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '24 hours' <= now() | AND b.slot_start IS NOT NULL AND b.slot_start + interval '24 hours' <= now()
// @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql |                        AND public.declutter_pickup_anchor(b.slot_start, b.pickup_day) + interval '24 hours' <= now()) |                        AND b.slot_start + interval '24 hours' <= now())
// @mutate supabase/migrations/20261031004529_declutter_handover_both_confirm.sql |   v_from := CASE WHEN b.pickup_day IS NOT NULL THEN public.declutter_pickup_anchor(b.slot_start, b.pickup_day) |   v_from := CASE WHEN false THEN public.declutter_pickup_anchor(b.slot_start, b.pickup_day)
// @mutate supabase/migrations/20261030164712_declutter_porch_places.sql |     VALUES (o.id, o.buyer_id, o.seller_id, v_start, v_start + interval '30 minutes', 'all_day', p_day, v_start); |     VALUES (o.id, o.buyer_id, o.seller_id, v_start, v_start + interval '30 minutes', 'all_day', p_day, NULL);
// @mutate supabase/migrations/20261028225038_declutter_porch_pick_a_day.sql | REVOKE ALL ON FUNCTION public.declutter_book_porch_day(uuid, date) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_book_porch_day(uuid, date) FROM PUBLIC;
// @mutate supabase/migrations/20261030164712_declutter_porch_places.sql |   IF o.handover <> 'porch' THEN |   IF false THEN

const ROOT = resolve(__dirname, "..", "..");
const DIR = join(ROOT, "supabase", "migrations");
const defs = effectiveDefs(DIR);
const body = (name: string) => {
  const d = defs.get(name);
  expect(d, `${name} has no definition`).toBeDefined();
  return blankSqlComments(d!.stmt);
};
const MIGRATION = blankSqlComments(readFileSync(join(DIR, "20261028225038_declutter_porch_pick_a_day.sql"), "utf8"));

describe("Declutter porch pickup is a DAY (owner 2026-10-28)", () => {
  it("the auto-pay waits 24 h after the anchor (the END of a porch day), in both places of the pickup loop", () => {
    const sweep = body("declutter_handover_sweep");
    const anchored = sweep.match(/public\.declutter_pickup_anchor\(b\.slot_start, b\.pickup_day\) \+ interval '24 hours' <= now\(\)/g) ?? [];
    expect(anchored.length).toBe(2);
    expect(sweep).not.toMatch(/b\.slot_start \+ interval '24 hours' <= now\(\)/);
    // Porch still needs the porch photo before any auto-pay (owner 2026-10-18).
    expect(sweep).toMatch(/o2\.handover <> 'porch' OR EXISTS \(SELECT 1 FROM public\.declutter_handovers h\s+WHERE h\.order_id = o2\.id AND h\.set_out_photo_path IS NOT NULL/);
    const anchor = body("declutter_pickup_anchor");
    expect(anchor).toMatch(/WHEN p_pickup_day IS NOT NULL\s+THEN \(\(p_pickup_day \+ 1\)::timestamp AT TIME ZONE 'America\/Chicago'\)\s+ELSE p_slot_start END/);
  });

  it("the buyer's no-show report on a porch day opens when the day is over, never 15 minutes after 00:00", () => {
    const noShow = body("declutter_report_no_show");
    expect(noShow).toMatch(/v_from := CASE WHEN b\.pickup_day IS NOT NULL THEN public\.declutter_pickup_anchor\(b\.slot_start, b\.pickup_day\)\s+ELSE b\.slot_start \+ interval '15 minutes' END;/);
  });

  it("booking a day: porch only, one of the seller's days, out all day, marked reminded, never once it is out", () => {
    const book = body("declutter_book_porch_day");
    for (const clause of [
      "IF o.handover <> 'porch' THEN",
      // The porch weekdays (20261029161347), read per ORDER since 20261030164712 (the frozen place's days, else the seller's).
      "public.declutter_order_is_porch_day(o.id, extract(dow FROM p_day)::smallint)",
      "(p_day::timestamp AT TIME ZONE 'America/Chicago') >= o.paid_at + interval '7 days'",
      "h.set_out_at IS NOT NULL",
      "VALUES (o.id, o.buyer_id, o.seller_id, v_start, v_start + interval '30 minutes', 'all_day', p_day, v_start);",
      "porch_mode = 'all_day', porch_until = NULL, reminded_slot_start = v_start",
      "'/declutter?tab=selling'",
    ]) expect(book, clause).toContain(clause);
    expect(book).not.toContain("view=sales");
  });

  it("a day never outlives its slot (an old build's time booking or a no-show clears it)", () => {
    expect(body("declutter_bookings_day_follows_slot")).toMatch(
      /IF NEW\.slot_start IS DISTINCT FROM OLD\.slot_start AND NEW\.pickup_day IS NOT DISTINCT FROM OLD\.pickup_day THEN\s+NEW\.pickup_day := NULL;/);
    expect(MIGRATION).toMatch(/CREATE TRIGGER trg_declutter_bookings_day_follows_slot\s+BEFORE UPDATE ON public\.declutter_bookings/);
  });

  it("grants: members call the two day RPCs, never anon; the anchor and the trigger function are internal", () => {
    const grants = [
      "REVOKE ALL ON FUNCTION public.declutter_book_porch_day(uuid, date) FROM PUBLIC, anon;",
      "GRANT EXECUTE ON FUNCTION public.declutter_book_porch_day(uuid, date) TO authenticated, service_role;",
      "REVOKE ALL ON FUNCTION public.declutter_porch_days(uuid) FROM PUBLIC, anon;",
      "REVOKE ALL ON FUNCTION public.declutter_pickup_anchor(timestamptz, date) FROM PUBLIC, anon, authenticated;",
      "REVOKE ALL ON FUNCTION public.declutter_bookings_day_follows_slot() FROM PUBLIC, anon, authenticated;",
    ];
    for (const g of grants) expect(MIGRATION, g).toContain(g);
    expect(grants.length).toBeGreaterThan(4);
  });
});
