/**
 * Strikes are PER SECTION (owner decision via the lead, 2026-10-18; it
 * overrides L45's "one marketplace strike count shared with Declutter").
 * Whole-account bans (is_caller_banned / ban_status) stay shared.
 *
 * Derived from the migrations, not a list of gates: every Shops function's
 * NEWEST definition (name starting shop_ / shops_) that counts strikes counts
 * Shops' own (shop_active_strike_count), never declutter_active_strike_count;
 * the Shops count reads only shop_strikes; Declutter's count reads only
 * declutter_strikes. The PGlite proof (src/test/pglite/shopsOrders.pglite.mjs
 * section 16) runs it: 3 Declutter strikes do not stop a Shops order or hide a
 * shop, 3 Shops strikes do and count nothing in Declutter.
 *
 * @mutate supabase/migrations/20261027163240_payout_setup_only_when_owed.sql |     WHEN public.shop_active_strike_count(p_owner_id) >= 3 THEN 'shop_strikes_blocked' |     WHEN public.declutter_active_strike_count(p_owner_id) >= 3 THEN 'shop_strikes_blocked'
 * @mutate supabase/migrations/20261018164444_shops_own_strike_count.sql |      AND public.shop_active_strike_count(p_owner_id) < 3; |      AND public.declutter_active_strike_count(p_owner_id) < 3;
 * @mutate supabase/migrations/20261018164444_shops_own_strike_count.sql |   IF public.shop_active_strike_count(v_uid) >= 3 THEN\n    RAISE EXCEPTION 'shop_strikes_blocked' USING | IF public.declutter_active_strike_count(v_uid) >= 3 THEN\n    RAISE EXCEPTION 'shop_strikes_blocked' USING
 * @mutate supabase/migrations/20261018164444_shops_own_strike_count.sql |     FROM public.shop_strikes s\n | FROM public.declutter_strikes s\n
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { latestFunctionDefs } from "./helpers/rpcErrorInventory";

const defs = latestFunctionDefs(join(process.cwd(), "supabase", "migrations"));
const shopFns = [...defs.entries()].filter(([name]) => /^shops?_/.test(name));

describe("strikes are per section: Shops counts its own", () => {
  it("the inventory is real", () => {
    expect(shopFns.length).toBeGreaterThan(30);
  });

  it("no Shops function counts Declutter's strikes", () => {
    const shared = shopFns.filter(([, d]) => /\bdeclutter_active_strike_count\s*\(|\bdeclutter_strikes\b/.test(d.body)).map(([n]) => n);
    expect(shared).toEqual([]);
  });

  it("every Shops gate that refuses for strikes uses the Shops count", () => {
    const gates = shopFns.filter(([, d]) => /shop_strikes_blocked|shop_active_strike_count/.test(d.body)).map(([n, d]) => [n, d.body] as const);
    // shop_owner_in_good_standing, shops_assert_owner_eligible, shop_owner_sell_block_reason, shops_request_order (2026-10-18).
    expect(gates.length).toBeGreaterThanOrEqual(4);
    for (const name of ["shop_owner_in_good_standing", "shops_assert_owner_eligible", "shop_owner_sell_block_reason", "shops_request_order"]) {
      expect(defs.get(name)?.body ?? "", name).toMatch(/\bshop_active_strike_count\s*\(/);
    }
    const noCount = gates.filter(([n, b]) => n !== "shop_active_strike_count" && /shop_strikes_blocked/.test(b) && !/\bshop_active_strike_count\s*\(/.test(b)).map(([n]) => n);
    // A gate may RAISE the code a helper decided (shop_owner_sell_block_reason); it must then call that helper.
    const viaHelper = noCount.filter((n) => !/\bshop_owner_sell_block_reason\s*\(|\bshops_assert_owner_eligible\s*\(/.test(defs.get(n)!.body));
    expect(viaHelper).toEqual([]);
  });

  it("each count reads only its own section's table", () => {
    const shop = defs.get("shop_active_strike_count")?.body ?? "";
    expect(shop).toMatch(/FROM public\.shop_strikes\b/);
    expect(shop).not.toMatch(/declutter_strikes/);
    const declutter = defs.get("declutter_active_strike_count")?.body ?? "";
    expect(declutter).toMatch(/FROM public\.declutter_strikes\b/);
    expect(declutter).not.toMatch(/shop_strikes/);
  });
});
