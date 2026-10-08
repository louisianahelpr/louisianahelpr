/**
 * Owner, 2026-10-08 (Q1575): "if someone declines an offer or cancels instead
 * of accept confirmation the other person needs to be very aware so they don't
 * show up or expect someone and they had no idea".
 *
 * The class: an open back-out notice puts its job in Needs You on BOTH tabs,
 * whatever else is true of it, and the banner names who and what.
 *
 * @mutate src/components/job-card/activityFilters.ts |   if ((j as { backout_notice?: unknown }).backout_notice) return "needs_you"; |
 * @mutate src/components/job-card/activityFilters.ts |   if ((app.job as { backout_notice?: unknown } \| null)?.backout_notice) return "needs_you"; |
 */
import { describe, expect, it } from "vitest";
import { appliedActivityBucket, postedActivityBucket } from "@/components/job-card/activityFilters";
import { backoutBannerText } from "@/lib/backoutNotices";
import type { AppliedApp } from "@/components/job-card/activityConstants";

const notice = (backout_kind: string, actor_name: string | null = "Lexi") => ({ id: "n", job_id: "j", backout_kind, actor_name });

describe("a back-out keeps the card in Needs You until Got It", () => {
  it("poster: a reopened job with no applicants would be Waiting; with the notice it is Needs You", () => {
    const job = { id: "j", status: "open", date_needed: "2099-01-01", expires_at: "2099-01-01T00:00:00Z" };
    expect(postedActivityBucket(job, 0)).toBe("waiting");
    expect(postedActivityBucket({ ...job, backout_notice: notice("helper_cancelled") } as never, 0)).toBe("needs_you");
  });
  it("Helpr: a cancelled job would be Cancelled; with the notice it is Needs You", () => {
    const app = (extra: object) => ({ id: "a", job_id: "j", helper_id: "h", status: "rejected", job: { id: "j", status: "cancelled", ...extra } }) as unknown as AppliedApp;
    expect(appliedActivityBucket(app({}))).toBe("cancelled");
    expect(appliedActivityBucket(app({ backout_notice: notice("poster_cancelled", "Sam") }))).toBe("needs_you");
  });
  it("the banner names who and what", () => {
    expect(backoutBannerText(notice("helper_cancelled") as never)).toBe("Lexi cancelled. They won't be coming.");
    expect(backoutBannerText(notice("poster_cancelled", "Sam") as never)).toBe("Sam cancelled this job. Don't go.");
    expect(backoutBannerText(notice("offer_declined") as never)).toMatch(/^Lexi declined your offer/);
    expect(backoutBannerText(notice("offer_expired", null) as never)).toMatch(/expired without an answer/);
  });
});
