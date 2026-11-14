/**
 * Shops: an enrolled test account sees a test (is_seed) shop while the launch switch hides seed data
 * (20261114233422; lead 2026-11-14 for the owner's live Stripe-TEST Shops order and the Q1957 hide/unhide smoke).
 * Before it, shop_state_ok hid every is_seed shop from every viewer but its owner, so shops_order_terms /
 * shops_request_order answered shop_not_found to the test buyer and no test-mode Shops order could be placed.
 *
 * Reads the EFFECTIVE (newest) shop_visible_to: the test-viewer branch keeps every other part of the public rule
 * (switch on for the viewer, not admin-hidden, owner in good standing), and only seed_hidden_for(viewer), the
 * jobs-side rule, decides it. The public link page (shop_link_visible / shop_state_ok) still hides test shops.
 * Behaviour on a real database: src/test/pglite/shopsTestAccountsSeeTestShops.pglite.mjs (3x; NEW_MIGRATION=skip
 * red; planted defects red).
 *
 * @mutate supabase/migrations/20261114233422_shops_test_accounts_see_test_shops.sql |             AND s.hidden_at IS NULL\n |
 * @mutate supabase/migrations/20261114233422_shops_test_accounts_see_test_shops.sql |             AND NOT public.seed_hidden_for(p_viewer)\n |
 * @mutate supabase/migrations/20261114233422_shops_test_accounts_see_test_shops.sql |             AND public.feature_enabled_for_user('shops', p_viewer)\n |
 * @mutate supabase/migrations/20261114233422_shops_test_accounts_see_test_shops.sql | GRANT EXECUTE ON FUNCTION public.shop_visible_to(uuid, uuid) TO service_role; | GRANT EXECUTE ON FUNCTION public.shop_visible_to(uuid, uuid) TO service_role, authenticated;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG_DIR = resolve(__dirname, "../../supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const FILE = "20261114233422_shops_test_accounts_see_test_shops.sql";
const MIG = blankSqlComments(readFileSync(resolve(MIG_DIR, FILE), "utf8")).replace(/\s+/g, " ");

describe("Shops: enrolled test accounts see test shops (20261114233422)", () => {
  it("the newest shop_visible_to adds the test-viewer branch with every other public rule kept", () => {
    const b = flat("shop_visible_to");
    expect(b).toContain("SELECT s.owner_id = p_viewer OR public.shop_publicly_visible(s.id)");
    expect(b).toContain(
      "OR (p_viewer IS NOT NULL AND NOT public.seed_hidden_for(p_viewer) AND public.feature_enabled_for_user('shops', p_viewer) AND s.hidden_at IS NULL AND public.shop_owner_in_good_standing(s.owner_id))",
    );
    expect(b).toContain("SECURITY DEFINER");
  });

  it("stays service_role only, and the migration touches nothing else", () => {
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.shop_visible_to(uuid, uuid) FROM PUBLIC, anon, authenticated;");
    expect(MIG).toContain("GRANT EXECUTE ON FUNCTION public.shop_visible_to(uuid, uuid) TO service_role;");
    expect(MIG).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.shop_visible_to\(uuid, uuid\) TO [^;]*\b(authenticated|anon)\b/);
    expect((MIG.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length).toBe(1);
    expect(MIG).not.toMatch(/platform_settings|seed_jobs_hidden_publicly\s*\(\s*\)\s*(RETURNS|AS)/i);
  });

  it("the signed-out link rule still hides test shops (shop_state_ok unchanged)", () => {
    expect(flat("shop_state_ok")).toContain("AND NOT (s.is_seed AND public.seed_jobs_hidden_publicly())");
    expect(flat("seed_hidden_for")).toContain("SELECT public.seed_jobs_hidden_publicly() AND (");
  });

  it("reads a real inventory (floor): the member RPCs that gate on shop_visible_to", () => {
    const callers = [...DEFS.keys()].filter((n) => n !== "shop_visible_to" && flat(n).includes("public.shop_visible_to("));
    expect(callers).toEqual(expect.arrayContaining(["shops_order_terms", "shops_request_order", "shops_get_shop", "shops_shop_items"]));
    expect(callers.length).toBeGreaterThan(10);
  });
});
