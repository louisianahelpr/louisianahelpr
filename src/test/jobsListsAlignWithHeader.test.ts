/**
 * Q2222 (dashboards build run 4, 2026-10-19, 320 + 375 shots): the Jobs lists sat 16px
 * inside the section header (cards at x=37 under a search row at x=25), and at
 * 320 a feed card cut its start time to "⏱ 1". The card's start time is
 * owner-protected (browseCardKeepsPlaceAndTime: never hidden by a width rule);
 * the meta row's two-line layout below 360px is browseCardMetaTwoLinesBelow360.test.ts.
 *
 * ONE SECTION SHELL (owner, 2026-10-19, from iPhone shots of the four
 * sections: "make layout consistent so the shells are in the same place for
 * each"; Jobs sat ~5px further in). The Jobs header has NO phone inset of its
 * own, and every Jobs list (the Browse feed, its loading bones, Posted /
 * Working and their bones) has none either (px-0; the desktop strip keeps
 * lg:px-4): the page's 20px gutter is the inset, as in SectionScreen. The
 * pixels are measured across all four sections by
 * e2e/prod-audit/section-shell-alignment.spec.ts; this pins the classes.
 *
 * @mutate src/components/dashboard/MainFeedSection.tsx |       className="px-0 lg:px-4 pt-1 lg:pt-3" |       className="px-1 lg:px-4 pt-1 lg:pt-3"
 * @mutate src/components/job-card/JobListPage.tsx | "flex-1 min-h-0 px-0 lg:px-4 pt-1 lg:pt-3 pb-0" | "flex-1 min-h-0 px-4 pt-1 lg:pt-3 pb-0"
 * @mutate src/pages/jobs/JobsSection.tsx | className="explore-header flex flex-col gap-1"> | className="explore-header flex flex-col gap-1 px-1">
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const code = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));
const INSET = "px-0 lg:px-4";

describe("Jobs lists line up with the section header, on the shared section gutter (Q2222)", () => {
  it("the header has no phone inset of its own", () => {
    expect(code("src/pages/jobs/JobsSection.tsx")).toMatch(/<div data-explore-header="" className="explore-header flex flex-col gap-1">/);
  });

  it("the feed, its bones, Posted / Working and their bones all use that (no) inset", () => {
    const sites: Array<[string, RegExp]> = [
      ["src/components/dashboard/MainFeedSection.tsx", /className="px-0 lg:px-4 pt-1 lg:pt-3"/],
      ["src/components/dashboard/BrowseTasksFeed.tsx", /className="px-0 lg:px-4 pt-1 lg:pt-3 pb-1 space-y-list"/],
      ["src/components/job-card/JobListPage.tsx", /"flex-1 min-h-0 px-0 lg:px-4 pt-1 lg:pt-3 pb-0"/],
      ["src/components/JobsSectionSkeleton.tsx", /className="flex-1 min-h-0 px-0 lg:px-4 pt-1 lg:pt-3 pb-0 space-y-list"/],
    ];
    expect(sites.length).toBeGreaterThan(3);
    for (const [f, re] of sites) expect(code(f), f).toMatch(re);
    expect(INSET).toBe("px-0 lg:px-4");
  });
});
