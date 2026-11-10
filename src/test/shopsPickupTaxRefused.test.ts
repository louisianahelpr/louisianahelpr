/**
 * Q2146 (lh-money-escrow review of Shops M1b part 2, finding fa4320caa#2; migration 20261110205854): a pickup
 * address Stripe refuses for sales tax is stamped, its owner told once per address, the stamp cleared when the
 * address changes, and My shop says so. Behaviour proof: src/test/pglite/shopsPickupTaxRefused.pglite.mjs (3x replay;
 * red with NEW_MIGRATION=skip and on planted defects). The edge call is pinned in src/test/edge/shop-checkout.test.ts
 * and the screen in src/components/shops/shopPickupAddressScreens.test.tsx. This guard reads the NEWEST definitions.
 *
 * @mutate supabase/migrations/20261110205854_shops_pickup_address_tax_refused.sql |     NEW.tax_refused_at := NULL;\n | \n
 * @mutate supabase/migrations/20261110205854_shops_pickup_address_tax_refused.sql | REVOKE ALL ON FUNCTION public.shops_mark_pickup_address_refused(uuid, timestamptz, text) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.shops_mark_pickup_address_refused(uuid, timestamptz, text) FROM PUBLIC, anon;
 * @mutate supabase/migrations/20261110205854_shops_pickup_address_tax_refused.sql |   WHERE a.shop_id = p_shop_id AND a.updated_at = p_address_updated_at |   WHERE a.shop_id = p_shop_id
 * @mutate supabase/migrations/20261110205854_shops_pickup_address_tax_refused.sql |    WHERE shop_id = p_shop_id AND updated_at = p_address_updated_at AND tax_refused_at IS NOT NULL; |    WHERE shop_id = p_shop_id AND tax_refused_at IS NOT NULL;
 * @mutate supabase/migrations/20261110205854_shops_pickup_address_tax_refused.sql |   IF NOT v_first THEN | IF false THEN
 * @mutate supabase/migrations/20261110205854_shops_pickup_address_tax_refused.sql |   PERFORM public.require_feature('shops');\n  SELECT a.tax_refused_at |   SELECT a.tax_refused_at
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, "20261110205854_shops_pickup_address_tax_refused.sql"), "utf8"));

describe("Shops: a pickup address Stripe refuses is stamped and its owner told (Q2146)", () => {
  it("reads a real inventory", () => {
    for (const fn of ["shop_pickup_addresses_owner_is_shop_owner", "shops_mark_pickup_address_refused", "shops_clear_pickup_address_refused", "shops_my_pickup_address_problem"]) {
      expect(DEFS.has(fn), fn).toBe(true);
    }
    expect(body("shops_mark_pickup_address_refused").length).toBeGreaterThan(300);
  });

  it("an address change clears the stamp, as it clears the cached tax location", () => {
    const trg = body("shop_pickup_addresses_owner_is_shop_owner");
    expect(trg).toMatch(/IS DISTINCT FROM \(OLD\.line1, OLD\.line2, OLD\.city, OLD\.postal_code\) THEN NEW\.stripe_tax_location_id := NULL; NEW\.stripe_tax_location_mode := NULL; NEW\.tax_refused_at := NULL; NEW\.tax_refused_reason := NULL;/);
  });

  it("the owner is told only on the first refusal of an address, and only the server can stamp", () => {
    const mark = body("shops_mark_pickup_address_refused");
    expect(mark).toContain("a.tax_refused_at IS NULL INTO v_owner, v_first");
    expect(mark).toContain("FOR UPDATE");
    // Review 1: only the copy the checkout was taxed on (a save meanwhile is never stamped).
    expect(mark).toContain("WHERE a.shop_id = p_shop_id AND a.updated_at = p_address_updated_at FOR UPDATE");
    expect(mark).toMatch(/IF NOT v_first THEN RETURN false; END IF; INSERT INTO public\.notifications/);
    for (const sig of ["shops_mark_pickup_address_refused(uuid, timestamptz, text)", "shops_clear_pickup_address_refused(uuid, timestamptz)"]) {
      expect(MIG).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
      expect(MIG).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO service_role;`);
    }
  });

  it("review 2: a later success on the same copy clears the stamp", () => {
    expect(body("shops_clear_pickup_address_refused")).toContain(
      "SET tax_refused_at = NULL, tax_refused_reason = NULL WHERE shop_id = p_shop_id AND updated_at = p_address_updated_at AND tax_refused_at IS NOT NULL",
    );
  });

  it("the owner's read is behind the shops switch, their own shop only, and returns the time, never Stripe's words", () => {
    const read = body("shops_my_pickup_address_problem");
    expect(read).toMatch(/BEGIN PERFORM public\.require_feature\('shops'\);/);
    expect(read).toContain("WHERE s.owner_id = auth.uid() AND a.owner_id = auth.uid()");
    expect(read).not.toContain("tax_refused_reason");
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.shops_my_pickup_address_problem() FROM PUBLIC, anon;");
  });
});
