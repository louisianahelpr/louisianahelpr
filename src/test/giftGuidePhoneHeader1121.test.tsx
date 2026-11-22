/**
 * Owner 2026-11-21, iPhone screenshots of /gift-guides/kids:
 *  - "put the icons below the red banner. On the same line as the 81 gifts ... also move the order by dec below the red
 *    banner": on a phone, a guide page draws ONE row under its banner (the count and the order-by pill on the left, the
 *    icons on the right) and no pill or icons above the banner. The landing (no banner) and every desktop keep them in
 *    the header row.
 *  - "Put the price in the top right corner where the heart is and the heart in the bottom right": every card (one
 *    PickRow: guide lists, the Top 10, the finder's results) has the price beside the name's first line on the right and
 *    the heart at the card's bottom-right corner.
 *  - "Remove show more just list everything" (guarded in giftGuidesPage.test.tsx).
 *
 * @mutate src/pages/info/GiftGuides.tsx |   const countRow = (phone && Boolean(guide) && !deals) \|\| sponsorsPage; |   const countRow = sponsorsPage;
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |   const open = searchOpen \|\| !!query; |   const open = true;
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx | onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); closeSearch(); } }} | onKeyDown={() => undefined}
 * @mutate src/pages/info/GiftGuides.tsx |           {!countRow && tools} |           {tools}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-list .gg-nm .gg-nm-meta{grid-column:2;grid-row:1; | .gg-list .gg-nm .gg-nm-meta{grid-column:1;grid-row:2;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-list .gg-heart-pick{position:absolute;right:-6px;bottom:0} | .gg-list .gg-heart-pick{position:absolute;right:-6px;top:0}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-cart{position:absolute;right:36px;bottom:0; | .gg-cart{grid-column:1;
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const isOpen = (id?: string) => !sortable \|\| !id \|\| (openSecs ? openSecs.has(id) : id === firstSection); |   const isOpen = (id?: string) => true;
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |       setOpenSecs(new Set([raw])); |       setOpenSecs(null);
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";

await loadAllGuidePicks();
const WIDTH = window.innerWidth;
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: WIDTH });
  vi.useRealTimers();
});

const renderAt = async (url: string, width: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
  let out!: ReturnType<typeof render>;
  await act(async () => {
    out = render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/gift-guides" element={<GiftGuides />} />
          <Route path="/gift-guides/:slug" element={<GiftGuides />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return out.container;
};

describe("phone guide page: the count, the pill and the icons on one row under the banner (owner 11-21)", () => {
  it.each(["kids", "her"])("/gift-guides/%s at 390: no pill or icons above the banner; one row after it", async (slug) => {
    const c = await renderAt(`/gift-guides/${slug}`, 390);
    const head = c.querySelector("[data-gift-headrow]")!;
    expect(head.querySelector("[data-gift-ship], [data-gift-quick]")).toBeNull();
    const banner = c.querySelector("[data-gift-banner]")!;
    const row = c.querySelector("[data-gift-countrow]")!;
    expect(row).not.toBeNull();
    expect(banner.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.querySelector("[data-gift-item-count]")?.textContent).toMatch(/^\d+ gifts$/);
    expect(row.querySelector("[data-gift-ship]")?.textContent).toMatch(/^Order by Dec 15/);
    expect(row.querySelector("[data-gift-quick] [data-gift-search-button]")).not.toBeNull();
    expect(row.querySelector("[data-gift-quick] [data-gift-share]")).not.toBeNull();
    // One count on the page (the list's own count is not drawn twice), one tool row.
    expect(c.querySelectorAll("[data-gift-item-count]").length).toBe(1);
    expect(c.querySelectorAll("[data-gift-quick]").length).toBe(1);
  });

  it("the landing on a phone and every page on a desktop keep the pill and the icons in the header row", async () => {
    for (const [url, width] of [["/gift-guides", 390], ["/gift-guides/kids", 1440], ["/gift-guides", 1440]] as const) {
      const c = await renderAt(url, width);
      const head = c.querySelector("[data-gift-headrow]")!;
      expect(head.querySelector("[data-gift-ship]"), `${url}@${width}`).not.toBeNull();
      expect(head.querySelector("[data-gift-quick]"), `${url}@${width}`).not.toBeNull();
      expect(c.querySelector("[data-gift-countrow]"), `${url}@${width}`).toBeNull();
      cleanup();
    }
  });
});

describe("every card: price top-right, heart bottom-right (owner 11-21)", () => {
  it("the name and the price share the first line (price right); the heart sits at the card's bottom-right, outside the link", async () => {
    expect(GIFT_GUIDES_CSS).toContain(".gg-list .gg-nm{display:grid;grid-template-columns:minmax(0,1fr) auto;");
    expect(GIFT_GUIDES_CSS).toContain(".gg-list .gg-nm .gg-nm-meta{grid-column:2;grid-row:1;");
    expect(GIFT_GUIDES_CSS).toContain(".gg-list .gg-heart-pick{position:absolute;right:-6px;bottom:0}");
    // The Top 10 cards are not the guides' listings: their heart sits on the photo's top-right (owner 11-21 evening).
    expect(GIFT_GUIDES_CSS).toContain(".gg-top10 .gg-heart-pick{position:absolute;top:2px;right:2px;z-index:1}");
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-list \.gg-heart-pick\{position:static\}/);
    const c = await renderAt("/gift-guides/kids", 390);
    const li = c.querySelector("li[data-gift-pick]")!;
    const link = li.querySelector("a[data-gift-title-link]")!;
    expect(link.querySelector(".gg-nm > .gg-nm-name + .sr-only + .gg-nm-meta [data-gift-price]")).not.toBeNull();
    expect(link.contains(li.querySelector("[data-gift-heart]"))).toBe(false);
  });
});

describe("the search is an icon at every width (owner 11-21: \"make search an icon always\")", () => {
  it.each([375, 1440])("at %ipx: a magnifier icon; tapping it opens the focused field; Escape shuts it; it stays open while a query is typed", async (width) => {
    const c = await renderAt("/gift-guides/kids", width);
    const tools = c.querySelector("[data-gift-quick]")!;
    expect(tools.querySelector("input")).toBeNull();
    const button = tools.querySelector<HTMLButtonElement>("button[data-gift-search-button]")!;
    expect(button.getAttribute("aria-label")).toBe("Search gift guides");
    expect(button.className).toMatch(/\bgg-icon\b/);
    await act(async () => { fireEvent.click(button); });
    const input = tools.querySelector<HTMLInputElement>("input[data-gift-search]")!;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    // A query keeps it open (and shows results); Escape clears it and shuts it.
    await act(async () => { fireEvent.change(input, { target: { value: "lego" } }); });
    await act(async () => { fireEvent.blur(input); });
    expect(tools.querySelector("input[data-gift-search]")).not.toBeNull();
    await act(async () => { fireEvent.keyDown(tools.querySelector("input[data-gift-search]")!, { key: "Escape" }); });
    expect(tools.querySelector("input")).toBeNull();
    expect(tools.querySelector("button[data-gift-search-button]")).not.toBeNull();
    // The close button shuts it too.
    await act(async () => { fireEvent.click(tools.querySelector("button[data-gift-search-button]")!); });
    await act(async () => { fireEvent.click(tools.querySelector("button[data-gift-search-close]")!); });
    expect(tools.querySelector("input")).toBeNull();
  });
});

describe("the cart sits beside the heart (owner 11-21: \"should we put the cart by the heart?\")", () => {
  it("the Amazon cart and the heart share the card's bottom-right corner (cart, then heart); no row of its own", () => {
    expect(GIFT_GUIDES_CSS).toContain(".gg-cart{position:absolute;right:36px;bottom:0;");
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-cart\{grid-column/);
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-cart\{[^}]*width:44px;height:44px/);
  });
});

describe("price sections open and close (owner 11-21: \"a button to open and expand each section\"; first open)", () => {
  const toggles = (c: HTMLElement) => [...c.querySelectorAll<HTMLButtonElement>("[data-gift-section-toggle]")];
  it("on load only the first section is open (all its gifts); a tap opens or closes one; each header is a 44px button", async () => {
    const c = await renderAt("/gift-guides/kids", 1440);
    const t = toggles(c);
    expect(t.length).toBeGreaterThan(2);
    expect(t.map((b) => b.getAttribute("aria-expanded"))).toEqual(["true", ...t.slice(1).map(() => "false")]);
    const first = t[0].getAttribute("data-gift-section-toggle")!;
    const count = Number(/\((\d+)\)/.exec(t[0].textContent ?? "")![1]);
    expect(c.querySelectorAll(`#gg-sec-${first}-list > li[data-gift-pick]`).length).toBe(count);
    expect(c.querySelectorAll(`#gg-sec-${t[1].getAttribute("data-gift-section-toggle")}-list`).length).toBe(0);
    expect(t[0].getAttribute("aria-controls")).toBe(`gg-sec-${first}-list`);
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-sec-toggle\{[^}]*min-height:48px/);
    await act(async () => { fireEvent.click(t[1]); });
    expect(t[1].getAttribute("aria-expanded")).toBe("true");
    expect(c.querySelector(`#gg-sec-${t[1].getAttribute("data-gift-section-toggle")}-list`)).not.toBeNull();
    await act(async () => { fireEvent.click(t[0]); });
    expect(t[0].getAttribute("aria-expanded")).toBe("false");
    expect(c.querySelector(`#gg-sec-${first}-list`)).toBeNull();
  });

  it("a section link (#25-to-50) opens that section (and only it)", async () => {
    window.history.replaceState(null, "", "#25-to-50");
    const c = await renderAt("/gift-guides/kids", 1440);
    window.history.replaceState(null, "", window.location.pathname);
    const open = toggles(c).filter((b) => b.getAttribute("aria-expanded") === "true").map((b) => b.getAttribute("data-gift-section-toggle"));
    expect(open).toEqual(["25-to-50"]);
  });
});
