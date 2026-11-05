/**
 * Q2408 "Any time this week" (owner: BUILD): a window job's day prints as its window ("Any day Nov 4-10", jobDayLabel),
 * never as its first day alone. After the first build, four readers still did formatJobDate(<job>.date_needed): the
 * /search job row, the admin job dialog, the admin analytics Jobs drill-down and a Helpr's Not picked row (whose read,
 * get_closed_application_job_labels, now returns date_window_end: 20261105233602).
 *
 * CLASS GUARD: in every app source file, formatJobDate(<anything>.date_needed) appears only where it is meant (exact
 * both ways): jobDayLabel itself, and the apply sheet's time question, which names the window's FIRST day on purpose
 * after saying the poster takes any day in it. Plus the rendered rows, and each reader carries the column.
 *
 * @mutate src/pages/search/SearchPage.tsx | j.date_needed ? jobDayLabel(j) : null | j.date_needed ? formatJobDate(j.date_needed) : null
 * @mutate src/components/admin/adminJobs/JobDetailDialog.tsx | {jobDayLabel(detailJob)} | {formatJobDate(detailJob.date_needed)}
 * @mutate src/components/admin/AdminAnalyticsDrilldowns.tsx | {j.location} · {jobDayLabel(j)} | {j.location} · {formatJobDate(j.date_needed)}
 * @mutate src/pages/jobs/appliedJobCard/ClosedJobRow.tsx | `${jobDayLabel(label)} · ` | `${label.date_needed} · `
 * @mutate src/lib/closedJobLabels.ts | date_window_end: row.date_window_end ?? null }]) | date_window_end: null }])
 * @mutate src/components/admin/AdminAnalytics.tsx | readJobsAheadOfDb(`${JOB_READABLE_COLUMNS}, date_window_end`, | readJobsAheadOfDb(`${JOB_READABLE_COLUMNS}`,
 * @mutate src/components/admin/AdminJobs.tsx | materials_note, date_window_end`, | materials_note`,
 * @mutate supabase/migrations/20261105233602_closed_application_job_labels_window.sql |             WHERE a.job_id = j.id AND a.helper_id = v_uid |             WHERE a.job_id = j.id
 * @mutate supabase/migrations/20261105233602_closed_application_job_labels_window.sql |   SELECT j.id, j.title, j.date_needed, j.date_window_end |   SELECT j.id, j.title, j.date_needed, NULL::date
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { blankComments, blankSqlComments } from "@/test/helpers/blankNonCode";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";
import { trackedFiles } from "@/test/helpers/trackedFiles";
import { ClosedJobRow } from "@/pages/jobs/appliedJobCard/ClosedJobRow";

const rpc = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: async () => ({ data: rpc.rows, error: null }) } }));
import { fetchClosedJobLabels } from "@/lib/closedJobLabels";

const REPO = resolve(__dirname, "..", "..");
const code = (f: string) => blankComments(readFileSync(resolve(REPO, f), "utf8"));

describe("Q2408: a window job's day prints as its window everywhere", () => {
  it("formatJobDate(<job>.date_needed) is used only where the first day is meant (exact both ways)", () => {
    const files = trackedFiles("src").filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"));
    expect(files.length).toBeGreaterThan(500);
    const hits: string[] = [];
    for (const f of files) {
      const n = (code(f).match(/formatJobDate\(\s*[\w.?!]*date_needed\b/g) ?? []).length;
      if (n) hits.push(`${f} x${n}`);
    }
    expect(hits.sort()).toEqual([
      // jobDayLabel's own one-day branch.
      "src/lib/jobDateWindow.ts x1",
      // "Does <first day> work for you? The poster takes any day this week": the first day on purpose (Q2408).
      "src/components/dashboard/applyConfirmDialog/ApplyTimeQuestion.tsx x2",
    ].sort());
  });

  it("the Not picked row prints the window, and its read carries the window's last day", async () => {
    render(<ClosedJobRow label={{ title: "Yard", date_needed: "2020-11-04", date_window_end: "2020-11-10" }} status="Not selected" />);
    expect(screen.getByText(/Not selected$/).textContent).toBe("Any day Nov 4-10 · Not selected");
    rpc.rows = [{ job_id: "j1", title: "Yard", date_needed: "2020-11-04", date_window_end: "2020-11-10" }, { job_id: "j2", title: "Old db", date_needed: "2020-11-05" }];
    const m = await fetchClosedJobLabels(true);
    expect(m.get("j1")).toEqual({ title: "Yard", date_needed: "2020-11-04", date_window_end: "2020-11-10" });
    expect(m.get("j2"), "a database before 20261105233602 returns no column: a one-day row").toEqual({ title: "Old db", date_needed: "2020-11-05", date_window_end: null });
  });

  it("the newest get_closed_application_job_labels returns the window, only for the caller's own applications", () => {
    const def = effectiveDefs(resolve(REPO, "supabase/migrations")).get("get_closed_application_job_labels");
    expect(def, "has a definition").toBeTruthy();
    const body = blankSqlComments(def!.stmt);
    expect(body).toMatch(/RETURNS TABLE\(job_id uuid, title text, date_needed date, date_window_end date\)/);
    expect(body).toMatch(/SELECT j\.id, j\.title, j\.date_needed, j\.date_window_end\s+FROM public\.jobs j/);
    expect(body, "the applicant check (behaviour: closedApplicationJobLabelsWindow.pglite.mjs W2)").toMatch(/WHERE a\.job_id = j\.id AND a\.helper_id = v_uid/);
  });

  it("each reader asks for date_window_end through readJobsAheadOfDb", () => {
    expect(code("src/pages/search/SearchPage.tsx")).toMatch(/readJobsAheadOfDb\(\s*"[^"]*date_needed,date_window_end,[^"]*",[\s\S]{0,400}\{ browseView: true \}/);
    expect(code("src/components/admin/AdminJobs.tsx")).toContain("readJobsAheadOfDb(`${JOB_READABLE_COLUMNS}, materials_note, date_window_end`,");
    expect(code("src/components/admin/AdminAnalytics.tsx")).toContain("readJobsAheadOfDb(`${JOB_READABLE_COLUMNS}, date_window_end`,");
  });
});
