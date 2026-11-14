/*
 * GUARD (owner 11-14, Depop/Vinted phone audit, ~/.lh-shots/depop-vinted-audit-1114/FINDINGS.md items 7, 8, 9):
 *   A. Browse/search cards on a phone: 2 columns 8px apart, a 3:4 photo with the heart (44px) on its corner, and TWO
 *      text lines under it: the title (one line) and the bold price ("incl. fee" beside it, the 11-07 rule). The
 *      "condition · distance" line shows from lg only. Free still says Free.
 *   B. A phone search shows the query as a heading with a compact Filter | Sort bar right above the cards: Filter opens
 *      the one filter sheet, Sort offers the sheet's own sort choices. Desktop keeps its header row.
 *   C. The item page on a phone: the photo runs edge to edge (AppPage phoneBleed), the buyer's Make offer / Buy now and
 *      the owner's own actions sit in the fixed bottom bar (StickyActionBar; the dock yields), 44px buttons.
 * Measured at 390x844 and 320 on the dev server: ~/.lh-shots/decl-depop-1114/.
 */
// @mutate src/components/declutter/DeclutterItemCard.tsx | <span className="relative block aspect-[3/4] overflow-hidden | <span className="relative block aspect-[4/5] overflow-hidden
// @mutate src/components/declutter/DeclutterItemCard.tsx | <span data-card-place="" className="hidden min-w-0 | <span data-card-place="" className="flex min-w-0
// @mutate src/components/declutter/DeclutterItemCard.tsx | className="mt-0.5 flex min-w-0 flex-wrap items-baseline | className="mt-0.5 flex min-w-0 flex-col items-baseline
// @mutate src/components/declutter/DeclutterSkeletons.tsx | "grid grid-cols-2 gap-x-2 gap-y-4 | "grid grid-cols-2 gap-x-3 gap-y-5
// @mutate src/components/declutter/DeclutterBrowseView.tsx |   const phoneResults = !desktop && q !== "" | const phoneResults = false && q !== ""
// @mutate src/components/declutter/DeclutterBrowseView.tsx | <DeclutterResultsBar filterCount={filterCount} onFilters={() => setFiltersOpen(true)} | <DeclutterResultsBar filterCount={filterCount} onFilters={() => undefined}
// @mutate src/components/declutter/DeclutterResultsBar.tsx | {`“${query.trim()}”`} | {null}
// @mutate src/components/declutter/DeclutterItemView.tsx |       phoneBleed\n | \n
// @mutate src/components/declutter/DeclutterItemView.tsx | <div className={APP_PAGE_PHONE_BLEED} data-item-photo-bleed=""> | <div data-item-photo-bleed="">
// @mutate src/components/AppPage.tsx | ${phoneBleed ? " max-sm:mx-0 max-sm:w-full max-sm:px-5" : ""} | ${phoneBleed ? "" : ""}
// @mutate src/components/declutter/DeclutterManageListing.tsx | <StickyActionBar label={t("lp.m.yours")} data-seller-bar="" spacer={false}> | <div data-seller-bar="">
// @mutate src/components/declutter/DeclutterOfferPanel.tsx | className="rounded-full px-3 max-sm:min-h-11 max-sm:py-1" | className="rounded-full px-3"
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "@/test/helpers/blankNonCode";
import { ItemCard } from "@/components/declutter/DeclutterItemCard";
import { DECLUTTER_GRID } from "@/components/declutter/DeclutterSkeletons";
import { DeclutterResultsBar, DeclutterResultsHead } from "@/components/declutter/DeclutterResultsBar";
import { sortChoices } from "@/components/declutter/DeclutterFilterPanel";

