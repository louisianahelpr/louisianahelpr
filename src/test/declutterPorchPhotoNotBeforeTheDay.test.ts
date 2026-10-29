/**
 * Declutter audit 1a #4 (prod 2026-10-29): the buyer booked a porch pickup for Sat Oct 31, the seller's porch photo
 * on Thu Oct 29 was accepted, the buyer was told "pick it up today" two days early, and the payout clock started.
 *
 * Reads the EFFECTIVE (newest) declutter_porch_photo from the migrations: its seller side refuses porch_day_not_yet
 * while today in Louisiana is before the booked day (the booking's pickup_day, else its slot's Louisiana date), and the
 * check sits before anything is written. The app has words for the code.
 * Backend proof: src/test/pglite/declutterPorchPhotoNotBeforeTheDay.pglite.mjs (3x; RED without the migration).
 *
 * @mutate supabase/migrations/20261029224749_declutter_porch_places.sql |     IF v_day IS NULL OR (now() AT TIME ZONE 'America/Chicago')::date < v_day THEN |     IF false THEN
 * @mutate supabase/migrations/20261029224749_declutter_porch_places.sql |     IF v_day IS NULL OR (now() | IF (now()
 * @mutate supabase/migrations/20261029224749_declutter_porch_places.sql |   IF v_side = 'seller' THEN\n    SELECT COALESCE(b.pickup_day, | IF v_side = 'buyer' THEN\n    SELECT COALESCE(b.pickup_day,
 * @mutate src/lib/declutter/errors.ts |   porch_day_not_yet: "Put it out on the day the buyer picked. You can post the porch photo from that day.",\n |
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { DECLUTTER_ERROR_COPY } from "@/lib/declutter/errors";

const ROOT = resolve(__dirname, "../..");
const DEFS = effectiveDefs(resolve(ROOT, "supabase/migrations"));
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");

describe("audit 1a #4: the seller's porch photo waits for the booked day", () => {
  const def = DEFS.get("declutter_porch_photo");
  const body = flat(def?.stmt ?? "");

  it("reads the newest declutter_porch_photo (floor)", () => {
    expect(DEFS.size).toBeGreaterThan(500);
    expect(body.length).toBeGreaterThan(1000);
  });

  it("the seller side refuses porch_day_not_yet before the Louisiana booked day", () => {
    const gate = body.match(/IF v_side = 'seller' THEN SELECT COALESCE\(b\.pickup_day, \(b\.slot_start AT TIME ZONE 'America\/Chicago'\)::date\) INTO v_day FROM public\.declutter_bookings b WHERE b\.order_id = o\.id; IF v_day IS NULL OR \(now\(\) AT TIME ZONE 'America\/Chicago'\)::date < v_day THEN RAISE EXCEPTION 'porch_day_not_yet' USING ERRCODE = '55000'/);
    expect(gate, "the porch_day_not_yet gate on the seller side").not.toBeNull();
  });

  it("the gate runs before the set-out photo is saved or the buyer is told", () => {
    const at = body.indexOf("'porch_day_not_yet'");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(body.indexOf("SET set_out_photo_path"));
    expect(at).toBeLessThan(body.indexOf("declutter_notify(o.buyer_id"));
  });

  it("the app has words for porch_day_not_yet", () => {
    expect(DECLUTTER_ERROR_COPY.porch_day_not_yet).toMatch(/day the buyer picked/);
  });
});
