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

/*
 * THE TITLE ROW IS THE LOADED ROW (loading-states-refresh 36158775025,
 * customer /jobs #0: "0 placeholder rows -> 2 real"). The placeholder drew one
 * 128px bar alone in a 44px box where PostsHeader / JobsHeader render a
 * ScreenHeaderRow: the screen's name, then a cluster of two 44px controls
 * (search, filter chevron). It is now that same ScreenHeaderRow, with the name
 * (known before any data) and one bone per control, and the screen keeps ONE
 * h1 while pending (LoadingHeading's; the row's title is decorative).
 *
 * @mutate src/components/ActivityPageSkeleton.tsx |             <Skeleton className="h-11 w-11 rounded-ds-md" />\n            <Skeleton className="h-11 w-11 rounded-ds-md" />\n | \n
 * @mutate src/components/ActivityPageSkeleton.tsx |         decorativeTitle\n | \n
 */
describe("the Activity placeholder's title row is the loaded header row", () => {
  for (const tab of ["posted", "applied"] as const) {
    const path = tab === "posted" ? "/posts" : "/jobs";
    const title = tab === "posted" ? "My Posts" : "My Jobs";

    it(`${path}: the screen's name plus one bone per header control, and a single h1`, () => {
      window.history.replaceState(null, "", path);
      const { container } = render(<ActivityPageSkeleton tab={tab} />);
      const name = [...container.querySelectorAll("span[aria-hidden]")].find((e) => e.textContent === title);
      expect(name, "the row shows the screen's name").toBeTruthy();
      const row = name!.parentElement!.parentElement!;
      const cluster = row.lastElementChild!;
      expect(cluster.children).toHaveLength(2);
      for (const bone of cluster.children) expect(bone.className).toMatch(/\bh-11\b.*\bw-11\b/);
      expect(container.querySelectorAll("h1")).toHaveLength(1);
    });
  }
});
