/**
 * A Helpr who cancelled is told so (Jobs audit 10-30, JOBS-21).
 *
 * helper_cancel_booking closed the application 'rejected' with closed_reason NULL, which reads "Not selected this
 * time" / "You weren't picked" to the Helpr and "Declined" to the poster. Nobody declined anyone.
 * PGlite proof (old body RED, new migration 3x GREEN): src/test/pglite/helperCancelSaysWhy.pglite.mjs
 *
 * @mutate supabase/migrations/20261031013445_helper_cancel_says_why.sql |          closed_reason = 'helper_cancelled'\n |          closed_reason = NULL\n
 * @mutate src/pages/posts/postedJobs/applicantBadge.ts |   helper_cancelled: "Cancelled", |   helper_cancelled: "Declined",
 * @mutate src/components/job-card/jobStatusLine.ts |   if (app.status === "rejected" && app.closed_reason === "helper_cancelled") return "helper_cancelled"; |
 * @mutate src/pages/jobs/jobPage/viewerState.ts |     if (app.status === "rejected" && app.closed_reason === "helper_cancelled") return { action: { kind: "none" }, status: "You cancelled this job" }; |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { helperStatusLine } from "@/components/job-card/jobStatusLine";
import { posterApplicantBadge } from "@/pages/posts/postedJobs/applicantBadge";
import { jobPageViewerState } from "@/pages/jobs/jobPage/viewerState";
import { closedCardLabel } from "@/pages/jobs/appliedJobCard/appliedJobCardHelpers";

describe("the Helpr's own cancel", () => {
  const closed = { status: "rejected", closed_reason: "helper_cancelled" };
  it("the Helpr's card, closed card and job page say they cancelled", () => {
    const line = helperStatusLine({ id: "a", job: { id: "j", status: "open", helper_id: null }, helper_id: "me", ...closed } as never, false);
    expect(line.id).toBe("helper_cancelled");
    expect(line.detail).toBe("You cancelled this job");
    expect(closedCardLabel(closed)).toBe("You cancelled this job");
    const page = jobPageViewerState({ isPoster: false, onCrew: false, userId: "me", posterFirst: "Rhonda", job: { status: "open", helper_id: null }, myApplication: closed } as never);
    expect(page.status).toBe("You cancelled this job");
  });
  it("the poster's list says Cancelled, not Declined", () => {
    expect(posterApplicantBadge(closed)).toEqual({ label: "Cancelled", kind: "closed" });
  });
  it("a passed-over applicant keeps Not selected", () => {
    const page = jobPageViewerState({ isPoster: false, onCrew: false, userId: "me", posterFirst: "Rhonda", job: { status: "open", helper_id: null }, myApplication: { status: "rejected", closed_reason: null } } as never);
    expect(page.status).toBe("Not selected this time");
  });
  it("the newest constraint admits the reason", () => {
    const sql = readFileSync(resolve(__dirname, "../..", "supabase/migrations/20261031013445_helper_cancel_says_why.sql"), "utf8");
    expect(sql).toMatch(/applications_closed_reason_check[\s\S]*'helper_cancelled'/);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.helper_cancel_booking(uuid) FROM PUBLIC, anon;");
  });
});
