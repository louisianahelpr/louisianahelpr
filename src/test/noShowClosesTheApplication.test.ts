/**
 * A Helpr reported as a no-show is shown as a no-show (app audit 2026-10-28, A3 / closed_reason 'no_show').
 *
 * THE DEFECT. 20261029154727 (A2-B14) made report_helper_no_show close the struck Helpr's accepted
 * application as 'rejected' with closed_reason NULL, and a reasonless rejection reads "Declined" on the
 * poster's applicant list (posterApplicantBadge) and "You weren't picked" on the Helpr's card
 * (deriveHelperWait). Nobody declined anyone.
 *
 * THE FIX (20261029180706). The same UPDATE now sets closed_reason 'no_show'; the newest
 * applications_closed_reason_check admits it (applicantBadgeCoversClosedReasons keeps the badge map exact
 * both ways). The poster's badge says "No-show"; the Helpr's card, closed card and job page say "The poster
 * reported you didn't show up for this job", and the job page links the strikes rules (/rules#strikes-bans,
 * the "Strikes and bans" section of CommunitySection).
 *
 * @mutate supabase/migrations/20261029180706_application_closed_by_no_show.sql |          closed_reason = 'no_show'\n |          closed_reason = NULL\n
 * @mutate src/pages/posts/postedJobs/applicantBadge.ts |   no_show: "No-show", |   no_show: "Declined",
 * @mutate src/components/job-card/jobStatusLine.ts |   if (app.status === "rejected" && app.closed_reason === "no_show") return "reported_no_show"; |
 * @mutate src/pages/jobs/appliedJobCard/appliedJobCardHelpers.ts |   if (app.closed_reason === "no_show") return "The poster reported you didn't show up for this job"; |
 * @mutate src/pages/jobs/jobPage/viewerState.ts |     if (app.closed_reason === "no_show") return { action: { kind: "none" }, status: "The poster reported you didn't show up for this job" }; |
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | {myApplication.data?.closed_reason === "no_show" && <Link to="/rules#strikes-bans" | {false && <Link to="/rules#strikes-bans"
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { posterApplicantBadge } from "@/pages/posts/postedJobs/applicantBadge";
import { closedCardLabel } from "@/pages/jobs/appliedJobCard/appliedJobCardHelpers";
import { jobPageViewerState } from "@/pages/jobs/jobPage/viewerState";
import { deriveHelperWait, HELPER_WAIT } from "@/components/job-card/jobStatusLine";
import { HELPER_STEP } from "@/components/tracker/jobStepFromWait";

const ROOT = resolve(__dirname, "../..");
const MIG = join(ROOT, "supabase", "migrations");
const SAID = "The poster reported you didn't show up for this job";

describe("a no-show report closes the reported Helpr's application as a no-show", () => {
  const defs = effectiveDefs(MIG);
  const fn = defs.get("report_helper_no_show");

  it("the newest report_helper_no_show closes exactly that Helpr's accepted application with closed_reason 'no_show'", () => {
    expect(defs.size).toBeGreaterThan(100);
    expect(fn?.file).toBe("20261029180706_application_closed_by_no_show.sql");
    const body = blankSqlComments(fn!.stmt).replace(/\s+/g, " ");
    expect(body).toMatch(/UPDATE public\.applications SET status = 'rejected', closed_reason = 'no_show' WHERE job_id = p_job_id AND helper_id = v_helper_id AND status = 'accepted';/);
    // One close, not two: the reason rides on A2-B14's own UPDATE.
    expect(body.match(/UPDATE public\.applications/g)?.length).toBe(1);
  });

  it("the poster's badge says No-show; the Helpr's card, closed card and job page say what happened", () => {
    expect(posterApplicantBadge({ status: "rejected", closed_reason: "no_show" })).toEqual({ label: "No-show", kind: "closed" });
    expect(closedCardLabel({ status: "rejected", closed_reason: "no_show" })).toBe(SAID);
    const app = { status: "rejected", closed_reason: "no_show", job: { id: "j1", status: "open", helper_id: null } } as never;
    expect(deriveHelperWait(app)).toBe("reported_no_show");
    expect(HELPER_WAIT.reported_no_show.detail).toBe(SAID);
    expect(HELPER_STEP.reported_no_show.label).toBe("No-show");
    const v = jobPageViewerState({
      isPoster: false,
      userId: "h1",
      job: { status: "open", helper_id: null, helper_confirmed_at: null } as never,
      myApplication: { status: "rejected", closed_reason: "no_show" },
      posterFirst: "Ana",
    } as never);
    expect(v.status).toBe(SAID);
  });

  it("the job page links the strikes rules, and that anchor exists", () => {
    expect(blankComments(readFileSync(join(ROOT, "src/pages/jobs/jobPage/JobPage.tsx"), "utf8")))
      .toMatch(/\{myApplication\.data\?\.closed_reason === "no_show" && <Link to="\/rules#strikes-bans"/);
    expect(readFileSync(join(ROOT, "src/pages/info/legal/CommunitySection.tsx"), "utf8")).toContain('anchorId="strikes-bans"');
  });
});
