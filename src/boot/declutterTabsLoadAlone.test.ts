/**
 * EACH /declutter TAB DOWNLOADS ONLY ITS OWN CODE (B77, 2026-11-01, "Nothing slow for users").
 *
 * Measured before (cwv-lab, customer, 375 Slow 4G + 4x CPU, median of 3; critical-path on the CI-env build): every tab
 * imported statically, so Declutter's page closure was 608 KB gz (350 past boot) and downloaded beside the boot JS; the
 * app first drew at 5.7 s on every tab. After: Browse 514 KB gz (DeclutterPage + DeclutterBrowseView), Buying/Selling
 * 567 (DeclutterPage + DeclutterMineViews); appDrawn 5.16 s (Browse) and 5.47 s (Selling, Buying).
 *
 * (a) DeclutterHomeView reaches no tab's code statically: Buying/Selling (DeclutterMineViews), Browse
 *     (DeclutterBrowseView), Wanted, Free and the manage sheet are lazy.
 * (b) DeclutterPage reaches neither the checkout (DeclutterTradeViews: the agreed-sales view) nor the two chats.
 * (c) src/boot/declutterRoute.ts starts the URL's tab beside the page, by the same URL reading as the page, so a tab
 *     costs no extra network round; critical-path.mjs's /declutter rows walk those preload lists.
 * (d) Q178 (11-20): Buying (DeclutterBuyingViews) and Selling (DeclutterMineViews) are two modules, and neither reaches
 *     the other's code: in one module the Selling tab downloaded the cart, checkout and order tracker (main
 *     236f6db2ad: /declutter?tab=selling 552 KB gz; split, 487; critical-path.mjs's /declutter?tab=buying row is Buying).
 *
 * @mutate src/components/declutter/DeclutterHomeView.tsx | import { useArrivalGate } from "@/hooks/useArrivalGate"; | import { useArrivalGate } from "@/hooks/useArrivalGate";\nimport { BuyingDash as _B } from "./DeclutterMineViews";
 * @mutate src/components/declutter/DeclutterHomeView.tsx | import type { DeclutterBrowseHeader, DeclutterChrome } from "./DeclutterBrowseView"; | import { type DeclutterBrowseHeader, type DeclutterChrome } from "./DeclutterBrowseView";
 * @mutate src/pages/declutter/DeclutterPage.tsx | import { lazy, Suspense, useEffect } from "react"; | import { lazy, Suspense, useEffect } from "react";\nimport "@/components/declutter/DeclutterTradeViews";
 * @mutate src/components/declutter/DeclutterHomeView.tsx | import { SectionHeading, StrikeCount, useDeclutterTodo } from "./DeclutterTabHeads"; | import { SectionHeading, StrikeCount, useDeclutterTodo } from "./DeclutterTabParts";
 * @mutate src/boot/declutterRoute.ts |   if (tab === "free") return () => import("@/components/declutter/DeclutterFreeView"); |
 * @mutate src/boot/declutterRoute.ts |   if (tab === "selling") return () => import("@/components/declutter/DeclutterMineViews"); |   if (tab === "selling") return () => import("@/components/declutter/DeclutterBrowseView");
 * @mutate src/boot/declutterRoute.ts |   if (tab === "buying") return () => import("@/components/declutter/DeclutterBuyingViews"); |   if (tab === "buying") return () => Promise.all([import("@/components/declutter/DeclutterMineViews"), import("@/components/declutter/DeclutterBuyingViews")]);
 * @mutate src/components/declutter/DeclutterMineViews.tsx | import { PaidOrders } from "./DeclutterTabParts"; | import { PaidOrders } from "./DeclutterTradeViews";
 * @mutate src/components/declutter/DeclutterMineViews.tsx | import { useEndedSales } from "./DeclutterEndedSales"; | import { useEndedSales } from "./DeclutterEndedSales";\nimport "./DeclutterBuyingViews";
 * @mutate src/components/declutter/DeclutterBuyingViews.tsx | import { useMyTrades } from "./useMyTrades"; | import { useMyTrades } from "./useMyTrades";\nimport "./ShopSaleCard";
 * @mutate src/boot/declutterRoute.ts | if (tabChunk) tabChunk().catch(() => { | if (false) tabChunk().catch(() => {
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { staticReach } from "../../scripts/perf/bootReach.mjs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const reach = (file: string) => [...staticReach(ROOT, [resolve(ROOT, file)])].map((f) => f.replace(`${ROOT}/`, ""));

const loaded: string[] = [];
function mockTabs() {
  for (const m of ["DeclutterMineViews", "DeclutterBuyingViews", "DeclutterBrowseView", "DeclutterWantedViews", "DeclutterFreeView"]) {
    vi.doMock(`@/components/declutter/${m}`, () => {
      loaded.push(m);
      return {};
    });
  }
}
vi.mock("@/pages/declutter/DeclutterPage", () => ({ default: () => null }));

afterEach(() => {
  loaded.length = 0;
  vi.resetModules();
});

describe("each /declutter tab downloads only its own code", () => {
  it("(a) the home view reaches no tab's code; (b) the page reaches neither the checkout nor the chats", () => {
    const home = reach("src/components/declutter/DeclutterHomeView.tsx");
    expect(home.length).toBeGreaterThan(40);
    for (const lazy of ["DeclutterMineViews", "DeclutterBuyingViews", "DeclutterBrowseView", "DeclutterWantedViews", "DeclutterFreeView", "DeclutterManageListing", "DeclutterTradeViews", "DeclutterTabParts", "DeclutterHandoverViews", "BuyingOrders"]) {
      expect(home.filter((f) => f.endsWith(`/${lazy}.tsx`)), lazy).toEqual([]);
    }
    const page = reach("src/pages/declutter/DeclutterPage.tsx");
    for (const lazy of ["DeclutterTradeViews", "DeclutterHandoverTalk", "DeclutterOrderTalk"]) {
      expect(page.filter((f) => f.endsWith(`/${lazy}.tsx`)), lazy).toEqual([]);
    }
  });

  it("(d) Selling reaches none of Buying's code, and Buying none of Selling's seller tools", () => {
    const selling = reach("src/components/declutter/DeclutterMineViews.tsx");
    const buying = reach("src/components/declutter/DeclutterBuyingViews.tsx");
    // Inventory floor: both walks read a real graph (the order views each tab shares are in both).
    expect(selling.length).toBeGreaterThan(100);
    expect(buying.length).toBeGreaterThan(100);
    for (const shared of ["DeclutterOffersSection", "DeclutterTabParts", "DeclutterTradeOffers"]) {
      expect(selling.some((f) => f.endsWith(`/${shared}.tsx`)), shared).toBe(true);
      expect(buying.some((f) => f.endsWith(`/${shared}.tsx`)), shared).toBe(true);
    }
    const buyerOnly = ["DeclutterBuyingViews", "DeclutterTradeViews", "BuyingOrders", "DeclutterFreeClaim", "DeclutterPickupDayCard", "DeclutterWatching", "DeclutterCheckoutSummary", "DeclutterGiftPicker", "ShipToMe"];
    for (const m of buyerOnly) expect(selling.filter((f) => f.endsWith(`/${m}.tsx`)), m).toEqual([]);
    const sellerOnly = ["DeclutterMineViews", "SellingHome", "ShopSaleCard", "AwayMode", "SellerPayoutPrompt", "DeclutterTradesPrompt", "DeclutterTakenDown"];
    for (const m of sellerOnly) expect(buying.filter((f) => f.endsWith(`/${m}.tsx`)), m).toEqual([]);
  });

  it.each([
    ["", "DeclutterBrowseView"],
    ["?tab=selling", "DeclutterMineViews"],
    ["?tab=buying", "DeclutterBuyingViews"],
    ["?view=cart", "DeclutterBuyingViews"],
    ["?view=mine", "DeclutterMineViews"],
    ["?view=offers", "DeclutterMineViews+DeclutterBuyingViews"],
    ["?tab=free", "DeclutterFreeView"],
    ["?tab=wanted", "DeclutterWantedViews"],
    ["?tab=deliver", null],
  ])("(c) /declutter%s starts %s beside the page", async (search, chunk) => {
    mockTabs();
    window.history.replaceState(null, "", `/declutter${search}`);
    await import("./declutterRoute");
    await new Promise((r) => setTimeout(r, 0));
    if (chunk) await vi.waitFor(() => expect([...loaded].sort()).toEqual(chunk.split("+").sort()));
    else expect(loaded).toEqual([]);
  });
});
