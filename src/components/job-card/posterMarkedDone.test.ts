import { describe, expect, it } from "vitest";
import { bucketPostedJob, postedActivityBucket } from "./activityFilters";
import { posterStatusLine } from "./jobStatusLine";
import type { Job } from "./activityConstants";

/**
 * Owner 2026-10-25: three refunded jobs "move them to my done", "dont say they
 * were done outside the app. just have them in my done section".
 * jobs.poster_marked_done_at (20261025211357) files a cancelled job under Done
 * and its line reads plain "Done"; status stays 'cancelled' (money untouched).
 *
 * @mutate src/components/job-card/activityFilters.ts |   return j.status === "cancelled" && !!j.poster_marked_done_at; |   return false;
 */
const cancelled = { status: "cancelled", payment_status: "refunded", cancellation_reason: "Expired" } as const;
const marked = { ...cancelled, poster_marked_done_at: "2026-10-25T21:00:00Z" };

describe("a cancelled job marked done sits in the poster's Done list", () => {
  it("files under Done, not Cancelled, in both bucketers", () => {
    expect(postedActivityBucket(marked, 0)).toBe("done");
    expect(bucketPostedJob(marked)).toBe("completed");
  });

  it("control: unmarked, it stays Cancelled", () => {
    expect(postedActivityBucket(cancelled, 0)).toBe("cancelled");
    expect(bucketPostedJob(cancelled)).toBe("cancelled");
  });

  it("its line reads just Done: no cancel reason, no refund, no 'outside the app'", () => {
    const line = posterStatusLine(marked as unknown as Job, 0);
    expect(line.id).toBe("done_marked");
    expect(line.detail).toBe("Done");
    expect(line.suffix).toBeNull();
    expect(`${line.eyebrow} ${line.detail}`).not.toMatch(/cancel|refund|outside|app/i);
  });
});
