/**
 * THE GUIDE SEARCH, POLISHED (owner 2026-11-22, a screenshot of Kids on her iPhone: "Polish the search bar somehow").
 * Tapping the toolbar's magnifier opened a pill field that slid over the count row ("83 gifts · By Dec 15 · search ·
 * filter · heart · share"), cut "83 gift" off, and wore a heavy dark-olive 2px ring.
 *
 * Now: a soft field (white, a thin light-olive border, 12px corners, a light ring on focus), 44px tall with 16px words
 * so iOS does not zoom, the magnifier left and a 44px ✕ right. On a phone the open search sits in the count row in place,
 * a small "N results" line heads the results while typing, and the ✕ (or Escape) puts the row back exactly. On a
 * computer the field takes up to 360px and gives way before the title.
 *
 * Owner 2026-11-22 evening (pop-up, on the Holiday Hub: "keep count on row. and fix her him and kids so its this way
 * too"): the phone's open search no longer hides the count. "146 gifts" stays at the left of the row (never wrapped),
 * the field takes the rest of the row, the other icons step out, and the results drop under the whole row.
 * Owner 2026-11-24 ~8:30 PM ("Remove by Dec 15 everywhere"): the "By Dec 15" pill is gone from the row (and its rules).
 * Measured (Chromium, local dev build, Her): 320 count x 20 w 58, field x 82 w 218; 375 field x 82 w 273; 1440 the
 * head row unchanged (field 316px); no horizontal overflow. Screenshots: ~/.lh-shots/guide-search-row-1122/.
 *
 * Measured in Chromium on 2026-11-22 (local dev build of this branch, Kids/Her/Him): 375 and 320, the open field is the
 * row's full width (375: x 20, w 335, h 44; ✕ 44x44 at its right), font 16px, border 1px, radius 12px, "3 results" for
 * "lego", the row back to count + pill + four icons after ✕; 768/1024/1440 the field 190/316/316px wide, clear of the
 * title; no horizontal overflow anywhere. Screenshots: ~/.lh-shots/guide-phonecard-1122/search-{before,after}-*.png.
 *
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-countrow:has(.gg-tools-search.is-open)>.gg-countrow-left{flex:none;flex-wrap:nowrap} | .gg-countrow:has(.gg-tools-search.is-open)>.gg-countrow-left{display:none}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-countrow:has(.gg-tools-search.is-open)>.gg-tools{flex:1 1 0;min-width:0;margin:0;position:static} | .gg-countrow:has(.gg-tools-search.is-open)>.gg-tools{flex:1 1 100%;margin:0}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-tools-search.is-open{position:relative;flex:1 1 auto;width:100%} | .gg-tools-search.is-open{position:absolute;right:0;width:100%}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | min-height:44px;font:500 16px Montserrat,sans-serif; | min-height:40px;font:500 13px Montserrat,sans-serif;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | @media (min-width:768px){.gg-tools-search.is-open{flex:0 1 360px;width:auto;min-width:0} | @media (min-width:768px){.gg-tools-search.is-open{flex:0 0 auto;width:360px;min-width:0}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-countrow .gg-tools{grid-column:2;grid-row:1;justify-self:end} | .gg-countrow .gg-tools{grid-column:1/-1;grid-row:2;justify-self:end}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-countrow:has(.gg-tools-search.is-open){display:flex} | .gg-countrow:has(.gg-tools-search.is-open){display:grid}
 * @mutate src/content/sbsFeaturedLocal.ts |   sortLabel: "Sort", |   sortLabel: "Sort businesses",
 * @mutate src/content/giftGuides.ts |   sortLabel: "Sort", |   sortLabel: "Sort by price",
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx | focus-within:ring-2 focus-within:ring-[hsl(var(--bark)/0.22)] | focus-within:ring-2 focus-within:ring-ring
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |             {shown > 0 && <li className="gg-search-count" | {false && <li className="gg-search-count"
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import { giftGuides as G } from "@/content/giftGuides";
import { SBS_WORDS } from "@/content/sbsFeaturedLocal";

await loadAllGuidePicks();
const WIDTH = window.innerWidth;
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: WIDTH });
});

const rule = (selector: string, from = 0) => {
  const at = GIFT_GUIDES_CSS.indexOf(`${selector}{`, from);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const body = GIFT_GUIDES_CSS.slice(at + selector.length + 1, GIFT_GUIDES_CSS.indexOf("}", at));
  return { at, decl: Object.fromEntries(body.split(";").filter(Boolean).map((d) => { const i = d.indexOf(":"); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; })) };
};
/** The phone block that holds the open-search row rules. */
const PHONE = GIFT_GUIDES_CSS.indexOf("@media (max-width:767px){\n.gg-tools-search.is-open{");
const PHONE_END = GIFT_GUIDES_CSS.indexOf("\n}\n", PHONE);
const inPhone = (at: number) => at > PHONE && at < PHONE_END;
const SHARE_TSX = readFileSync("src/pages/info/giftGuides/GiftGuideShare.tsx", "utf8");

