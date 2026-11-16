/**
 * Owner picks 11-08 (design audit B, Declutter redesign): the shared pieces and the Browse card rules that have no
 * older guard.
 *
 * - Browse card: "Trades OK" is a photo tag in the ONE PhotoTag style (the same as "Porch pickup"), only when the
 *   item takes trades.
 * - Category chips: no icons on the row (M4, 11-16: no "Free" chip; the Free tab is the way in).
 * - StickyActionBar: the buttons render ONCE (inline on a wide screen), never a second copy.
 *
 * @mutate src/components/declutter/DeclutterItemCard.tsx | {item.accepts_trades === true && <PhotoTag data-card-trades="">{t("decl.card.trades")}</PhotoTag>} | {null}
 * @mutate src/components/declutter/DeclutterCategoryChips.tsx |       {chips.map((k) => ( |       <FilterChip pressed={free} onClick={() => onFree?.(!free)} size="tall" className="shrink-0" data-category-chip="free">Free</FilterChip>\n      {chips.map((k) => (
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ItemCard } from "@/components/declutter/DeclutterItemCard";
import { DeclutterCategoryChips } from "@/components/declutter/DeclutterCategoryChips";
import { StickyActionBar } from "@/components/ui/StickyActionBar";

const item = (extra: Record<string, unknown> = {}) => ({
  id: "i1", seller_id: "u2", status: "live", title: "Oak rocking chair", category: "furniture", condition_stars: 4,
  delivery_size: "small", price_cents: 4000, current_price_cents: 4000, area_label: "Mid-City", area_lat: 30.45, area_lng: -91.15,
  porch_ok: true, ...extra,
}) as never;

describe("owner picks 11-08: Declutter redesign", () => {
  it("a card that takes trades wears a 'Trades OK' photo tag in the same style as 'Porch pickup'; one that doesn't, none", () => {
    const on = render(<MemoryRouter><ItemCard item={item({ accepts_trades: true })} miles={2} approximate={false} /></MemoryRouter>);
    const trades = on.container.querySelector("[data-photo-tags] [data-card-trades]")!;
    const porch = on.container.querySelector("[data-photo-tags] [data-card-porch]")!;
    expect(trades.textContent).toBe("Trades OK");
    expect(trades.className).toBe(porch.className);
    on.unmount();
    const off = render(<MemoryRouter><ItemCard item={item()} miles={2} approximate={false} /></MemoryRouter>);
    expect(off.container.querySelector("[data-card-trades]")).toBeNull();
    off.unmount();
  });

  // M4 (iOS design audit 11-16): Declutter's Free TAB sits beside Browse, so the row no longer repeats it as a chip.
  it("the chip row has no icons and no 'Free' chip (the Free tab is the one way in); All clears a Free filter", () => {
    const onFree = vi.fn();
    const items = [{ category: "furniture", current_price_cents: 0 }, { category: "kitchen", current_price_cents: 500 }];
    const r = render(<DeclutterCategoryChips items={items} value={null} onChange={() => undefined} free onFree={onFree} />);
    const chips = [...r.container.querySelectorAll("[data-category-chip]")].map((c) => c.getAttribute("data-category-chip"));
    expect(chips.length).toBeGreaterThan(1);
    expect(chips).not.toContain("free");
    expect(r.container.querySelector("[data-chip-row] svg")).toBeNull();
    fireEvent.click(screen.getByText("All"));
    expect(onFree).toHaveBeenCalledWith(false);
    r.unmount();
  });

  it("the sticky action bar renders its buttons once", () => {
    const r = render(<StickyActionBar label="Buy or make an offer"><button type="button">Make offer</button><button type="button">Buy now</button></StickyActionBar>);
    expect(screen.getAllByRole("button", { name: "Buy now" })).toHaveLength(1);
    expect(screen.getByRole("group", { name: "Buy or make an offer" })).toBeInTheDocument();
    r.unmount();
  });
});
