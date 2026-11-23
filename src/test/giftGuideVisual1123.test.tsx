/**
 * GUARD (guide visual audit 1123b, ~/Desktop/Louisiana Helpr Work/Gift guides and affiliate/Guide-audit-visual-1123b.md;
 * fix packets A-E):
 *  #1 (Med) Find a gift opened half scrolled (head row and banner title under the top bar: 178px on a phone, 356px on
 *     desktop): the view now opens at the page top on every arrival, and its card is no #gift-finder jump target.
 *  #2 (Med) the menu sheet scrolled twice (the sheet box AND its list): the box is a column that never scrolls; only
 *     the list does, so the Gift guides title and the close button stay put.
 *  #3 (Med) Black Friday / Cyber Monday deal lines on a phone: 14px text, each sale (offer + date) one 44px tap row,
 *     rows 12px apart.
 *  #4 (Med) landing Top 10 at 768: the sideways row up to 1023px (five across from 1024), the code chip on one line.
 *  #13/#14/#15 Top 10 names three lines, code badge 12px (was 10), the Prime line a 44px tap (was 42).
 *  #5 Small Business Saturday cards 14px (town 12, line 13 before); Holiday Hub cards 16px body, 13px kind (13/11 before).
 *  #6 tablet guide rows (768-1023): three-line names like phones.
 *  Lead 11-23: /gift-guides/printables/banners' og:description and twitter:description (api/share.ts sets both from
 *     ogDescription) say the same four-banner line as its description (Facebook showed the old one-banner line).
 * Every check below reads the shipped CSS / renders the shipped component, so it fails on the old values.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideLanding.tsx |     window.scrollTo(0, 0); |     void 0;
 * @mutate src/pages/info/giftGuides/GiftGuideFinder.tsx |     <section aria-labelledby={FINDER_TITLE_ID} className="gg-finder gg-quiz" | <section id={FINDER_ID} aria-labelledby={FINDER_TITLE_ID} className="gg-finder gg-quiz"
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg.gg-sheet-menu{display:flex;flex-direction:column;overflow:hidden} | .gg.gg-sheet-menu{display:flex;flex-direction:column}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-sheet-menu>.gg-sheet-menu-body{position:relative;flex:1 1 auto;min-height:0} | .gg-sheet-menu>.gg-sheet-menu-body{flex:1 1 auto;min-height:0}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-sheet-menu>.gg-sheet-menu-body{position:relative;flex:1 1 auto;min-height:0} | .gg-sheet-menu>.gg-sheet-menu-body{position:relative;flex:1 1 auto}
 * @mutate src/lib/publicPageMeta.mjs |     ogDescription: "Four free holiday banners, | ogDescription: "Print it at Walgreens or any photo counter, free from Louisiana Helpr.", x: "Four free holiday banners,
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx | .gg-card-sales>li[data-gift-sale]{position:relative;min-height:44px;padding:4px 0} | .gg-card-sales>li[data-gift-sale]{position:relative;padding:4px 0}
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx | .gg-card-sale::after{content:"";position:absolute;inset:0} | .gg-card-sale::after{content:""}
 * @mutate src/pages/info/giftGuides/GiftGuideDealCards.tsx | .gg-card-line{font-size:14px} | .gg-card-line{font-size:12.5px}
 * @mutate src/pages/info/giftGuides/GiftGuideDeals.tsx | @media (max-width:767px){.gg-deal-text{font-size:14px}} | @media (max-width:767px){.gg-deal-text{font-size:13px}}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | @media (min-width:1024px){.gg-top10{grid-auto-flow:row; | @media (min-width:768px){.gg-top10{grid-auto-flow:row;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-top10 .gg-bdg{white-space:nowrap} | .gg-top10 .gg-bdg{}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-top10 .gg-nm-name{-webkit-line-clamp:3;min-height:3lh} | .gg-top10 .gg-nm-name{min-height:2lh}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-bdg{font-style:normal;font-size:12px; | .gg-bdg{font-style:normal;font-size:10px;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-prime-trial{display:inline-flex;align-items:center;min-height:44px; | .gg-prime-trial{display:inline-block;
 * @mutate src/pages/info/giftGuides/smallBizCardStyles.ts | .gg-sb-town{margin:0;font-size:14px; | .gg-sb-town{margin:0;font-size:12px;
 * @mutate src/pages/info/giftGuides/smallBizCardStyles.ts | .gg-sb-text{margin:0;font-size:14px; | .gg-sb-text{margin:0;font-size:13px;
 * @mutate src/pages/info/holidays/holidayParts.tsx | <p className={`text-ds-15 text-muted-foreground ${more | <p className={`text-ds-13 text-muted-foreground ${more
 * @mutate src/pages/info/holidays/holidayParts.tsx | whitespace-nowrap text-ds-13 font-medium | whitespace-nowrap text-ds-12 font-medium
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | @media (max-width:1023px){.gg-list:not(.gg-top10) .gg-nm-name{-webkit-line-clamp:3}} | @media (max-width:767px){.gg-list:not(.gg-top10) .gg-nm-name{-webkit-line-clamp:3}}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { loadGuidePicks } from "@/content/giftGuideCatalog";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import { CARD_CSS } from "@/pages/info/giftGuides/GiftGuideDealCards";
import { SB_CARD_CSS } from "@/pages/info/giftGuides/smallBizCardStyles";
import { HolidayCard } from "@/pages/info/holidays/holidayParts";
import { HOLIDAY_EVENTS } from "@/content/holidayHub/events.mjs";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";

const ROOT = resolve(__dirname, "../..");
const src = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The body of the first `@media <query>{...}` block that holds `marker`, braces matched. */
function mediaBlock(css: string, query: string, marker: string): string {
  let from = 0;
  for (;;) {
    const at = css.indexOf(`@media ${query}{`, from);
    if (at < 0) return "";
    let depth = 0;
    const open = at + `@media ${query}`.length;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) {
        const body = css.slice(open + 1, i);
        if (body.includes(marker)) return body;
        from = i;
        break;
      }
    }
  }
}
/** The declarations of `selector{...}` inside `css` (exact selector text), or "". */
const decls = (css: string, selector: string) => {
  const at = css.indexOf(`${selector}{`);
  return at < 0 ? "" : css.slice(at + selector.length + 1, css.indexOf("}", at));
};
const px = (d: string, prop: string) => Number(new RegExp(`(?:^|;)${prop}:([\\d.]+)px`).exec(d)?.[1] ?? NaN);

