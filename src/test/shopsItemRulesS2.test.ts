/**
 * Shops audit 2 (11-12) S2-003 server half: a download has one price, so the database refuses options on it
 * (20261112222000_shops_item_rules_s2.sql), and the editor names the refusal. Behaviour on a real database is
 * src/test/pglite/shopsItemRulesS2.pglite.mjs (3x; NEW_MIGRATION=skip RED; 5 planted defects RED). S2-002 is pinned
 * in shopsLiveItemPhotos.test.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SHOPS_ERROR_COPY } from "@/lib/shops/errors";
import { rpcErrorMessage } from "@/lib/shops/rpcErrorCopy";

const SQL = readFileSync(resolve(__dirname, "../../supabase/migrations/20261112222000_shops_item_rules_s2.sql"), "utf8");

describe("S2-003 a download takes no options", () => {
  it("both triggers stand and the old rows are cleared first", () => {
    expect(SQL).toMatch(/CREATE TRIGGER trg_shop_items_download_has_no_options BEFORE INSERT OR UPDATE OF kind, option_names ON public\.shop_items/);
    expect(SQL).toMatch(/CREATE TRIGGER trg_shop_item_variants_not_on_downloads BEFORE INSERT OR UPDATE ON public\.shop_item_variants/);
    expect(SQL.indexOf("UPDATE public.shop_item_variants v SET active = false")).toBeLessThan(SQL.indexOf("CREATE TRIGGER trg_shop_items_download_has_no_options"));
  });
  it("the editor says it in plain words on both save paths", () => {
    const err = { message: "options_not_for_downloads", code: "22023" };
    expect(SHOPS_ERROR_COPY.options_not_for_downloads).toMatch(/one price/);
    expect(rpcErrorMessage("shops_set_item_variants", err)).toBe(SHOPS_ERROR_COPY.options_not_for_downloads);
    expect(rpcErrorMessage("shops_update_item", err)).toBe(SHOPS_ERROR_COPY.options_not_for_downloads);
  });
});
