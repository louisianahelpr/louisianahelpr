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
 * @mutate src/components/mobileNav/useSectionTabs.ts | listed: sectionListedHere({ on: on[s.feature] \|\| OPEN_FOR_THOSE_WHO_HAVE_IT.has(s.feature), preview: unlaunched }) | listed: sectionListedHere({ on: on[s.feature], preview: unlaunched })
 * @mutate src/components/mobileNav/useSectionTabs.ts |     const unlaunched = !OPEN_FOR_THOSE_WHO_HAVE_IT.has(s.feature) && !openToEveryone?.has(s.feature); |     const unlaunched = !OPEN_FOR_THOSE_WHO_HAVE_IT.has(s.feature) && openToEveryone !== null && !openToEveryone.has(s.feature);
 * @mutate src/lib/hideUnopenedInApp.ts |   return !tab.preview; |   return !hideUnopenedInApp() \|\| !tab.preview;
 * @mutate src/components/create/CreateSheet.tsx | {waysLine(visible.length)} | One account, four ways to get things done.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const env = vi.hoisted(() => ({ native: false, on: new Set<string>(["declutter"]), open: new Set<string>(["declutter"]) as ReadonlySet<string> | null }));
vi.mock("@/lib/nativeInit", async (orig) => ({ ...(await orig<object>()), get isNativePlatform() { return env.native; } }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => env.on.has(k), useFeatureStatus: (k: string) => ({ on: env.on.has(k), settled: true }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
// Only Declutter is open to everyone (prod, 11-16).
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => env.open }));

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

afterEach(() => { cleanup(); env.native = false; env.on = new Set(["declutter"]); env.open = new Set(["declutter"]); });

describe("Shops and Homes are hidden from members until they launch (M8/M9)", () => {
  it("found the section tabs (inventory)", () => {
    env.on = new Set(["declutter", "shops", "rentals"]);
    env.open = new Set(["declutter", "shops", "rentals"]);
    expect(listed().length).toBeGreaterThan(2);
  });

  it("a member: Declutter only, on the website and in the app", () => {
    expect(listed()).toEqual(["Declutter"]);
    env.native = true;
    expect(listed()).toEqual(["Declutter"]);
  });

  it("a tester does not see Shops and Homes either until they launch, on the website and in the app (owner 11-17)", () => {
    env.on = new Set(["declutter", "shops", "rentals"]);
    expect(listed()).toEqual(["Declutter"]);
    env.native = true;
    expect(listed()).toEqual(["Declutter"]);
  });

  it("while the open-to-everyone answer is loading or failed, an unlaunched section stays hidden (no flash)", () => {
    env.on = new Set(["declutter", "shops", "rentals"]);
    env.open = null;
    expect(listed()).toEqual(["Declutter"]);
  });

  it("the day a section opens to everyone it lists again, for testers and members alike", () => {
    env.on = new Set(["declutter", "shops", "rentals"]);
    env.open = new Set(["declutter", "shops"]);
    expect(listed()).toEqual(["Declutter", "Shops"]);
    env.native = true;
    expect(listed()).toEqual(["Declutter", "Shops"]);
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
