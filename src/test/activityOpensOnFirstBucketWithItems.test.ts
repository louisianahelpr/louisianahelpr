/**
 * Owner, 2026-10-08: "if there is nothing in needs you for my post, it should
 * auto open on waiting instead, if there is nothing in waiting then it goes to
 * scheduled and so on. same for my jobs." My Posts and My Jobs open on the
 * first bucket, in tab order, that holds anything.
 *
 * @mutate src/components/job-card/activityConstants.ts |   return order.find((k) => (counts[k] ?? 0) > 0) ?? preferred; |   return preferred;
 * @mutate src/components/job-card/JobListPage.tsx |     if (next !== statusFilter) setStatusFilter(next); |     void next;
 * @mutate src/components/job-card/JobListPage.tsx |     setLinkedJobMissing(!!deepLinkJobId && !named); |     void named;
 * @mutate src/components/job-card/JobListPage.tsx |     if (!linkedJobMissing \|\| loading) return; |     return;
 * @mutate src/components/job-card/JobListPage.tsx |  && !jobIsUnfundedDraft(j)) |)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { firstBucketWithItems } from "@/components/job-card/activityConstants";
import { POSTED_STATUS_FILTERS, APPLIED_STATUS_FILTERS } from "@/components/job-card/activityFilters";

const ORDER = POSTED_STATUS_FILTERS.map((f) => f.key);

describe("Activity opens on the first bucket that has anything", () => {
  it("both tabs walk the same order: needs you, waiting, scheduled, done, cancelled", () => {
    expect(ORDER).toEqual(["needs_you", "waiting", "scheduled", "done", "cancelled"]);
    expect(APPLIED_STATUS_FILTERS.map((f) => f.key)).toEqual(ORDER);
  });

  it("Needs you when it holds anything; otherwise the next non-empty bucket", () => {
    expect(firstBucketWithItems(ORDER, { needs_you: 1, waiting: 3 }, "needs_you")).toBe("needs_you");
    expect(firstBucketWithItems(ORDER, { needs_you: 0, waiting: 2, scheduled: 1 }, "needs_you")).toBe("waiting");
    expect(firstBucketWithItems(ORDER, { needs_you: 0, waiting: 0, scheduled: 4 }, "needs_you")).toBe("scheduled");
    expect(firstBucketWithItems(ORDER, { done: 5, cancelled: 1 }, "needs_you")).toBe("done");
    expect(firstBucketWithItems(ORDER, { cancelled: 1 }, "needs_you")).toBe("cancelled");
  });

  it("everything empty stays on Needs you", () => {
    expect(firstBucketWithItems(ORDER, {}, "needs_you")).toBe("needs_you");
  });

  // Q1668 (found 2026-10-12 in e2e-journeys 38181872855): a notification link
  // to a job My Posts does not list (cancelled, never paid) landed on a view
  // with no word about the job. Now the page says so and falls back to the
  // first bucket with anything.
  it("a link to a job the list does not hold says so and opens the first bucket with anything", () => {
    const src = readFileSync(join(process.cwd(), "src/components/job-card/JobListPage.tsx"), "utf8");
    const resolve = src.slice(src.indexOf("deepLinkResolvedFor.current = deepLinkKey;"), src.indexOf("let bucket: string | null = null;"));
    expect(resolve).toMatch(/setLinkedJobMissing\(!!deepLinkJobId && !named\);/);
    // A never-paid job sits in postedJobs but My Posts never shows it.
    expect(src).toMatch(/postedJobs\.some\(\(j\) => j\.id === \(deepLinkJobId \?\? highlightJobId\) && !jobIsUnfundedDraft\(j\)\)/);
    const fallback = src.slice(src.indexOf("if (!linkedJobMissing || loading) return;"), src.indexOf("}, [linkedJobMissing, loading]);"));
    expect(fallback).toMatch(/firstBucketWithItems\(activeStatusFilters\.map/);
    expect(fallback).toMatch(/setStatusFilter\(next\)/);
    expect(src).toMatch(/\{linkedJobMissing && \([\s\S]{0,300}That job is no longer on \{tab === "posted" \? "My Posts" : "My Jobs"\}\./);
  });

  it("the page applies it once per tab, only on a plain open (no filter or job in the link)", () => {
    const src = readFileSync(join(process.cwd(), "src/components/job-card/JobListPage.tsx"), "utf8");
    const effect = src.slice(src.indexOf("const openedOnFirstBucketFor"), src.indexOf("}, [loading, tab, activeCounts"));
    expect(effect).toMatch(/if \(deepLinkHadFilter \|\| deepLinkJobId \|\| statusFilter !== defaultFilter\) return;/);
    expect(effect).toMatch(/firstBucketWithItems\(activeStatusFilters\.map/);
    expect(effect).toMatch(/if \(next !== statusFilter\) setStatusFilter\(next\);/);
  });
});