describe("#1 Find a gift opens at the page top", () => {
  it("from the menu / rail / a shared link: scrolls to 0 on arrival and has no #gift-finder target", async () => {
    await act(async () => { await Promise.all(["her", "him", "kids"].map((s) => loadGuidePicks(s))); });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { container } = render(
      <MemoryRouter initialEntries={["/gift-guides#gift-finder"]}>
        <Routes><Route path="/gift-guides" element={<GiftGuides />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.querySelector("[data-gift-finder]")).not.toBeNull(), { timeout: 5000 });
    expect(container.querySelector("[data-gift-finder-view]")).not.toBeNull();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    // Neither the browser's own #hash jump nor ScrollToTop's in-app one has an element to scroll to.
    expect(document.getElementById("gift-finder")).toBeNull();
  });
});

describe("#2 the menu sheet scrolls once (its list), never the sheet box", () => {
  it("the box is a non-scrolling column that out-ranks the shared sheet's overflow-y-auto; the list takes the room left", () => {
    const box = decls(GIFT_GUIDES_CSS, ".gg.gg-sheet-menu");
    expect(box).toContain("display:flex");
    expect(box).toContain("flex-direction:column");
    expect(box).toContain("overflow:hidden");
    const list = decls(GIFT_GUIDES_CSS, ".gg-sheet-menu>.gg-sheet-menu-body");
    expect(list).toContain("min-height:0");
    // The rows' screen-reader words (.sr-only, position:absolute) must take the list, not the fixed sheet, as their box.
    expect(list).toContain("position:relative");
    expect(list).toContain("flex:1 1 auto");
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg-sheet-menu \.gg-sheet-menu-body\{max-height:70dvh;overflow-y:auto/);
    // The two-class selector only matches if the sheet wears both classes.
    expect(src("src/pages/info/giftGuides/GiftGuidesPhoneSheet.tsx")).toContain('className="gg gg-sheet-menu"');
  });
});

describe("#3 deal lines on a phone", () => {
  it("14px card text, each sale a 44px row 8px apart, Top deal text 14px", () => {
    const phone = mediaBlock(CARD_CSS, "(max-width:767px)", ".gg-card-sale");
    expect(px(decls(phone, ".gg-card-line"), "font-size")).toBeGreaterThanOrEqual(14);
    // Each sale row (offer + its date) is the tap target: the link's ::after fills the positioned row, 44px or taller.
    const row = decls(phone, ".gg-card-sales>li[data-gift-sale]");
    expect(px(row, "min-height")).toBeGreaterThanOrEqual(44);
    expect(row).toContain("position:relative");
    const hit = decls(phone, ".gg-card-sale::after");
    expect(hit).toContain("position:absolute");
    expect(hit).toContain("inset:0");
    // Rows are clearly apart: gap plus the row's top and bottom padding at least 12px.
    const pad = Number(/padding:(\d+)px 0/.exec(row)?.[1] ?? 0);
    expect(px(decls(phone, ".gg-card-sales"), "gap") + 2 * pad).toBeGreaterThanOrEqual(12);
    expect(px(decls(phone, ".gg-card-more"), "font-size")).toBeGreaterThanOrEqual(14);
    const deals = src("src/pages/info/giftGuides/GiftGuideDeals.tsx");
    const m = /@media \(max-width:767px\)\{\.gg-deal-text\{font-size:(\d+)px\}\}/.exec(deals);
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(14);
    // The one-column phone layout stays.
    expect(CARD_CSS).toContain(".gg-deal-grid[data-gift-sales]{grid-template-columns:minmax(0,1fr)}");
  });
});

