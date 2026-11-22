/**
 * Amazon Buy Now on the guide cards (owner 2026-11-21, pop-up choice "Amazon + Walmart Buy Now"; Walmart not built, no
 * official buy-now link format): an Amazon item's card has a small cart icon under its price that puts that item in the
 * shopper's Amazon cart, credited to our tag. It is its own 44px link outside the card's photo+name link (sponsored,
 * noopener, new tab, like every gift link), said as "Add <name> to your Amazon cart"; other stores' cards have none.
 *
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const cart = amazonCartUrl([pick.href]); |   const cart = amazonCartUrl([pick.href]) ?? pick.href;
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |       {cart && ( |       {false && (
 * @mutate src/lib/retailerCart.ts |   const q = new URLSearchParams({ AssociateTag: AMAZON_TAG }); |   const q = new URLSearchParams({});
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-cart{position:absolute;right:36px;bottom:0;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px; | .gg-cart{position:absolute;right:36px;bottom:0;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PickRow } from "@/pages/info/giftGuides/GiftGuideView";
import { guideBySlug, loadAllGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";
import { amazonAsin } from "@/lib/retailerCart";

await loadAllGuidePicks();
afterEach(cleanup);
const row = (pick: CatalogPick) => render(<MemoryRouter><ol><PickRow pick={pick} guide="her" /></ol></MemoryRouter>).container;

describe("the cart icon on an Amazon card", () => {
  it("an Amazon item: one cart link with its ASIN and our tag, outside the card link, sponsored and in a new tab", () => {
    const amazon = guideBySlug("her")!.picks.filter((p) => /^https:\/\/(www\.)?amazon\.com\/dp\//.test(p.href));
    // Inventory floor: the Her guide carries many Amazon picks today.
    expect(amazon.length).toBeGreaterThan(5);
    for (const pick of amazon.slice(0, 5)) {
      const c = row(pick);
      const carts = [...c.querySelectorAll<HTMLAnchorElement>("a.gg-cart")];
      expect(carts, pick.name).toHaveLength(1);
      const u = new URL(carts[0].href);
      expect(`${u.origin}${u.pathname}`).toBe("https://www.amazon.com/gp/aws/cart/add.html");
      expect(u.searchParams.get("AssociateTag")).toBe("louisianahelpr-20");
      expect(u.searchParams.get("ASIN.1")).toBe(amazonAsin(pick.href));
      expect(amazonAsin(pick.href)).toMatch(/^[A-Z0-9]{10}$/);
      expect(carts[0].getAttribute("rel")).toBe("sponsored noopener");
      expect(carts[0].getAttribute("target")).toBe("_blank");
      expect(c.querySelector("a[data-gift-title-link]")!.contains(carts[0])).toBe(false);
      expect(carts[0].querySelector("[data-gift-cart]")?.textContent).toBe(`Add ${pick.name} to your Amazon cart (opens in a new tab)`);
      cleanup();
    }
  });

  it("another store's item has no cart link", () => {
    const other = guideBySlug("her")!.picks.find((p) => !/^https:\/\/(www\.)?amazon\.com\//.test(p.href))!;
    expect(other).toBeTruthy();
    expect(row(other).querySelector("a.gg-cart")).toBeNull();
  });

  // Owner 11-21 ("should we put the cart by the heart?"): beside the heart at the card's bottom-right, not a row of its own.
  it("the icon is a 44px tap target beside the heart", () => {
    const css = readFileSync(join(process.cwd(), "src/pages/info/giftGuides/giftGuidesStyles.ts"), "utf8");
    expect(css).toContain(".gg-cart{position:absolute;right:36px;bottom:0;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;");
  });
});
