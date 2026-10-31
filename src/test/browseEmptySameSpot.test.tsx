/**
 * Owner 2026-10-30: the Browse empty state sits in the same spot on Jobs and Declutter. Both (and Free) use the ONE shared
 * BrowseEmptyState, and its place comes from the screen, never from what sits above it.
 *
 * @mutate src/components/dashboard/BrowseTasksFeed.tsx | <BrowseEmptyState | <EmptyState variant="bare"
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | <BrowseEmptyState | <EmptyState variant="bare"
 * @mutate src/components/declutter/DeclutterFreeView.tsx | <BrowseEmptyState | <EmptyState variant="bare"
 * @mutate src/components/ui/BrowseEmptyState.tsx |   return (nav && nav.height > 0 ? nav.top : innerHeight) / 2; |   return innerHeight / 2;
 * @mutate src/components/ui/BrowseEmptyState.tsx |   return Math.max(highest, Math.round(screenMid - natural)); |   return 0;
 * @mutate src/components/ui/BrowseEmptyState.tsx |   return Math.max(highest, Math.round(screenMid - natural)); |   return Math.round(screenMid - natural);
 * @mutate src/components/ui/BrowseEmptyState.tsx | "pointer-events-none flex min-h-0 | "flex min-h-0
 * @mutate src/components/ui/BrowseEmptyState.tsx | [&_[data-empty-state]>*]:pointer-events-auto | [&_[data-empty-state]>*]:opacity-100
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { browseEmptyScreenMid, browseEmptyShift, SHIFTED_LAYER } from "@/components/ui/BrowseEmptyState";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));
const SCREENS = ["src/components/dashboard/BrowseTasksFeed.tsx", "src/components/declutter/DeclutterBrowseView.tsx", "src/components/declutter/DeclutterFreeView.tsx"];

describe("Browse empty states share one spot", () => {
  // Audit SS-9: moved up, the layer's empty top lay over "Save this search" and took its press. The press itself is
  // proved in a browser (jsdom has no hit test): ~/.lh-shots/b65-saved-search/.
  it("the moved layer takes no press, except on the card's own content", () => {
    expect(SHIFTED_LAYER.split(" ")).toEqual(expect.arrayContaining(["pointer-events-none", "[&_[data-empty-state]>*]:pointer-events-auto"]));
  });
  it.each(SCREENS)("%s uses the shared layout, no bare EmptyState", (file) => {
    const src = read(file);
    expect(src).toContain("<BrowseEmptyState");
    expect(src).not.toMatch(/<EmptyState\s+variant="bare"/);
  });
  it("centres above the bottom nav, measured from the nav, and on the whole screen when it is hidden", () => {
    expect(browseEmptyScreenMid(800, { top: 700, height: 100 })).toBe(350);
    expect(browseEmptyScreenMid(800, { top: 0, height: 0 })).toBe(400);
    expect(browseEmptyScreenMid(800, null)).toBe(400);
    const src = read("src/components/ui/BrowseEmptyState.tsx");
    expect(src).toContain('document.querySelector(".mobile-nav-frame")');
    expect(src).not.toContain("--bottom-nav-h\")");
  });
  it("lands on the same screen line whatever sits above it", () => {
    const mid = 358;
    for (const top of [160, 180, 200]) {
      const room = { top, height: 716 - top };
      expect(room.top + room.height / 2 + browseEmptyShift(room, 300, mid)).toBe(mid);
    }
  });
  it("never rises over what sits above it, and does nothing unmeasured", () => {
    const room = { top: 400, height: 316 };
    const shift = browseEmptyShift(room, 300, 358);
    expect(room.top + room.height / 2 + shift - 150).toBe(room.top);
    expect(browseEmptyShift({ top: 0, height: 0 }, 0, 358)).toBe(0);
  });
});
