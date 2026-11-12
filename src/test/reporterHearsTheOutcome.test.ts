/**
 * A3-113: a member who reports a job, member, listing, message, review, question or Wanted post hears the outcome.
 * The behaviour runs in src/test/pglite/reporterHearsTheOutcome.pglite.mjs (migration 3x; red with NEW_MIGRATION=skip;
 * 10 planted defects red). This reads the NEWEST definition, so a later restatement cannot quietly put the reported
 * party or typed words in the notice, drop the test-account skip, or merge the two outcomes; and the Report sheet
 * says the reporter will hear back.
 *
 * @mutate supabase/migrations/20261112094500_shops_review_report.sql |        OR public.is_test_subject(NEW.reporter_id)\n | \n
 * @mutate supabase/migrations/20261112094500_shops_review_report.sql | THEN 'We looked into it and took action.' | THEN 'We looked into it and didn''t find a rule broken.'
 * @mutate supabase/migrations/20261112094500_shops_review_report.sql | 'Thanks for your report about ' \|\| v_noun | 'Thanks for your report about ' \|\| coalesce(NEW.description, '')
 * @mutate supabase/migrations/20261102015348_reporter_hears_the_outcome.sql |   AFTER UPDATE OF status ON public.reports |   AFTER INSERT ON public.reports
 * @mutate supabase/migrations/20261103052255_declutter_wanted_homes_admin_not_found_is_404.sql | SET status = CASE WHEN reporter_id IS NULL THEN 'resolved' ELSE 'dismissed' END | SET status = 'resolved'
 * @mutate src/components/ReportDialog.tsx | We&apos;ll send you a notice when we&apos;ve looked into it | There&apos;s no automatic status update
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { describe, expect, it } from "vitest";
import { newestFunction } from "./helpers/parityReaders";
import { blankSqlComments } from "./helpers/blankNonCode";

const fn = newestFunction("notify_reporter_report_outcome");
const body = blankSqlComments(fn.body);
// The trigger is read from the newest migration that creates it; the grant from the newest that defines the function.
const MIGS = "supabase/migrations/";
const migSql = (f: string) => blankSqlComments(readFileSync(MIGS + f, "utf8"));
const trigFile = readdirSync(MIGS).filter((f) => f.endsWith(".sql")).sort().reverse()
  .find((f) => migSql(f).includes("CREATE TRIGGER trg_reports_zz_reporter_outcome")) ?? "";

describe("the reporter hears the outcome of a report", () => {
  it("skips a test or seed reporter, and support tickets, before it writes anything", () => {
    const insert = body.indexOf("INSERT INTO public.notifications");
    expect(insert).toBeGreaterThan(200);
    for (const needle of ["public.is_test_subject(NEW.reporter_id)", "p.is_seed IS TRUE", "NEW.reported_type = 'support'"]) {
      const at = body.indexOf(needle);
      expect(at, needle).toBeGreaterThan(-1);
      expect(at, needle).toBeLessThan(insert);
    }
  });

  it("the notice carries nothing anyone typed and never the reported party", () => {
    const insert = body.slice(body.indexOf("INSERT INTO public.notifications"), body.indexOf("EXCEPTION"));
    expect(insert.length).toBeGreaterThan(300);
    expect(insert).not.toMatch(/NEW\.(reason|description|reported_content|reported_id)/);
    expect(insert).toMatch(/NEW\.reporter_id/);
  });

  it("the two outcomes say different things", () => {
    expect(body).toMatch(/WHEN NEW\.status = 'resolved'\s+THEN 'We looked into it and took action\.'/);
    expect(body).toMatch(/ELSE 'We looked into it and didn''t find a rule broken\./);
  });

  it("fires once, when a report closes", () => {
    expect(trigFile).not.toBe("");
    const sql = migSql(trigFile);
    expect(sql).toMatch(/AFTER UPDATE OF status ON public\.reports\s+FOR EACH ROW\s+WHEN \(NEW\.status IN \('resolved', 'dismissed'\)/);
    expect(sql).toMatch(/AND OLD\.status NOT IN \('resolved', 'dismissed'\)\)/);
    expect(migSql(fn.file.split("/").pop() ?? "")).toMatch(/REVOKE ALL ON FUNCTION public\.notify_reporter_report_outcome\(\) FROM PUBLIC, anon, authenticated/);
  });

  it("releasing a Wanted post's photos closes a member's report as dismissed (the photos were fine)", () => {
    const rel = blankSqlComments(newestFunction("declutter_admin_release_wanted_photos").body);
    expect(rel).toMatch(/SET status = CASE WHEN reporter_id IS NULL THEN 'resolved' ELSE 'dismissed' END\s+WHERE id = p_report_id/);
    expect(rel).not.toMatch(/SET status = 'resolved' WHERE id = p_report_id/);
  });

  it("the Report sheet says the reporter will hear back", () => {
    const src = readFileSync("src/components/ReportDialog.tsx", "utf8");
    expect(src).toContain("We&apos;ll send you a notice when we&apos;ve looked into it");
    expect(src).not.toContain("There&apos;s no automatic status update");
  });
});
