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
 *
 * @mutate src/components/declutter/DeclutterHomeView.tsx | import { useArrivalGate } from "@/hooks/useArrivalGate"; | import { useArrivalGate } from "@/hooks/useArrivalGate";\nimport { BuyingDash as _B } from "./DeclutterMineViews";
 * @mutate src/components/declutter/DeclutterHomeView.tsx | import type { DeclutterBrowseHeader } from "./DeclutterBrowseView"; | import { type DeclutterBrowseHeader } from "./DeclutterBrowseView";
 * @mutate src/pages/declutter/DeclutterPage.tsx | import { lazy, Suspense, useEffect } from "react"; | import { lazy, Suspense, useEffect } from "react";\nimport "@/components/declutter/DeclutterTradeViews";
 * @mutate src/components/declutter/DeclutterHomeView.tsx | import { SectionHeading, useDeclutterTodo } from "./DeclutterTabBadges"; | import { SectionHeading, useDeclutterTodo } from "./DeclutterTabParts";
 * @mutate src/boot/declutterRoute.ts |   if (tab === "free") return () => import("@/components/declutter/DeclutterFreeView"); |
 * @mutate src/boot/declutterRoute.ts |     return () => import("@/components/declutter/DeclutterMineViews"); |     return () => import("@/components/declutter/DeclutterBrowseView");
 * @mutate src/boot/declutterRoute.ts | if (tabChunk) tabChunk().catch(() => { | if (false) tabChunk().catch(() => {
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { staticReach } from "../../scripts/perf/bootReach.mjs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const reach = (file: string) => [...staticReach(ROOT, [resolve(ROOT, file)])].map((f) => f.replace(`${ROOT}/`, ""));

const loaded: string[] = [];
function mockTabs() {
  for (const m of ["DeclutterMineViews", "DeclutterBrowseView", "DeclutterWantedViews", "DeclutterFreeView"]) {
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
    for (const lazy of ["DeclutterMineViews", "DeclutterBrowseView", "DeclutterWantedViews", "DeclutterFreeView", "DeclutterManageListing", "DeclutterTradeViews", "DeclutterTabParts", "DeclutterHandoverViews", "BuyingOrders"]) {
      expect(home.filter((f) => f.endsWith(`/${lazy}.tsx`)), lazy).toEqual([]);
    }
    const page = reach("src/pages/declutter/DeclutterPage.tsx");
    for (const lazy of ["DeclutterTradeViews", "DeclutterHandoverTalk", "DeclutterOrderTalk"]) {
      expect(page.filter((f) => f.endsWith(`/${lazy}.tsx`)), lazy).toEqual([]);
    }
  });

  it.each([
    ["", "DeclutterBrowseView"],
    ["?tab=selling", "DeclutterMineViews"],
    ["?tab=buying", "DeclutterMineViews"],
    ["?view=cart", "DeclutterMineViews"],
    ["?tab=free", "DeclutterFreeView"],
    ["?tab=wanted", "DeclutterWantedViews"],
    ["?tab=deliver", null],
  ])("(c) /declutter%s starts %s beside the page", async (search, chunk) => {
    mockTabs();
    window.history.replaceState(null, "", `/declutter${search}`);
    await import("./declutterRoute");
    await new Promise((r) => setTimeout(r, 0));
    if (chunk) await vi.waitFor(() => expect(loaded).toEqual([chunk]));
    else expect(loaded).toEqual([]);
  });
});
