/**
 * Shops audit 11-12 S044: a paused shop's shared link tells guests the shop is paused (its name only), instead of
 * "not found". Reads the EFFECTIVE (newest) shops_public_shop; behaviour on a real database is
 * src/test/pglite/shopsPausedLinkSaysPaused.pglite.mjs (3x; skip red; planted defects red; "AND paused" is an
 * equivalent mutant while shop_link_visible refuses only paused shops past these checks, kept as defence).
 *
 * @mutate supabase/migrations/20261112210500_shops_public_items_from_price.sql | RETURN jsonb_build_object('id', v_s.id, 'name', v_s.name, 'paused', true); | RETURN jsonb_build_object('id', v_s.id, 'name', v_s.name);
 * @mutate supabase/migrations/20261112210500_shops_public_items_from_price.sql |        AND public.shop_state_ok(p_shop_id) THEN |        THEN
 * @mutate src/components/shops/PublicShopView.tsx |       ) : isPausedShop(shop.data) ? ( |       ) : false ? (
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

describe("S044: a paused shop's link says paused", () => {
  it("shops_public_shop answers only {id, name, paused} for a paused, otherwise visible shop", () => {
    const b = flat("shops_public_shop");
    expect(b).toContain(
      "IF p_shop_id IS NULL OR NOT public.shop_link_visible(p_shop_id) THEN IF p_shop_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.feature_switches f WHERE f.key = 'shops' AND f.audience IN ('testers', 'everyone')) AND public.shop_state_ok(p_shop_id) THEN SELECT * INTO v_s FROM public.shops WHERE id = p_shop_id AND paused; IF FOUND THEN RETURN jsonb_build_object('id', v_s.id, 'name', v_s.name, 'paused', true); END IF; END IF; RETURN NULL; END IF;",
    );
  });

  it("the public page shows '<Shop> is paused for now' with Browse shops", () => {
    const view = readFileSync(resolve(__dirname, "../components/shops/PublicShopView.tsx"), "utf8");
    expect(view).toContain(") : isPausedShop(shop.data) ? (");
    expect(view).toContain("<ShopUnavailable title={`${shop.data.name} is paused for now`}");
    const ui = readFileSync(resolve(__dirname, "../components/shops/shopsUi.tsx"), "utf8");
    expect(ui).toContain("title={title ?? SHOP_UNAVAILABLE_TITLE}");
    expect(ui).toContain('<Link to="/shops">Browse shops</Link>');
  });
});
