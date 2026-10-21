/**
 * Cowork design audit 2026-10-20:
 *  J10: a typed search with no hits read "No jobs match your filters." with a
 *       "Clear filters" button, though no filter was set.
 *  J8:  the empty feed offered "Post Your First Job" to members who had posted,
 *       in Title Case.
 * The class: the Browse empty state names what is actually narrowing the feed
 * (the search word, the radius, or filters), the same way on the signed-in and
 * guest feeds (both read browseFilteredEmptyCopy), and its buttons never
 * presume a history the person may not have.
 *
 * @mutate src/lib/browseEmptyCopy.ts |   const searchOnly = !!q && i.activeFilterCount <= 1; |   const searchOnly = false;
 * @mutate src/components/dashboard/EmptyFeedActions.tsx | strokeWidth={2.25} />\n        Post a job | strokeWidth={2.25} />\n        Post Your First Job
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { browseFilteredEmptyCopy } from "./browseEmptyCopy";

const base = { nearbyActive: false, currentMiles: 0, nextMiles: 10 };
const ROOT = resolve(__dirname, "../..");

describe("J10: a search miss is named as a search", () => {
  it("search only: the word, and 'Clear search'", () => {
    const c = browseFilteredEmptyCopy({ ...base, searchQuery: "  bookshelf ", activeFilterCount: 1 });
    expect(c.title).toBe("No jobs match “bookshelf”.");
    expect(c.clearLabel).toBe("Clear search");
    expect(`${c.title} ${c.body}`).not.toMatch(/filters?\b/i);
  });
  it("search plus a filter: both named, 'Clear filters'", () => {
    const c = browseFilteredEmptyCopy({ ...base, searchQuery: "bookshelf", activeFilterCount: 2 });
    expect(c.title).toBe("No jobs match “bookshelf” with your filters.");
    expect(c.clearLabel).toBe("Clear filters");
  });
  it("filters only: unchanged sentence; radius only: the radius", () => {
    expect(browseFilteredEmptyCopy({ ...base, searchQuery: "", activeFilterCount: 1 }).title).toBe("No jobs match your filters.");
    expect(browseFilteredEmptyCopy({ ...base, searchQuery: "", activeFilterCount: 1, nearbyActive: true, currentMiles: 10, nextMiles: 25 }).title).toBe("No jobs within 10 mi of you.");
  });
  it("both Browse feeds read it (no hand-written filtered title left)", () => {
    for (const f of ["src/components/dashboard/BrowseTasksFeed.tsx", "src/pages/home/DashboardGuest.tsx"]) {
      const src = blankComments(readFileSync(resolve(ROOT, f), "utf8"));
      expect(src, f).toMatch(/browseFilteredEmptyCopy\(/);
      expect(src, f).not.toMatch(/"No jobs match your filters\."/);
      expect(src, f).not.toMatch(/>\s*Clear filters\s*</);
    }
  });
});

describe("J8: the empty feed's buttons presume nothing", () => {
  it("'Post a job', sentence case, never 'your first'", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "src/components/dashboard/EmptyFeedActions.tsx"), "utf8"));
    expect(src).toMatch(/>\s*Post a job\s*</);
    expect(src).toMatch(/Notify me when one lands/);
    expect(src).not.toMatch(/[Yy]our [Ff]irst/);
  });
});
