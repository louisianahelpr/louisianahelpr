/**
 * D-NEW11 "I'm on my way" (the pickup-day card): it tells the seller once, only for the order's buyer, only on the booked
 * day, and moves nothing. Reads the EFFECTIVE definition. Backend proof: src/test/pglite/declutterOnMyWay.pglite.mjs
 * (3x; red with NEW_MIGRATION=skip, and each planted defect red).
 */
// @mutate supabase/migrations/20261030161617_declutter_pickup_on_my_way.sql |   IF o.buyer_id IS DISTINCT FROM v_uid THEN | IF false THEN
// @mutate supabase/migrations/20261030161617_declutter_pickup_on_my_way.sql |   IF v_day <> v_today THEN |   IF false THEN
// @mutate supabase/migrations/20261030161617_declutter_pickup_on_my_way.sql | REVOKE ALL ON FUNCTION public.declutter_on_my_way(uuid) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_on_my_way(uuid) FROM PUBLIC;
// @mutate src/components/declutter/DeclutterMineViews.tsx |       <PickupDayCard orders={t.live} bookings={t.bookings} held= | <p data-x="" held=
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const body = blankSqlComments(effectiveDefs(MIGRATIONS).get("declutter_on_my_way")?.stmt ?? "").replace(/\s+/g, " ");
const file = readFileSync(resolve(MIGRATIONS, "20261030161617_declutter_pickup_on_my_way.sql"), "utf8");

describe("I'm on my way", () => {
  it("reads the definition (floor)", () => {
    expect(body.length).toBeGreaterThan(800);
  });
  it("only the buyer, only on the booked day", () => {
    expect(body).toContain("IF o.buyer_id IS DISTINCT FROM v_uid THEN");
    expect(body).toContain("IF v_day <> v_today THEN");
  });
  it("writes no order, money or handover: only the booking's note and a notice", () => {
    expect(body.match(/\b(UPDATE|INSERT INTO|DELETE FROM)\s+[a-z_.]+/g)).toEqual(["UPDATE public.declutter_bookings"]);
  });
  it("members only", () => {
    expect(file).toContain("REVOKE ALL ON FUNCTION public.declutter_on_my_way(uuid) FROM PUBLIC, anon;");
  });
  it("the card is on Buying", () => {
    const mine = blankComments(readFileSync(resolve(__dirname, "../components/declutter/DeclutterMineViews.tsx"), "utf8"));
    expect(mine).toContain("<PickupDayCard orders={t.live} bookings={t.bookings} held=");
  });
});
