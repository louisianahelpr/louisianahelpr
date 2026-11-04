// @mutate src/components/profile/ProfileTabFallback.tsx | if (tab === "instant_book" && !instantBookSwitchCachedOn()) return "settings"; | if (false) return "settings";
// @mutate src/components/profile/ProfileTabFallback.tsx | (data !== null && typeof data === "object" && data.instant_book === true)); | (data !== null && typeof data === "object" && data.instant_book === false));
// @mutate src/components/profile/ProfileTabFallback.tsx | export const REVIEW_BLOCK_RESERVE_PX = 213; | export const REVIEW_BLOCK_RESERVE_PX = 96;
// @mutate src/components/profile/ProfileTabFallback.tsx |     <div className="flex justify-end">\n      <Skeleton className="h-9 w-32 rounded-full" />\n    </div>\n |
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ProfileTabBodyReserve, REVIEW_BLOCK_RESERVE_PX, TAB_SHAPES, reserveTabFor } from "@/components/profile/ProfileTabFallback";
import { queryClient } from "@/lib/queryClient";
import { featureSwitchBatchKey, featureSwitchSingleKey } from "@/lib/featureSwitchQuery";

vi.mock("@/components/help/HelpEntry", () => ({ HelpEntry: () => null })); // Its top bar's Help needs the app's providers.

/**
 * Q1695: two profile tab placeholders that the loading-states refresh of 2026-11-03 19:40Z (bot PR #3963,
 * bot/refresh/loading-states a5461a1531, 375, both test accounts) caught lying about the screen that replaces them.
 * src/test/loadingStateShape.test.ts reads a measurement only the bot's browser run can produce, so until its next
 * refresh lands, this file holds the placeholders to the numbers that run recorded.
 *
 *   instant_book: the switch is off for everyone (owner 11-01) and the tab turns into Settings
 *     (useInstantBookTabRedirect); the loading frame drew the instant-book form: rows 6, row 122px -> rows 7,
 *     row 235px (Settings' measured shape, TAB_SHAPES.settings), twice per persona.
 *   reviews: the block under the header is 213px (the loaded frame's median row; rowRect.h 281: the sort strip over
 *     one review card); the bare card measured 96px.
 */
const blockHeights = (root: HTMLElement) =>
  [...root.children].map((el) => (el as HTMLElement).style.height || (el as HTMLElement).style.minHeight);

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe("Q1695 refresh 11-03: instant book waits in Settings' shape while its switch is off", () => {
  it("with no cached switch answer, the tab reserves exactly Settings' blocks", () => {
    expect(reserveTabFor("instant_book")).toBe("settings");
    const r = render(<ProfileTabBodyReserve tab="instant_book" />);
    const settings = render(<ProfileTabBodyReserve tab="settings" />);
    expect(r.container.children.length).toBe(TAB_SHAPES.settings!.length);
    expect(blockHeights(r.container)).toEqual(blockHeights(settings.container));
  });

  it("a cached batch answer saying the switch is ON draws the instant-book form again", () => {
    queryClient.setQueryData(featureSwitchBatchKey("u1"), { instant_book: true });
    expect(reserveTabFor("instant_book")).toBe("instant_book");
    const r = render(<ProfileTabBodyReserve tab="instant_book" />);
    expect(r.container.children.length).toBe(TAB_SHAPES.instant_book!.length);
  });

  it("a cached per-switch ON answer counts too; an OFF answer keeps Settings", () => {
    queryClient.setQueryData(featureSwitchBatchKey("u1"), { instant_book: false });
    expect(reserveTabFor("instant_book")).toBe("settings");
    queryClient.setQueryData(featureSwitchSingleKey("instant_book", "u1"), true);
    expect(reserveTabFor("instant_book")).toBe("instant_book");
  });

  it("every other tab keeps its own shape", () => {
    expect(reserveTabFor("settings")).toBe("settings");
    expect(reserveTabFor("auto_tip")).toBe("auto_tip");
  });
});

describe("Q1695 refresh 11-03: reviews reserve the measured 213px block", () => {
  it("holds the sort strip's bone over the one neutral review row, 213px in all", () => {
    // The loaded frame's median row (rows 2: the 57px header and this block) is 213px; rowRect.h 281.
    expect(REVIEW_BLOCK_RESERVE_PX).toBe(213);
    const r = render(<ProfileTabBodyReserve tab="reviews" />);
    const block = r.container.querySelector("[data-testid='profile-tab-fallback']") as HTMLElement;
    expect(block.style.minHeight).toBe(`${REVIEW_BLOCK_RESERVE_PX}px`);
    expect(block.querySelector(".h-9.rounded-full")).not.toBeNull();
    expect(block.querySelectorAll("[data-review-row-reserve]")).toHaveLength(1);
  });
});
