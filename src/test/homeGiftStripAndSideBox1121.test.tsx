/**
 * Owner 11-21 (signed-in Home): "remove picked by a Louisiana nurse. and move this to under good evening lexi like one
 * long strip. your profile etc needs a box around it."
 *  - The gift guides promo says "Holiday gift guides · Gifts, deals and codes" (no nurse line), on Home and Declutter.
 *  - On Home it is ONE slim strip (48px: gift icon, words, chevron, X), right under the greeting and its date line,
 *    above the first card; its slot is held while its lazy chunk loads, and it is no longer in the side column.
 *  - The profile line and Your sections sit in ONE liquid-glass card, like Needs you; the money tiles follow it.
 *
 * @mutate src/components/GiftGuidesPromo.tsx | const GIFT_PROMO_LINE = "Gifts, deals and codes"; | const GIFT_PROMO_LINE = "Gifts, deals and codes, picked by a Louisiana nurse";
 * @mutate src/components/GiftGuidesPromo.tsx |   if (where === "home") { |   if (false) {
 * @mutate src/pages/home/HomeDashboard.tsx |         {promoShows && <Suspense fallback={<div aria-hidden data-gift-promo-hold="" className="h-14 sm:h-12" />}><GiftGuidesPromo where="home" /></Suspense>}\n | \n
 * @mutate src/pages/home/HomeDashboard.tsx | <Suspense fallback={<div aria-hidden data-gift-promo-hold="" className="h-14 sm:h-12" />}> | <Suspense fallback={null}>
 * @mutate src/pages/home/HomeDashboard.tsx | <div data-home-side-card="" className="liquid-glass p-card flex flex-col gap-2 min-w-0 empty:hidden"> | <div data-home-side-card="" className="flex flex-col gap-2 min-w-0">
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GiftGuidesPromo from "@/components/GiftGuidesPromo";
import { giftPromoShows, GIFT_PROMO_KEY } from "@/components/giftGuidesPromoGate";
import { blankComments } from "@/test/helpers/blankNonCode";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
const NOV = new Date(2026, 10, 21);
const draw = (where: "home" | "declutter") => render(<MemoryRouter><GiftGuidesPromo where={where} now={NOV} /></MemoryRouter>).container;

describe("Home's gift guides strip (owner 11-21)", () => {
  it("Home: one slim strip, gift icon + words + chevron + X; no nurse line, no tall tile", () => {
    const c = draw("home");
    const strip = c.querySelector<HTMLElement>("[data-gift-promo=home]")!;
    expect(strip.hasAttribute("data-gift-promo-strip")).toBe(true);
    // The held slot on Home is the strip's own height (phone two lines, one from sm).
    expect(strip.className).toContain("h-14 sm:h-12");
    expect(strip.textContent).toBe("Holiday gift guides · Gifts, deals and codes");
    expect(strip.querySelector("[data-gift-promo-link]")?.getAttribute("href")).toBe("/gift-guides");
    // gift icon + chevron + the X's icon; no 40px tile.
    expect(strip.querySelectorAll("svg").length).toBe(3);
    expect(strip.querySelector(".h-10.w-10")).toBeNull();
    fireEvent.click(strip.querySelector("[data-gift-promo-close]")!);
    expect(c.querySelector("[data-gift-promo]")).toBeNull();
    expect(window.localStorage.getItem(GIFT_PROMO_KEY)).toBe("1");
    expect(giftPromoShows(NOV)).toBe(false);
  });

  it("Declutter keeps its card, with the same words (no nurse line)", () => {
    const c = draw("declutter");
    const card = c.querySelector("[data-gift-promo=declutter]")!;
    expect(card.hasAttribute("data-gift-promo-strip")).toBe(false);
    expect(card.textContent).toContain("Gifts, deals and codes");
    expect(card.textContent).not.toMatch(/nurse/i);
  });

  it("Home places it right under the greeting and date, before the first card, slot held; not in the side column", () => {
    const home = blankComments(readFileSync("src/pages/home/HomeDashboard.tsx", "utf8"));
    const strip = home.indexOf('<GiftGuidesPromo where="home" />');
    expect(strip).toBeGreaterThan(0);
    expect(home.split('<GiftGuidesPromo where="home" />').length).toBe(2);
    expect(home.indexOf("data-home-date")).toBeLessThan(strip);
    expect(home.indexOf("<PageTitleBar")).toBeLessThan(strip);
    expect(strip).toBeLessThan(home.indexOf('data-testid="home-top-loading"'));
    expect(strip).toBeLessThan(home.indexOf("data-home-columns"));
    expect(home).toContain('{promoShows && <Suspense fallback={<div aria-hidden data-gift-promo-hold="" className="h-14 sm:h-12" />}><GiftGuidesPromo where="home" /></Suspense>}');
    expect(home).toContain("const [promoShows] = useState(() => giftPromoShows());");
    expect(strip).toBeLessThan(home.indexOf("<section data-home-side"));
  });

  it("the profile line and Your sections share ONE card; the money tiles follow it", () => {
    const home = blankComments(readFileSync("src/pages/home/HomeDashboard.tsx", "utf8"));
    const side = home.slice(home.indexOf("<section data-home-side"));
    const card = side.indexOf("data-home-side-card");
    const cardTag = side.slice(card, side.indexOf(">", card));
    expect(cardTag).toContain("liquid-glass p-card");
    expect(cardTag).toContain("empty:hidden");
    const order = ["data-home-side-card", "<YourPageLink", 'data-testid="open-customize"', "data-section-chips=", "sections-opening-soon", '<HomeMoneyTiles money={money} placement="side" />'].map((s) => side.indexOf(s));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The card closes before the money tiles.
    const between = side.slice(order[4], order[5]);
    expect(between).toMatch(/<\/div>/);
  });
});
