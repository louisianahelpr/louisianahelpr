/**
 * The guest feed grid is never capped narrow on desktop (Q1035).
 *
 * The mocked e2e/visual-audit/desktop-fill.spec.ts measured /browse's feed grid
 * at 1440px (93% of the viewport) from seeded jobs. It moved to the real
 * backend as e2e/journeys/visual-desktop-fill.spec.ts on 2026-11-05, but that
 * row could not move with it: the grid only exists when prod has open jobs, and
 * open_jobs_browse held 0 rows (read-only, 05:00:21Z 2026-11-05). So the
 * defect class it caught, a content column stranded narrow in a wide viewport,
 * is pinned here at source level: the one shared class string has no width cap,
 * and both the loading bone and the loaded guest feed draw with it.
 *
 * Its @mutate came with it (capping the grid dropped /browse to 27% there).
 * @mutate src/components/GuestBrowseSkeleton.tsx | md:grid-cols-2 md:gap-4"; | md:grid-cols-2 md:gap-4 max-w-sm";
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const code = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));
const BONE = code("src/components/GuestBrowseSkeleton.tsx");
const FEED = code("src/pages/home/DashboardGuest.tsx");

describe("the guest feed grid fills a desktop viewport", () => {
  it("the shared grid class has two columns from md and no width cap", () => {
    const m = /export const GUEST_FEED_GRID_CLASS = "([^"]+)";/.exec(BONE);
    expect(m, "GUEST_FEED_GRID_CLASS is declared in GuestBrowseSkeleton.tsx").toBeTruthy();
    const cls = m![1].split(/\s+/);
    expect(cls).toContain("md:grid-cols-2");
    expect(cls.filter((c) => /(^|:)max-w-/.test(c) || /(^|:)w-(?!full)/.test(c)), "no width cap on the feed grid").toEqual([]);
  });

  it("the loaded guest feed draws with the same class", () => {
    expect(FEED).toMatch(/GUEST_FEED_GRID_CLASS/);
  });
});
