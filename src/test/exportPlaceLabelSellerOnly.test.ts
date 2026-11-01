/**
 * DOWNLOAD MY DATA NEVER GIVES A BUYER THE SELLER'S PICKUP-PLACE LABEL (owner 2026-10-31 11:42 PM, OWNER-DECISIONS
 * "Declutter item page layout": "Pickup places show the CITY only, never the place's label"). The newest
 * export_my_data hands the buyer their order's frozen place without the label (and, as before, without the
 * address, point or seller id); the seller's own copy is whole. Behaviour: src/test/pglite/exportPlaceCityOnly.pglite.mjs.
 *
 * @mutate supabase/migrations/20261101061156_export_my_data_place_city_only.sql | - 'seller_id' - 'label' END), '[]'::jsonb) FROM public.declutter_order_porch_places t | - 'seller_id' END), '[]'::jsonb) FROM public.declutter_order_porch_places t
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { latestFunctionDefs } from "./helpers/rpcErrorInventory";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = latestFunctionDefs(resolve(import.meta.dirname, "../../supabase/migrations"));
const body = blankSqlComments(defs.get("export_my_data")?.body ?? "").replace(/\s+/g, " ");

describe("the newest export_my_data keeps the place label the seller's", () => {
  it("is read", () => {
    expect(defs.size).toBeGreaterThan(500);
    expect(body.length).toBeGreaterThan(10000);
  });
  it("the buyer's copy of the frozen place drops the label; the seller's is whole", () => {
    expect(body).toContain(
      "CASE WHEN t.seller_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'address' - 'lat' - 'lng' - 'seller_id' - 'label' END), '[]'::jsonb) FROM public.declutter_order_porch_places t",
    );
  });
});
