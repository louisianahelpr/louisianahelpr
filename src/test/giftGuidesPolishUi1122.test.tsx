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
 * #8: the 25 Days sponsors page draws no "25 Days sponsor" or "Shop Louisiana" chip (every card is a sponsor), its heart
 *     sits on the photo's top-right corner there only, and "Also sponsoring" is plain names with dots, not pills.
 * #11: Swipe: one instruction (no tip box), "18 gifts under $25" on the count's line, a 150px card photo on phones (Skip
 *      and Save measured 677-733px on a 375x812 screen, were 839-895), the deck centered in the content column, and the
 *      disclosures right under a short page instead of at the foot of the menu.
 * #19: on a phone the hub shows one line above the greeting, and a guide's banner starts 16px under the chip row.
 *
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | @media (hover:hover) and (pointer:fine){.gg-side a{min-height:36px} | @media (hover:hover) and (pointer:fine){.gg-side a{min-height:44px}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-side{position:static;max-height:none;overflow:visible} | .gg-side{max-height:none}
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx |       <GiftGuidesPhoneNav active={null} page={path} /> |       {null}
 * @mutate src/pages/info/giftGuides/GiftGuidesPhoneNav.tsx | const printablesOpen = open !== null && PRINTABLE_PATHS.includes(open); | const printablesOpen = false;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-pnav>.gg-chip-menu{flex:none;margin-right:20px} | .gg-pnav>.gg-chip-menu{margin-right:20px}
 * @mutate src/pages/info/giftGuides/GiftGuideMyList.tsx | {/* UX audit M4 | <a href="/gift-guides" data-gift-back="">All guides</a>{/* UX audit M4
 * @mutate src/pages/info/giftGuides/GiftGuideCover.tsx | <header className="gg-words gg-pagehead" data-gift-words=""> | <header className="gg-words" data-gift-words="">
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | const badges = guide === SPONSORS_PAGE ? | const badges = false ?
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-also-list li{display:inline;white-space:nowrap} | .gg-also-list li{padding:5px 10px;border:1px solid var(--gg-line);border-radius:999px}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-layout>.gg-disc{grid-column:2;grid-row:2;margin-left:24px;align-self:start} | .gg-layout>.gg-disc{grid-column:2;grid-row:2;margin-left:24px;align-self:end}
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx | .gg-fun:has([data-swipe-deck]){max-width:none} | .gg-fun:has([data-swipe-deck]){}
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
import { FUN_WORDS } from "@/content/giftGuideFun1120";
import { PickRow } from "@/pages/info/giftGuides/GiftGuideView";
import { guideBySlug, loadAllGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";

vi.mock("@/pages/info/giftGuides/GiftGuideShare", () => ({ GiftGuideTools: () => null }));

afterEach(cleanup);
await loadAllGuidePicks();

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

describe("polish audit 1122 #8: the 25 Days sponsors page cards", () => {
  const real = guideBySlug("25-days-sponsors")!.picks[0];
  expect(real).toBeDefined();
  const pick = { ...real, badges: ["sponsor", "shop-louisiana", "trending"] } as CatalogPick;
  const badgesOn = (guide: string) => {
    const c = render(<MemoryRouter><ul><PickRow pick={pick} guide={guide} /></ul></MemoryRouter>).container;
    const out = [...c.querySelectorAll("[data-gift-badge]")].map((b) => b.getAttribute("data-gift-badge"));
    cleanup();
    return out;
  };
  it("no sponsor or Shop Louisiana chip on the sponsors page; other badges and other guides untouched", () => {
    expect(badgesOn("25-days-sponsors")).toEqual(["trending"]);
    expect(badgesOn("her")).toEqual(["sponsor", "shop-louisiana", "trending"]);
  });
  it("the heart sits on the photo's corner on that page only; Also sponsoring is plain text", () => {
    expect(GIFT_GUIDES_CSS).toContain('article[data-gift-guide="25-days-sponsors"] .gg-list .gg-heart-pick{top:4px;bottom:auto;right:auto;left:54px;z-index:1}');
    expect(GIFT_GUIDES_CSS).toContain('@media (min-width:768px){article[data-gift-guide="25-days-sponsors"] .gg-list .gg-heart-pick{top:2px;left:auto;right:2px}}');
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-list \.gg-heart-pick\{position:absolute;right:-6px;bottom:0\}/);
    expect(GIFT_GUIDES_CSS).toContain(".gg-also-list li{display:inline;white-space:nowrap}");
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-also-list li\{[^}]*border/);
  });
});

describe("polish audit 1122 #11: Swipe on a phone and a wide screen", () => {
  it("no tip box in the deck; the short-round note is plain and sits on the count line", () => {
    const swipe = src("src/pages/info/giftGuides/fun/SwipeGifts.tsx");
    expect(swipe).not.toMatch(/<Hint\b/);
    expect(swipe).toContain('{fewNote && at === 0 && <span data-swipe-few=""> · {fewNote}</span>}');
    expect(FUN_WORDS.swipeFew(18, "Under $25")).toBe("18 gifts under $25");
    expect(FUN_WORDS.swipeFew(1, "Under $25")).toBe("1 gift under $25");
  });
  it("a 150px photo on phones, the deck centered in the column, disclosures under the content", () => {
    const fun = src("src/pages/info/giftGuides/fun/FunPage.tsx");
    expect(fun).toContain(".gg-fun:has([data-swipe-deck]){max-width:none}");
    expect(fun).toMatch(/@media \(max-width:479px\)\{\.gg-swipe-card\{padding:12px\}\.gg-swipe-card \.gg-photo,\.gg-swipe-card \.gg-letter,\.gg-swipe-card \.gg-thumb\{width:150px;height:150px\}/);
    expect(GIFT_GUIDES_CSS).toContain(".gg-layout>.gg-disc{grid-column:2;grid-row:2;margin-left:24px;align-self:start}");
  });
});