const renderAt = async (url: string, width: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  let out!: ReturnType<typeof render>;
  await act(async () => {
    out = render(
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path="/gift-guides/:slug" element={<GiftGuides />} /></Routes>
      </MemoryRouter>,
    );
  });
  return out.container;
};

describe("the guide search, polished (owner 2026-11-22)", () => {
  it("a soft field: 44px tall, 16px words (no iOS zoom), a 1px light border, 12px corners, a light focus ring; a 44px ✕", () => {
    const field = rule(".gg-search input").decl;
    expect(field["min-height"]).toBe("44px");
    expect(field.font).toMatch(/^500 16px /);
    expect(field.border).toMatch(/^1px solid hsl\(var\(--bark\) \/ \.2\)$/);
    expect(field["border-radius"]).toBe("12px");
    expect(rule(".gg-search:focus-within input").decl["border-color"]).toBe("hsl(var(--bark) / .55)");
    // The wrapper's focus ring is the light olive one (the old dark 2px ring-ring is gone), still ring-2 for the
    // bare-input focus guard (focusableHasVisibleFocus.test.ts).
    expect(SHARE_TSX).toContain('className="gg-search rounded-xl focus-within:ring-2 focus-within:ring-[hsl(var(--bark)/0.22)]"');
    expect(SHARE_TSX).not.toMatch(/gg-search rounded-full focus-within:ring-2 focus-within:ring-ring/);
    // The ✕ is the round button's own 44px size (no size="sm"), at the field's right edge.
    expect(SHARE_TSX).toMatch(/<RoundIconButton className="gg-search-close"/);
    expect(rule(".gg-search-close").decl).toMatchObject({ position: "absolute", right: "0", top: "50%" });
  });

  it("phone: the open search keeps the count on its row (\"keep count on row\"); the field takes the rest, the other icons step out", () => {
    expect(PHONE, "the phone block").toBeGreaterThan(0);
    const open = rule(".gg-tools-search.is-open", PHONE);
    expect(inPhone(open.at)).toBe(true);
    expect(open.decl).toEqual({ position: "relative", flex: "1 1 auto", width: "100%" });
    // The other icons step out, not covered.
    for (const [selector, display] of [
      [".gg-tools:has(>.gg-tools-search.is-open)>:not(.gg-tools-search)", "none"],
    ] as const) {
      const r = rule(selector, PHONE);
      expect(inPhone(r.at), selector).toBe(true);
      expect(r.decl.display, selector).toBe(display);
    }
    // The count stays: its group keeps its own width on the one row (never hidden), the count never wraps.
    const row = rule(".gg-countrow:has(.gg-tools-search.is-open)", PHONE);
    expect(inPhone(row.at)).toBe(true);
    expect(row.decl).toEqual({ position: "relative", "flex-wrap": "nowrap" });
    const left = rule(".gg-countrow:has(.gg-tools-search.is-open)>.gg-countrow-left", PHONE);
    expect(inPhone(left.at)).toBe(true);
    expect(left.decl).toEqual({ flex: "none", "flex-wrap": "nowrap" });
    expect(rule(".gg-countrow:has(.gg-tools-search.is-open) .gg-itemcount", PHONE).decl).toEqual({ "white-space": "nowrap" });
    // The field's group takes the rest of the row; the results drop under the whole row (positioned by the row).
    expect(rule(".gg-countrow:has(.gg-tools-search.is-open)>.gg-tools", PHONE).decl).toEqual({ flex: "1 1 0", "min-width": "0", margin: "0", position: "static" });
    expect(rule(".gg-countrow .gg-tools-search.is-open", PHONE).decl).toEqual({ position: "static" });
    // The old rule that hid the count while searching is gone.
    expect(GIFT_GUIDES_CSS).not.toContain(".gg-countrow:has(.gg-tools-search.is-open)>:not(.gg-tools){display:none}");
    // Nothing positions the open field over the row any more.
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-tools-search\.is-open\{position:absolute/);
  });

  it("computer: the field takes up to 360px and gives way before the title (no pill, owner 11-24)", () => {
    expect(GIFT_GUIDES_CSS).toContain("@media (min-width:768px){.gg-tools-search.is-open{flex:0 1 360px;width:auto;min-width:0}.gg-tools:has(>.gg-tools-search.is-open){max-width:none}}");
    expect(GIFT_GUIDES_CSS).not.toContain(".gg-ship");
  });

  it("320 (consistency audit 1122 #17): under 360px the count and the four icons share the first line", () => {
    // Measured (Chromium, local dev build, 11-22): Her and the sponsors page at 320, the count x 20 and the four icons at
    // x 124, 168, 212, 256 on one line (y 327); 360 keeps everything on one row. (The pill under the count is gone, 11-24.)
    const at = GIFT_GUIDES_CSS.indexOf("@media (max-width:359px){\n.gg-countrow{");
    expect(at, "the under-360px count row block").toBeGreaterThan(0);
    const end = GIFT_GUIDES_CSS.indexOf("\n}\n", at);
    const inBlock = (sel: string) => { const r = rule(sel, at); expect(r.at < end, sel).toBe(true); return r.decl; };
    expect(inBlock(".gg-countrow")).toEqual({ display: "grid", "grid-template-columns": "auto minmax(0,1fr)", "align-items": "center", gap: "2px 4px" });
    expect(inBlock(".gg-countrow-left")).toEqual({ display: "contents" });
    expect(inBlock(".gg-countrow .gg-itemcount")).toEqual({ "grid-column": "1", "grid-row": "1" });
    expect(inBlock(".gg-countrow .gg-tools")).toEqual({ "grid-column": "2", "grid-row": "1", "justify-self": "end" });
    // The open search goes back to the one flex row (the count stays, the field takes the rest).
    expect(inBlock(".gg-countrow:has(.gg-tools-search.is-open)")).toEqual({ display: "flex" });
    // After the base count row rule, so it wins.
    expect(at).toBeGreaterThan(GIFT_GUIDES_CSS.indexOf(".gg-countrow{display:flex;"));
  });

  it("one name per action on the sliders icon (consistency audit 1122 #6): \"Sort\" for a sort, \"Filter\" for a filter", () => {
    expect(G.sortLabel).toBe("Sort");
    expect(G.sortLabelActive("Price: low to high")).toBe("Sort, Price: low to high");
    expect(SBS_WORDS.sortLabel).toBe(G.sortLabel);
    expect(SBS_WORDS.sortLabelActive("Name: A to Z")).toBe(G.sortLabelActive("Name: A to Z"));
    expect(G.filterLabel).toBe("Filter");
    expect(G.filterLabelActive(2)).toBe("Filter, 2 on");
    // The Hub's filter takes the same words (src/test/holidayHub.test.tsx clicks it by them).
    expect(readFileSync("src/pages/info/holidays/HolidayHub.tsx", "utf8")).toContain("aria-label={active.length ? G.filterLabelActive(active.length) : G.filterLabel}");
  });

  it("Kids at 375: open, type, an \"N results\" line counting the rows shown; ✕ puts the row back with focus on the magnifier", async () => {
    const c = await renderAt("/gift-guides/kids", 375);
    const row = c.querySelector("[data-gift-countrow]")!;
    const before = [...row.querySelectorAll("[data-gift-item-count], [data-gift-quick] > *")].map((e) => e.outerHTML.slice(0, 60));
    expect(before.length).toBeGreaterThan(4);
    const countText = row.querySelector("[data-gift-item-count]")?.textContent;
    expect(countText).toMatch(/^\d+ gifts$/);
    await act(async () => { fireEvent.click(row.querySelector("button[data-gift-search-button]")!); });
    const input = row.querySelector<HTMLInputElement>("input[data-gift-search]")!;
    expect(row.querySelector("[data-gift-search-box]")?.getAttribute("data-gift-search-box")).toBe("open");
    // The count is still in the row while the field is open (owner 11-22 evening: "keep count on row").
    expect(row.querySelector("[data-gift-item-count]")?.textContent).toBe(countText);
    expect(row.querySelector("[data-gift-search-count]")).toBeNull();
    await act(async () => { fireEvent.change(input, { target: { value: "lego" } }); });
    await waitFor(() => expect(row.querySelector("[data-gift-found-item]")).not.toBeNull());
    const count = row.querySelector<HTMLElement>("[data-gift-search-count]")!;
    const links = row.querySelectorAll("#gift-search-results a").length;
    expect(links).toBeGreaterThan(0);
    expect(count.textContent).toBe(G.searchCount(links));
    expect(Number(count.dataset.giftSearchCount)).toBe(links);
    expect(G.searchCount(1)).toBe("1 result");
    await act(async () => { fireEvent.click(row.querySelector("button[data-gift-search-close]")!); });
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
    const after = [...row.querySelectorAll("[data-gift-item-count], [data-gift-quick] > *")].map((e) => e.outerHTML.slice(0, 60));
    expect(after).toEqual(before);
    expect(document.activeElement).toBe(row.querySelector("button[data-gift-search-button]"));
  });
});
