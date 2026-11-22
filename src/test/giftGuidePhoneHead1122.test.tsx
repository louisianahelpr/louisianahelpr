/**
 * Owner 2026-11-22, iPhone screenshot of /gift-guides: "Remove everything under the holiday gift guides on the phone
 * view. Remove the search order by, hers him kids deals. Only thing that will stay is the 3 line with no circle around it
 * and the heart. Both of those will go on the right of the holiday gift guide. On the phone view change holiday gift
 * guides to just gift guides bc it's too long the other way."
 *
 * Up to 767px every guides page's head row (GuidesTop -> GuidesHeadRow, the landing too) is ONE line: back arrow +
 * "Gift guides", then the heart ("Wish list") and the three-line menu ("Guides menu") on the right, 44x44 targets with
 * no circle, border or fill. The head row's "Order by Dec 15" pill, search and Share and the Her / Him / Kids / Deals chip
 * row are gone there; a guide's own count row under its banner is unchanged (lead 11-22: "she didn't ask to change it").
 * From 768px up nothing changes ("Holiday gift guides", the pill, search, heart, Share, the sidebar).
 * jsdom reads no @media, so the phone-only rules are read from the shipped CSS and the DOM is checked for the parts.
 *
 * @mutate src/pages/info/giftGuides/GuidesTop.tsx | <MyListIcon current={onMyList} head /> | {null}
 * @mutate src/pages/info/giftGuides/GuidesHeadRow.tsx | <><span className="gg-head-holiday">{HOLIDAY}</span>{G.headerTitle.slice(HOLIDAY.length)}</> | G.headerTitle
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-headrow>.gg-ship,.gg-headrow>.gg-tools{display:none} | .gg-headrow>.gg-ship{display:none}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-head-holiday{display:none} | .gg-head-holiday{}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-head-phone{display:none} | .gg-head-phone{}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-head-phone .gg-icon,.gg-head-phone .gg-icon:hover,.gg-head-phone .gg-icon[aria-expanded="true"]{background:transparent; | .gg-head-phone .gg-icon{background:transparent;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-head-title [data-gift-head-name]::first-letter{text-transform:uppercase} | .gg-head-title [data-gift-head-name]::first-letter{}
 * @mutate src/content/giftGuides.ts | phoneMenuLabel: "Guides menu", | phoneMenuLabel: "More",
 * @mutate src/content/giftGuides.ts | (n > 0 ? `Wish list, ${n} saved` : "Wish list") | `My Wish List, ${n} saved`
 * @mutate src/pages/info/GiftGuides.tsx | pillInRow={!countRow} onMyList={myList} | pillInRow={!countRow}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/sbsFeaturedApi", () => ({
  listFeaturedLocal: vi.fn(async () => []),
  sbsLogoUrl: (id: string) => `https://x.invalid/logo?${id}`,
  sbsDeviceId: () => "test-device-0001",
  submitFeaturedLocal: vi.fn(async () => ({ ok: true })),
}));

import GiftGuides from "@/pages/info/GiftGuides";
import Printables from "@/pages/info/giftGuides/printables/Printables";
import SwipeGifts from "@/pages/info/giftGuides/fun/SwipeGifts";
import { loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";

await loadAllGuidePicks();
const WIDTH = window.innerWidth;
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: WIDTH });
});

const renderAt = async (url: string, width: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  let out!: ReturnType<typeof render>;
  await act(async () => {
    out = render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/gift-guides" element={<GiftGuides />} />
          <Route path="/gift-guides/printables/*" element={<Printables />} />
          <Route path="/gift-guides/swipe" element={<SwipeGifts />} />
          <Route path="/gift-guides/:slug" element={<GiftGuides />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await waitFor(() => expect(out.container.querySelector("[data-gift-headrow]")).not.toBeNull());
  return out.container;
};

/** The phone-only rules (the block that starts with the phone cluster's base rule). */
const phoneCss = () => {
  const at = GIFT_GUIDES_CSS.indexOf(".gg-head-phone{display:none}");
  expect(at).toBeGreaterThan(-1);
  const rest = GIFT_GUIDES_CSS.slice(at);
  return rest.slice(0, rest.indexOf("\n}\n") + 2);
};

/** Every page drawn by the shared top, phone width: the landing, a guide, a deals day, a printables page, a fun page. */
const PAGES = ["/gift-guides", "/gift-guides/her", "/gift-guides/black-friday", "/gift-guides/printables/gift-tags", "/gift-guides/swipe", "/gift-guides/my-list"] as const;

