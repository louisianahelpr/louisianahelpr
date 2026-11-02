/**
 * Q2491 (lead 2026-11-01): a seller with saved pickup places has the seller-delivery range measured from their place
 * NEAREST the buyer's drop-off (declutter_porch_places), not the listing's own address; a seller with no places is
 * measured from the items' own points, the farthest deciding, as before. Reads the EFFECTIVE definition.
 * Backend proof: src/test/pglite/declutterSellerDeliveryNearestPlace.pglite.mjs (3x; red without the migration and on
 * its planted defects).
 *
 * @mutate supabase/migrations/20261102030012_declutter_seller_delivery_nearest_place.sql | SELECT false, min(public.declutter_road_miles(round(pl.lat, 2) | SELECT false, max(public.declutter_road_miles(round(pl.lat, 2)
 * @mutate supabase/migrations/20261102030012_declutter_seller_delivery_nearest_place.sql | v_has_places := EXISTS (SELECT 1 FROM public.declutter_porch_places pl WHERE pl.seller_id = p_seller); | v_has_places := false;
 * @mutate supabase/migrations/20261102030012_declutter_seller_delivery_nearest_place.sql |       FROM public.declutter_porch_places pl\n     WHERE pl.seller_id = p_seller; |       FROM public.declutter_porch_places pl;
 * @mutate supabase/migrations/20261102030012_declutter_seller_delivery_nearest_place.sql | min(public.declutter_road_miles(round(pl.lat, 2), round(pl.lng, 2), d.lat, d.lng)) | min(public.declutter_road_miles(pl.lat, pl.lng, d.lat, d.lng))
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (s: string) => s.replace(/\s+/g, " ");
const check = flat(blankSqlComments(defs.get("declutter_seller_delivery_check")?.stmt ?? ""));

describe("seller delivery range from the seller's nearest saved place", () => {
  it("reads the newest definition", () => {
    expect(defs.size).toBeGreaterThan(500);
    expect(check.length).toBeGreaterThan(2000);
  });

  it("a seller with places: the nearest of THEIR places, from the rounded point", () => {
    expect(check).toContain("v_has_places := EXISTS (SELECT 1 FROM public.declutter_porch_places pl WHERE pl.seller_id = p_seller);");
    expect(check).toContain(
      "IF v_has_places THEN SELECT false, min(public.declutter_road_miles(round(pl.lat, 2), round(pl.lng, 2), d.lat, d.lng)) INTO v_unplaced, v_far FROM public.declutter_porch_places pl WHERE pl.seller_id = p_seller;");
  });

  it("a seller without places: every item's own point, the farthest deciding (unchanged)", () => {
    expect(check).toContain(
      "ELSE SELECT bool_or(p.pickup_lat IS NULL OR p.pickup_lng IS NULL), max(public.declutter_road_miles(round(p.pickup_lat, 2), round(p.pickup_lng, 2), d.lat, d.lng)) INTO v_unplaced, v_far");
    expect(check).toContain("IF v_far > s.radius_miles THEN");
  });
});
