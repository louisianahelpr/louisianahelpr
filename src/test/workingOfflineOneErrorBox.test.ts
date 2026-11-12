/**
 * F280a (whole-app audit 11-10, offline in the app): the Working tab showed two stacked error boxes. With the tab's
 * own read failed and nothing to list, ActivityEmptyState draws the page's ErrorState, and the quotes block above it
 * (JobListQuotes, on for testers) drew its own inline ErrorState for the same failed connection. The empty branch now
 * mounts the quotes block only while the tab's read has not failed, so one box says it.
 *
 * @mutate src/components/job-card/JobListPage.tsx | {!loadError && <JobListQuotesSlot tab={tab} className="mx-4 mt-3" />} | <JobListQuotesSlot tab={tab} className="mx-4 mt-3" />
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

const page = blankComments(readFileSync("src/components/job-card/JobListPage.tsx", "utf8"));
const empty = blankComments(readFileSync("src/components/job-card/ActivityEmptyState.tsx", "utf8"));
const quotes = blankComments(readFileSync("src/components/quotes/JobListQuotes.tsx", "utf8"));

describe("F280a a failed Working/Posted read shows one error box, not two", () => {
  it("the two boxes it guards against both exist", () => {
    expect(empty).toMatch(/if \(loadError && totalCount === 0\)[\s\S]{0,200}<ErrorState onRetry=\{onRetry\} \/>/);
    expect(quotes.match(/<ErrorState variant="inline"/g)?.length ?? 0).toBeGreaterThan(1);
  });

  it("the empty branch mounts the quotes block only when the tab's read did not fail", () => {
    const a = page.indexOf("{showEmptyState ? (");
    const b = page.indexOf("<ActivityEmptyState", a);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    const branch = page.slice(a, b);
    const slots = branch.match(/[^\n]*<JobListQuotesSlot[^\n]*/g) ?? [];
    expect(slots.length).toBe(1);
    expect(slots[0]).toMatch(/\{!loadError && <JobListQuotesSlot /);
  });
});
