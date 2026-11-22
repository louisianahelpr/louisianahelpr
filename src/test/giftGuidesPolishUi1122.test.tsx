/**
 * The gift guides polish audit of 2026-11-22 (owner's Guides-polish-audit-1122.md), the UI and layout findings.
 *
 * #2 (High): the desktop menu was held to 828px at 1440x900 but needed 959px, so the LOUISIANA group was cut off with
 *    no scrollbar on a Mac. On a mouse screen its rows are 36px and the group headings 10px apart (815px), and on a
 *    screen too short for it the menu scrolls with the page instead of sticking, so nothing is ever hidden.
 * #3 (High): Gift tags, Coloring books, Banners, Swipe, Secret Santa, the planner and Shop Small had no phone chip row.
 *    GuidesFrame draws it now, with Printables filled on the printables pages.
 * #6: the chips are Her, Him, Kids, Deals, Printables and a pinned More (Menu was 8th and out of view at 375).
 * #5: a phone's count row (count, pill, 4 icons) fits one row at 375: the pill reads "By Dec 15" there, gaps 4px.
 * #9: My Wish List has no second "All guides" back link (the head row's arrow goes to /gift-guides).
 * #10: one sub-page title: the frame pages' title opens the content column in the shared left-aligned serif style, the
 *      same as My Wish List's and a shared list's title.
 * #19: on a phone the hub shows one line above the greeting, and a guide's banner starts 16px under the chip row.
 *
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | @media (hover:hover) and (pointer:fine){.gg-side a{min-height:36px} | @media (hover:hover) and (pointer:fine){.gg-side a{min-height:44px}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-side{position:static;max-height:none;overflow:visible} | .gg-side{max-height:none}
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx |       <GiftGuidesPhoneNav active={null} page={path} /> |       {null}
 * @mutate src/pages/info/giftGuides/GiftGuidesPhoneNav.tsx | const printablesOpen = open !== null && PRINTABLE_PATHS.includes(open); | const printablesOpen = false;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-pnav>.gg-chip-menu{flex:none;margin-right:20px} | .gg-pnav>.gg-chip-menu{margin-right:20px}
 * @mutate src/pages/info/giftGuides/GiftGuideMyList.tsx | {/* UX audit M4 | <a href="/gift-guides" data-gift-back="">All guides</a>{/* UX audit M4
 * @mutate src/pages/info/giftGuides/GiftGuideCover.tsx | <header className="gg-words gg-pagehead" data-gift-words=""> | <header className="gg-words" data-gift-words="">
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-countrow .gg-ship-order{display:none} | .gg-countrow .gg-ship-order{}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-pnav:has(+.gg-divider){border-bottom-color:transparent} | .gg-pnav:has(+.gg-divider){}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import { GuidesFrame } from "@/pages/info/giftGuides/fun/FunPage";

vi.mock("@/pages/info/giftGuides/GiftGuideShare", () => ({ GiftGuideTools: () => null }));

afterEach(cleanup);

const frameAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <GuidesFrame title="Page" path={path}><p>body</p></GuidesFrame>
    </MemoryRouter>,
  ).container;

describe("polish audit 1122 #2: the desktop guides menu fits", () => {
  it("mouse screens get 36px rows and 10px group gaps; a short screen lets the menu scroll with the page", () => {
    expect(GIFT_GUIDES_CSS).toContain("@media (hover:hover) and (pointer:fine){.gg-side a{min-height:36px}.gg-side .gg-side-h{margin-top:10px}}");
    const short = /@media [^{]*max-height:889px[^{]*\{\.gg-side\{([^}]*)\}\}/.exec(GIFT_GUIDES_CSS);
    expect(short?.[1]).toBe("position:static;max-height:none;overflow:visible");
    // Touch screens keep 44px rows, so their cut-off point is taller.
    expect(GIFT_GUIDES_CSS).toMatch(/\(not \(\(hover:hover\) and \(pointer:fine\)\)\) and \(max-height:1039px\)\{\.gg-side\{position:static/);
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-side a\{[^}]*min-height:44px/);
  });
});

describe("polish audit 1122 #3/#6: the phone chip row on every frame page, More pinned", () => {
  const pages = ["/gift-guides/printables/gift-tags", "/gift-guides/printables/coloring-books", "/gift-guides/printables/banners", "/gift-guides/swipe", "/gift-guides/draw-names", "/gift-guides/planner", "/shop-small"];
  it("each of the 7 pages draws the chip row right under the head row", () => {
    expect(pages.length).toBeGreaterThan(6);
    for (const path of pages) {
      const c = frameAt(path);
      const nav = c.querySelector("[data-gift-phone-nav]");
      expect(nav, path).not.toBeNull();
      expect(c.querySelector("[data-gift-headrow]")!.nextElementSibling, path).toBe(nav);
      cleanup();
    }
  });

  it("Printables is filled on the printables pages and links straight to Gift tags; More on the fun tools", () => {
    for (const path of pages.slice(0, 3)) {
      const chip = frameAt(path).querySelector('[data-gift-chip="printables"]')!;
      expect(chip.className, path).toContain("is-on");
      expect(chip.getAttribute("aria-current")).toBe("page");
      expect(chip.getAttribute("href")).toBe("/gift-guides/printables/gift-tags");
      cleanup();
    }
    const swipe = frameAt("/gift-guides/swipe");
    expect(swipe.querySelector('[data-gift-chip="menu"]')!.className).toContain("is-on");
    expect(swipe.querySelector('[data-gift-chip="printables"]')!.className).not.toContain("is-on");
  });

  it("More sits outside the scrolling row, so it always shows", () => {
    const c = frameAt("/gift-guides/swipe");
    const more = c.querySelector('[data-gift-chip="menu"]')!;
    expect(more.textContent).toBe("More");
    expect(more.closest(".gg-pnav-row")).toBeNull();
    expect(more.parentElement!.matches("[data-gift-phone-nav]")).toBe(true);
    expect(GIFT_GUIDES_CSS).toContain(".gg-pnav>.gg-chip-menu{flex:none;margin-right:20px}");
  });
});

const src = (f: string) => blankComments(readFileSync(f, "utf8"));

describe("polish audit 1122 #5/#9/#10/#19", () => {
  it("#5: the phone count row's pill drops 'Order ' and the gaps are 4px", () => {
    expect(src("src/pages/info/GiftGuides.tsx")).toContain('<span className="gg-ship-order">Order </span>');
    expect(GIFT_GUIDES_CSS).toContain("@media (max-width:479px){.gg-countrow,.gg-countrow-left{gap:4px}.gg-countrow .gg-ship-order{display:none}.gg-countrow .gg-ship::first-letter{text-transform:uppercase}}");
  });

  it("#9: My Wish List draws no second back link", () => {
    const my = src("src/pages/info/giftGuides/GiftGuideMyList.tsx");
    expect(my).toContain('data-gift-my-list=""');
    expect(my).not.toContain("data-gift-back=");
    expect(my).not.toContain("allGuidesLabel");
  });

  it("#10: the frame's title is the first thing in the content column, in the shared page-title style", () => {
    const c = frameAt("/gift-guides/swipe");
    const main = c.querySelector(".gg-layout > .gg-main")!;
    const head = main.firstElementChild!;
    expect(head.matches("header.gg-words.gg-pagehead")).toBe(true);
    expect(head.querySelector("h1#gift-page-title")?.textContent).toBe("Page");
    expect(GIFT_GUIDES_CSS).toContain(".gg-words.gg-pagehead{text-align:left;");
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-pagehead h1,\.gg \.gg-wish-title\{font-family:'Bodoni Moda'/);
  });

  it("#19: one line above the hub's greeting on a phone; a gap above a guide's banner", () => {
    const phone = GIFT_GUIDES_CSS.slice(GIFT_GUIDES_CSS.indexOf("@media (max-width:767px){.gg-pagehead h1"));
    expect(phone).toContain(".gg-pnav:has(+.gg-divider){border-bottom-color:transparent}.gg-pnav+.gg-banner-wrap{padding-top:16px}}");
  });
});
