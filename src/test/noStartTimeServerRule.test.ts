/**
 * A JOB WITH NO START TIME IS "ANY TIME THAT DAY" ON THE SERVER TOO (Jobs audit 1102b row 2, Q2588, server half).
 *
 * THE DEFECT. The app's rule (src/lib/anyTimeThatDay.ts; jobIsOverdue in src/components/job-card/activityFilters.ts)
 * never calls a no-start-time job late on its day: it is overdue once its Central day is over. The database read a
 * NULL start_time as the midnight that STARTS the day: auto_start_due_jobs set the job in_progress at 12:00 AM and
 * notify_poster_on_status_change told the poster "Start time passed — <Helpr> hasn't checked in"; report_helper_no_show
 * and rpc_poster_report_member_no_show let the poster strike the Helpr from 12:00 AM; get_helper_on_time_percents
 * counted every arrival after 12:10 AM as late (and read the arrival in UTC).
 *
 * THE FIX (20261102100421). Each reads a no-start-time job as due at the NEXT Central midnight, jobIsOverdue's instant.
 * Behaviour proven by src/test/pglite/noStartTimeDueAtDayEnd.pglite.mjs (old bodies 16 FAIL, migration 3x ALL PASS,
 * 7 plants each red). This guard pins it on the newest definitions and holds the CLASS: every function the database
 * runs that still reads a NULL start_time as 00:00 is listed below with why that is not a late / start-passed /
 * no-show reading; a new one fails until it is classified (exact both ways).
 *
 * @mutate supabase/migrations/20261102100421_no_start_time_job_is_due_at_the_end_of_its_day.sql |        AND ((CASE WHEN j.start_time IS NULL THEN (j.date_needed + 1) + '00:00'::time ELSE j.date_needed + j.start_time END)\n              AT TIME ZONE 'America/Chicago') <= now() |        AND ((j.date_needed + COALESCE(j.start_time, '00:00'::time))\n              AT TIME ZONE 'America/Chicago') <= now()
 * @mutate supabase/migrations/20261102100421_no_start_time_job_is_due_at_the_end_of_its_day.sql |   v_starts_at := (CASE WHEN v_start_time IS NULL THEN (v_date_needed + 1) + '00:00'::time ELSE v_date_needed + v_start_time END) |   v_starts_at := (v_date_needed + COALESCE(v_start_time, '00:00'::time))
 * @mutate supabase/migrations/20261102100421_no_start_time_job_is_due_at_the_end_of_its_day.sql |   v_starts_at := (CASE WHEN v_job.start_time IS NULL THEN (v_job.date_needed + 1) + '00:00'::time ELSE v_job.date_needed + v_job.start_time END) |   v_starts_at := (v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time))
 * @mutate supabase/migrations/20261102100421_no_start_time_job_is_due_at_the_end_of_its_day.sql |         WHERE CASE WHEN any_time THEN arrived_local < scheduled_start | WHERE CASE WHEN any_time THEN arrived_local < scheduled_start - interval '1 day'
 * @mutate supabase/migrations/20261102100421_no_start_time_job_is_due_at_the_end_of_its_day.sql |       helper_arrived_at AT TIME ZONE 'America/Chicago' AS arrived_local, |       helper_arrived_at::timestamp AS arrived_local,
 * @mutate src/lib/anyTimeThatDay.ts | export function hasStartTime(job: { start_time?: string \| null }): boolean { | export function hasStartTimeX(job: { start_time?: string \| null }): boolean {
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = resolve(__dirname, "../..");
const MIG = join(ROOT, "supabase", "migrations");
const THIS = "20261102100421_no_start_time_job_is_due_at_the_end_of_its_day.sql";
const defs = effectiveDefs(MIG);
const body = (fn: string) => blankSqlComments(defs.get(fn)?.stmt ?? "").replace(/\s+/g, " ");
/** `date + COALESCE(start_time, '00:00')`: a NULL start read as the midnight that starts the day. */
const MIDNIGHT = /COALESCE\s*\(\s*[\w.]*start_time\s*,\s*'00:00(?::00)?'(?:::time)?\s*\)/i;
/** The day's end for a NULL start (the next Central midnight), the start itself otherwise. */
const dueAt = (d: string, t: string) =>
  new RegExp(String.raw`CASE WHEN ${t.replace(".", String.raw`\.`)} IS NULL THEN \(${d.replace(".", String.raw`\.`)} \+ 1\) \+ '00:00'::time ELSE ${d.replace(".", String.raw`\.`)} \+ ${t.replace(".", String.raw`\.`)} END`);

