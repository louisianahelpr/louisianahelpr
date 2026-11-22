/**
 * THE GUIDE SEARCH, POLISHED (owner 2026-11-22, a screenshot of Kids on her iPhone: "Polish the search bar somehow").
 * Tapping the toolbar's magnifier opened a pill field that slid over the count row ("83 gifts · By Dec 15 · search ·
 * filter · heart · share"), cut "83 gift" off, and wore a heavy dark-olive 2px ring.
 *
 * Now: a soft field (white, a thin light-olive border, 12px corners, a light ring on focus), 44px tall with 16px words
 * so iOS does not zoom, the magnifier left and a 44px ✕ right. On a phone the open search takes the whole count row in
 * place (the count, the pill and the other icons step out; nothing sits under it or is cut), a small "N results" line
 * heads the results while typing, and the ✕ (or Escape) puts the row back exactly. On a computer the field takes up to
 * 360px and gives way before the title (below 1280px the pill steps out while it is open).
 *
 * Measured in Chromium on 2026-11-22 (local dev build of this branch, Kids/Her/Him): 375 and 320, the open field is the
 * row's full width (375: x 20, w 335, h 44; ✕ 44x44 at its right), font 16px, border 1px, radius 12px, "3 results" for
 * "lego", the row back to count + pill + four icons after ✕; 768/1024/1440 the field 190/316/316px wide, clear of the
 * title; no horizontal overflow anywhere. Screenshots: ~/.lh-shots/guide-phonecard-1122/search-{before,after}-*.png.
 *
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-countrow:has(.gg-tools-search.is-open)>:not(.gg-tools){display:none} | .gg-countrow:has(.gg-tools-search.is-open)>:not(.gg-tools){opacity:1}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-tools-search.is-open{position:relative;flex:1 1 auto;width:100%} | .gg-tools-search.is-open{position:absolute;right:0;width:100%}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | min-height:44px;font:500 16px Montserrat,sans-serif; | min-height:40px;font:500 13px Montserrat,sans-serif;
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | @media (min-width:768px){.gg-tools-search.is-open{flex:0 1 360px;width:auto;min-width:0} | @media (min-width:768px){.gg-tools-search.is-open{flex:0 0 auto;width:360px;min-width:0}
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

  it("phone: the open search fills the count row in place, and the count, pill and other icons step out (not covered)", () => {
    expect(PHONE, "the phone block").toBeGreaterThan(0);
    const open = rule(".gg-tools-search.is-open", PHONE);
    expect(inPhone(open.at)).toBe(true);
    expect(open.decl).toEqual({ position: "relative", flex: "1 1 auto", width: "100%" });
    for (const [selector, display] of [
      [".gg-countrow:has(.gg-tools-search.is-open)>:not(.gg-tools)", "none"],
      [".gg-tools:has(>.gg-tools-search.is-open)>:not(.gg-tools-search)", "none"],
    ] as const) {
      const r = rule(selector, PHONE);
      expect(inPhone(r.at), selector).toBe(true);
      expect(r.decl.display, selector).toBe(display);
    }
    expect(rule(".gg-countrow:has(.gg-tools-search.is-open)>.gg-tools", PHONE).decl).toMatchObject({ flex: "1 1 100%" });
    // Nothing positions the open field over the row any more.
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-tools-search\.is-open\{position:absolute/);
  });

  it("computer: the field takes up to 360px and gives way before the title; below 1280px the pill steps out", () => {
    expect(GIFT_GUIDES_CSS).toContain("@media (min-width:768px){.gg-tools-search.is-open{flex:0 1 360px;width:auto;min-width:0}.gg-tools:has(>.gg-tools-search.is-open){max-width:none}}");
    expect(GIFT_GUIDES_CSS).toContain("@media (min-width:768px) and (max-width:1279px){.gg-headrow:has(.gg-tools-search.is-open)>.gg-ship{display:none}}");
  });

  it("Kids at 375: open, type, an \"N results\" line counting the rows shown; ✕ puts the row back with focus on the magnifier", async () => {
    const c = await renderAt("/gift-guides/kids", 375);
    const row = c.querySelector("[data-gift-countrow]")!;
    const before = [...row.querySelectorAll("[data-gift-item-count], [data-gift-ship], [data-gift-quick] > *")].map((e) => e.outerHTML.slice(0, 60));
    expect(before.length).toBeGreaterThan(4);
    await act(async () => { fireEvent.click(row.querySelector("button[data-gift-search-button]")!); });
    const input = row.querySelector<HTMLInputElement>("input[data-gift-search]")!;
    expect(row.querySelector("[data-gift-search-box]")?.getAttribute("data-gift-search-box")).toBe("open");
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
    const after = [...row.querySelectorAll("[data-gift-item-count], [data-gift-ship], [data-gift-quick] > *")].map((e) => e.outerHTML.slice(0, 60));
    expect(after).toEqual(before);
    expect(document.activeElement).toBe(row.querySelector("button[data-gift-search-button]"));
  });
});
