/**
 * GUARD (owner 2026-11-25 ~5:30 PM: "We need to polish the signed out and in version on phones"; the phone audit,
 * ~/.lh-shots/phone-polish-audit-1125/FINDINGS.md, gift guide and deals findings 5, 6, 7, 8, 9, 46 and 48).
 * Measured in Chromium at 390 before (live www) and after (this branch), ~/.lh-shots/phone-polish-guides-1125/:
 *  - #5 one header: signed out, the site bar was fixed over the guides' own "← Gift guides ≡" row on every guides page
 *    (bar bottom stayed at 60px after a 900px scroll); now it scrolls away (bar bottom -840px). The
 *    guides' row keeps its 61px (the owner's 11-22 11:40 PM spacing, giftGuideMenuHint1122), not the audit's 52px.
 *  - #6 a banner title never runs past the arch: Black Friday's title line was 276px in a 277px arch (spilled past the
 *    gold line), Monster Jam's 255px; now at most 72% of the arch's inner width (196px, 197px), lines balanced.
 *  - #7 a gift row was 105-123px with a blank band over its pinned icons; now 88px (72px photo, 8px above and below),
 *    the cart and heart 8px under the price.
 *  - #8 one top on every guide, 16px apart: banner, count row, tip box, theme covers (Kids), sections (Kids had its count
 *    row under its theme covers; Monster Jam 30px and Black Friday 32px above the first section).
 *  - #9 deal cards: 120px photo, brand 15px bold, offer 14px/1.35, dates 12px, 12px padding.
 *  - #46 Popular searches links (30px) and Sales offer lines (18px) draw 36px tall.
 *  - #48 the landing's holiday banner (116px) is 80px; the Top 10 two cards across; names 15px/600.
 * jsdom has no layout, so the heights are summed from the rules the phone uses, and the rules must be the LAST in the
 * stylesheet (so nothing later undoes them). A computer (768px up) is untouched: every rule sits in max-width:767px.
 *
 * @mutate src/components/Navbar.tsx |         scrollsAway && "max-[767px]:absolute", |         false,
 * @mutate src/components/Navbar.tsx |   const scrollsAway = navSection(location.pathname) === "guides"; |   const scrollsAway = location.pathname === "/gift-guides";
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg .gg-words.gg-banner-wrap .gg-banner h1{max-width:72%; | .gg .gg-words.gg-banner-wrap .gg-banner h1{max-width:100%;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg .gg-list:not(.gg-top10) .gg-thumb{width:72px;height:72px;padding:4px} | .gg .gg-list:not(.gg-top10) .gg-thumb{width:88px;height:88px;padding:4px}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | >:is(.gg-heart-pick,.gg-cart){top:25px;bottom:auto} | >:is(.gg-heart-pick,.gg-cart){bottom:0}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg>.gg-countrow,.gg>.gg-menuhint, | .gg>.gg-menuhint,
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | >.gg-deal>.gg-deal-photo{aspect-ratio:auto;height:120px} | >.gg-deal>.gg-deal-photo{aspect-ratio:1/1}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg .gg-greet-in{padding:8px 12px} | .gg .gg-greet-in{padding:22px 12px 18px}
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));

import Navbar from "@/components/Navbar";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";

afterEach(cleanup);

const MARK = "Phone polish audit 1125";
const start = GIFT_GUIDES_CSS.indexOf(MARK);
const block = GIFT_GUIDES_CSS.slice(start);
/** The declarations of the one rule in the 1125 block whose selector is exactly `sel`, as a property map. */
function rule(sel: string): Record<string, string> {
  const at = block.indexOf(`\n${sel}{`);
  expect(at, `rule ${sel}`).toBeGreaterThan(0);
  const body = block.slice(at + sel.length + 2, block.indexOf("}", at));
  return Object.fromEntries(body.split(";").filter(Boolean).map((d) => { const i = d.indexOf(":"); return [d.slice(0, i), d.slice(i + 1)]; }));
}
const px = (v: string | undefined) => { if (v === "0") return 0; const m = /^(-?\d+(?:\.\d+)?)px/.exec(v ?? ""); expect(m, `px value in "${v}"`).not.toBeNull(); return Number(m![1]); };
/** padding shorthand -> [top, right, bottom, left]. */
const pad = (v: string) => { const p = v.split(/\s+/).map(px); return [p[0], p[1] ?? p[0], p[2] ?? p[0], p[3] ?? p[1] ?? p[0]]; };