describe("#4/#13/#14/#15 the Top 10, badges and the Prime line", () => {
  it("a sideways row up to 1023px, five across only from 1024; the code chip never wraps; three-line names", () => {
    expect(GIFT_GUIDES_CSS).toContain("@media (min-width:1024px){.gg-top10{grid-auto-flow:row;grid-auto-columns:auto;grid-template-columns:repeat(5,minmax(0,1fr))");
    expect(GIFT_GUIDES_CSS).not.toMatch(/@media \(min-width:768px\)\{\.gg-top10\{/);
    expect(decls(mediaBlock(GIFT_GUIDES_CSS, "(min-width:768px) and (max-width:1023px)", ".gg-top10{"), ".gg-top10")).toContain("grid-auto-columns:minmax(160px,30%)");
    expect(decls(GIFT_GUIDES_CSS, ".gg-top10 .gg-bdg")).toContain("white-space:nowrap");
    expect(GIFT_GUIDES_CSS).toContain(".gg-top10 .gg-nm-name{-webkit-line-clamp:3;min-height:3lh}");
  });
  it("every badge is at least 12px; the Prime line is a 44px tap", () => {
    expect(px(decls(GIFT_GUIDES_CSS, ".gg-bdg"), "font-size")).toBeGreaterThanOrEqual(12);
    expect(px(decls(GIFT_GUIDES_CSS, ".gg-prime-trial"), "min-height")).toBeGreaterThanOrEqual(44);
  });
});

describe("#6 tablet guide rows show three-line names", () => {
  it("the three-line rule reaches 1023px", () => {
    expect(GIFT_GUIDES_CSS).toContain("@media (max-width:1023px){.gg-list:not(.gg-top10) .gg-nm-name{-webkit-line-clamp:3}}");
  });
});

describe("#5 phone card text: Small Business Saturday and the Holiday Hub", () => {
  it("Small Business Saturday's town and line are 14px", () => {
    expect(px(decls(SB_CARD_CSS, ".gg-sb-town"), "font-size")).toBeGreaterThanOrEqual(14);
    expect(px(decls(SB_CARD_CSS, ".gg-sb-text"), "font-size")).toBeGreaterThanOrEqual(14);
  });
  it("a Hub card's body lines are at least 14px and its kind tag at least 12px (resolved through tailwind.config.ts)", () => {
    const tw = readFileSync(resolve(ROOT, "tailwind.config.ts"), "utf8");
    const size = (token: string) => Number(new RegExp(`"${token}": \\["(\\d+)px"`).exec(tw)?.[1] ?? NaN);
    const sizeOf = (el: Element) => {
      const t = [...el.classList].find((c) => /^text-ds-\d+$/.test(c));
      return t ? size(t.slice(5)) : NaN;
    };
    const items = HOLIDAY_EVENTS.filter((e) => e.address && e.note);
    expect(items.length).toBeGreaterThan(0);
    const c = render(<MemoryRouter><ul><HolidayCard item={items[0]} kind="event" tag="Market" /></ul></MemoryRouter>).container;
    const tag = c.querySelector("[data-holiday-tag]")!;
    expect(sizeOf(tag)).toBeGreaterThanOrEqual(12);
    const body = [...c.querySelectorAll("p:not([data-holiday-tag]), [data-holiday-maps]")];
    expect(body.length).toBeGreaterThan(2);
    for (const el of body) expect(sizeOf(el), el.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(14);
  });
});

describe("lead 11-23: the banners page shares its four-banner line", () => {
  it("og:description (and twitter:description, built from it) match the page description", () => {
    const m = (PUBLIC_PAGE_META as Record<string, { description: string; ogDescription?: string }>)["/gift-guides/printables/banners"];
    expect(m.description).toMatch(/^Four free holiday banners, Happy Thanksgiving and three Merry Christmas designs/);
    expect(m.ogDescription).toBe(m.description);
    const share = src("api/share.ts");
    expect(share).toContain('setMetaContent(out, "property", "og:description", meta.ogDescription ?? meta.description)');
    expect(share).toContain('setMetaContent(out, "name", "twitter:description", meta.ogDescription ?? meta.description)');
  });
});
