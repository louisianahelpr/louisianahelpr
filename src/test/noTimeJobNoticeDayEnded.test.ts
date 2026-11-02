/**
 * Q2640 (lead 11-02, Q2588 follow-up): auto_start_due_jobs starts a job with no start time at the Central midnight
 * that ENDS its day (20261102100421), and notify_poster_on_status_change then told the poster "Start time passed"
 * for a job that never had one. The in_progress branch now asks start_time first: no time and no arrival reads
 * "Job day ended"; a timed job keeps "Start time passed"; an arrival keeps "Work has started".
 *
 * Reads the EFFECTIVE definition (newest CREATE, any dollar tag, comments blanked). Can fail on the original bug:
 * every definition before 20261102235342 has no start_time case. Behaviour (real Postgres):
 * src/test/pglite/noTimeJobNoticeDayEnded.pglite.mjs (8 PASS; 4 FAIL with NEW_MIGRATION=skip; 3 plants red).
 *
 * @mutate supabase/migrations/20261102235342_no_time_job_notice_says_the_day_ended.sql |       IF NEW.start_time IS NULL THEN |       IF NEW.start_time IS NOT NULL THEN
 * @mutate supabase/migrations/20261102235342_no_time_job_notice_says_the_day_ended.sql | v_title := 'Job day ended'; | v_title := 'Start time passed';
 */
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs("supabase/migrations");
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("a job with no start time is told its day ended (Q2640)", () => {
  it("the sender is defined", () => {
    expect(defs.has("notify_poster_on_status_change")).toBe(true);
  });

  it("the no-start-time case comes first, then the timed case, then work started", () => {
    const b = flat(blankSqlComments(defs.get("notify_poster_on_status_change")!.stmt));
    const noTime = b.indexOf("IF NEW.helper_arrived_at IS NULL AND NEW.poster_confirmed_arrival_at IS NULL THEN IF NEW.start_time IS NULL THEN v_title := 'Job day ended';");
    const timed = b.indexOf("ELSE v_title := 'Start time passed';", noTime);
    const started = b.indexOf("v_title := 'Work has started';");
    expect(noTime, "no 'Job day ended' case for start_time IS NULL").toBeGreaterThan(-1);
    expect(timed).toBeGreaterThan(noTime);
    expect(started).toBeGreaterThan(timed);
    expect(b).toContain(`' hasn''t checked in for "' || NEW.title || '", and its day is over. Open the job to message them or report a no-show.'`);
  });
});
