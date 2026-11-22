/**
 * Owner 2026-11-22: "make the header consistent on EVERY Holiday gift guides sub-page. Black Friday, Small Business
 * Saturday and Cyber Monday are already right: back arrow, then 'Holiday gift guides' to the right of the back button,
 * and the page's own main title BELOW that." Every guides sub-route draws ONE head row (GuidesHeadRow) with the back
 * arrow and "Holiday gift guides" (a plain line, not the h1), and the page's own title as its only h1, below that row.
 *
 * @mutate src/pages/info/giftGuides/fun/FunPage.tsx |       <GiftGuidesWords lead="" title={title} titleId="gift-page-title" tools={null} />\n | \n
 * @mutate src/pages/info/giftGuides/GuidesHeadRow.tsx | : <p className="text-page-title leading-tight" data-gift-head-name="">{G.headerTitle}</p>} | : <p className="text-page-title leading-tight" data-gift-head-name="">Gift guides</p>}
 * @mutate src/pages/info/GiftGuides.tsx | titleIsH1={!banner} | titleIsH1
 * @mutate src/pages/info/giftGuides/printables/NameMaker.tsx | grid-template-columns:repeat(3,minmax(0,1fr));align-items:start; | grid-template-columns:repeat(3,minmax(0,1fr));
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-top10 .gg-nm{display:flex;flex:1;flex-direction:column;padding-bottom:0} | .gg-top10 .gg-nm{padding-bottom:0}
 *
 * Also two owner bugs from the same night, read from the shipped CSS:
 *  - Gift tags (owner 11-22, "why does it click like this?"): a chosen tag's cell hugs the tag; it stretched to the
 *    row's tallest name with an empty gray box under it, and the label's focus ring ran the whole height.
 *  - Top 10 (owner 11-22, the price-top-right card "is only for product listings, common sense"): the name, then the
 *    price on its own line under it, not the listing's name-left / price-right grid.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/sbsFeaturedApi", () => ({
  listFeaturedLocal: vi.fn(async () => []),
  sbsLogoUrl: (id: string) => `https://x.invalid/logo?${id}`,
  sbsDeviceId: () => "test-device-0001",
  submitFeaturedLocal: vi.fn(async () => ({ ok: true })),
}));

import GiftGuides from "@/pages/info/GiftGuides";
import Printables from "@/pages/info/giftGuides/printables/Printables";
import SwipeGifts from "@/pages/info/giftGuides/fun/SwipeGifts";
import SecretSanta from "@/pages/info/giftGuides/fun/SecretSanta";
import GiftPlanner from "@/pages/info/giftGuides/fun/GiftPlanner";
import ShopSmall from "@/pages/info/ShopSmall";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";

afterEach(cleanup);

/** Every route reached from the guides menu, with the words its own h1 must hold. */
const PAGES: [url: string, title: RegExp][] = [
  ["/gift-guides/her", /Her/],
  ["/gift-guides/him", /Him/],
  ["/gift-guides/kids", /Kids/],
  ["/gift-guides/black-friday", /Black Friday/],
  ["/gift-guides/small-business-saturday", /Small Business Saturday/],
  ["/gift-guides/cyber-monday", /Cyber Monday/],
  ["/gift-guides/printables/gift-tags", /tags/i],
  ["/gift-guides/printables/coloring-books", /coloring/i],
  ["/gift-guides/printables/banners", /banner/i],
  ["/gift-guides/swipe", /swipe/i],
  ["/gift-guides/draw-names", /secret santa/i],
  ["/gift-guides/planner", /planner/i],
  ["/shop-small", /shop small/i],
];

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/gift-guides/printables/*" element={<Printables />} />
        <Route path="/gift-guides/swipe" element={<SwipeGifts />} />
        <Route path="/gift-guides/draw-names" element={<SecretSanta />} />
        <Route path="/gift-guides/planner" element={<GiftPlanner />} />
        <Route path="/gift-guides/:slug" element={<GiftGuides />} />
        <Route path="/shop-small" element={<ShopSmall />} />
      </Routes>
    </MemoryRouter>,
  );

describe("every Holiday gift guides sub-page: 'Holiday gift guides' by the back arrow, its own title below (owner 11-22)", () => {
  it.each(PAGES)("%s", async (url, title) => {
    const { container } = renderAt(url);
    await waitFor(() => expect(container.querySelector("h1")).not.toBeNull());
    const rows = container.querySelectorAll("[data-gift-headrow]");
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.querySelector("[data-gift-back-to]")?.getAttribute("data-gift-back-to")).toBe("/gift-guides");
    expect(row.querySelector("[data-gift-back-to] button[aria-label]")).not.toBeNull();
    const name = row.querySelector("[data-gift-head-name]");
    expect(name?.textContent).toBe("Holiday gift guides");
    expect(name?.tagName).toBe("P");
    // The page's own title is its one h1, outside the row and after it.
    const h1s = [...container.querySelectorAll("h1")];
    expect(h1s.length).toBe(1);
    expect(row.contains(h1s[0])).toBe(false);
    expect(row.compareDocumentPosition(h1s[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(h1s[0].textContent).toMatch(title);
  });
});

describe("one head row component, so the pages cannot drift apart again", () => {
  const files = [...readdirSync("src/pages/info/giftGuides", { recursive: true }).map((f) => `src/pages/info/giftGuides/${f}`), "src/pages/info/GiftGuides.tsx", "src/pages/info/ShopSmall.tsx"].filter((f) => f.endsWith(".tsx"));

  it("only GuidesHeadRow draws the head row; every page with one uses it", () => {
    expect(files.length).toBeGreaterThan(20); // inventory floor: ~40 .tsx files under the guides on 2026-11-22
    const drawers = files.filter((f) => /data-gift-headrow=/.test(blankComments(readFileSync(f, "utf8"))));
    expect(drawers).toEqual(["src/pages/info/giftGuides/GuidesHeadRow.tsx"]);
    const users = files.filter((f) => /<GuidesHeadRow\b/.test(blankComments(readFileSync(f, "utf8"))));
    expect(users.sort()).toEqual(["src/pages/info/GiftGuides.tsx", "src/pages/info/giftGuides/fun/FunPage.tsx"]);
  });

  it("every /gift-guides route in App.tsx renders GiftGuides or a page in the shared frame (FunBody / GuidesFrame)", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const routes = [...app.matchAll(/<Route path="(\/gift-guides[^"]*|\/shop-small)" element=\{.*?<(\w+) \/>/g)].map((m) => [m[1], m[2]] as const);
    expect(routes.length).toBeGreaterThan(6); // inventory floor: 9 routes on 2026-11-22
    const imports = Object.fromEntries([...app.matchAll(/const (\w+) = lazyWithPreload\(\(\) => import\("\.\/([^"]+)"\)\)/g)].map((m) => [m[1], `src/${m[2]}.tsx`]));
    const loose = routes.filter(([, comp]) => {
      if (comp === "GiftGuides") return false;
      const src = imports[comp] ? blankComments(readFileSync(imports[comp], "utf8")) : "";
      return !/<FunBody\b|<GuidesFrame\b/.test(src);
    });
    expect(loose).toEqual([]);
  });
});

describe("the same night's two card fixes", () => {
  it("a gift tag cell hugs its tag (no stretched chosen box); the keyboard ring is on the cell, not a full-height label", () => {
    const css = blankComments(readFileSync("src/pages/info/giftGuides/printables/NameMaker.tsx", "utf8"));
    const grid = css.match(/\.pr-designs\{[^}]*\}/)?.[0] ?? "";
    expect(grid).toMatch(/align-items:start/);
    expect(css).not.toMatch(/\.pr-design:focus-within\{/);
    expect(css).toMatch(/\.pr-design-cell:has\(\.pr-design input:focus-visible\)\{outline:2px solid/);
  });

  it("a Top 10 card: heart top-right and rank top-left on the photo; the name, then the price under it", () => {
    const css = blankComments(GIFT_GUIDES_CSS);
    expect(css).toMatch(/\.gg-top10 \.gg-heart-pick\{position:absolute;top:2px;right:2px/);
    expect(css).toMatch(/\.gg-rank\{position:absolute;top:6px;left:6px/);
    const nm = [...css.matchAll(/\.gg-top10 \.gg-nm\{([^}]*)\}/g)].map((m) => m[1]).join(";");
    expect(nm).toMatch(/display:flex/);
    expect(nm).toMatch(/flex-direction:column/);
  });
});
