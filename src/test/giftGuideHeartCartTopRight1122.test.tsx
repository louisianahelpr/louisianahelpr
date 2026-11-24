/**
 * HEART AND CART: ON THE PHOTO'S TOP-RIGHT ON A COMPUTER, AT THE ROW'S BOTTOM-RIGHT ON A PHONE.
 *
 * Owner 2026-11-22, reviewing the live guides: "move the heart and shopping cart back to the top right of picture. maybe
 * put the shopping cart below the heart instead of on the side". Then, later the same day, from her phone (a screenshot of
 * the Her guide): "On the phone the heart goes in the bottom right below the price and the cart goes on the left of that.
 * The computer stays the same like those 2 icons can stay in the picture."
 *
 * So, on every guide row (one PickRow: Her/Him/Kids, the 25 Days sponsors page, the finder's results): from 768px the
 * 44px heart sits on the photo's top-right and an Amazon pick's 44px cart directly under it (unchanged); below 768px
 * both leave the 88px photo for ONE line at the row's bottom-right, under the price, the cart left of the heart, and the
 * name column keeps a 44px strip at its foot so a name or the chips never run under them. Both stay outside the card's
 * link, with no circle behind either (owner 11-21). The landing's Top 10 card (photo on top at every width) keeps the
 * heart and cart on its photo.
 *
 * The geometry is read from the stylesheet itself. Measured in Chromium on 2026-11-22 (local build of this branch, every
 * drawn row of Her at 320/375/414 and Kids at 375): phone heart box at the row's right edge and bottom (Her 375: row
 * 335x104, heart at x 291, y 60; cart at x 247, y 60; price at x 291, y 14), 0 icon boxes over a photo, name, price or
 * chip row; a row with a code chip grows to 125px with the heart under the chip. Her at 1440: heart 2px in from the
 * card's top-right, cart 44px under it, exactly as before the change.
 *
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-list>:where([data-gift-pick])>.gg-heart-pick{bottom:0;right:0;justify-content:flex-end} | .gg-list>:where([data-gift-pick])>.gg-heart-pick{top:4px;left:54px;justify-content:flex-end}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-list>:where([data-gift-pick])>.gg-cart{bottom:0;right:44px;justify-content:flex-end} | .gg-list>:where([data-gift-pick])>.gg-cart{bottom:44px;right:0;justify-content:flex-end}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-list>:where([data-gift-pick]) .gg-nm{padding-bottom:44px} | .gg-list>:where([data-gift-pick]) .gg-nm{padding-bottom:0}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | @media (max-width:767px){\n.gg-list>:where([data-gift-pick])>.gg-heart-pick | @media (min-width:0px){\n.gg-list>:where([data-gift-pick])>.gg-heart-pick
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-list .gg-heart-pick,.gg-list .gg-cart{position:absolute;z-index:1} | .gg-list .gg-heart-pick,.gg-list .gg-cart{position:absolute;top:4px;left:54px;z-index:1}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-list .gg-cart{top:46px;left:auto;right:2px} | .gg-list .gg-cart{top:2px;left:auto;right:46px}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-top10 .gg-cart{position:absolute;top:46px;right:2px;z-index:1} | .gg-top10 .gg-cart{position:absolute;bottom:-10px;right:-10px;z-index:1}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-top10 .gg-heart-pick,.gg-top10 .gg-cart{left:auto;bottom:auto;justify-content:center} | .gg-top10 .gg-heart-pick,.gg-top10 .gg-cart{left:auto}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-cart:hover{color:hsl(var(--bark))} | .gg-cart:hover{background:var(--gg-soft)}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { loadAllGuidePicks } from "@/content/giftGuideCatalog";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";

await loadAllGuidePicks();
afterEach(cleanup);

const rule = (selector: string, from = 0) => {
  const at = GIFT_GUIDES_CSS.indexOf(`${selector}{`, from);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  const body = GIFT_GUIDES_CSS.slice(at + selector.length + 1, GIFT_GUIDES_CSS.indexOf("}", at));
  return Object.fromEntries(body.split(";").filter(Boolean).map((d) => d.split(":").map((x) => x.trim()) as [string, string]));
};
const px = (v: string | undefined) => Number(/^(-?\d+)px$/.exec(v ?? "")?.[1] ?? NaN);
const TAP = 44;
const DESKTOP = GIFT_GUIDES_CSS.indexOf("@media (min-width:768px){\n.gg-list .gg-heart-pick");

const PHONE = GIFT_GUIDES_CSS.indexOf("@media (max-width:767px){\n.gg-list>:where([data-gift-pick])>.gg-heart-pick");
const ROW = ".gg-list>:where([data-gift-pick])";

describe("heart and cart: on the photo on a computer, at the row's bottom-right on a phone (owner 2026-11-22)", () => {
  it("phone row: one line at the row's bottom-right under the price, the cart directly left of the heart, off the photo", () => {
    expect(PHONE, "the phone placement lives in the phone breakpoint").toBeGreaterThan(0);
    const phoneEnd = GIFT_GUIDES_CSS.indexOf("\n}\n", PHONE);
    const heartAt = GIFT_GUIDES_CSS.indexOf(`${ROW}>.gg-heart-pick{`, PHONE);
    const cartAt = GIFT_GUIDES_CSS.indexOf(`${ROW}>.gg-cart{`, PHONE);
    const stripAt = GIFT_GUIDES_CSS.indexOf(`${ROW} .gg-nm{`, PHONE);
    for (const at of [heartAt, cartAt, stripAt]) expect(at > PHONE && at < phoneEnd).toBe(true);
    const heart = rule(`${ROW}>.gg-heart-pick`, PHONE);
    const cart = rule(`${ROW}>.gg-cart`, PHONE);
    // The base rule gives both their layer and nothing else: no top/left that would park them on the 88px photo.
    expect(rule(".gg-list .gg-heart-pick,.gg-list .gg-cart")).toEqual({ position: "absolute", "z-index": "1" });
    for (const box of [heart, cart]) {
      expect(box.top).toBeUndefined();
      expect(box.left).toBeUndefined();
      expect(box.bottom).toBe("0");
      // Each icon sits at its box's right edge, so the heart's icon lines up under the price's right edge.
      expect(box["justify-content"]).toBe("flex-end");
    }
    // One line: same bottom; the heart at the row's right edge (where the price column ends); the cart's box ends
    // exactly where the heart's begins.
    expect(heart.right).toBe("0");
    expect(px(cart.right)).toBe(TAP);
    // The name column keeps a strip as tall as the icons at its foot, so a name or the chips never sit under them.
    expect(px(rule(`${ROW} .gg-nm`, PHONE)["padding-bottom"])).toBe(TAP);
    // The price stays top-right beside the name's first line (owner 11-21), so the icons are below it.
    expect(rule(".gg-list .gg-nm .gg-nm-meta")).toMatchObject({ "grid-column": "2", "grid-row": "1" });
  });

  it("tablet and desktop cards (photo on top): the column is 2px in from the photo's top-right, cart under heart", () => {
    expect(DESKTOP).toBeGreaterThan(0);
    const heart = rule(".gg-list .gg-heart-pick", DESKTOP);
    const cart = rule(".gg-list .gg-cart", DESKTOP);
    expect([heart.top, heart.right, heart.left]).toEqual(["2px", "2px", "auto"]);
    expect([cart.top, cart.right, cart.left]).toEqual([`${2 + TAP}px`, "2px", "auto"]);
  });

  it("the Top 10 card: the heart on the photo's top-right and the cart under it (not at the end of the price line)", () => {
    expect(rule(".gg-top10 .gg-heart-pick")).toMatchObject({ position: "absolute", top: "2px", right: "2px" });
    expect(rule(".gg-top10 .gg-cart")).toMatchObject({ position: "absolute", top: `${2 + TAP}px`, right: "2px" });
    // Neither takes the phone row's bottom-right line: the Top 10's own rules come later at the same weight and reset it.
    expect(rule(".gg-top10 .gg-heart-pick,.gg-top10 .gg-cart")).toEqual({ left: "auto", bottom: "auto", "justify-content": "center" });
    expect(rule(".gg-top10 .gg-nm")["padding-bottom"]).toBe("0");
    // Owner 2026-11-24 10:36 AM: no "shop similar" on the Top 10, so no card keeps a strip under the price for it.
    expect(GIFT_GUIDES_CSS).not.toContain(".gg-top10>li:has(");
    expect(GIFT_GUIDES_CSS.indexOf(".gg-top10 .gg-nm{")).toBeGreaterThan(GIFT_GUIDES_CSS.indexOf(`${ROW} .gg-nm{`));
    expect(GIFT_GUIDES_CSS.indexOf(".gg-top10 .gg-heart-pick,.gg-top10 .gg-cart{")).toBeGreaterThan(PHONE);
    expect(rule(".gg-top10 .gg-nm .gg-nm-meta")["padding-right"]).toBeUndefined();
  });

  it("44px tap targets, no circle behind the cart (no hover fill), a white halo like the heart's; no page keeps its own placement", () => {
    expect(rule(".gg-cart")).toMatchObject({ width: "44px", height: "44px" });
    expect(rule(".gg-heart")).toMatchObject({ width: "44px", height: "44px", background: "transparent" });
    expect(rule(".gg-cart:hover").background).toBeUndefined();
    expect(rule(".gg-cart svg").filter).toMatch(/drop-shadow/);
    expect(GIFT_GUIDES_CSS).not.toMatch(/\[data-gift-guide="[^"]+"\] \.gg-list \.gg-heart-pick/);
    // The phone's strip under the name is the only room kept for them (no unscoped strip, no space beside the chips).
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-list \.gg-nm\{padding-bottom:/);
    expect(rule(".gg-list .gg-badges")["padding-right"]).toBeUndefined();
  });

  it("on Her, Him and Kids every Amazon card draws the heart then the cart, both outside the card's link; other stores no cart", async () => {
    let carts = 0;
    for (const slug of ["her", "him", "kids"]) {
      let c!: HTMLElement;
      await act(async () => {
        c = render(
          <MemoryRouter initialEntries={[`/gift-guides/${slug}`]}>
            <Routes><Route path="/gift-guides/:slug" element={<GiftGuides />} /></Routes>
          </MemoryRouter>,
        ).container;
      });
      for (const li of c.querySelectorAll("ol.gg-list > li[data-gift-pick]")) {
        const heart = li.querySelector(":scope > button.gg-heart-pick");
        const cart = li.querySelector(":scope > a.gg-cart");
        const link = li.querySelector(":scope > a[data-gift-title-link]")!;
        expect(heart, slug).not.toBeNull();
        expect(link.contains(heart), slug).toBe(false);
        const amazon = /^https:\/\/(www\.)?amazon\.com\//.test(link.getAttribute("href") ?? "");
        if (!amazon) { expect(cart, slug).toBeNull(); continue; }
        expect(cart, `${slug}: an Amazon card's cart`).not.toBeNull();
        expect(heart!.compareDocumentPosition(cart!) & Node.DOCUMENT_POSITION_FOLLOWING, slug).toBeTruthy();
        carts++;
      }
      cleanup();
    }
    expect(carts).toBeGreaterThan(100);
  });
});
