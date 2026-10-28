/**
 * "Need a hand?" knows what was bought (lead 2026-10-28, Confusing #27; migration 20261028201659): the buyer's
 * declutter_setup_helpr read returns item_details [{title, category, delivery_size}] beside 'items' (the titles,
 * unchanged), so a mug is not offered "Hang it on the wall". Additive: every earlier key stays.
 * Reads the EFFECTIVE definition. Backend proof: src/test/pglite/declutterSetupHelprItemDetails.pglite.mjs
 * (3x; 2 FAIL without the migration; RED on a wrong order and on the old key renamed).
 */
// @mutate supabase/migrations/20261028201659_declutter_setup_helpr_item_details.sql | jsonb_build_object('title', i.title, 'category', i.category, 'delivery_size', i.delivery_size) | jsonb_build_object('title', i.title)
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = blankSqlComments(DEFS.get("declutter_setup_helpr")?.stmt ?? "").replace(/\s+/g, " ");

describe("declutter_setup_helpr names what each item is", () => {
  it("reads the definition (floor)", () => {
    expect(flat.length).toBeGreaterThan(1000);
  });

  it("item_details carries each item's title, category and size; every earlier key stays", () => {
    expect(flat).toContain("'item_details', COALESCE(( SELECT jsonb_agg(jsonb_build_object('title', i.title, 'category', i.category, 'delivery_size', i.delivery_size) ORDER BY c.created_at, i.id)");
    for (const k of ["'order_id', o.id", "'status', o.status", "'handover', o.handover", "'items', COALESCE((", "'pickup_at',", "'jobs', COALESCE(("]) {
      expect(flat, k).toContain(k);
    }
  });
});
