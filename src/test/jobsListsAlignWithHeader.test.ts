/**
 * Q2222 (dashboards build run 4, 2026-10-19, 320 + 375 shots): the Jobs lists sat 16px
 * inside the section header (cards at x=37 under a search row at x=25), and at
 * 320 a feed card cut its start time to "⏱ 1". Every Jobs list (the Browse
 * feed, its loading bones, Posted / Working and their bones) now uses the
 * header's own phone inset (px-1; the desktop strip keeps lg:px-4). The card's
 * start time is owner-protected (browseCardKeepsPlaceAndTime: never hidden by a
 * width rule); the meta row's two-line layout below 360px is
 * browseCardMetaTwoLinesBelow360.test.ts.
 *
 * @mutate src/components/dashboard/MainFeedSection.tsx |       className="px-1 lg:px-4 pt-3" |       className="px-4 pt-3"
 * @mutate src/components/job-card/JobListPage.tsx | "flex-1 min-h-0 px-1 lg:px-4 pt-3 pb-0" | "flex-1 min-h-0 px-4 pt-3 pb-0"
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const code = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));
const INSET = "px-1 lg:px-4";

describe("Jobs lists line up with the section header (Q2222)", () => {
  it("the header's phone inset is px-1", () => {
    expect(code("src/pages/jobs/JobsSection.tsx")).toMatch(/<div className="flex flex-col gap-3 px-1">/);
  });

  it("the feed, its bones, Posted / Working and their bones all use that inset", () => {
    const sites: Array<[string, RegExp]> = [
      ["src/components/dashboard/MainFeedSection.tsx", /className="px-1 lg:px-4 pt-3"/],
      ["src/components/dashboard/BrowseTasksFeed.tsx", /className="px-1 lg:px-4 pt-3 pb-1 space-y-list"/],
      ["src/components/job-card/JobListPage.tsx", /"flex-1 min-h-0 px-1 lg:px-4 pt-3 pb-0"/],
      ["src/components/JobsSectionSkeleton.tsx", /className="flex-1 min-h-0 px-1 lg:px-4 pt-3 pb-0 space-y-list"/],
    ];
    expect(sites.length).toBeGreaterThan(3);
    for (const [f, re] of sites) expect(code(f), f).toMatch(re);
    expect(INSET).toBe("px-1 lg:px-4");
  });
});
