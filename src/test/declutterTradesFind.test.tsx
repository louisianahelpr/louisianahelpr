/**
 * Trades audit 11-08, the last client items (lead 11-08):
 *  - #3 buyers can find trades: "Trades OK" on a Browse card and on the item page, an "Open to trades" filter, and a
 *    guest's line "Sign in and list an item to offer a trade" (anon reads accepts_trades from 20261108195151; the
 *    column and fallback are proved in src/lib/declutter/api.test.ts, the grant in
 *    src/test/pglite/declutterTradesFixes.pglite.mjs);
 *  - cart "Remove" on a trade line says it backs out of the whole trade (the server ends it at once, same proof);
 *  - start_checkout's trade_checkout_first ("Choose your trade pickup first") has words.
 *
 * @mutate src/lib/declutter/browseFilters.ts |     if (f.tradesOnly && item.accepts_trades !== true) return false;\n |
 * @mutate src/lib/declutter/browseFilters.ts |       freeOnly: p.get("free") === "1", tradesOnly: p.get("trades") === "1", |       freeOnly: p.get("free") === "1", tradesOnly: false,
 * @mutate src/lib/declutter/browseFilters.ts |   put("trades", s.filters.tradesOnly ? "1" : null);\n |
 * @mutate src/lib/declutter/browseFilters.ts |     + (f.tradesOnly ? 1 : 0)\n |
 * @mutate src/components/declutter/DeclutterFilterPanel.tsx |             <Chip on={filters.tradesOnly} onClick={() => onChange({ ...filters, tradesOnly: !filters.tradesOnly })}>Open to trades</Chip>\n |
 * @mutate src/components/declutter/DeclutterItemCard.tsx | {item.accepts_trades === true && <PhotoTag data-card-trades="">{t("decl.card.trades")}</PhotoTag>} | {false && <PhotoTag data-card-trades="">{t("decl.card.trades")}</PhotoTag>}
 * @mutate src/components/declutter/DeclutterGuest.tsx |       {trades && <p data-guest-trades="" | {false && <p data-guest-trades=""
 * @mutate src/components/declutter/DeclutterItemView.tsx |               {it.accepts_trades === true && !free && ( |               {false && (
 * @mutate src/components/declutter/DeclutterItemView.tsx | trades={!free && it.accepts_trades === true} /> | trades={false} />
 * @mutate src/components/declutter/DeclutterCartRemove.tsx |   const trade = line.source === "swap"; |   const trade = false;
 * @mutate src/lib/declutter/errors.ts |   trade_checkout_first: "Choose your trade pickup first, then check out the rest.",\n |
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import type { DeclutterItem } from "@/lib/declutter/api";
import { NO_FILTERS, activeFilterCount, applyBrowseFilters, browseStateFromParams, browseStateInParams } from "@/lib/declutter/browseFilters";
import { declutterErrorMessage } from "@/lib/declutter/errors";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));

const { ItemCard } = await import("@/components/declutter/DeclutterItemCard");
const { DeclutterGuestJoin } = await import("@/components/declutter/DeclutterGuest");
const { RemoveFromCart } = await import("@/components/declutter/DeclutterCartRemove");
const { declutterFilterSections } = await import("@/components/declutter/DeclutterFilterPanel");

const item = (over: Partial<DeclutterItem> = {}): DeclutterItem => ({
  id: "i1", seller_id: "s1", status: "live", title: "Lamp", description: "", category: "furniture", condition_stars: 4,
  delivery_size: "small", price_cents: 2000, current_price_cents: 2000, area_label: "Mid-City", area_lat: 30.4, area_lng: -91.1,
  created_at: "2026-11-01T00:00:00Z", live_at: "2026-11-01T00:00:00Z", porch_ok: true, accepts_offers: true, ...over,
});

const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

const src = (f: string) => blankComments(readFileSync(f, "utf8"));

describe("Trades audit 11-08 #3: buyers can find trades", () => {
  it("the Open to trades filter keeps only listings that take trades, counts as a filter and rides in the URL", () => {
    const rows = [item({ id: "a", accepts_trades: true }), item({ id: "b", accepts_trades: false }), item({ id: "c" })].map((i) => ({ item: i, miles: null }));
    const on = { ...NO_FILTERS, tradesOnly: true };
    expect(applyBrowseFilters(rows, on, "", undefined).map((r) => r.item.id)).toEqual(["a"]);
    expect(applyBrowseFilters(rows, NO_FILTERS, "", undefined).map((r) => r.item.id)).toEqual(["a", "b", "c"]);
    expect(activeFilterCount(on, null)).toBe(1);
    const params = browseStateInParams(new URLSearchParams("tab=browse"), { query: "", filters: on, maxMiles: null });
    expect(params.get("trades")).toBe("1");
    expect(browseStateFromParams(params).filters.tradesOnly).toBe(true);
    expect(browseStateFromParams(new URLSearchParams("")).filters.tradesOnly).toBe(false);
  });

  it("the filter sheet has an Open to trades chip that turns the filter on", () => {
    const onChange = vi.fn();
    const sections = declutterFilterSections({
      filters: NO_FILTERS, onChange, maxMiles: null, onMaxMiles: () => {}, showDrops: false, sellerDelivery: false,
      ask: { origin: { status: "none" }, asked: false, asking: false, canAskAgain: false, deviceNote: null, askDevice: () => {}, guest: true } as never,
    });
    const price = sections.find((s) => s.key === "price");
    wrap(<>{price?.content}</>);
    fireEvent.click(screen.getByRole("button", { name: "Open to trades" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tradesOnly: true }));
  });

  it("a card says Trades OK only for a listing that takes trades", () => {
    const { container, unmount } = wrap(<ItemCard item={item({ accepts_trades: true })} miles={null} approximate={false} />);
    expect(container.querySelector("[data-card-trades]")?.textContent).toBe("Trades OK");
    unmount();
    const off = wrap(<ItemCard item={item({ accepts_trades: false })} miles={null} approximate={false} />);
    expect(off.container.querySelector("[data-card-trades]")).toBeNull();
  });

  it("a guest on a listing open to trades is told how to offer one", () => {
    const { container, unmount } = wrap(<DeclutterGuestJoin free={false} trades />);
    expect(container.querySelector("[data-guest-trades]")?.textContent).toBe("Sign in and list an item to offer a trade.");
    unmount();
    const off = wrap(<DeclutterGuestJoin free={false} />);
    expect(off.container.querySelector("[data-guest-trades]")).toBeNull();
  });

  it("the item page shows Trades OK and the guest's trade line from the item read's accepts_trades", () => {
    const view = src("src/components/declutter/DeclutterItemView.tsx");
    expect(view).toMatch(/\{it\.accepts_trades === true && !free && \(\s*<span data-item-trades="" [^>]+>\{t\("decl\.card\.trades"\)\}<\/span>/);
    expect(view).toMatch(/<DeclutterGuestJoin free=\{free\} offers=\{it\.accepts_offers !== false\} trades=\{!free && it\.accepts_trades === true\} \/>/);
  });
});

describe("Trades: Remove on a trade line, and the trade-first refusal", () => {
  it("Remove on a trade line asks to back out of the trade; a plain line keeps its words", () => {
    wrap(<RemoveFromCart line={{ line_id: "l1", item_title: "Chair", source: "swap" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Chair from your cart" }));
    expect(screen.getByText("Back out of this trade?")).toBeTruthy();
    expect(screen.getByText(/The trade ends now/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back out" })).toBeTruthy();
  });

  it("a plain cart line still says it goes back on sale", () => {
    wrap(<RemoveFromCart line={{ line_id: "l1", item_title: "Chair", source: "buy" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Chair from your cart" }));
    expect(screen.getByText("Remove it from your cart?")).toBeTruthy();
    expect(screen.queryByText(/The trade ends now/)).toBeNull();
  });

  it("trade_checkout_first (declutter-checkout's refusal code) has words", () => {
    expect(declutterErrorMessage(new Error("trade_checkout_first"))).toBe("Choose your trade pickup first, then check out the rest.");
  });
});
