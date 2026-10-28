/**
 * "N sold" on a seller's profile (lead 2026-10-28; migration 20261028202132): declutter_seller_sold_count returns
 * one integer, the seller's items handed over through Declutter priced above $0, and nothing else; a test
 * seller reads 0 to anyone the seed switch hides test accounts from.
 * Reads the EFFECTIVE definition. Backend proof: src/test/pglite/declutterSellerSoldCount.pglite.mjs (3x; 11 FAIL
 * without the migration; RED on 5 planted defects: paid-not-handed counted, free counted, seed shown, no switch
 * gate, anon granted).
 */
// @mutate supabase/migrations/20261028202132_declutter_seller_sold_count.sql | o.status = 'handed_over' AND c.price_cents > 0 | o.status IN ('handed_over', 'paid')
// @mutate supabase/migrations/20261028202132_declutter_seller_sold_count.sql |      AND public.seed_hidden_for(v_uid) THEN |      AND false THEN
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = blankSqlComments(DEFS.get("declutter_seller_sold_count")?.stmt ?? "").replace(/\s+/g, " ");

describe("declutter_seller_sold_count: one number, completed paid sales only", () => {
  it("reads the definition (floor)", () => {
    expect(flat.length).toBeGreaterThan(500);
  });

  it("returns an integer, behind the switch", () => {
    expect(flat).toMatch(/RETURNS integer/);
    expect(flat).toMatch(/BEGIN PERFORM public\.require_feature\('declutter'\);/);
  });

  it("counts handed-over lines above $0 only, and hides a test seller where test accounts are hidden", () => {
    expect(flat).toContain("WHERE o.seller_id = p_seller_id AND o.status = 'handed_over' AND c.price_cents > 0");
    expect(flat).toContain("AND public.seed_hidden_for(v_uid) THEN RETURN 0;");
  });
});
