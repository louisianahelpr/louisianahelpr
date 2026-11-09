/**
 * Owner UI audit 2026-11-09, F104 (HIGH, data): Posted > Done listed "Trim tree branches", "Clean a 2-bedroom house"
 * and "Detail Kia Telluride" while Receipts said "Cancelled · refunded". Measured on prod: all three (375000de,
 * 9c321fed, 1251173a) expired with nobody hired (cancellation_reason "Job listing expired...", no cancelled_by) and
 * carry poster_marked_done_at from a 10-25 support flag. Owner 11-09: one job status everywhere; owner 10-31: an
 * expired listing is Expired, never Cancelled and never Done. The flag stays in the data; it is ignored for an
 * expired listing in every place that reads it.
 *
 * Inventory: every src/ reader of poster_marked_done_at (tracked files, comments blanked) must be one of the
 * readers below, each checked by behaviour here.
 *
 * @mutate src/components/job-card/activityFilters.ts |   return j.status === "cancelled" && !!j.poster_marked_done_at && !isExpiredListing(j); |   return j.status === "cancelled" && !!j.poster_marked_done_at;
 * @mutate src/components/job-card/jobStatusLine.ts |       return job.poster_marked_done_at && !isExpiredListing(job) ? "done_marked" : "cancelled"; |       return job.poster_marked_done_at ? "done_marked" : "cancelled";
 * @mutate src/lib/expiredListing.ts |   return isExpiredListing(job) ? "Expired" : "Cancelled"; |   return "Cancelled";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";
import { bucketPostedJob, postedActivityBucket } from "@/components/job-card/activityFilters";
import { derivePosterWait } from "@/components/job-card/jobStatusLine";
import { cancelledStatusWord, EXPIRED_LISTING_REASON_PREFIX } from "@/lib/expiredListing";
import type { Job } from "@/components/job-card/activityConstants";

const ROOT = resolve(__dirname, "../..");
const FLAG = "2026-10-25T22:35:01Z";
const expired = {
  id: "375000de", status: "cancelled", helper_id: null, cancelled_by: null, poster_marked_done_at: FLAG,
  cancellation_reason: `${EXPIRED_LISTING_REASON_PREFIX} — scheduled time passed with no Helpr assigned`,
  payment_status: "refunded", date_needed: "2026-10-24",
};
const posterCancelled = { ...expired, id: "x", cancelled_by: "poster-1", cancellation_reason: "Changed my mind" };

describe("an expired listing never lands in Done (F104)", () => {
  it("the Posted buckets file it as cancelled/expired, whatever poster_marked_done_at says", () => {
    expect(bucketPostedJob(expired)).toBe("cancelled");
    expect(postedActivityBucket(expired as never)).toBe("cancelled");
  });

  it("its status line is never 'Done'", () => {
    expect(derivePosterWait(expired as unknown as Job)).not.toBe("done_marked");
  });

  it("Receipts says Expired", () => {
    expect(cancelledStatusWord(expired)).toBe("Expired");
    expect(cancelledStatusWord(posterCancelled)).toBe("Cancelled");
  });

  it("the 10-25 flag still files a real (non-expired) cancelled job under Done", () => {
    expect(bucketPostedJob(posterCancelled)).toBe("completed");
    expect(postedActivityBucket(posterCancelled as never)).toBe("done");
    expect(derivePosterWait(posterCancelled as unknown as Job)).toBe("done_marked");
  });

  it("every reader of poster_marked_done_at is one checked here", () => {
    const readers = trackedFiles("src")
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|\/src\/test\/|^src\/test\/|integrations\//.test(f))
      .filter((f) => /poster_marked_done_at\b(?!["'`,])/.test(blankComments(readFileSync(resolve(ROOT, f), "utf8"))))
      .map((f) => relative(ROOT, resolve(ROOT, f)));
    expect(readers.length).toBeGreaterThan(1);
    expect(readers.sort()).toEqual(["src/components/job-card/activityFilters.ts", "src/components/job-card/jobStatusLine.ts"]);
  });
});