const code = (p: string) => blankComments(readFileSync(p, "utf8"));
const item = (extra: Record<string, unknown> = {}) => ({
  id: "i1", seller_id: "s1", status: "live", title: "Oak rocking chair", category: "furniture", condition_stars: 5,
  price_cents: 4000, current_price_cents: 4000, area_label: "Mid-City", area_lat: 30.4, area_lng: -91.1, porch_ok: true, ...extra,
}) as never;
const card = (props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  render(<MemoryRouter><ItemCard item={item(extra)} miles={3} approximate={false} {...props} /></MemoryRouter>);

describe("A. Declutter cards on a phone (Depop/Vinted item 8)", () => {
  it("two columns 8px apart on a phone; the tablet and desktop grid unchanged", () => {
    const cls = DECLUTTER_GRID.split(/\s+/);
    expect(cls.length).toBeGreaterThan(4);
    expect(cls).toEqual(expect.arrayContaining(["grid-cols-2", "gap-x-2", "sm:grid-cols-3", "sm:gap-x-3", "sm:gap-y-5"]));
    expect(cls).not.toContain("gap-x-3");
  });

  it("a 3:4 photo below lg (4:5 from lg), the heart over it with a 44px hit area", () => {
    const { container } = card({ save: { on: false, toggle: vi.fn() } });
    const photo = container.querySelector("[data-item-card] > span.relative") as HTMLElement;
    expect(photo.className.split(/\s+/)).toEqual(expect.arrayContaining(["aspect-[3/4]", "lg:aspect-[4/5]"]));
    expect(photo.className).not.toMatch(/(^|\s)aspect-\[4\/5\]/);
    const heart = container.querySelector("[data-card-heart]") as HTMLElement;
    expect(heart.className.split(/\s+/)).toEqual(expect.arrayContaining(["h-11", "w-11", "absolute"]));
  });

  it("two text lines below lg: the title (truncated) then the bold price with incl. fee beside it; the meta line from lg only", () => {
    const { container } = card();
    const title = container.querySelector("[data-card-title]") as HTMLElement;
    expect(title.className).toMatch(/\btruncate\b/);
    const place = container.querySelector("[data-card-place]") as HTMLElement;
    expect(place.className.split(/\s+/)).toEqual(expect.arrayContaining(["hidden", "lg:flex"]));
    const price = container.querySelector("[data-card-price]") as HTMLElement;
    const pc = price.className.split(/\s+/);
    // One row below lg (wrapping only when too narrow), the stacked desktop column from lg.
    expect(pc).toEqual(expect.arrayContaining(["flex-wrap", "lg:flex-col"]));
    expect(pc).not.toContain("flex-col");
    expect(price.querySelector("[data-card-base-price]")?.className).toMatch(/\bfont-bold\b/);
    expect(price.querySelector("[data-price-incl-fee]")?.textContent).toMatch(/incl\. fee$/);
    // Visible below lg: the title and the price, nothing else (the place line is hidden).
    const shown = [...container.querySelectorAll("[data-card-title], [data-card-place], [data-card-price]")]
      .filter((e) => !(e as HTMLElement).className.split(/\s+/).includes("hidden"));
    expect(shown).toHaveLength(2);
  });

  it("Free still says Free, with no incl.-fee figure", () => {
    const { container } = card({}, { price_cents: 0, current_price_cents: 0 });
    expect(container.querySelector("[data-card-free]")?.textContent).toBe("Free");
    expect(container.querySelector("[data-price-incl-fee]")).toBeNull();
  });
});

describe("B. The phone search results page (Depop/Vinted item 7)", () => {
  it("the query is the heading, with how many items", () => {
    const a = render(<DeclutterResultsHead query="  lamp " count={18} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("“lamp”");
    expect(a.container.querySelector("[data-results-count]")?.textContent).toBe("18 items");
    a.unmount();
    const b = render(<DeclutterResultsHead query="lamp" count={1} />);
    expect(b.container.querySelector("[data-results-count]")?.textContent).toBe("1 item");
  });

  it("one 44px Filter | Sort bar: Filter opens the sheet, Sort offers the sheet's choices and sets one", async () => {
    const onFilters = vi.fn();
    const onSort = vi.fn();
    const { sorts, sortNow } = sortChoices(false, "closest");
    expect(sorts).toEqual(["newest", "price_low", "price_high"]);
    expect(sortNow).toBe("newest");
    const { container } = render(<DeclutterResultsBar filterCount={2} onFilters={onFilters} sorts={sorts} sort={sortNow} onSort={onSort} />);
    const bar = container.querySelector("[data-results-bar]") as HTMLElement;
    expect(bar.className).toMatch(/\bh-11\b/);
    fireEvent.click(screen.getByRole("button", { name: "Filters (2)" }));
    expect(onFilters).toHaveBeenCalledTimes(1);
    const sortButton = container.querySelector("[data-results-sort]") as HTMLElement;
    await act(async () => { fireEvent.keyDown(sortButton, { key: "Enter" }); });
    const choices = document.querySelectorAll("[data-sort-choice]");
    expect([...choices].map((c) => c.getAttribute("data-sort-choice"))).toEqual(sorts);
    expect(document.querySelector('[data-sort-choice="newest"]')?.getAttribute("aria-checked")).toBe("true");
    await act(async () => { fireEvent.click(document.querySelector('[data-sort-choice="price_low"]') as HTMLElement); });
    expect(onSort).toHaveBeenCalledWith("price_low");
  });

  it("the filter sheet's Sort row and the bar read one list (sortChoices)", () => {
    expect(sortChoices(true, "closest").sorts).toEqual(["closest", "newest", "price_low", "price_high"]);
    expect(code("src/components/declutter/DeclutterFilterPanel.tsx")).toContain("const { sorts, sortNow } = sortChoices(located, filters.sort);");
  });

  it("Browse shows the heading and the bar on a phone while a search is typed, the bar right before the cards", () => {
    const src = code("src/components/declutter/DeclutterBrowseView.tsx");
    expect(src).toContain('const phoneResults = !desktop && q !== "" && itemsPhase !== "offline-empty";');
    expect(src).toContain("{phoneResults && <DeclutterResultsHead query={query}");
    const bar = src.indexOf("{phoneResults && <DeclutterResultsBar filterCount={filterCount} onFilters={() => setFiltersOpen(true)}");
    expect(bar).toBeGreaterThan(0);
    expect(src.indexOf('{itemsPhase === "offline-empty" ? (', bar)).toBeGreaterThan(bar);
    expect(src).toContain("onSort={(sort) => setFilters((f) => ({ ...f, sort }))}");
  });
});

describe("C. The item page on a phone (Depop/Vinted item 9)", () => {
  it("the photo runs edge to edge: the page bleeds and the gallery wrapper cancels the gutter (page and its skeleton)", () => {
    const page = code("src/components/AppPage.tsx");
    expect(page).toContain('export const APP_PAGE_PHONE_BLEED = "max-sm:-mx-5";');
    expect(page).toContain('${phoneBleed ? " max-sm:px-0" : ""}');
    expect(page).toContain('${phoneBleed ? " max-sm:mx-0 max-sm:w-full max-sm:px-5" : ""}');
    const view = code("src/components/declutter/DeclutterItemView.tsx");
    expect(view).toMatch(/stickyHeader\s+phoneBleed\s*>/);
    expect(view).toContain('<div className={APP_PAGE_PHONE_BLEED} data-item-photo-bleed="">');
    const bones = code("src/components/declutter/DeclutterSkeletons.tsx");
    expect(bones).toContain("stickyHeader phoneBleed>");
    expect(bones).toContain("<div className={APP_PAGE_PHONE_BLEED}>");
    expect(code("src/components/declutter/itemPhotoFrame.ts")).toContain("max-sm:rounded-none");
  });

  it("the buyer's bar and the owner's actions are the fixed bottom bar, 44px buttons on a phone", () => {
    const offer = code("src/components/declutter/DeclutterOfferPanel.tsx");
    expect(offer).toContain('<StickyActionBar label={t("decl.buy.bar")} data-declutter-buybar="" spacer={false} pinWide>');
    expect(offer.match(/max-sm:min-h-11/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    const owner = code("src/components/declutter/DeclutterManageListing.tsx");
    const start = owner.indexOf('<StickyActionBar label={t("lp.m.yours")} data-seller-bar="" spacer={false}>');
    expect(start).toBeGreaterThan(0);
    const end = owner.indexOf("</StickyActionBar>", start);
    const inBar = owner.slice(start, end);
    for (const key of ['t("lp.m.tMenu")', 't("lp.m.relist")', 't("lp.m.relistNew")']) expect(inBar).toContain(key);
    expect(inBar.match(/max-sm:h-11/g)?.length).toBe(3);
  });
});
