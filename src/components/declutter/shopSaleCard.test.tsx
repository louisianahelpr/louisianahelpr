/**
 * Declutter top 5 #4 (owner 11-19): the shop-wide sale.
 * Server behaviour: src/test/pglite/declutterShopSale.pglite.mjs (28 PASS applied 3x; NEW_MIGRATION=skip RED; a planted
 * put-back that overwrites the seller's own new price 1 FAIL). Here: the newest definitions keep the money rules (never
 * below the lowest price, never above the listed price, a seller's own change kept, a reserved listing waits), and the
 * Selling card and the item page draw the sale.
 *
 * @mutate supabase/migrations/20261120014036_declutter_shop_sale.sql |     v_cents := greatest(100, COALESCE(r.floor_price_cents, 100), |     v_cents := greatest(100,
 * @mutate supabase/migrations/20261120014036_declutter_shop_sale.sql |     IF r.seller_changed_at IS NULL AND r.status IN ('live', 'paused') AND r.current_price_cents = r.sale_cents THEN |     IF r.status IN ('live', 'paused') AND r.current_price_cents = r.sale_cents THEN
 * @mutate supabase/migrations/20261120014036_declutter_shop_sale.sql |          SET current_price_cents = least(r.before_cents, r.price_cents), updated_at = now() |          SET current_price_cents = r.before_cents, updated_at = now()
 * @mutate supabase/migrations/20261120014036_declutter_shop_sale.sql |        AND NOT EXISTS (SELECT 1 FROM public.declutter_shop_sale_items x\n                        WHERE x.item_id = i.id AND x.restored_at IS NULL)\n    RETURNING | AND true\n    RETURNING
 * @mutate supabase/migrations/20261120014036_declutter_shop_sale.sql |                         WHERE x.item_id = i.id AND (x.sale_id = p_sale_id OR x.restored_at IS NULL)) |                         WHERE x.item_id = i.id AND x.sale_id = p_sale_id)
 * @mutate supabase/migrations/20261120014036_declutter_shop_sale.sql |  FOR EACH ROW WHEN (NEW.status IN ('live', 'paused') AND OLD.status IS DISTINCT FROM NEW.status) |  FOR EACH ROW WHEN (false)
 */
import { describe, expect, it, vi } from "vitest";
// DemandLine relies on the item page to register its words (i18nDictionariesRideWithTheirScreens); a standalone render does it here.
import "@/lib/i18n/enItemPage";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { newestFunction } from "@/test/helpers/parityReaders";
import { blankSqlComments } from "@/test/helpers/blankNonCode";

const state = vi.hoisted(() => ({
  sale: null as null | { id: string; percent_off: number; starts_at: string; ends_at: string; status: "on" | "scheduled" },
  demand: null as null | { saves: number; offers_week: number; views_today: number; sale_pct: number | null; sale_ends_at: string | null },
}));
vi.mock("@/lib/declutter/api", () => ({ fetchMyShopSale: async () => state.sale }));
vi.mock("@/lib/declutter/demand", async (orig) => ({ ...(await orig<object>()), fetchItemDemand: async () => state.demand }));

import { ShopSaleCard } from "./ShopSaleCard";
import { DemandLine } from "./DemandLine";
import { saleEnd, saleEndOfDay } from "@/lib/declutter/sellerTools";

