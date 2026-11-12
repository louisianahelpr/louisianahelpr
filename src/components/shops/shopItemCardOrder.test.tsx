/**
 * S026 (Shops audit 11-12): the shop page's item cards had no Add or Order action; the buyer had to scroll past every
 * card to a second "Order" list. Each card on a visitor's view of an open shop now has "Order", which takes the buyer
 * to that item's row in the order sheet (scrolls to it, focuses its first live control). The owner's own page and a
 * paused shop show none, and neither does the signed-out public page (no order sheet there).
 *
 * @mutate src/components/shops/ShopView.tsx | <ShopItemsList shopId={s.id} reportable={!s.mine} orderable={!s.mine && !s.paused} />} | <ShopItemsList shopId={s.id} reportable={!s.mine} />}
 * @mutate src/components/shops/ShopItemsList.tsx | onOrder={orderable ? goToOrderRow : undefined} | onOrder={undefined}
 * @mutate src/components/shops/ShopOrderSheet.tsx |  data-order-item={i.id}> | >
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ShopItem } from "@/lib/shops/items";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { ShopItemsGrid } from "./ShopProfile";
import { goToOrderRow } from "./ShopItemsList";

const item = (id: string) => ({
  id, kind: "made", subtype: "crafts", status: "live", title: `Mug ${id}`, description: "", price_cents: 2000,
  lead_time_days: 1, stock_count: null, home_kitchen: false, photos: [],
}) as unknown as ShopItem;
const src = (f: string) => blankComments(readFileSync(resolve(__dirname, f), "utf8"));

describe("S026: an item card's Order goes to that item's row in the order sheet", () => {
  it("each card has an Order button that scrolls to and focuses the item's order row", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(
      <>
        <ShopItemsGrid items={[item("a"), item("b")]} onOrder={goToOrderRow} />
        <section id="shop-order-sheet">
          <ul>
            <li data-order-item="b"><button type="button" disabled>Less</button><button type="button">More of Mug b</button></li>
          </ul>
        </section>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Order Mug b" }));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.textContent).toBe("More of Mug b");
  });

  it("no Order button without an order sheet (the public page, the owner)", () => {
    render(<ShopItemsGrid items={[item("a")]} />);
    expect(screen.queryByRole("button", { name: /^Order / })).toBeNull();
  });

  it("is wired only on a visitor's view of an open shop, to rows the order sheet marks", () => {
    expect(src("ShopView.tsx")).toMatch(/<ShopItemsList shopId=\{s\.id\} reportable=\{!s\.mine\} orderable=\{!s\.mine && !s\.paused\} \/>/);
    expect(src("ShopItemsList.tsx")).toMatch(/onOrder=\{orderable \? goToOrderRow : undefined\}/);
    expect(src("ShopOrderSheet.tsx")).toMatch(/data-order-item=\{i\.id\}/);
    expect(src("ShopOrderOptions.tsx")).toMatch(/data-order-item=\{item\.id\}/);
    expect(src("PublicShopView.tsx")).not.toMatch(/onOrder|orderable/);
  });
});
