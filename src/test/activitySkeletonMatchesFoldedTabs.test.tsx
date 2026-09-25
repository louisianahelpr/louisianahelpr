/*
 * The My Posts / My Jobs loading placeholder reserves the phone tab row
 * exactly when the loaded header shows it: folded on the default filter,
 * open on any other `?filter=` (owner, 2026-09-25: "open with the chevrons
 * collapsed"). A placeholder that reserves a row the page will not show
 * makes every card jump up when the data lands.
 *
 * @mutate src/components/ActivityPageSkeleton.tsx | {!isWebDesktop && tabRowOpens && ( | {!isWebDesktop && (
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));

import { ActivityPageSkeleton } from "@/components/ActivityPageSkeleton";

/** The reserved tab row's five label bones. */
const tabBones = (c: HTMLElement) => c.querySelectorAll(".flex.items-baseline.gap-3 > *").length;

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("the Activity placeholder reserves the phone tab row only when it will show", () => {
  for (const tab of ["posted", "applied"] as const) {
    const path = tab === "posted" ? "/posts" : "/jobs";

    it(`${path} with no filter: no tab row reserved (it arrives folded)`, () => {
      window.history.replaceState(null, "", path);
      const { container } = render(<ActivityPageSkeleton tab={tab} />);
      expect(tabBones(container)).toBe(0);
    });

    it(`${path}?filter=needs_you (the default): no tab row reserved`, () => {
      window.history.replaceState(null, "", `${path}?filter=needs_you`);
      const { container } = render(<ActivityPageSkeleton tab={tab} />);
      expect(tabBones(container)).toBe(0);
    });

    it(`${path}?filter=cancelled: the tab row is reserved (it arrives open)`, () => {
      window.history.replaceState(null, "", `${path}?filter=cancelled`);
      const { container } = render(<ActivityPageSkeleton tab={tab} />);
      expect(tabBones(container)).toBe(5);
    });
  }
});
