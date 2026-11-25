/**
 * The gift guides polish audit of 2026-11-22 (owner's Guides-polish-audit-1122.md), the UI and layout findings.
 *
 * #2 (High): the desktop menu was held to 828px at 1440x900 but needed 959px, so the LOUISIANA group was cut off with
 *    no scrollbar on a Mac. On a mouse screen its rows are 36px and the group headings 10px apart (815px), and on a
 *    screen too short for it the menu scrolls with the page instead of sticking, so nothing is ever hidden.
 * #3 (High): Gift tags, Coloring books, Banners, Swipe, Secret Santa, the planner and Shop Small had no phone menu.
 *    GuidesFrame draws it now (owner 11-22: the head row's three-line menu, which replaced the chip row).
 * #6: the menu always shows (owner 11-22: on the head row's right, beside the heart; was a pinned More chip).
 * #5: a phone's count row (count, 4 icons) fits one row at 375, gaps 4px. Its "By Dec 15" pill is gone (owner 2026-11-24
 *     ~8:30 PM: "Remove by Dec 15 everywhere").
 * #9: My Wish List has no second "All guides" back link (the head row's arrow goes to /gift-guides).
 * #10: one sub-page title (overtaken by the owner's 11-22 #13 "the same top section as the guides and the deals"): the
 *      frame pages' title is their gingham banner above the menu and the content column, in the deals days' sizes.
 * #8: the 25 Days sponsors page draws no "25 Days sponsor" or "Shop Louisiana" chip (every card is a sponsor), its heart
 *     sits on the photo's top-right corner there only, and "Also sponsoring" is plain names with dots, not pills.
 * #11: Swipe: one instruction (no tip box), "18 gifts under $25" on the count's line, a 150px card photo on phones (Skip
 *      and Save measured 677-733px on a 375x812 screen, were 839-895), the deck centered in the content column, and the
 *      disclosures right under a short page instead of at the foot of the menu.
 * #12/#20/#30: the deals days use one card design: a Top deal's brand name is its link (no Shop line) and its code is the
 *      same one-piece copy chip as the code cards; a code a Top deal shows gets no second code card (XT25); no arrow
 *      icon on code and sale cards; "+N more" is 44px; no jump-chip row above the sections.
 * #17: a Holiday Hub card's kind is its own one-line tag under the name (not inside the h3), and the place has its own
 *      line above Website / calendar / More details (measured: 0 of 40 places cut, were 18; 0 tags wrapped, were 12).
 * #28: /holidays hides Home in the top nav (/shop-small is now a 301); the Hub's link to the guides sits under its intro.
 * #29: a Hub search with no match says 'No lights or events match "..."' with Clear search; the hint fits the field.
 * #22: in the "Save for someone" popup each box's icons sit on the same line as its + (the open icon sat alone below).
 * #19: on a phone the hub shows one line above the greeting (owner 11-22: the chip row and its line are gone).
 *
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | @media (hover:hover) and (pointer:fine){.gg-side a{min-height:36px} | @media (hover:hover) and (pointer:fine){.gg-side a{min-height:44px}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-side{position:static;max-height:none;overflow:visible} | .gg-side{max-height:none}
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx | nav={{ active: null, page: path }} | nav={{ active: null, page: "/gift-guides/swipe" }}
 * @mutate src/pages/info/giftGuides/GuidesTop.tsx | <GuidesMenuButton active={nav.active} myList={nav.myList} page={nav.page} /> | {null}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-head-phone{display:flex;align-items:center;flex:none;margin:0 -10px 0 auto} | .gg-head-phone{display:flex;align-items:center;flex:none}
 * @mutate src/pages/info/giftGuides/GiftGuideMyList.tsx | {/* UX audit M4 | <a href="/gift-guides" data-gift-back="">All guides</a>{/* UX audit M4
 * @mutate src/pages/info/giftGuides/GiftGuideCover.tsx | sub ? "gg-words gg-banner-wrap gg-banner-sub" | sub ? "gg-words gg-banner-wrap"
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | const badges = guide === SPONSORS_PAGE ? | const badges = false ?
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-also-list li{display:inline;white-space:nowrap} | .gg-also-list li{padding:5px 10px;border:1px solid var(--gg-line);border-radius:999px}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-layout>.gg-disc{grid-column:2;grid-row:2;margin-left:24px;align-self:start} | .gg-layout>.gg-disc{grid-column:2;grid-row:2;margin-left:24px;align-self:end}
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx | .gg-fun{margin:0;padding:4px 0 24px} | .gg-fun{max-width:640px;margin:0;padding:4px 0 24px}
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx | const codes = codesOn(day).filter((c) => !shownCodes.has(c.code.toUpperCase())); | const codes = codesOn(day);
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx |           <CodeChip code={code} /> |           <code>{code}</code>
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx | .gg-card-more{min-height:44px; | .gg-card-more{min-height:32px;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-top10 .gg-nm .gg-nm-meta{justify-content:flex-start;margin-top:0; | .gg-top10 .gg-nm .gg-nm-meta{justify-content:flex-start;margin-top:auto;
 * @mutate src/pages/info/holidays/holidayParts.tsx |       <h3 className="text-ds-16 font-semibold leading-snug text-foreground">{item.name}</h3> |       <h3 className="text-ds-16 font-semibold leading-snug text-foreground">{item.name}{tag}</h3>
 * @mutate src/pages/info/holidays/HolidayHub.tsx | <HolidayNothing onClear={() => setQuery("")} clearLabel="Clear search"> | <HolidayNothing onClear={clearAll}>
 * @mutate src/pages/info/giftGuides/giftWishStyles.ts | .gg-savefor-box{display:flex;flex-wrap:wrap;align-items:center} | .gg-savefor-box{}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | @media (max-width:479px){.gg-countrow{gap:4px}} | @media (max-width:479px){.gg-countrow{gap:12px}}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import { GIFT_WISH_CSS } from "@/pages/info/giftGuides/giftWishStyles";
import { FunBody } from "@/pages/info/giftGuides/fun/FunPage";
import { FUN_WORDS } from "@/content/giftGuideFun1120";
import { GiftGuideDeals } from "@/pages/info/giftGuides/GiftGuideDeals";
import { HolidayCard } from "@/pages/info/holidays/holidayParts";
import { HOLIDAY_EVENTS } from "@/content/holidayHub/events.mjs";
import { dealDay } from "@/content/giftGuideDeals.mjs";
import { PickRow } from "@/pages/info/giftGuides/GiftGuideView";
import { guideBySlug, loadAllGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";

vi.mock("@/pages/info/giftGuides/GiftGuideShare", () => ({ GiftGuideTools: () => null, MyListIcon: () => null }));
vi.mock("@/lib/sbsFeaturedApi", () => ({ listFeaturedLocal: async () => [], sbsLogoUrl: () => "" }));

afterEach(cleanup);
await loadAllGuidePicks();

// Through FunBody, the frame pages' one way in (GuidesFrame is the module's own since /shop-small became a 301).
const frameAt = (path: ComponentProps<typeof FunBody>["path"]) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <FunBody title="Page" path={path}><p>body</p></FunBody>
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

// Owner 2026-11-22 (phone): the chip row of #3/#6 is gone; every frame page's head row carries the phone's heart and
// three-line menu instead (the whole check is src/test/giftGuidePhoneHead1122.test.tsx).
describe("polish audit 1122 #3/#6, owner 11-22: the phone's menu on every frame page, in the head row", () => {
  const pages = ["/gift-guides/printables/gift-tags", "/gift-guides/printables/coloring-books", "/gift-guides/printables/banners", "/gift-guides/swipe", "/gift-guides/draw-names", "/gift-guides/planner"] as const;
  it("each of the 6 pages draws the three-line menu on the right of its head row, and no chip row", () => {
    expect(pages.length).toBeGreaterThan(5);
    for (const path of pages) {
      const c = frameAt(path);
      const row = c.querySelector("[data-gift-headrow]")!;
      const menu = row.querySelector("[data-gift-head-phone] > button[data-gift-head-menu]");
      expect(menu, path).not.toBeNull();
      expect(menu!.getAttribute("aria-label"), path).toBe("Guides menu");
      expect(row.lastElementChild!.matches("[data-gift-head-phone]"), path).toBe(true);
      expect(c.querySelector("[data-gift-phone-nav], [data-gift-chip]"), path).toBeNull();
      cleanup();
    }
  });

  it("the heart and the menu sit at the row's right edge (margin-left auto), never on a line of their own", () => {
    const phone = GIFT_GUIDES_CSS.slice(GIFT_GUIDES_CSS.indexOf(".gg-head-phone{display:none}"));
    expect(phone).toContain(".gg-head-phone{display:flex;align-items:center;flex:none;margin:0 -10px 0 auto}");
    expect(phone).toContain(".gg-headrow{flex-wrap:nowrap;gap:4px}");
  });
});

const src = (f: string) => blankComments(readFileSync(f, "utf8"));

describe("polish audit 1122 #5/#9/#10/#19", () => {
  it("#5: the phone count row's gaps are 4px; its pill is gone (owner 11-24)", () => {
    expect(GIFT_GUIDES_CSS).toContain("@media (max-width:479px){.gg-countrow{gap:4px}}");
    expect(GIFT_GUIDES_CSS).not.toContain("gg-ship");
    expect(src("src/pages/info/giftGuides/GuidesTop.tsx")).not.toContain("gg-ship");
  });

  it("#9: My Wish List draws no second back link", () => {
    const my = src("src/pages/info/giftGuides/GiftGuideMyList.tsx");
    expect(my).toContain('data-gift-my-list=""');
    expect(my).not.toContain("data-gift-back=");
    expect(my).not.toContain("allGuidesLabel");
  });

  it("#10 (owner 11-22 #13): the frame's title is its gingham banner over the menu and the content, in the deals' sizes", () => {
    const c = frameAt("/gift-guides/swipe");
    const banner = c.querySelector("header.gg-words.gg-banner-wrap.gg-banner-sub")!;
    expect(banner).not.toBeNull();
    expect(banner.querySelector("h1#gift-guide-title")?.textContent).toMatch(/Swipe to Find Gifts$/);
    expect(c.querySelector(".gg-layout")!.contains(banner)).toBe(false);
    expect(c.querySelector(".gg-layout > .gg-main > header")).toBeNull();
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-pagehead h1,\.gg \.gg-wish-title\{font-family:'Bodoni Moda'/);
  });

  it("#19 (owner 11-22: no chip row on a phone): no chip-row line or rule is left, so the hub's divider is its one line", () => {
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-pnav|\.gg-chip-nav/);
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-divider\{/);
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
  // Owner 2026-11-22 ("move the heart and shopping cart back to the top right of picture"): every guide's cards now put
  // the heart on the photo's corner on a computer and (owner 11-22 later) at the row's bottom-right on a phone (the
  // sponsors page's own rule became everyone's), so no page-scoped override is left.
  it("the heart sits where every guide's does on that page; Also sponsoring is plain text", () => {
    expect(GIFT_GUIDES_CSS).toContain(".gg-list>:where([data-gift-pick])>.gg-heart-pick{bottom:0;right:0;justify-content:flex-end}");
    expect(GIFT_GUIDES_CSS).toContain(".gg-list .gg-heart-pick{top:2px;left:auto;right:2px}");
    expect(GIFT_GUIDES_CSS).not.toContain('article[data-gift-guide="25-days-sponsors"] .gg-list .gg-heart-pick');
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
    // Owner 11-22: the fun column spans the content column (no 640px cap), so the deck centres in the page's column.
    expect(fun).toContain(".gg-fun{margin:0;padding:4px 0 24px}");
    expect(fun).not.toMatch(/\.gg-fun\{[^}]*max-width/);
    expect(fun).toMatch(/\.gg-swipe-stage\{[^}]*margin:0 auto/);
    expect(fun).toMatch(/@media \(max-width:479px\)\{\.gg-swipe-card\{padding:12px\}\.gg-swipe-card \.gg-photo,\.gg-swipe-card \.gg-letter,\.gg-swipe-card \.gg-thumb\{width:150px;height:150px\}/);
    expect(GIFT_GUIDES_CSS).toContain(".gg-layout>.gg-disc{grid-column:2;grid-row:2;margin-left:24px;align-self:start}");
  });
});

describe("polish audit 1122 #12/#20/#30: one deal card design", () => {
  it("Black Friday: Top deals carry the copy chip and a brand link; XT25 has one card; no arrows, no jump row", async () => {
    const { container } = render(<MemoryRouter><GiftGuideDeals day={dealDay("black-friday")!} now={new Date("2026-11-21T18:00:00Z")} /></MemoryRouter>);
    await waitFor(() => expect(container.querySelector("[data-gift-deal]")).not.toBeNull());
    const top = container.querySelector("[data-gift-deal-list]")!;
    const chips = [...top.querySelectorAll("[data-gift-deal-code] [data-gift-code-copy]")];
    expect(chips.length).toBeGreaterThan(0);
    expect(top.querySelectorAll("p.gg-deal-code, [data-gift-shop]").length).toBe(0);
    for (const card of top.querySelectorAll("li[data-gift-deal]")) expect(card.querySelector("a[data-gift-deal-brand]"), card.getAttribute("data-gift-deal")!).not.toBeNull();
    expect(chips.map((c) => c.getAttribute("data-gift-code-copy"))).toContain("XT25");
    expect(container.querySelectorAll('[data-gift-code-copy="XT25"]').length).toBe(1);
    expect(container.querySelector("[data-gift-open-site], [data-gift-deal-jump]")).toBeNull();
    expect(src("src/pages/info/giftGuides/GiftGuideDealCards.tsx")).toContain(".gg-card-more{min-height:44px;");
  });
});

describe("polish audit 1122 #20: Top 10 prices line up", () => {
  it("the price sits right under a three-line name box (guide visual 1123b #13), never pushed down past a code chip", () => {
    expect(GIFT_GUIDES_CSS).toContain(".gg-top10 .gg-nm-name{-webkit-line-clamp:3;min-height:3lh}");
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-top10 \.gg-nm \.gg-nm-meta\{justify-content:flex-start;margin-top:0;/);
  });
});

describe("polish audit 1122 #17/#28/#29: the Holiday Hub", () => {
  it("#17: the kind is a one-line tag under the name; the place sits on its own line above the actions", () => {
    const item = HOLIDAY_EVENTS.find((e) => e.address)!;
    expect(item).toBeDefined();
    const c = render(<MemoryRouter><ul><HolidayCard item={item} kind="event" tag="Christmas lights · Walk-through" /></ul></MemoryRouter>).container;
    const h3 = c.querySelector("h3")!;
    expect(h3.textContent).toBe(item.name);
    const tag = c.querySelector("[data-holiday-tag]")!;
    expect(tag.tagName).toBe("P");
    expect(tag.className).toContain("whitespace-nowrap");
    const maps = c.querySelector("[data-holiday-maps]")!;
    expect(maps.closest("[data-holiday-actions]")).toBeNull();
    expect(maps.querySelector(".truncate")).toBeNull();
  });
  it("#28/#29: Home hidden on /holidays; a no-match search says so and clears the search", () => {
    expect(src("src/components/Navbar.tsx")).toContain('const NAV_HOME_HIDDEN_ON = ["/browse", "/jobs", "/declutter", "/gift-guides", "/holidays"] as const;');
    const hub = src("src/pages/info/holidays/HolidayHub.tsx");
    expect(hub).toContain('<HolidayNothing onClear={() => setQuery("")} clearLabel="Clear search">');
    expect(hub).toContain("{`No lights or events match \"${query.trim()}\".`}");
    // #28's "Shopping too?" link sat above the filters; owner 2026-11-22 ("Remove the words above 82 light displays then
    // move that and the and filter and search up") took it and the intro out, so the count, search and filter row is the
    // first thing in the page body, right under the banner.
    expect(hub).not.toContain("data-holiday-guides-link");
    expect(hub).not.toContain("{W.hubIntro}");
    expect(hub).toMatch(/data-holiday-page="hub">\s*(?:\{\s*\}\s*)?<div className="space-y-2\.5" data-holiday-filters="">/);
  });
});

describe("polish audit 1122 #22: the save popup's boxes", () => {
  it("the row and its icons share one line; an edit form drops under them at full width", () => {
    expect(GIFT_WISH_CSS).toContain(".gg-savefor-box{display:flex;flex-wrap:wrap;align-items:center}");
    expect(GIFT_WISH_CSS).toContain(".gg-savefor-box>.gg-savefor-row{flex:1 1 0;min-width:0}");
    expect(GIFT_WISH_CSS).toContain(".gg-savefor-box>:not(.gg-savefor-row):not(.gg-savefor-tools){flex-basis:100%}");
  });
});
