/**
 * Owner, 2026-10-07: a posted job whose only applicant's offer expired showed
 * "No applicants yet" collapsed and "Applicants (1)" open. "Still show the
 * number of applications ... it either needs to be offered, expired or
 * declined."
 *
 * The class: once anyone applied, the collapsed card never says nobody did,
 * and it names each closed application with the SAME badge words the
 * applicant list shows (posterApplicantBadge), so the two surfaces agree.
 *
 * @mutate src/pages/posts/postedJobCard/PosterStatusStrip.tsx | return line.id === "no_applicants" && closedApplicants ? { ...line, detail: closedApplicants } : line; | return line;
 * @mutate src/pages/posts/postedJobs/applicantBadge.ts |     const badge = posterApplicantBadge(a); |     const badge = { label: "Declined" };
 */
import { describe, expect, it } from "vitest";
import { posterStatusLine } from "@/components/job-card/jobStatusLine";
import type { Job } from "@/components/job-card/activityConstants";
import { closedApplicantsSummary, posterApplicantBadge } from "@/pages/posts/postedJobs/applicantBadge";
import { withClosedApplicants } from "@/pages/posts/postedJobCard/PosterStatusStrip";

const openJob = {
  id: "j1",
  status: "open",
  title: "clean",
  date_needed: "2099-01-09",
  start_time: "14:00:00",
  expires_at: "2099-01-09T19:00:00Z",
  direct_offer_status: null,
} as unknown as Job;

const expired = { status: "rejected", closed_reason: "offer_expired" };
const declined = { status: "rejected", closed_reason: null };
const blocked = { status: "rejected", closed_reason: "party_blocked" };
const cancelled = { status: "rejected", closed_reason: "job_cancelled" };

function collapsedDetail(apps: { status: string; closed_reason: string | null }[]): string {
  const line = posterStatusLine(openJob, 0, new Date("2026-10-07T12:00:00Z"));
  return withClosedApplicants(line, closedApplicantsSummary(apps)).detail ?? "";
}

describe("a posted job someone applied to never reads 'No applicants yet'", () => {
  it("the owner's case: one offer that expired", () => {
    expect(collapsedDetail([expired])).toBe("1 applicant · offer expired");
  });

  it("declined, and a mix", () => {
    expect(collapsedDetail([declined])).toBe("1 applicant · declined");
    expect(collapsedDetail([declined, expired, blocked])).toBe("3 applicants · 2 declined, 1 offer expired");
  });

  it("every closed reason the badge names is named with the badge's own words", () => {
    for (const a of [expired, declined, blocked]) {
      const badge = posterApplicantBadge(a)!.label.toLowerCase();
      expect(collapsedDetail([a])).toContain(badge);
      expect(collapsedDetail([a])).not.toBe("No applicants yet");
    }
  });

  it("with nothing to name (no applications, or only a job cancel) it stays 'No applicants yet'", () => {
    expect(collapsedDetail([])).toBe("No applicants yet");
    expect(collapsedDetail([cancelled])).toBe("No applicants yet");
  });

  it("a waiting applicant keeps the applicants line (the summary only replaces the empty one)", () => {
    const line = posterStatusLine(openJob, 1, new Date("2026-10-07T12:00:00Z"));
    expect(withClosedApplicants(line, "1 applicant · declined")).toBe(line);
  });
});