const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe("Declutter top 5 #4: shop-wide sale", () => {
  it("the newest definitions keep the money rules", () => {
    for (const n of ["declutter_shop_sale_apply", "declutter_shop_sale_restore", "declutter_start_shop_sale", "declutter_end_shop_sale", "declutter_shop_sale_sweep"]) {
      expect(newestFunction(n).file, n).toContain("20261120014036");
    }
    const apply = flat(newestFunction("declutter_shop_sale_apply").body);
    expect(apply).toContain("v_cents := greatest(100, COALESCE(r.floor_price_cents, 100), round(r.current_price_cents * (100 - v_sale.percent_off) / 100.0)::integer);");
    expect(apply).toContain("WHERE id = r.id AND status = 'live' AND current_price_cents = r.current_price_cents;");
    const restore = flat(newestFunction("declutter_shop_sale_restore").body);
    expect(restore).toContain("ELSIF r.seller_changed_at IS NULL AND r.status NOT IN ('live', 'paused', 'completed', 'withdrawn', 'rejected', 'removed', 'sold_elsewhere') THEN CONTINUE;");
    expect(restore).toContain("IF r.seller_changed_at IS NULL AND r.status IN ('live', 'paused') AND r.current_price_cents = r.sale_cents THEN");
    expect(apply).toContain("WHERE x.item_id = i.id AND (x.sale_id = p_sale_id OR x.restored_at IS NULL))");
    // Review 11-19 #1 and #6: the triggers that put a relisted listing's price back and mark the seller's own price.
    expect(newestFunction("declutter_items_shop_sale_return").file).toContain("20261120014036");
    expect(newestFunction("declutter_items_shop_sale_price").file).toContain("20261120014036");
    expect(restore).toContain("SET current_price_cents = least(r.before_cents, r.price_cents)");
    // Lead 11-19: the nightly drop never stacks on a running sale, so the end can put back the exact price.
    const drops = newestFunction("declutter_price_drop_sweep");
    expect(drops.file).toContain("20261120014036");
    expect(flat(drops.body)).toContain("AND NOT EXISTS (SELECT 1 FROM public.declutter_shop_sale_items x WHERE x.item_id = i.id AND x.restored_at IS NULL)");
    const start = flat(newestFunction("declutter_start_shop_sale").body);
    expect(start).toContain("OR p_ends_at > v_start + interval '14 days 2 hours' OR v_start > now() + interval '14 days' THEN");
  });

  it("review 11-19 #5: the end is clamped to a full day at least and 14 days at most", () => {
    const lateNight = new Date(2026, 10, 20, 23, 50);
    expect(saleEnd(lateNight, 1).getTime() - lateNight.getTime()).toBe(24 * 3600_000);
    const noon = new Date(2026, 10, 20, 12, 0);
    expect(saleEnd(noon, 15).getTime() - noon.getTime()).toBe(14 * 24 * 3600_000);
    expect(saleEnd(noon, 3).getDate()).toBe(22);
  });

  it("a sale 'through' N days ends at 11:59 PM on the last day", () => {
    const end = saleEndOfDay(new Date(2026, 10, 20, 15, 0), 2);
    expect([end.getDate(), end.getHours(), end.getMinutes()]).toEqual([22, 23, 59]);
  });

  it("Selling: no sale offers to start one; a running one says until when and can be ended", async () => {
    state.sale = null;
    const a = wrap(<ShopSaleCard userId="u1" />);
    expect(await screen.findByText("Start a sale")).toBeTruthy();
    a.unmount();
    state.sale = { id: "s1", percent_off: 20, starts_at: "2026-11-20T15:00:00Z", ends_at: "2026-11-23T05:59:00Z", status: "on" };
    wrap(<ShopSaleCard userId="u1" />);
    expect(await screen.findByText(/^20% off everything until /)).toBeTruthy();
    expect(screen.getByText("End sale")).toBeTruthy();
  });

  it("the item page says the sale only for a listing at its sale price", async () => {
    state.demand = { saves: 0, offers_week: 0, views_today: 0, sale_pct: 15, sale_ends_at: "2026-11-23T05:59:00Z" };
    const a = wrap(<DemandLine itemId="i1" />);
    expect(await screen.findByText(/^Shop sale: 15% off until /)).toBeTruthy();
    a.unmount();
    state.demand = { saves: 0, offers_week: 0, views_today: 0, sale_pct: null, sale_ends_at: null };
    const { container } = wrap(<DemandLine itemId="i2" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-item-sale]")).toBeNull();
  });
});
