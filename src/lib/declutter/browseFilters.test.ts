/**
 * Declutter Browse filters (boards 25 + 39): every filter reads a real column,
 * and "may drop tonight" comes from the real nightly rule (priceDrop.ts).
 * @mutate src/lib/declutter/browseFilters.ts |   if (way === "porch") return item.porch_ok; |   if (way === "porch") return true;
 * @mutate src/lib/declutter/browseFilters.ts |     if (maxC !== null && item.current_price_cents > maxC) return false; |
 * @mutate src/lib/declutter/browseFilters.ts |   return { planned: true, tonight: chicagoDay(next.at) === chicagoDay(now) }; |   return { planned: true, tonight: true };
 * @mutate src/lib/declutter/browseFilters.ts |   return priceRangeSwapped(f) ? [f.maxDollars, f.minDollars] : [f.minDollars, f.maxDollars]; |   return [f.minDollars, f.maxDollars];
 */
import { describe, expect, it } from "vitest";
import { NO_FILTERS, activeFilterCount, applyBrowseFilters, browseStateFromParams, browseStateInParams, dropOutlook, priceBounds, priceRangeSwapped } from "./browseFilters";

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Item ${id}`, status: "live", category: "furniture", condition_stars: 4, current_price_cents: 4000,
  porch_ok: true, live_at: "2026-10-10T12:00:00Z", created_at: "2026-10-10T12:00:00Z", ...over,
});
const rows = (items: ReturnType<typeof item>[]) => items.map((i) => ({ item: i, miles: null }));

describe("Declutter Browse filters", () => {
  it("price, condition, category, porch and search each narrow by their real column", () => {
    const all = rows([item("a"), item("b", { current_price_cents: 900, porch_ok: false }), item("c", { condition_stars: 5, category: "kitchen" })]);
    const ids = (f: typeof NO_FILTERS, q = "") => applyBrowseFilters(all, f, q, undefined).map((r) => r.item.id);
    expect(ids(NO_FILTERS)).toEqual(["a", "b", "c"]);
    expect(ids({ ...NO_FILTERS, maxDollars: 10 })).toEqual(["b"]);
    expect(ids({ ...NO_FILTERS, minDollars: 10 })).toEqual(["a", "c"]);
    expect(ids({ ...NO_FILTERS, porchOnly: true })).toEqual(["a", "c"]);
    expect(ids({ ...NO_FILTERS, conditions: [5] })).toEqual(["c"]);
    expect(ids({ ...NO_FILTERS, category: "kitchen" })).toEqual(["c"]);
    expect(ids(NO_FILTERS, "item B")).toEqual(["b"]);
    expect(ids({ ...NO_FILTERS, sort: "price_low" })).toEqual(["b", "a", "c"]);
    // Audit 11-10 F315: Highest price is the reverse.
    // @mutate src/lib/declutter/browseFilters.ts |   if (f.sort === "price_high") return [...kept].sort((a, b) => b.item.current_price_cents - a.item.current_price_cents); |
    expect(ids({ ...NO_FILTERS, sort: "price_high" })).toEqual(["a", "c", "b"]);
    expect(activeFilterCount({ ...NO_FILTERS, porchOnly: true, minDollars: 1 }, 25)).toBe(3);
    expect(activeFilterCount(NO_FILTERS, null)).toBe(0);
  });

  it("the drop outlook: only an 'offers' item on the plan, and 'tonight' only when the next run falls on today's Louisiana date", () => {
    const morning = new Date("2026-10-20T15:00:00Z"); // 10 AM CDT; the run is 23:07Z = 6:07 PM today
    const late = new Date("2026-10-21T01:00:00Z"); // 8 PM CDT on the 20th; today's run has passed
    const it1 = item("x");
    expect(dropOutlook(it1, { sale_mode: "fixed", last_price_drop_on: null }, morning)).toEqual({ planned: false, tonight: false });
    expect(dropOutlook(it1, undefined, morning)).toEqual({ planned: false, tonight: false });
    expect(dropOutlook(it1, { sale_mode: "offers", last_price_drop_on: "2026-10-19" }, morning)).toEqual({ planned: true, tonight: true });
    expect(dropOutlook(it1, { sale_mode: "offers", last_price_drop_on: "2026-10-20" }, late)).toEqual({ planned: true, tonight: false });
    const drops = new Map([["x", { sale_mode: "offers", last_price_drop_on: "2026-10-19" }]]);
    expect(applyBrowseFilters(rows([it1, item("y")]), { ...NO_FILTERS, dropsOnly: true }, "", drops, morning).map((r) => r.item.id)).toEqual(["x"]);
  });
});

/**
 * Audit item 4 / BUY-35: Back from an item finds the search, because Browse keeps it in the URL.
 * @mutate src/lib/declutter/browseFilters.ts |   put("q", s.query.trim() === "" ? null : s.query); |
 * @mutate src/lib/declutter/browseFilters.ts |   put("cond", s.filters.conditions.length ? s.filters.conditions.join(",") : null); |
 * @mutate src/lib/declutter/browseFilters.ts | tradesOnly: p.get("trades") === "1", porchOnly: p.get("porch") === "1", | tradesOnly: p.get("trades") === "1", porchOnly: false,
 */
describe("Browse's state survives the URL", () => {
  const s = { query: "oak chair", maxMiles: 25, filters: { ...NO_FILTERS, category: "furniture", minDollars: 5, maxDollars: 90, conditions: [3, 5], porchOnly: true, dropsOnly: true, freeOnly: true, sort: "price_low" as const } };

  it("every field comes back", () => {
    expect(browseStateFromParams(browseStateInParams(new URLSearchParams(), s))).toEqual(s);
  });

  it("other params stay, and defaults leave no trace", () => {
    const start = new URLSearchParams("tab=browse&q=old&porch=1");
    expect(browseStateInParams(start, { query: "  ", maxMiles: null, filters: NO_FILTERS }).toString()).toBe("tab=browse");
  });

  it("a nonsense sort or condition from the URL is ignored", () => {
    const f = browseStateFromParams(new URLSearchParams("sort=zzz&cond=9,a,2")).filters;
    expect(f.sort).toBe("closest");
    expect(f.conditions).toEqual([2]);
  });

  // Audit 1110 F312: a min typed above the max is read as the range the member meant, so the list never goes blank.
  it("a min above the max keeps the items between the two bounds", () => {
    const all = rows([item("a"), item("b", { current_price_cents: 900 }), item("c", { current_price_cents: 9000 })]);
    const ids = (f: typeof NO_FILTERS) => applyBrowseFilters(all, f, "", undefined).map((r) => r.item.id);
    expect(ids({ ...NO_FILTERS, minDollars: 50, maxDollars: 5 })).toEqual(["a", "b"]);
    expect(priceBounds({ minDollars: 50, maxDollars: 5 })).toEqual([5, 50]);
    expect(priceBounds({ minDollars: 5, maxDollars: null })).toEqual([5, null]);
    expect(priceRangeSwapped({ minDollars: 50, maxDollars: 5 })).toBe(true);
    expect(priceRangeSwapped({ minDollars: 5, maxDollars: 50 })).toBe(false);
  });
});
