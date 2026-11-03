/**
 * Owner bug 11-03: the server dates a job with an OPEN continue day (job_continue_days status 'set', closed_at null) by
 * that day where it decides "late". Held on the NEWEST definitions (effectiveDefs: any dollar tag; comments blanked):
 *   - admin_stalled_job_queue returns the open SET day's date and start time for a job in progress, and leaves out a
 *     job whose SET day is today or still ahead (not stalled; it comes back once that day passes; lead 11-03);
 *   - sweep_no_show_alerts' CREW branch skips a crew job with an open SET day.
 * Behaviour: src/test/pglite/continuingJobServerDates.pglite.mjs (16 checks; prod's bodies give 5 FAILs).
 */
// @mutate supabase/migrations/20261103214229_continuing_job_admin_stalled_and_crew_no_show.sql |     coalesce(c.new_date, j.date_needed), |     j.date_needed,
// @mutate supabase/migrations/20261103214229_continuing_job_admin_stalled_and_crew_no_show.sql |       AND NOT EXISTS (SELECT 1 FROM public.job_continue_days d | AND EXISTS (SELECT 1 FROM public.job_continue_days d
// @mutate supabase/migrations/20261103214229_continuing_job_admin_stalled_and_crew_no_show.sql |      WHERE d.job_id = j.id AND d.status = 'set' AND d.closed_at IS NULL AND j.status = 'in_progress' |      WHERE d.job_id = j.id AND d.status = 'set' AND d.closed_at IS NULL
// @mutate supabase/migrations/20261103214229_continuing_job_admin_stalled_and_crew_no_show.sql |     AND NOT (c.new_date IS NOT NULL AND c.new_date >= (now() AT TIME ZONE 'America/Chicago')::date) |     AND true
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "").replace(/\s+/g, " ");

describe("the server dates a continuing job by its open continue day (owner bug 11-03)", () => {
  it("reads the newest definitions (inventory floor)", () => {
    expect(defs.size).toBeGreaterThan(100);
    expect(defs.get("admin_stalled_job_queue")?.file).toBe("20261103214229_continuing_job_admin_stalled_and_crew_no_show.sql");
    expect(defs.get("sweep_no_show_alerts")?.file).toBe("20261103214229_continuing_job_admin_stalled_and_crew_no_show.sql");
  });

  it("the admin stalled queue returns the open SET day's date and start for a job in progress", () => {
    const q = flat("admin_stalled_job_queue");
    expect(q).toContain("coalesce(c.new_date, j.date_needed)");
    expect(q).toContain("CASE WHEN c.new_date IS NOT NULL THEN c.new_start_time ELSE j.start_time END");
    expect(q).toContain("WHERE d.job_id = j.id AND d.status = 'set' AND d.closed_at IS NULL AND j.status = 'in_progress'");
    expect(q).toContain("public.has_role(auth.uid(), 'admin')");
    expect(q).toContain("AND NOT (c.new_date IS NOT NULL AND c.new_date >= (now() AT TIME ZONE 'America/Chicago')::date)");
  });

  it("the crew no-show branch skips a crew with an open SET day; the solo branch stays accepted-only", () => {
    const s = flat("sweep_no_show_alerts");
    expect(s).toContain(
      "AND NOT EXISTS (SELECT 1 FROM public.job_continue_days d WHERE d.job_id = j.id AND d.status = 'set' AND d.closed_at IS NULL)",
    );
    expect(s).toContain("AND j.status = 'accepted'");
  });
});
