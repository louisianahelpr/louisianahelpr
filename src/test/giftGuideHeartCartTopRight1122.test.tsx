/**
 * HEART AND CART ON THE PHOTO'S TOP-RIGHT, CART UNDER THE HEART (owner 2026-11-22, reviewing the live guides: "move the
 * heart and shopping cart back to the top right of picture. maybe put the shopping cart below the heart instead of on
 * the side"). On every guide card (one PickRow: Her/Him/Kids rows, the 25 Days sponsors page, the finder's results and
 * the landing's Top 10) the 44px heart sits on the photo's top-right corner and an Amazon pick's 44px cart directly
 * under it, both outside the card's link, with no circle behind either (owner 11-21) and nothing left under the price.
 *
 * The geometry is read from the stylesheet itself: the phone row's photo size and top padding, and each icon's box,
 * so a moved photo or icon fails here (measured in Chromium on 2026-11-22, Her at 375: heart box 10px past the photo's
 * right edge and 10px above its top, i.e. its 18px icon 12px in from the corner; cart 44px below; at 1440 both 2px in).
 *
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-list .gg-cart{position:absolute;top:48px;left:54px;z-index:1} | .gg-list .gg-cart{position:absolute;top:4px;left:10px;z-index:1}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-list .gg-cart{top:46px;left:auto;right:2px} | .gg-list .gg-cart{top:2px;left:auto;right:46px}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-list .gg-heart-pick{position:absolute;top:4px;left:54px;z-index:1} | .gg-list .gg-heart-pick{position:absolute;top:60px;left:54px;z-index:1}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-top10 .gg-cart{position:absolute;top:46px;right:2px;z-index:1} | .gg-top10 .gg-cart{position:absolute;bottom:-10px;right:-10px;z-index:1}
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

describe("heart and cart sit on the photo's top-right, the cart under the heart (owner 2026-11-22)", () => {
  it("phone row: both 44px boxes are stacked in one column whose icons land inside the 88px photo's top-right", () => {
    const thumb = rule(".gg-list .gg-thumb");
    const photo = px(thumb.width);
    expect(photo).toBe(px(thumb.height));
    const padTop = px(rule(".gg-list .gg-item").padding?.split(" ")[0]);
    const heart = rule(".gg-list .gg-heart-pick");
    const cart = rule(".gg-list .gg-cart");
    expect(heart.position).toBe("absolute");
    expect(cart.position).toBe("absolute");
    expect(heart.bottom).toBeUndefined();
    expect(cart.bottom).toBeUndefined();
    // One column: the same left edge; the cart's box starts where the heart's ends.
    expect(px(cart.left)).toBe(px(heart.left));
    expect(px(cart.top)).toBe(px(heart.top) + TAP);
    // Each icon's centre is inside the photo, in its right half and its top-right quarter for the heart.
    const centre = (box: Record<string, string>) => ({ x: px(box.left) + TAP / 2, y: px(box.top) + TAP / 2 - padTop });
    for (const [name, box] of [["heart", heart], ["cart", cart]] as const) {
      const c = centre(box);
      expect(c.x, name).toBeGreaterThan(photo / 2);
      expect(c.x, name).toBeLessThan(photo);
      expect(c.y, name).toBeGreaterThan(0);
      expect(c.y, name).toBeLessThan(photo);
    }
    expect(centre(heart).y).toBeLessThan(photo / 2);
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
    expect(GIFT_GUIDES_CSS).toContain(".gg-top10 .gg-heart-pick,.gg-top10 .gg-cart{left:auto}");
    expect(rule(".gg-top10 .gg-nm .gg-nm-meta")["padding-right"]).toBeUndefined();
  });

  it("44px tap targets, no circle behind the cart (no hover fill), a white halo like the heart's; no page keeps its own placement", () => {
    expect(rule(".gg-cart")).toMatchObject({ width: "44px", height: "44px" });
    expect(rule(".gg-heart")).toMatchObject({ width: "44px", height: "44px", background: "transparent" });
    expect(rule(".gg-cart:hover").background).toBeUndefined();
    expect(rule(".gg-cart svg").filter).toMatch(/drop-shadow/);
    expect(GIFT_GUIDES_CSS).not.toMatch(/\[data-gift-guide="[^"]+"\] \.gg-list \.gg-heart-pick/);
    // Nothing waits under the price for them any more.
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
