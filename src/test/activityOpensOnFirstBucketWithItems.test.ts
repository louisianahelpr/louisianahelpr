/**
 * Owner, 2026-10-08: "if there is nothing in needs you for my post, it should
 * auto open on waiting instead, if there is nothing in waiting then it goes to
 * scheduled and so on. same for my jobs." My Posts and My Jobs open on the
 * first bucket, in tab order, that holds anything.
 *
 * @mutate src/components/job-card/activityConstants.ts |   return order.find((k) => (counts[k] ?? 0) > 0) ?? preferred; |   return preferred;
 * @mutate src/components/job-card/JobListPage.tsx |     if (next !== statusFilter) setStatusFilter(next); |     void next;
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

  it("the page applies it once per tab, only on a plain open (no filter or job in the link)", () => {
    const src = readFileSync(join(process.cwd(), "src/components/job-card/JobListPage.tsx"), "utf8");
    const effect = src.slice(src.indexOf("const openedOnFirstBucketFor"), src.indexOf("}, [loading, tab, activeCounts"));
    expect(effect).toMatch(/if \(deepLinkHadFilter \|\| deepLinkJobId \|\| statusFilter !== defaultFilter\) return;/);
    expect(effect).toMatch(/firstBucketWithItems\(activeStatusFilters\.map/);
    expect(effect).toMatch(/if \(next !== statusFilter\) setStatusFilter\(next\);/);
  });
});
