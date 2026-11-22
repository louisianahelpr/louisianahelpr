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
 *    menu link that changes the view carries no #anchor (the printables entries open that part at the page's top with
 *    ?show=...), and a menu navigation scrolls the window to the top (ScrollToTop); a true #anchor still scrolls to it.
 *
 * @mutate src/pages/info/GiftGuides.tsx |   const countRow = (phone && Boolean(guide) && !deals) \|\| sponsorsPage; |   const countRow = phone && Boolean(guide) && !deals;
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |       {!filter && nav.length > 1 && ( |       {nav.length > 1 && (
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |       {filter && <GiftGuideFilter filter={filter} />} |       {null}
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | to={`${PRINTABLES_PATH}?show=${p.show}`} | to={`${PRINTABLES_PATH}#pr-${p.show}`}
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

describe("the 25 Days sponsors page: its tools and Filter under the banner (owner 11-21)", () => {
  it("one row under the banner at desktop width: the count, the pill, then search, Filter, heart, Share; no chips or tip in the list", async () => {
    const c = await renderAt("/gift-guides/25-days-sponsors");
    expect(c.querySelector("[data-gift-headrow] [data-gift-quick]")).toBeNull();
    const row = c.querySelector("[data-gift-countrow]")!;
    expect(row).not.toBeNull();
    expect(row.querySelector("[data-gift-item-count]")?.textContent).toMatch(/^\d+ gifts$/);
    const icons = [...row.querySelectorAll("[data-gift-quick] button, [data-gift-quick] a")].map((b) => b.getAttribute("aria-label"));
    expect(icons).toEqual(["Search gift guides", "Filter", "My Wish List, 0 saved", "Share"]);
    expect(c.querySelector("[data-gift-section-nav], .gg-secnav")).toBeNull();
    expect(c.querySelector(".gg-main [data-gift-budget]")).toBeNull();
    expect(c.querySelector("[data-gift-hint='budget']")).toBeNull();
    expect(c.textContent).not.toMatch(/Tap a price to see gifts/);
  });

  it("the Filter holds the section links and the price limits; a price limit filters the list and counts on the icon", async () => {
    const c = await renderAt("/gift-guides/25-days-sponsors");
    const before = c.querySelectorAll("li[data-gift-pick]").length;
    await act(async () => { fireEvent.click(c.querySelector("[data-gift-filter-button]")!); });
    const panel = c.querySelector("[data-gift-filter-panel]")!;
    expect(panel.getAttribute("role")).toBe("dialog");
    const sections = [...panel.querySelectorAll("[data-gift-section-link]")].map((b) => b.textContent);
    expect(sections.length).toBeGreaterThan(1);
    const choices = [...panel.querySelectorAll("[data-gift-budget-choice]")].map((b) => b.getAttribute("data-gift-budget-choice"));
    expect(choices).toEqual(["all", "25", "50", "100"]);
    await act(async () => { fireEvent.click(panel.querySelector('[data-gift-budget-choice="50"]')!); });
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
  it("no menu link that changes the view carries an #anchor; the printables entries open that part at the top", async () => {
    const c = await renderAt("/gift-guides/her");
    const hrefs = [...c.querySelectorAll<HTMLAnchorElement>("[data-gift-sidebar] a")].map((a) => a.getAttribute("href")!);
    expect(hrefs.length).toBeGreaterThan(10);
    // The finder is a view of the landing (/gift-guides#gift-finder shows the finder alone, at the top).
    expect(hrefs.filter((h) => h.includes("#") && h !== "/gift-guides#gift-finder")).toEqual([]);
    expect(hrefs.filter((h) => h.startsWith("/gift-guides/printables"))).toEqual(["/gift-guides/printables?show=tags", "/gift-guides/printables?show=coloring", "/gift-guides/printables?show=banners"]);
  });

  it("clicking a menu link scrolls the window to the top", async () => {
    const c = await renderAt("/gift-guides/her");
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    await act(async () => { fireEvent.click(c.querySelector("[data-gift-sidebar] a[data-gift-side='kids']")!); });
    expect(c.querySelector("[data-where]")?.textContent).toBe("/gift-guides/kids");
    expect(scroll).toHaveBeenCalledWith(0, 0);
  });
});
