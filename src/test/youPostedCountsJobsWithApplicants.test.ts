/**
 * F260a (whole-app audit 11-10, You tab, as the Helpr test account): "Jobs Posted · 1 live" while the account had two
 * funded open jobs ("Wash two cars" had an applicant waiting). The tile counts every live post, "waiting for
 * applicants or booked" (useHomeSummary), but an open job with applicants to answer is bucketed Needs you, so it fell
 * out of the count. postedJobIsLive counts it; an expired listing, a cancelled or a finished one stay out. Measured on
 * prod 11-14: 7b923b19 has open/escrow x2 and open/unpaid x1, so the tile should read 2.
 *
 * @mutate src/components/job-card/activityFilters.ts |   return pendingApplicantCount > 0 && j.status === "open" && postedActivityBucket(j, 0, now) === "waiting"; |   return false;
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts |     const postedLive = pj.filter((j) => postedJobIsLive(j, posted.pendingApplicantCounts?.[j.id] ?? 0)); |     const postedLive = pj.filter((j) => ["waiting", "scheduled"].includes(postedActivityBucket(j, posted.pendingApplicantCounts?.[j.id] ?? 0)));
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { postedJobIsLive } from "@/components/job-card/activityFilters";
import { blankComments } from "@/test/helpers/blankNonCode";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

// The real clock, not a fixed day: postedActivityBucket's "today is live" rule reads todayMs() (src/lib/jobDate.ts), which
// takes no clock argument, so the fixed NOW of 2026-11-14 put the job day (NOW + 6) on the real today from 2026-11-20 and
// the job bucketed Needs you (CI #4779 shard 3, 2026-11-20). Every date here is relative to the same NOW.
const NOW = new Date();
const inHours = (h: number) => new Date(NOW.getTime() + h * 3600_000).toISOString();
const open = (over: Record<string, unknown> = {}) => ({
  status: "open", payment_status: "escrow", date_needed: jobLocalDateISO(6, NOW), start_time: "09:00:00", expires_at: inHours(7 * 24), helper_id: null, ...over,
});

describe("F260a: the You tab's Posted tile counts every live post", () => {
  it("an open funded job is live with no applicants AND with applicants to answer", () => {
    expect(postedJobIsLive(open(), 0, NOW)).toBe(true);
    expect(postedJobIsLive(open(), 1, NOW)).toBe(true);
    expect(postedJobIsLive(open(), 3, NOW)).toBe(true);
  });

  it("an expired listing, a cancelled or finished job stay out, applicants or not", () => {
    expect(postedJobIsLive(open({ expires_at: inHours(-6) }), 1, NOW)).toBe(false);
    expect(postedJobIsLive(open({ status: "cancelled" }), 1, NOW)).toBe(false);
    expect(postedJobIsLive(open({ status: "completed" }), 0, NOW)).toBe(false);
  });

  it("the tile reads postedJobIsLive", () => {
    const summary = blankComments(readFileSync("src/pages/home/homeDashboard/useHomeSummary.ts", "utf8"));
    expect(summary).toContain("const postedLive = pj.filter((j) => postedJobIsLive(j, posted.pendingApplicantCounts?.[j.id] ?? 0));");
  });
});