describe("guides phone polish 1125: the rules are phone-only and last", () => {
  it("sits in one max-width:767px block at the very end of the guides' stylesheet", () => {
    expect(start).toBeGreaterThan(0);
    const media = GIFT_GUIDES_CSS.indexOf("@media (max-width:767px){", start);
    expect(media).toBeGreaterThan(start);
    // Nothing but the block (and its under-360 line) follows the marker: no later layer can undo it.
    const rules = block.match(/\{[^{}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(25);
    expect(GIFT_GUIDES_CSS.trimEnd().endsWith("-webkit-line-clamp:3}}")).toBe(true);
  });
});

describe("#5 one header on a phone: the site bar scrolls away on every guides page", () => {
  const GUIDES = ["/gift-guides", "/gift-guides/her", "/gift-guides/kids", "/gift-guides/monster-jam", "/gift-guides/black-friday", "/gift-guides/printables/gift-tags", "/gift-guides/swipe", "/holidays"];
  const OTHERS = ["/", "/browse", "/declutter", "/jobs/abc", "/legal"];
  const navAt = (path: string) => {
    render(<MemoryRouter initialEntries={[path]}><Navbar solid /></MemoryRouter>);
    const nav = document.querySelector('nav[aria-label="Primary"]')!;
    const cls = (nav.getAttribute("class") ?? "").split(/\s+/);
    cleanup();
    return { cls, away: nav.hasAttribute("data-nav-scrolls-away") };
  };
  it("guides pages: fixed from 768px, drawn at the page's top (absolute) up to 767px", () => {
    for (const p of GUIDES) {
      const { cls, away } = navAt(p);
      expect(cls, p).toContain("fixed");
      expect(cls, p).toContain("max-[767px]:absolute");
      expect(away, p).toBe(true);
    }
    expect(GUIDES.length).toBeGreaterThan(6);
  });
  it("every other page keeps the fixed bar at every width", () => {
    for (const p of OTHERS) {
      const { cls, away } = navAt(p);
      expect(cls, p).toContain("fixed");
      expect(cls.some((c) => c.endsWith(":absolute")), p).toBe(false);
      expect(away, p).toBe(false);
    }
  });
  it("the guides' own row keeps the owner's 11-22 spacing: the 1125 block sets none of its own", () => {
    expect(block).not.toMatch(/\.gg-headrow\{/);
  });
});

describe("#6 a banner title stays inside the arch", () => {
  it("at most 72% of the arch's inner width, lines balanced; long titles and deals days clamp(30px, 8.5vw, 43px)", () => {
    const r = rule(".gg .gg-words.gg-banner-wrap .gg-banner h1");
    expect(r["max-width"]).toBe("72%");
    expect(r["text-wrap"]).toBe("balance");
    expect(r["margin-left"]).toBe("auto");
    const long = rule(".gg .gg-words.gg-banner-long .gg-banner h1,.gg:has([data-gift-deals-page]) .gg-words.gg-banner-wrap .gg-banner h1");
    expect(long["font-size"]).toBe("clamp(30px,8.5vw,43px)");
    // The deals page's own sheet loads later than this one: this selector must out-rank its (.gg:has(...) .gg-banner h1).
    expect(GIFT_GUIDES_CSS.slice(start)).toContain(".gg:has([data-gift-deals-page]) .gg-words.gg-banner-wrap .gg-banner h1");
  });
});

describe("#7 a gift row is about 88px", () => {
  it("72px photo, 8px above and below; icons 8px under the price; name 15px, two lines", () => {
    const thumb = rule(".gg .gg-list:not(.gg-top10) .gg-thumb");
    const item = pad(rule(".gg .gg-list:not(.gg-top10) .gg-item").padding);
    const row = item[0] + px(thumb.height) + item[2];
    expect(row).toBeLessThanOrEqual(90);
    expect(row).toBeGreaterThanOrEqual(86);
    const nm = rule(".gg .gg-list:not(.gg-top10)>:where([data-gift-pick]) .gg-nm");
    expect(nm["padding-bottom"]).toBe("0");
    // The price column is the icons' width, so a name never runs under the cart and heart.
    expect(nm["grid-template-columns"]).toBe("minmax(0,1fr) 88px");
    const name = rule(".gg .gg-list:not(.gg-top10)>:where([data-gift-pick]) .gg-nm-name");
    expect(name["font-size"]).toBe("15px");
    expect(name["-webkit-line-clamp"]).toBe("2");
    const icons = rule(".gg .gg-list:not(.gg-top10)>:where([data-gift-pick])>:is(.gg-heart-pick,.gg-cart)");
    // The row's 8px top + the price's 20px line - 3px (a 44px box centres a 22px icon 11px down) = the icon 8px under it.
    expect(px(icons.top)).toBe(item[0] + 20 - 3);
    expect(icons.bottom).toBe("auto");
    expect(rule(".gg .gg-list>:where([data-gift-pick])>.gg-dupe").top).toBe(icons.top);
    // Bottom-of-row icons (the 11-22 phone rule) were what left the blank band: none of the block's rules pins them there.
    expect(block).not.toMatch(/gg-heart-pick[^{]*\{[^}]*bottom:0/);
  });
});

describe("#8 one top on every guide, 16px apart", () => {
  it("count row, tip box and theme covers each sit 16px under the one before; the first section 16px under the last", () => {
    expect(rule(".gg>.gg-countrow,.gg>.gg-menuhint,.gg>[data-gift-theme-row],.gg article[data-gift-guide]>.gg-menuhint").margin).toBe("16px 0 0");
    expect(rule(".gg .gg-words.gg-banner-wrap")["margin-bottom"]).toBe("0");
    expect(rule(".gg .gg-main")["padding-top"]).toBe("0");
    expect(rule(".gg [data-gift-deals-page]>.gg-deals-list")["margin-top"]).toBe("16px");
  });
  it("Kids draws its count row first, then the tip box, then the theme covers", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../pages/info/GiftGuides.tsx"), "utf8"));
    const count = src.indexOf('className="gg-countrow" data-gift-countrow=""');
    const tip = src.indexOf("guide?.slug === KIDS_FILTER_GUIDE && MENU_HINT_GUIDES.has(guide.slug) && <GuidesMenuHint />");
    const themes = src.indexOf("guide?.slug === KIDS_FILTER_GUIDE && <LazyThemeRow />");
    expect(count).toBeGreaterThan(0);
    expect(tip).toBeGreaterThan(count);
    expect(themes).toBeGreaterThan(tip);
  });
});

describe("#9 deal cards", () => {
  it("120px photo, brand 15px bold, offer 14px/1.35 4px under it, dates 12px, 12px padding", () => {
    const card = ".gg .gg-deal-grid:not([data-gift-sales])>.gg-deal";
    expect(rule(card).padding).toBe("12px");
    expect(rule(`${card}>.gg-deal-photo`).height).toBe("120px");
    const brand = rule(`${card} .gg-card-store`);
    expect([brand["font-size"], brand["font-weight"]]).toEqual(["15px", "700"]);
    // The brand's 44px link box reaches 12px past its 20px line: -4px top makes 8px under the photo, -12px bottom puts
    // the offer's 4px straight under the words.
    expect(px(brand["line-height"])).toBe(20);
    expect(rule(`${card}>:is(.gg-deal-brand,.gg-card-head)`).margin).toBe("-4px 0 -12px");
    const text = rule(`${card}>:is(.gg-deal-text,.gg-card-line)`);
    expect([text["margin-top"], text["font-size"], text["line-height"]]).toEqual(["4px", "14px", "1.35"]);
    expect(rule(`${card}>[data-gift-deal-dates]`)["font-size"]).toBe("12px");
  });
});

describe("#46 small links draw 36px and tap 44px", () => {
  it("Popular searches links and Sales offer lines", () => {
    expect(rule(".gg .gg-searches .gg-also-list a")["min-height"]).toBe("36px");
    const hit = rule(".gg .gg-searches .gg-also-list a::after");
    expect(36 - px(hit.top) - px(hit.bottom)).toBe(44);
    // A Sales line's row (li) is already a 44px tap (its ::after covers the row); the link itself now draws 36px.
    expect(rule(".gg .gg-card-sales .gg-card-sale")["min-height"]).toBe("36px");
  });
});

describe("#48 the gift guides landing", () => {
  it("holiday banner about 80px; Top 10 two across; names 15px/600", () => {
    // 6px stripe band + 8px inner padding, each above and below, + the heading (27px type at 390, 1.1) + 4px + the line
    // (14px, 1.3) = 80px at 390 (measured: 80px).
    const outer = pad(rule(".gg .gg-greet").padding);
    const inner = pad(rule(".gg .gg-greet-in").padding);
    const heading = Math.round(390 * 0.07 * 1.1);
    const line = Math.round(14 * 1.3);
    const h = outer[0] + outer[2] + inner[0] + inner[2] + heading + px(rule(".gg .gg-greet-p")["margin-top"]) + line;
    expect(h).toBeLessThanOrEqual(82);
    expect(rule(".gg .gg-top10")["grid-auto-columns"]).toBe("calc((100% - 16px) / 2)");
    const name = rule(".gg .gg-top10 .gg-nm-name");
    expect([name["font-size"], name["font-weight"]]).toEqual(["15px", "600"]);
    expect(rule(".gg .gg-top10 .gg-nm")["overflow-wrap"]).toBe("break-word");
  });
});