/** Every function the database runs that still reads a NULL start_time as 00:00, and why that is not "late". */
const MIDNIGHT_READS_CLASSIFIED: Record<string, string> = {
  helper_cancel_booking: "late-cancel fee window (hours before the start); a no-start-time job's cancel rule, not a late notice",
  job_hours_until_start: "the cancellation-fee anchor (hours until start); fee policy, not a late / no-show reading",
  block_user_and_settle: "a block settles a crew whose start is ahead; not a late / no-show reading",
  helper_mark_on_the_way: "on_the_way_too_early: a no-start-time job's On my way opens at its day's 00:00 (start_time IS NULL branch), never earlier",
  series_give_up_strike: "recurring give-up late-cancel strike (hours before a visit); cancel policy, not a late notice",
  request_job_schedule_change: "a schedule change must be asked before the job's day starts / for a time ahead",
  respond_job_schedule_change: "an accepted new day must still be ahead",
  end_series_for_banned_account: "a ban ends visits still ahead",
  request_job_detail_change: "a detail change must be asked before the job's day starts",
  respond_job_detail_change: "a detail change lapses once the job's day starts",
  settle_job_detail_change: "a detail change lapses once the job's day starts",
  sweep_backout_notice_reminders: "back-out notice reminders while the job's day is within 24 h",
  sweep_confirm_reminders_and_repost: "the day-before confirm (CONFIRM_DEADLINE_HOURS_BEFORE_START), the same instant the app's confirmDeadlineMs uses for a NULL start",
  jobs_schedule_move_clears_confirms: "a schedule move clears the day-of confirm when the new start is over 2h15m ahead",
  refund_come_back_pending: "a refund come-back is pending while the job's day is ahead",
  notify_on_payment_escrowed: "the Job funded notice names the day-before confirm deadline (2 h before a midnight start, as the confirm sweep reads it; A3-38, 20261102084222); not a late / no-show reading",
};

describe("a job with no start time is never started, late or a no-show on its day (server)", () => {
  it("the four fixed functions run from 20261102100421 and read a NULL start as the day's end", () => {
    expect(defs.size).toBeGreaterThan(100);
    for (const fn of ["auto_start_due_jobs", "report_helper_no_show", "rpc_poster_report_member_no_show", "get_helper_on_time_percents"]) {
      expect(defs.get(fn)?.file, fn).toBe(THIS);
      expect(body(fn), `${fn} still reads a NULL start_time as 00:00`).not.toMatch(MIDNIGHT);
    }
    const auto = body("auto_start_due_jobs");
    // The start gate, the 7-day backstop and the order: three reads, all of the day's end.
    expect(auto.match(new RegExp(dueAt("j.date_needed", "j.start_time").source, "g"))?.length).toBe(3);
    expect(auto).toMatch(new RegExp(String.raw`AND \(\(${dueAt("j.date_needed", "j.start_time").source}\) AT TIME ZONE 'America/Chicago'\) <= now\(\)`));
    expect(body("report_helper_no_show")).toMatch(new RegExp(String.raw`v_starts_at := \(${dueAt("v_date_needed", "v_start_time").source}\) AT TIME ZONE 'America/Chicago'; IF v_starts_at IS NULL OR now\(\) < v_starts_at THEN RAISE EXCEPTION 'job_not_started'`));
    expect(body("rpc_poster_report_member_no_show")).toMatch(new RegExp(String.raw`v_starts_at := \(${dueAt("v_job.date_needed", "v_job.start_time").source}\) AT TIME ZONE 'America/Chicago'; IF v_starts_at IS NULL OR v_now < v_starts_at THEN RAISE EXCEPTION 'job_not_started'`));
    const onTime = body("get_helper_on_time_percents");
    expect(onTime).toMatch(/helper_arrived_at AT TIME ZONE 'America\/Chicago' AS arrived_local/);
    expect(onTime).toMatch(new RegExp(dueAt("date_needed", "start_time").source));
    expect(onTime).toMatch(/WHEN any_time THEN arrived_local < scheduled_start ELSE arrived_local - scheduled_start <= INTERVAL '10 minutes' END/);
    expect(onTime).not.toMatch(/helper_arrived_at::timestamp/);
  });

  it("the cutoff is the app's: the next Central midnight, the instant jobIsOverdue turns a no-time job overdue", () => {
    const app = blankComments(readFileSync(join(ROOT, "src/components/job-card/activityFilters.ts"), "utf8"));
    // jobIsOverdue: a date behind today (Central) with no start time is overdue (start null -> the day passing decides).
    expect(app).toMatch(/export function jobIsOverdue[\s\S]*?if \(!isPastDue\(j\.date_needed\)\) return false;/);
    const rule = blankComments(readFileSync(join(ROOT, "src/lib/anyTimeThatDay.ts"), "utf8"));
    expect(rule).toMatch(/export function hasStartTime\(job: \{ start_time\?: string \| null \}\): boolean \{\s*return !!job\.start_time;/);
  });

  it("every other function that reads a NULL start_time as 00:00 is classified as not a late / no-show reading (exact both ways)", () => {
    const found = [...defs.entries()].filter(([, d]) => MIDNIGHT.test(blankSqlComments(d.stmt))).map(([n]) => n).sort();
    expect(found.length).toBeGreaterThan(10);
    expect(found).toEqual(Object.keys(MIDNIGHT_READS_CLASSIFIED).sort());
    for (const fn of ["auto_start_due_jobs", "report_helper_no_show", "rpc_poster_report_member_no_show", "get_helper_on_time_percents", "sweep_no_show_alerts", "sweep_job_start_reminders"]) {
      expect(MIDNIGHT_READS_CLASSIFIED[fn], `${fn} sends late / no-show / start wording and may never read 00:00`).toBeUndefined();
    }
  });
});
