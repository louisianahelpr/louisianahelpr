/**
 * A Helpr reported as a no-show is shown as a no-show (app audit 2026-10-28, A3 / closed_reason 'no_show').
 *
 * THE DEFECT. report_helper_no_show (newest before this: 20261003193541) reopened the job and cleared
 * jobs.helper_id but left the reported Helpr's application 'accepted' (read live 2026-10-29: no
 * "applications" in pg_get_functiondef). The poster's applicant list called them "Selected" on a
 * reopened job; after another hire it read like a decline; their own card had no word for it.
 *
 * THE FIX. The newest report_helper_no_show closes that one application as rejected / 'no_show'; the
 * newest applications_closed_reason_check admits it (applicantBadgeCoversClosedReasons keeps the badge
 * map exact both ways); the poster badge says "No-show", the Helpr's closed card and job page
 * "Reported as a no-show". Behaviour on a real schema: src/test/pglite/noShowClosesTheApplication.pglite.mjs.
 *
 * @mutate supabase/migrations/20261029180706_application_closed_by_no_show.sql |          closed_reason = 'no_show'\n |          closed_reason = NULL\n
 * @mutate supabase/migrations/20261029180706_application_closed_by_no_show.sql |      AND helper_id = v_helper_id\n     AND status = 'accepted'; |      AND status = 'accepted';
 * @mutate src/pages/posts/postedJobs/applicantBadge.ts |   no_show: "No-show", |   no_show: "Declined",
 * @mutate src/pages/jobs/appliedJobCard/appliedJobCardHelpers.ts |   if (app.closed_reason === "no_show") return "Reported as a no-show"; |
 * @mutate src/pages/jobs/jobPage/viewerState.ts |     if (app.closed_reason === "no_show") return { action: { kind: "none" }, status: "Reported as a no-show" }; |
 */
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { posterApplicantBadge } from "@/pages/posts/postedJobs/applicantBadge";
import { closedCardLabel } from "@/pages/jobs/appliedJobCard/appliedJobCardHelpers";
import { jobPageViewerState } from "@/pages/jobs/jobPage/viewerState";

const MIG = join(resolve(__dirname, "../.."), "supabase", "migrations");

describe("a no-show report closes the reported Helpr's application as a no-show", () => {
  const defs = effectiveDefs(MIG);
  const fn = defs.get("report_helper_no_show");

  it("the newest report_helper_no_show closes exactly that Helpr's accepted application with closed_reason 'no_show'", () => {
    expect(defs.size).toBeGreaterThan(100);
    expect(fn?.file).toBe("20261029180706_application_closed_by_no_show.sql");
    const body = blankSqlComments(fn!.stmt).replace(/\s+/g, " ");
    expect(body).toMatch(/UPDATE public\.applications SET status = 'rejected', closed_reason = 'no_show' WHERE job_id = p_job_id AND helper_id = v_helper_id AND status = 'accepted';/);
    // Before the reopen, so the row is closed in the same transaction that frees the job.
    expect(body.indexOf("closed_reason = 'no_show'")).toBeLessThan(body.indexOf("SET status = 'open'"));
  });

  it("the poster's badge says No-show, the Helpr's card and job page say Reported as a no-show", () => {
    expect(posterApplicantBadge({ status: "rejected", closed_reason: "no_show" })).toEqual({ label: "No-show", kind: "closed" });
    expect(closedCardLabel({ status: "rejected", closed_reason: "no_show" })).toBe("Reported as a no-show");
    const v = jobPageViewerState({
      isPoster: false,
      userId: "h1",
      job: { status: "open", helper_id: null, helper_confirmed_at: null } as never,
      myApplication: { status: "rejected", closed_reason: "no_show" },
      posterFirst: "Ana",
    });
    expect(v.status).toBe("Reported as a no-show");
  });
});
