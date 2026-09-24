/**
 * Q366 (owner, 2026-09-24): two safety gaps between poster and Helpr.
 *
 * 1. SOS was the poster's alone: the Helpr on site, who is the one in a
 *    stranger's home, had no share-my-location control. Both cards now read the
 *    same sosOffered(job), and the Helpr's on-site, working and revision steps
 *    put the chip first.
 * 2. A poster could not report or block an applicant from the applicant list.
 *    Each row now has Report (reported_type 'application') and Block. The DB
 *    CHECK admits 'application', auto_escalate_reports counts it against the
 *    applicant, and the admin queue resolves it to the applicant's name and job
 *    instead of treating the application id as a person.
 */
// @mutate src/components/SosShareButton.tsx | return !!job.helper_arrived_at && !job.helper_completed_at && !job.poster_completed_at; | return !!job.helper_arrived_at;
// @mutate src/components/activity/appliedJobCard/ActiveJobSection.tsx | sosChip: sosOffered(job) ? <SosShareButton key="sos" jobId={job.id} /> : null, | sosChip: null,
// @mutate src/components/activity/appliedJobCard/steps/OnSiteStep.tsx | actions={[sosChip, reportChip, | actions={[reportChip,
// @mutate src/components/activity/appliedJobCard/steps/WorkingStep.tsx | actions={[sosChip, reportChip, | actions={[reportChip,
// @mutate src/components/activity/appliedJobCard/steps/RevisionStep.tsx | actions={[sosChip, reportChip, | actions={[reportChip,
// @mutate src/components/activity/postedJobCard/steps/InProgressStep.tsx | const showSos = sosOffered(job); | const showSos = !!job.helper_arrived_at;
// @mutate src/components/ReportDialog.tsx | type ReportedType = "job" \| "message" \| "user" \| "review" \| "application"; | type ReportedType = "job" \| "message" \| "user" \| "review";
// @mutate src/components/activity/postedJobs/ApplicantsPanel.tsx | reportedType="application" | reportedType="user"
// @mutate src/components/activity/postedJobs/ApplicantsPanel.tsx | blockedUserId={blockApp.helper_id} | blockedUserId={blockApp.id}
// @mutate src/components/activity/postedJobs/ApplicantsPanel.tsx | onClick={() => { hapticLight(); setBlockApp(app); }} | onClick={() => { hapticLight(); }}
// @mutate supabase/migrations/20260924182505_report_against_application.sql | 'review'::text, 'application'::text])); | 'review'::text]));
// @mutate supabase/migrations/20260924182505_report_against_application.sql | SELECT a.helper_id INTO v_subject FROM public.applications a WHERE a.id = NEW.reported_id; | v_subject := NEW.reported_id;
// @mutate src/components/admin/AdminReports.tsx | r.reported_type === "application" ? appHelper.get(r.reported_id) ?? null | r.reported_type === "application" ? r.reported_id
// @mutate src/components/admin/AdminReports.tsx | const isUserSubject = (r: Report) => r.reported_type !== "job" && r.reported_type !== "application"; | const isUserSubject = (r: Report) => r.reported_type !== "job";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("Q366: SOS for the Helpr on site", () => {
  it("sosOffered is on-site only and ends when either side completes", async () => {
    const { sosOffered } = await import("@/components/SosShareButton");
    expect(sosOffered({ helper_arrived_at: null })).toBe(false);
    expect(sosOffered({ helper_arrived_at: "t" })).toBe(true);
    expect(sosOffered({ helper_arrived_at: "t", helper_completed_at: "t" })).toBe(false);
    expect(sosOffered({ helper_arrived_at: "t", poster_completed_at: "t" })).toBe(false);
  });

  it("both cards read the same gate", () => {
    expect(read("src/components/activity/postedJobCard/steps/InProgressStep.tsx")).toContain("const showSos = sosOffered(job);");
    expect(read("src/components/activity/appliedJobCard/ActiveJobSection.tsx"))
      .toContain('sosChip: sosOffered(job) ? <SosShareButton key="sos" jobId={job.id} /> : null,');
  });

  it.each(["OnSiteStep", "WorkingStep", "RevisionStep"])("the Helpr's %s puts the SOS chip first", (step) => {
    expect(read(`src/components/activity/appliedJobCard/steps/${step}.tsx`)).toContain("actions={[sosChip, reportChip,");
  });
});

describe("Q366: report or block an applicant", () => {
  it("ReportDialog knows the application subject", () => {
    const src = read("src/components/ReportDialog.tsx");
    expect(src).toContain('type ReportedType = "job" | "message" | "user" | "review" | "application";');
    expect(src).toContain(`application: "What's wrong with this application?"`);
  });

  it("each applicant row reports the application and blocks the applicant", () => {
    const src = read("src/components/activity/postedJobs/ApplicantsPanel.tsx");
    expect(src).toContain("onClick={() => { hapticLight(); setReportApp(app); }}");
    expect(src).toContain("onClick={() => { hapticLight(); setBlockApp(app); }}");
    expect(src).toContain('reportedType="application"');
    expect(src).toContain("reportedId={reportApp.id}");
    expect(src).toContain("blockedUserId={blockApp.helper_id}");
  });

  it("the DB admits it and escalation counts it against the applicant", () => {
    const sql = read("supabase/migrations/20260924182505_report_against_application.sql");
    expect(sql).toContain("'review'::text, 'application'::text]));");
    expect(sql).toContain("SELECT a.helper_id INTO v_subject FROM public.applications a WHERE a.id = NEW.reported_id;");
    expect(sql).toMatch(/r\.reported_type = 'application'\s+AND r\.reported_id IN \(SELECT a\.id FROM public\.applications a WHERE a\.helper_id = v_subject\)/);
  });

  it("the admin queue resolves an application to its applicant, not to a person with the application's id", () => {
    const src = read("src/components/admin/AdminReports.tsx");
    expect(src).toContain('const isUserSubject = (r: Report) => r.reported_type !== "job" && r.reported_type !== "application";');
    expect(src).toContain('r.reported_type === "application" ? appHelper.get(r.reported_id) ?? null');
    expect(src).toContain("navigate(`/user/${report.subject_user_id ?? report.reported_id}`)");
    expect(src).toContain("userId: report.subject_user_id ?? report.reported_id");
  });
});
