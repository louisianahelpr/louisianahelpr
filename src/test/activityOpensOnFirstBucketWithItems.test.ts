/**
 * WHERE JOBS > POSTED / WORKING OPEN, AND HOW THE BOXES FILTER.
 *
 * Re-pointed 2026-10-19 (Q2205). Owner, 2026-10-08: "if there is nothing in
 * needs you for my post, it should auto open on waiting instead ... same for
 * my jobs" — My Posts and My Jobs opened on the first bucket that held
 * anything, so the reader never landed on an empty view while work sat in
 * another one. Owner, 2026-10-19 (final section decisions): Posted / Working
 * open on EVERY group under status boxes — tap a box = only that group, tap
 * it again = all. The intent (never open on an empty view while something
 * else holds items) is now met by construction: every group with items shows.
 * What this pins:
 *   - both tabs walk the same bucket order;
 *   - the page opens on "all" and never auto-switches to one bucket;
 *   - a box toggles its group on and back off to "all".
 *
 * @mutate src/components/job-card/JobListPage.tsx |   const defaultFilter = "all"; |   const defaultFilter = "needs_you";
 * @mutate src/components/job-card/embeddedActivity.tsx |   return current === tapped ? "all" : tapped; |   return tapped;
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POSTED_STATUS_FILTERS, APPLIED_STATUS_FILTERS } from "@/components/job-card/activityFilters";
import { nextBoxFilter, BOX_BUCKETS } from "@/components/job-card/embeddedActivity";
import { blankComments } from "./helpers/blankNonCode";

const ORDER = POSTED_STATUS_FILTERS.map((f) => f.key);
const PAGE = blankComments(readFileSync(join(process.cwd(), "src/components/job-card/JobListPage.tsx"), "utf8"));

describe("Jobs > Posted / Working open on every group", () => {
  it("both tabs walk the same order: needs you, waiting, scheduled, done, cancelled", () => {
    expect(ORDER).toEqual(["needs_you", "waiting", "scheduled", "done", "cancelled"]);
    expect(APPLIED_STATUS_FILTERS.map((f) => f.key)).toEqual(ORDER);
    expect([...BOX_BUCKETS]).toEqual(ORDER.slice(0, 4));
  });

  it("the page opens on 'all' and never moves the reader to one bucket by itself", () => {
    expect(PAGE).toContain('const defaultFilter = "all";');
    expect(PAGE).toMatch(/useState<string>\(\(\) => searchParams\.get\("filter"\) \?\? defaultFilter\)/);
    // No auto-switch effect survives (the 2026-10-08 rule's code).
    expect(PAGE).not.toMatch(/firstBucketWithItems|openedOnFirstBucketFor/);
  });

  it("a box narrows to its group; the lit box tapped again shows every group", () => {
    expect(nextBoxFilter("all", "waiting")).toBe("waiting");
    expect(nextBoxFilter("waiting", "done")).toBe("done");
    expect(nextBoxFilter("done", "done")).toBe("all");
  });
});
