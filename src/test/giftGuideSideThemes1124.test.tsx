/**
 * THE THEMED GUIDES ARE KIDS' SUBSECTIONS IN THE GUIDES MENU (owner 2026-11-24 ~7:50 PM: "They can show as subsections of
 * kids in the left, like when you click Kids they expand down"). In the desktop sidebar and the phone's menu sheet (one
 * component, GiftGuidesMenu):
 *  - the theme rows (Monster Jam, Bluey ...) sit in a list nested inside Kids' row, never beside Her / Him / Kids;
 *  - Kids' row is a native disclosure (details/summary: the summary is announced as a button with its expanded state,
 *    no new script on the first paint), folded off Kids (the landing, Her, Him, the deals days ...); its + / - opens the
 *    themes in place and closes them again;
 *  - on Kids and on every theme page it is open, so the open page stays in view (aria-current).
 *
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | <details open={onKids}> | <details open>
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx |   const onKids = open === "kids" \|\| isKidsTheme(open ?? ""); |   const onKids = open === "kids";
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx | <summary>{row(g)}</summary><ul data-gift-side-themes=""> | {row(g)}<ul data-gift-side-themes="">
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg summary::-webkit-details-marker{display:none} | .gg-side summary::-webkit-details-marker{display:none}
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import { GiftGuidesMenu } from "@/pages/info/giftGuides/GiftGuidesSidebar";
import { guideBySlug } from "@/content/giftGuideCatalog";
import { KIDS_THEME_GUIDES_1124 as THEME_GUIDES_1124 } from "@/content/giftGuideLive.mjs";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";

afterEach(cleanup);

const menuAt = (slug: string | null) =>
  render(<MemoryRouter><GiftGuidesMenu active={slug ? guideBySlug(slug)! : null} idPrefix="t" wishList /></MemoryRouter>).container;
const kids = (c: HTMLElement) => c.querySelector<HTMLDetailsElement>("[data-gift-side-guides] details")!;

describe("the guides menu: themed guides fold under Kids (owner 11-24)", () => {
  it("the theme rows are nested in Kids' disclosure, one per live theme, never beside Her / Him / Kids", () => {
    const c = menuAt(null);
    const top = [...c.querySelectorAll("[data-gift-side-guides] > li > a[data-gift-side], [data-gift-side-guides] > li > details > summary > a[data-gift-side]")].map((a) => a.getAttribute("data-gift-side"));
    expect(top).toEqual(["", "her", "him", "kids"]);
    const d = kids(c);
    expect(d.querySelector(":scope > summary > a[data-gift-side='kids']")).not.toBeNull();
    const nested = [...d.querySelectorAll(":scope > ul[data-gift-side-themes] > li > a")].map((a) => a.getAttribute("data-gift-side"));
    expect(nested).toEqual([...THEME_GUIDES_1124]);
    expect(nested.length).toBeGreaterThan(5);
  });

  it.each([null, "her", "him"])("off Kids (%s): folded, and its summary opens and closes them in place", (slug) => {
    const c = menuAt(slug);
    const d = kids(c);
    expect(d.open).toBe(false);
    act(() => { fireEvent.click(d.querySelector("summary")!); });
    expect(d.open).toBe(true);
    act(() => { fireEvent.click(d.querySelector("summary")!); });
    expect(d.open).toBe(false);
  });

  it.each(["kids", ...THEME_GUIDES_1124])("on %s: open, and the open page is marked", (slug) => {
    const c = menuAt(slug);
    expect(kids(c).open).toBe(true);
    expect(c.querySelector(`[data-gift-side='${slug}']`)?.getAttribute("aria-current")).toBe("page");
  });

  it("the summary styles reach the desktop sidebar AND the phone's menu sheet (both under .gg): no marker, a + / - at the right", () => {
    expect(GIFT_GUIDES_CSS).toContain(".gg summary::-webkit-details-marker{display:none}");
    expect(GIFT_GUIDES_CSS).toMatch(/\.gg summary\{list-style:none;/);
    expect(GIFT_GUIDES_CSS).toContain('.gg summary::after{content:"+";');
    expect(GIFT_GUIDES_CSS).toContain('.gg details[open] summary::after{content:"\\2212"}');
    // The phone's menu sheet carries the .gg class, so the same rules apply there.
    expect(readFileSync("src/pages/info/giftGuides/GiftGuidesPhoneSheet.tsx", "utf8")).toContain('className="gg gg-sheet-menu"');
  });
});