describe("the phone head row on every guides page (owner 11-22)", () => {
  it.each(PAGES)("%s at 375: arrow + title, then the heart and the three-line menu on the right; no chip row", async (url) => {
    const c = await renderAt(url, 375);
    const row = c.querySelector("[data-gift-headrow]")!;
    // Title: the page's h1 on the landing / My Wish List as before, a plain line elsewhere; "Holiday " is its own span,
    // which the phone CSS hides (and the "g" is capitalised), so a phone reads "Gift guides".
    const name = row.querySelector("[data-gift-head-name]")!;
    expect(name.textContent).toBe("Holiday gift guides");
    expect(name.querySelector(":scope > .gg-head-holiday")?.textContent).toBe("Holiday ");
    expect(name.textContent!.slice("Holiday ".length)).toBe("gift guides");
    // Right side: the heart, then the three-line menu, the row's last child.
    const right = row.lastElementChild!;
    expect(right.matches("[data-gift-head-phone]")).toBe(true);
    const kids = [...right.children];
    expect(kids.map((k) => (k.matches("a[data-gift-head-heart]") ? "heart" : k.matches("button[data-gift-head-menu]") ? "menu" : k.tagName))).toEqual(["heart", "menu"]);
    expect(kids[0].getAttribute("aria-label")).toMatch(/^Wish list(, \d+ saved)?$/);
    expect(kids[0].getAttribute("href")).toBe("/gift-guides/my-list");
    expect(kids[1].getAttribute("aria-label")).toBe("Guides menu");
    // 44x44 targets, drawn as plain icons (the shared .gg-icon box: 44px, no border).
    for (const k of kids) expect(k.className).toMatch(/\bgg-icon\b/);
    // The chip row is gone from every page.
    expect(c.querySelector("[data-gift-phone-nav], [data-gift-chip]"), url).toBeNull();
  });

  it("My Wish List: the phone heart is the current page there", async () => {
    const c = await renderAt("/gift-guides/my-list", 375);
    expect(c.querySelector("[data-gift-head-heart]")?.getAttribute("aria-current")).toBe("page");
    cleanup();
    const her = await renderAt("/gift-guides/her", 375);
    expect(her.querySelector("[data-gift-head-heart]")?.hasAttribute("aria-current")).toBe(false);
  });

  it("the phone CSS: one line, the pill and the icons hidden, 'Holiday ' hidden and the g capitalised, the heart + menu shown with no circle", () => {
    const css = phoneCss();
    expect(css).toMatch(/^\.gg-head-phone\{display:none\}\n@media \(max-width:767px\)\{/);
    expect(css).toContain(".gg-headrow{flex-wrap:nowrap;gap:4px}");
    expect(css).toContain(".gg-headrow>.gg-ship,.gg-headrow>.gg-tools{display:none}");
    expect(css).toContain(".gg-head-holiday{display:none}");
    expect(css).toContain(".gg-head-title [data-gift-head-name]::first-letter{text-transform:uppercase}");
    expect(css).toMatch(/\.gg-head-phone\{display:flex;[^}]*margin:0 -10px 0 auto\}/);
    // No circle, border or fill on the two icons, even hovered (a tap leaves :hover on iOS) or with the sheet open.
    expect(css).toContain('.gg-head-phone .gg-icon,.gg-head-phone .gg-icon:hover,.gg-head-phone .gg-icon[aria-expanded="true"]{background:transparent;border:0;box-shadow:none}');
    // The shared icon box is the 44x44 target.
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-icon\{position:relative;display:inline-flex;[^}]*width:44px;height:44px;[^}]*border:0/);
    // Keyboard focus still shows (a ring, not a filled circle).
    expect(css).toMatch(/\.gg-head-phone \.gg-icon:focus-visible\{background:transparent;outline:2px solid/);
  });
});

// Lead 11-22, owner on the Her page: "Remove him kids her buttons under holiday gift guides. deals from here they can
// click the 3 line ... or they can go back"; a guide's own toolbar row under its banner stays as it is.
describe("a phone's guide page: the count row under the banner is unchanged (owner 11-22)", () => {
  it.each(["/gift-guides/her", "/gift-guides/kids"])("%s at 375: the count, the pill, search, sort, heart and Share under the banner; the head row's heart too", async (url) => {
    const c = await renderAt(url, 375);
    const row = c.querySelector("[data-gift-countrow]")!;
    expect(row).not.toBeNull();
    expect(row.querySelector("[data-gift-item-count]")?.textContent).toMatch(/^\d+ gifts$/);
    expect(row.querySelector("[data-gift-ship]")).not.toBeNull();
    for (const sel of ["[data-gift-search-button]", "[data-gift-sort-button]", "[data-gift-my-list-link]", "[data-gift-share]"]) expect(row.querySelector(`[data-gift-quick] ${sel}`), sel).not.toBeNull();
    // The head row holds none of those, only the phone's heart and menu.
    const head = c.querySelector("[data-gift-headrow]")!;
    expect(head.querySelector("[data-gift-ship], [data-gift-quick]")).toBeNull();
    expect(head.querySelectorAll("[data-gift-head-heart], [data-gift-head-menu]").length).toBe(2);
  });
});

describe("desktop is unchanged (owner 11-22: the phone view only)", () => {
  it.each(["/gift-guides", "/gift-guides/her", "/gift-guides/black-friday"])("%s at 1440: the pill, search, heart and Share in the head row; the sidebar", async (url) => {
    const c = await renderAt(url, 1440);
    const row = c.querySelector("[data-gift-headrow]")!;
    expect(row.querySelector(":scope > [data-gift-ship]")).not.toBeNull();
    const tools = row.querySelector(":scope > [data-gift-quick]")!;
    expect(tools.querySelector("[data-gift-search-button]")).not.toBeNull();
    expect(tools.querySelector("[data-gift-my-list-link]")?.getAttribute("aria-label")).toMatch(/^My Wish List, \d+ saved$/);
    expect(tools.querySelector("[data-gift-share]")).not.toBeNull();
    expect(c.querySelector("[data-gift-sidebar]")).not.toBeNull();
    expect(c.querySelector("[data-gift-countrow]")).toBeNull();
  });
});
