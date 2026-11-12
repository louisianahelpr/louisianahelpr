/**
 * S024 (Shops audit 11-12, shops-...a001-MOCK-H-1440-light.png): a shop's items grid was 2 columns at every width,
 * so at 1440 each card was ~760px wide with a huge photo. It now uses Declutter's breakpoints: 2 columns on a phone,
 * 3 from sm, 4 from lg; the loading skeleton has the same columns, so the cards land where it stood.
 * (jsdom has no layout, so this reads the grid's column classes; Tailwind compiles each one.)
 *
 * @mutate src/components/shops/ShopProfile.tsx | export const SHOP_ITEMS_GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"; | export const SHOP_ITEMS_GRID = "grid grid-cols-2 gap-3";
 * @mutate src/components/shops/ShopProfile.tsx |       <ul className={SHOP_ITEMS_GRID} data-testid="shop-items-grid"> |       <ul className="grid grid-cols-2 gap-3" data-testid="shop-items-grid">
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ShopItem } from "@/lib/shops/items";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { SHOP_ITEMS_GRID, ShopItemsGrid } from "./ShopProfile";

const item = (id: string) => ({
  id, kind: "made", subtype: "crafts", status: "live", title: `Mug ${id}`, description: "", price_cents: 2000,
  lead_time_days: 1, stock_count: null, home_kitchen: false, photos: [],
}) as unknown as ShopItem;

const cols = (cls: string) => Object.fromEntries(
  cls.split(/\s+/).map((c) => /^(?:(sm|md|lg|xl|2xl):)?grid-cols-(\d+)$/.exec(c)).filter(Boolean).map((m) => [m![1] ?? "base", Number(m![2])]),
);

describe("S024: the shop's items grid gets denser on wider screens", () => {
  it("2 columns on a phone, 3 from sm, 4 from lg", () => {
    render(<ShopItemsGrid items={[item("a"), item("b"), item("c"), item("d"), item("e")]} />);
    const grid = screen.getByTestId("shop-items-grid");
    expect(grid.querySelectorAll("li")).toHaveLength(5);
    expect(cols(grid.className)).toEqual({ base: 2, sm: 3, lg: 4 });
  });

  it("the loading skeleton uses the same grid (no jump when the cards arrive)", () => {
    const src = readFileSync(resolve(__dirname, "ShopItemsList.tsx"), "utf8");
    expect(src).toMatch(/aria-label="Loading items" className=\{SHOP_ITEMS_GRID\}/);
    expect(cols(SHOP_ITEMS_GRID)).toEqual({ base: 2, sm: 3, lg: 4 });
  });
});
