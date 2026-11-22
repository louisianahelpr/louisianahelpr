/**
 * Owner 2026-11-22, iPhone screenshot of /gift-guides: "Remove everything under the holiday gift guides on the phone
 * view. Remove the search order by, hers him kids deals. Only thing that will stay is the 3 line with no circle around it
 * and the heart. Both of those will go on the right of the holiday gift guide. On the phone view change holiday gift
 * guides to just gift guides bc it's too long the other way."
 *
 * Up to 767px every guides page's head row (GuidesTop -> GuidesHeadRow, the landing too) is ONE line: back arrow +
 * "Gift guides", then the three-line menu ("Guides menu") on the right, a 44x44 target with no circle, border or fill.
 * The head row's "Order by Dec 15" pill, search and Share and the Her / Him / Kids / Deals chip row are gone there; a
 * guide's own count row under its banner is unchanged (lead 11-22: "she didn't ask to change it").
 * Owner 11-22 later, asked about the heart showing twice on a phone: "Where should we have it on all the pages it
 * belongs on? I think by the search and icons filter. The 3 line dash stays up." So the head row's heart is gone: the
 * heart lives only in a page's own toolbar (Her/Him/Kids: search, sort, heart, Share under the banner); a page with no
 * toolbar on a phone (the deals days, the printables, the fun pages, My Wish List, the Holiday Hub) shows none, and My
 * Wish List stays one tap away in the menu sheet (giftGuidesPhoneNav1121.test.tsx).
 * From 768px up nothing changes ("Holiday gift guides", the pill, search, heart, Share, the sidebar).
 * jsdom reads no @media, so the phone-only rules are read from the shipped CSS and the DOM is checked for the parts.
 *
 * @mutate src/pages/info/giftGuides/GuidesTop.tsx | phone={<GuidesMenuButton active={nav.active} myList={nav.myList} page={nav.page} />}> | phone={<><a className="gg-icon" href="/gift-guides/my-list" data-gift-head-heart="">x</a><GuidesMenuButton active={nav.active} myList={nav.myList} page={nav.page} /></>}>
 * @mutate src/pages/info/giftGuides/GuidesHeadRow.tsx | <><span className="gg-head-holiday">{HOLIDAY}</span>{G.headerTitle.slice(HOLIDAY.length)}</> | G.headerTitle
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-headrow>.gg-ship,.gg-headrow>.gg-tools{display:none} | .gg-headrow>.gg-ship{display:none}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-head-holiday{display:none} | .gg-head-holiday{}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-head-phone{display:none} | .gg-head-phone{}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-head-phone .gg-icon,.gg-head-phone .gg-icon:hover,.gg-head-phone .gg-icon[aria-expanded="true"]{background:transparent; | .gg-head-phone .gg-icon{background:transparent;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-head-title [data-gift-head-name]::first-letter{text-transform:uppercase} | .gg-head-title [data-gift-head-name]::first-letter{}
 * @mutate src/content/giftGuides.ts | phoneMenuLabel: "Guides menu", | phoneMenuLabel: "More",
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | @media (hover:hover){.gg-icon:hover,.gg-icon[aria-expanded="true"]{background:hsl(var(--muted) / .7)}} | .gg-icon:hover,.gg-icon[aria-expanded="true"]{background:hsl(var(--muted) / .7)}
 * @mutate src/pages/info/giftGuides/giftWishStyles.ts | @media (hover:hover){.gg-savefor-tool:hover{background:hsl(var(--muted));color:var(--gg-ink)}} | .gg-savefor-tool:hover{background:hsl(var(--muted));color:var(--gg-ink)}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-icon:focus-visible{outline:2px solid hsl(var(--ring)); | .gg-icon:focus-visible{background:hsl(var(--muted) / .7);
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |       {sort && <GiftGuideSort order={sort.order} onChange={sort.onChange} />}\n      {filter && <GiftGuideFilter filter={filter} />}\n      <MyListIcon current={myList} /> |       <MyListIcon current={myList} />\n      {sort && <GiftGuideSort order={sort.order} onChange={sort.onChange} />}\n      {filter && <GiftGuideFilter filter={filter} />}
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
import { blankComments } from "./helpers/blankNonCode";

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
  it.each(PAGES)("%s at 375: arrow + title, then only the three-line menu on the right (no heart); no chip row", async (url) => {
    const c = await renderAt(url, 375);
    const row = c.querySelector("[data-gift-headrow]")!;
    // Title: the page's h1 on the landing / My Wish List as before, a plain line elsewhere; "Holiday " is its own span,
    // which the phone CSS hides (and the "g" is capitalised), so a phone reads "Gift guides".
    const name = row.querySelector("[data-gift-head-name]")!;
    expect(name.textContent).toBe("Holiday gift guides");
    expect(name.querySelector(":scope > .gg-head-holiday")?.textContent).toBe("Holiday ");
    expect(name.textContent!.slice("Holiday ".length)).toBe("gift guides");
    // Right side: only the three-line menu, the row's last child (owner 11-22: "The 3 line dash stays up"; the heart
    // went to the toolbar).
    const right = row.lastElementChild!;
    expect(right.matches("[data-gift-head-phone]")).toBe(true);
    const kids = [...right.children];
    expect(kids.map((k) => (k.matches("button[data-gift-head-menu]") ? "menu" : k.matches("a[href$='/my-list']") ? "heart" : k.tagName))).toEqual(["menu"]);
    expect(kids[0].getAttribute("aria-label")).toBe("Guides menu");
    expect(c.querySelector("[data-gift-head-heart]"), url).toBeNull();
    // 44x44 targets, drawn as plain icons (the shared .gg-icon box: 44px, no border).
    for (const k of kids) expect(k.className).toMatch(/\bgg-icon\b/);
    // The chip row is gone from every page.
    expect(c.querySelector("[data-gift-phone-nav], [data-gift-chip]"), url).toBeNull();
  });

  // Owner 11-22 later ("I think by the search and icons filter"): a phone shows the heart only in a page's own toolbar.
  // Pages without one on a phone (the deals days, the printables, Swipe, My Wish List) show it nowhere outside the head
  // row's tools, which the phone CSS hides (asserted below), and no count row.
  it.each(["/gift-guides/black-friday", "/gift-guides/printables/gift-tags", "/gift-guides/swipe", "/gift-guides/my-list"])("%s at 375: no toolbar on a phone, so no heart outside the hidden head-row tools", async (url) => {
    const c = await renderAt(url, 375);
    expect(c.querySelector("[data-gift-countrow]"), url).toBeNull();
    for (const heart of c.querySelectorAll("[data-gift-my-list-link]")) expect(heart.closest("[data-gift-headrow] > [data-gift-quick]"), url).not.toBeNull();
  });

  it("the phone CSS: one line, the pill and the icons hidden, 'Holiday ' hidden and the g capitalised, the heart + menu shown with no circle", () => {
    const css = phoneCss();
    expect(css).toMatch(/^\.gg-head-phone\{display:none\}\n@media \(max-width:767px\)\{/);
    expect(css).toContain(".gg-headrow{flex-wrap:nowrap;gap:4px}");
    expect(css).toContain(".gg-headrow>.gg-ship,.gg-headrow>.gg-tools{display:none}");
    // (the head row's tools, and with them their heart, are hidden on a phone: the count row's toolbar holds the heart)
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

  // Lead 11-22 (owner: no circles on header icons): iOS keeps :hover on a tapped button, so a toolbar icon (search, sort,
  // filter, heart, Share; the My lists tools) showed a grey circle after a tap until the next tap elsewhere. Its hover
  // and open-menu fill now apply only under @media (hover:hover); keyboard focus is a ring.
  it("toolbar icons: the hover and open-menu fill only where a pointer hovers; keyboard focus is a ring", async () => {
    const { GIFT_WISH_CSS } = await import("@/pages/info/giftGuides/giftWishStyles");
    // Each stylesheet with every @media (hover:hover){...} block taken out (braces balanced).
    const outsideHover = (css: string) => {
      let out = css;
      for (let at = out.indexOf("@media (hover:hover){"); at >= 0; at = out.indexOf("@media (hover:hover){")) {
        let depth = 0;
        let end = at;
        for (let i = out.indexOf("{", at); i < out.length; i++) {
          if (out[i] === "{") depth++;
          else if (out[i] === "}" && --depth === 0) { end = i + 1; break; }
        }
        out = out.slice(0, at) + out.slice(end);
      }
      return out;
    };
    const guides = blankComments(GIFT_GUIDES_CSS);
    const wish = blankComments(GIFT_WISH_CSS);
    expect(guides).toContain('@media (hover:hover){.gg-icon:hover,.gg-icon[aria-expanded="true"]{background:hsl(var(--muted) / .7)}}');
    expect(wish).toContain("@media (hover:hover){.gg-savefor-tool:hover{background:hsl(var(--muted));color:var(--gg-ink)}}");
    // Outside those blocks no icon rule fills on hover or with its menu open (the phone head row's transparent rule stays).
    expect(outsideHover(guides)).not.toMatch(/\.gg-icon:hover[^{]*\{background:hsl/);
    expect(outsideHover(guides)).not.toMatch(/\.gg-icon\[aria-expanded="true"\][^{]*\{background:hsl/);
    expect(outsideHover(wish)).not.toMatch(/\.gg-savefor-tool:hover[^{]*\{background:hsl/);
    expect(outsideHover(guides)).toContain('.gg-head-phone .gg-icon,.gg-head-phone .gg-icon:hover,.gg-head-phone .gg-icon[aria-expanded="true"]{background:transparent;border:0;box-shadow:none}');
    // Keyboard focus: a 2px ring, no fill, at every width.
    expect(outsideHover(guides)).toContain(".gg-icon:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:-2px;border-radius:8px}");
    expect(guides).not.toMatch(/\.gg-icon:focus-visible[^{]*\{background:hsl/);
  });
});

// Lead 11-22, owner on the Her page: "Remove him kids her buttons under holiday gift guides. deals from here they can
// click the 3 line ... or they can go back"; a guide's own toolbar row under its banner stays as it is.
describe("a phone's guide page: the count row under the banner is unchanged (owner 11-22)", () => {
  it.each(["/gift-guides/her", "/gift-guides/kids"])("%s at 375: the count, the pill, then search, sort, heart and Share under the banner (the heart right after search and sort); the head row has only the menu", async (url) => {
    const c = await renderAt(url, 375);
    const row = c.querySelector("[data-gift-countrow]")!;
    expect(row).not.toBeNull();
    expect(row.querySelector("[data-gift-item-count]")?.textContent).toMatch(/^\d+ gifts$/);
    expect(row.querySelector("[data-gift-ship]")).not.toBeNull();
    for (const sel of ["[data-gift-search-button]", "[data-gift-sort-button]", "[data-gift-my-list-link]", "[data-gift-share]"]) expect(row.querySelector(`[data-gift-quick] ${sel}`), sel).not.toBeNull();
    // Owner 11-22: the heart sits "by the search and icons filter": the toolbar reads search, sort, heart, Share.
    const order = [...row.querySelector("[data-gift-quick]")!.children].map((k) =>
      k.matches("[data-gift-search-box]") ? "search" : k.querySelector("[data-gift-sort-button]") || k.matches("[data-gift-sort-button]") ? "sort"
        : k.matches("[data-gift-my-list-link]") ? "heart" : k.querySelector("[data-gift-share]") || k.matches("[data-gift-share]") ? "share" : k.tagName);
    expect(order).toEqual(["search", "sort", "heart", "share"]);
    // The head row holds none of those, only the phone's menu (no second heart).
    const head = c.querySelector("[data-gift-headrow]")!;
    expect(head.querySelector("[data-gift-ship], [data-gift-quick]")).toBeNull();
    expect([...head.querySelectorAll("[data-gift-head-phone] > *")].map((k) => k.getAttribute("data-gift-head-menu") !== null ? "menu" : k.tagName)).toEqual(["menu"]);
    expect(c.querySelectorAll("[data-gift-my-list-link]").length).toBe(1);
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
