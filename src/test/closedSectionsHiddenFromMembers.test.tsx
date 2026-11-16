/**
 * M8/M9 (iOS design audit 11-16; owner decision 11-16): "hide Shops and Homes from members everywhere (Home, the tab
 * bar, Create, Customize, Settings) until they launch. The Create sheet copy should match ('two ways')." and "hide
 * the Homes tab from members entirely". Admins and testers keep their existing access (shops and rentals are
 * audience=testers on prod, read 11-16).
 *
 * Every one of those surfaces filters on the ONE `listed` answer from useSectionTabs (sectionListedHere). This file
 * pins that answer for a member and a tester, on the website and in the app, and the Create sheet's count line. The
 * per-surface renders: navSoonAndTopMessages (bar), centerCreateNav (Create), customizeBoard90 (Customize),
 * youBoard18 (You and Home's line), nothingComingSoonInTheApp and sectionNavTabs (Explore), search tests (Search).
 *
 * @mutate src/lib/hideUnopenedInApp.ts |   if (!tab.on) return false; |   if (!tab.on && hideUnopenedInApp()) return false;
 * @mutate src/components/mobileNav/useSectionTabs.ts | listed: sectionListedHere({ on: on[s.feature] \|\| OPEN_FOR_THOSE_WHO_HAVE_IT.has(s.feature), preview }) | listed: sectionListedHere({ on: on[s.feature], preview })
 * @mutate src/components/create/CreateSheet.tsx | {waysLine(visible.length)} | One account, four ways to get things done.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const env = vi.hoisted(() => ({ native: false, on: new Set<string>(["declutter"]) }));
vi.mock("@/lib/nativeInit", async (orig) => ({ ...(await orig<object>()), get isNativePlatform() { return env.native; } }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => env.on.has(k), useFeatureStatus: (k: string) => ({ on: env.on.has(k), settled: true }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
// Only Declutter is open to everyone (prod, 11-16).
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => new Set(["declutter"]) }));

import { useSectionTabs } from "@/components/mobileNav/useSectionTabs";
import { waysLine } from "@/components/create/CreateSheet";

function Listed() {
  const tabs = useSectionTabs();
  return <p data-listed="">{tabs.filter((t) => t.listed).map((t) => t.label).join(",")}</p>;
}
const listed = () => {
  render(<Listed />);
  const out = document.querySelector("[data-listed]")!.textContent!.split(",").filter(Boolean);
  cleanup();
  return out;
};

afterEach(() => { cleanup(); env.native = false; env.on = new Set(["declutter"]); });

describe("Shops and Homes are hidden from members until they launch (M8/M9)", () => {
  it("found the section tabs (inventory)", () => {
    env.on = new Set(["declutter", "shops", "rentals"]);
    expect(listed().length).toBeGreaterThan(2);
  });

  it("a member: Declutter only, on the website and in the app", () => {
    expect(listed()).toEqual(["Declutter"]);
    env.native = true;
    expect(listed()).toEqual(["Declutter"]);
  });

  it("a tester keeps Shops and Homes on the website (the app keeps leaving previews out of these lists)", () => {
    env.on = new Set(["declutter", "shops", "rentals"]);
    expect(listed()).toEqual(["Declutter", "Shops", "Homes"]);
    env.native = true;
    expect(listed()).toEqual(["Declutter"]);
  });

  it("Declutter stays listed while its switch read is out, so its tab never pops in late", () => {
    env.on = new Set();
    expect(listed()).toEqual(["Declutter"]);
  });

  it("the Create sheet's line counts the sections shown", () => {
    expect(waysLine(2)).toBe("One account, two ways to get things done.");
    expect(waysLine(4)).toBe("One account, four ways to get things done.");
    expect(waysLine(1)).toBe("One account to get things done.");
  });
});
