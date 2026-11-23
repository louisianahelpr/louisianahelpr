/**
 * Owner 2026-11-21, four asks on the gift guides:
 *  - 25 Days sponsors page: "move search, heart and share under the line for shop our sponsors, and move those things
 *    into the filter for that section. Remove tap a price to see gifts in your budget." Its count, order-by pill and
 *    icons sit on one row under the banner at every width; its section links and price limits live in a Filter in that
 *    row (with an active count); the list draws neither; the budget tip is gone from every guide.
 *  - "remove shop small here, it's already listed with small business saturday": no Shop Small in the guides menu.
 *    (/shop-small keeps working; its redirect to the Small Business Saturday page follows once that page carries the
 *    business sign-up form, so the form is never unreachable.)
 *  - "when I click into each section on the left panel, it should open to the top of the page, not the middle": every
 *    menu link that changes the view carries no #anchor (each printables entry opens that kind's own page, owner 11-21
 *    "coloring book and banner should have their own page"), and a menu navigation scrolls the window to the top
 *    (ScrollToTop); a true #anchor still scrolls to it.
 *
 * @mutate src/pages/info/GiftGuides.tsx |   const countRow = phone && Boolean(guide) && !deals; |   const countRow = (phone && Boolean(guide) && !deals) \|\| guide?.slug === "25-days-sponsors";
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |       {!filter && nav.length > 1 && ( |       {nav.length > 1 && (
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |       {filter && <GiftGuideFilter filter={filter} />} |       {null}
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |         <Icon d={SLIDERS} />\n        {active > 0 |         <Icon d="M4 5h16l-6 7.5V19l-4 1.5v-8L4 5z" />\n        {active > 0
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | <Link to={p.path} {...current(p.path)} data-gift-side-printables={p.key}> | <Link to={`/gift-guides/printables#pr-${p.key}`} {...current(p.path)} data-gift-side-printables={p.key}>
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import ScrollToTop from "@/components/ScrollToTop";
import { loadAllGuidePicks } from "@/content/giftGuideCatalog";

await loadAllGuidePicks();
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function Where() {
  const { pathname, hash } = useLocation();
  return <p data-where="">{pathname + hash}</p>;
}
const renderAt = async (url: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
  let out!: ReturnType<typeof render>;
  await act(async () => {
    out = render(
      <MemoryRouter initialEntries={[url]}>
        <ScrollToTop />
        <Routes>
          <Route path="/gift-guides" element={<><GiftGuides /><Where /></>} />
          <Route path="/gift-guides/:slug" element={<><GiftGuides /><Where /></>} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return out.container;
};

describe("the 25 Days sponsors page: its tools and Filter (owner 11-21), set up as Her on a desktop (owner 11-22)", () => {
  it("at desktop width: the pill, then search, Filter, heart, Share in the header row, the count heading the content column; no chips or tip in the list", async () => {
    // Owner 11-22 ("104 gifts needs to move to the right like the other pages are set up"): as on Her, no row under the
    // banner on a desktop (a phone keeps the guides' one row there, src/test/giftGuidePhoneHeader1121.test.tsx).
    const c = await renderAt("/gift-guides/25-days-sponsors");
    expect(c.querySelector("[data-gift-countrow]")).toBeNull();
    const row = c.querySelector("[data-gift-headrow]")!;
    expect(row.querySelector("[data-gift-ship]")?.textContent).toMatch(/^Order by Dec 15/);
    expect(c.querySelector(".gg-main [data-gift-item-count]")?.textContent).toMatch(/^\d+ gifts$/);
    const icons = [...row.querySelectorAll("[data-gift-quick] button, [data-gift-quick] a")].map((b) => b.getAttribute("aria-label"));
    expect(icons).toEqual(["Search gift guides", "Filter", "My Wish List, 0 saved", "Share"]);
    expect(c.querySelector("[data-gift-section-nav], .gg-secnav")).toBeNull();
    expect(c.querySelector(".gg-main [data-gift-budget]")).toBeNull();
    expect(c.querySelector("[data-gift-hint='budget']")).toBeNull();
    expect(c.textContent).not.toMatch(/Tap a price to see gifts/);
  });

  // Owner 2026-11-22 (iPhone): "Should be the same filter icon as all the others": the sponsors' Filter is the same
  // sliders icon, in the same plain 44px icon button, as the sort on Her, Him and Kids (it was a funnel).
  it("the Filter is the same sliders icon and button as the sort on Her, Him and Kids", async () => {
    const her = await renderAt("/gift-guides/her");
    const sort = her.querySelector("[data-gift-sort-button]")!;
    const sliders = sort.querySelector("path")?.getAttribute("d");
    const sortClass = sort.className;
    expect(sliders).toBe("M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4");
    cleanup();
    const c = await renderAt("/gift-guides/25-days-sponsors");
    const filter = c.querySelector("[data-gift-filter-button]")!;
    expect(filter.querySelector("path")?.getAttribute("d")).toBe(sliders);
    expect(filter.className).toBe(sortClass);
    expect(filter.querySelectorAll("svg").length).toBe(1);
  });

  it("the Filter holds the section links and the price limits; a price limit filters the list and counts on the icon", async () => {
    const c = await renderAt("/gift-guides/25-days-sponsors");
    const before = c.querySelectorAll("li[data-gift-pick]").length;
    await act(async () => { fireEvent.click(c.querySelector("[data-gift-filter-button]")!); });
    const panel = c.querySelector("[data-gift-filter-panel]")!;
    // A menu like the sort menu beside it (popupShellInventory: no hand-rolled dialog); a price choice is a radio item.
    expect(panel.getAttribute("role")).toBe("menu");
    const sections = [...panel.querySelectorAll("[data-gift-section-link]")].map((b) => b.textContent);
    expect(sections.length).toBeGreaterThan(1);
    const choices = [...panel.querySelectorAll("[data-gift-budget-choice]")].map((b) => b.getAttribute("data-gift-budget-choice"));
    expect(choices).toEqual(["all", "25", "50", "100"]);
    await act(async () => { fireEvent.click(panel.querySelector('[data-gift-budget-choice="50"]')!); });
    expect(c.querySelector('[data-gift-budget-choice="50"]')?.getAttribute("aria-checked")).toBe("true");
    expect(c.querySelector("[data-gift-filter-count]")?.textContent).toBe("1");
    expect(c.querySelector("[data-gift-filter-button]")?.getAttribute("aria-label")).toBe("Filter, 1 on");
    expect(c.querySelectorAll("li[data-gift-pick]").length).toBeLessThan(before);
  });
});

describe("Shop Small left the menu (owner 11-21)", () => {
  it("no Shop Small entry in the menu (desktop sidebar and the phone sheet share it)", async () => {
    const c = await renderAt("/gift-guides/her");
    expect(c.querySelector("[data-gift-side-shop-small], [data-gift-sidebar] a[href='/shop-small']")).toBeNull();
    expect(c.querySelector("[data-gift-sidebar]")?.textContent).not.toMatch(/Shop Small/);
    expect([...c.querySelectorAll("[data-gift-side-more] a")].map((a) => a.textContent)).toEqual(["Holiday Hub", "25 Days sponsors"]);
  });
});

describe("a menu link opens the page at its top (owner 11-21: \"not the middle\")", () => {
  it("no menu link that changes the view carries an #anchor; each printables entry opens its own page", async () => {
    const c = await renderAt("/gift-guides/her");
    const hrefs = [...c.querySelectorAll<HTMLAnchorElement>("[data-gift-sidebar] a")].map((a) => a.getAttribute("href")!);
    expect(hrefs.length).toBeGreaterThan(10);
    // The finder is a view of the landing (/gift-guides#gift-finder shows the finder alone, at the top).
    expect(hrefs.filter((h) => h.includes("#") && h !== "/gift-guides#gift-finder")).toEqual([]);
    expect(hrefs.filter((h) => h.startsWith("/gift-guides/printables"))).toEqual(["/gift-guides/printables/gift-tags", "/gift-guides/printables/coloring-books", "/gift-guides/printables/banners"]);
  });

  it("clicking a menu link scrolls the window to the top", async () => {
    const c = await renderAt("/gift-guides/her");
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    await act(async () => { fireEvent.click(c.querySelector("[data-gift-sidebar] a[data-gift-side='kids']")!); });
    expect(c.querySelector("[data-where]")?.textContent).toBe("/gift-guides/kids");
    expect(scroll).toHaveBeenCalledWith(0, 0);
  });
});
