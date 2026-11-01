/**
 * Q1326 (owner decision 2026-10-12): ALLOW a Helpr to be hired for two jobs
 * at overlapping times, and tell them clearly that they are already booked at
 * that time and need to get one of the jobs rescheduled: an in-app notice on
 * the card AND a notification.
 *
 * WHAT WAS OPEN: no hire path checked a clash, and nothing told the Helpr.
 * The owner chose "allow and tell", not "refuse". Behaviour (the notification
 * on hire, crew seat and move; the caller-only read; no hire refused) is
 * proven in src/test/pglite/helprDoubleBookingNotice.pglite.mjs. This file
 * pins the parts PGlite cannot see: the card shows the sentence, collapsed,
 * only on the Helpr's side; the Activity data tags the job from
 * my_schedule_clashes(); and no hire RPC refuses a clash.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { jobLocalDateISO } from "./helpers/jobLocalDate";

let rpcResult: { data: unknown; error: unknown } = { data: [], error: null };
const report = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => report(...a) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve(rpcResult) },
}));

import { fetchMyScheduleClashes, scheduleClashText } from "@/lib/scheduleClashes";
import { ScheduleChangeForJob } from "@/components/series/JobSeriesCardControls";

const ROOT = join(__dirname, "..", "..");
const CLASH = { otherJobId: "j2", otherTitle: "Fence", otherDate: "2026-11-03", otherStartTime: "09:00:00" };
const job = (over: Record<string, unknown> = {}) => ({
  id: "j1",
  title: "Gutters",
  status: "accepted",
  // A Central-time day three weeks out (jobDayFixtureTimezone): the card only
  // renders the clash; the day itself is not asserted.
  date_needed: jobLocalDateISO(21),
  start_time: "10:00:00",
  helper_id: "h1",
  customer_id: "p1",
  ...over,
});

beforeEach(() => {
  rpcResult = { data: [], error: null };
  report.mockClear();
});

describe("Q1326: a double-booked Helpr is told on the card", () => {
  it("says it plainly: the other job, when, and to get one rescheduled", () => {
    const t = scheduleClashText(CLASH);
    expect(t).toMatch(/^You're also booked for "Fence" \(Nov 3 at 9:00 AM\) at an overlapping time\./);
    expect(t).toMatch(/Please get one of these jobs rescheduled\.$/);
  });

  it("the Helpr's card shows it COLLAPSED (it is too important to hide behind the expand)", () => {
    render(<ScheduleChangeForJob job={job({ schedule_clash: CLASH }) as never} userId="h1" viewer="helper" expanded={false} />);
    expect(screen.getByRole("status")).toHaveTextContent(/You're also booked for "Fence"/);
  });

  it("only on the Helpr's side, and only when there is a clash", () => {
    const { container, unmount } = render(
      <ScheduleChangeForJob job={job({ schedule_clash: CLASH }) as never} userId="p1" viewer="poster" expanded={false} />,
    );
    expect(container.querySelector("[data-schedule-clash]")).toBeNull();
    unmount();
    const r2 = render(<ScheduleChangeForJob job={job() as never} userId="h1" viewer="helper" expanded={false} />);
    expect(r2.container.querySelector("[data-schedule-clash]")).toBeNull();
  });

  it("reads my_schedule_clashes: first clash per job; not deployed is silent; other errors are reported", async () => {
    rpcResult = {
      data: [
        { job_id: "j1", other_job_id: "j2", other_title: "Fence", other_date: "2026-11-03", other_start_time: "09:00:00" },
        { job_id: "j1", other_job_id: "j3", other_title: "Mow", other_date: "2026-11-03", other_start_time: "10:30:00" },
        { job_id: "j2", other_job_id: "j1", other_title: "Gutters", other_date: "2026-11-03", other_start_time: "10:00:00" },
      ],
      error: null,
    };
    const m = await fetchMyScheduleClashes();
    expect([...m.keys()]).toEqual(["j1", "j2"]);
    expect(m.get("j1")?.otherTitle).toBe("Fence");
    rpcResult = { data: null, error: { code: "PGRST202", message: "missing" } };
    expect((await fetchMyScheduleClashes()).size).toBe(0);
    expect(report).not.toHaveBeenCalled();
    rpcResult = { data: null, error: { code: "42501", message: "denied" } };
    expect((await fetchMyScheduleClashes()).size).toBe(0);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("the Activity data tags each job with its clash, from one read", () => {
    const src = blankComments(readFileSync(join(ROOT, "src/hooks/useActivityData.ts"), "utf8"));
    expect(src.length).toBeGreaterThan(10_000);
    // Loaded with its query since B61 (11-01, AUD31-60): the same one read, through a dynamic import.
    expect(src).toMatch(/queryFn: \(\) => scheduleClashesApi\(\)\.then\(\(m\) => \(m \? m\.fetchMyScheduleClashes\(\) : untilReload\(\)\)\)/);
    expect(src).toContain('import("@/lib/scheduleClashes")');
    expect(src).toMatch(/schedule_clash: c/);
  });

  it("the database tells the Helpr, and NO hire path refuses an overlapping hire", () => {
    const dir = join(ROOT, "supabase", "migrations");
    const defs = effectiveDefs(dir);
    const note = defs.get("notify_helpr_of_booking_clash");
    expect(note, "notify_helpr_of_booking_clash must be defined").toBeDefined();
    const body = blankSqlComments(note!.stmt);
    expect(body).toMatch(/INSERT INTO public\.notifications/);
    expect(body).toMatch(/rescheduled/);
    for (const rpc of ["accept_application", "respond_to_direct_offer", "accept_group_application"]) {
      const d = defs.get(rpc);
      expect(d, `${rpc} must still exist`).toBeDefined();
      expect(blankSqlComments(d!.stmt), `${rpc} must not refuse a clash (owner: double booking is allowed)`).not.toMatch(
        /schedule_change_clash|helpr_booking_clashes|booking_clash/,
      );
    }
    // A crew seat counts from the moment it is taken: the crew job is still
    // 'open' then and jobs.helper_id is never set (accept_group_application).
    const rule = blankSqlComments(defs.get("helpr_booking_clashes")!.stmt);
    expect(rule).toMatch(/j\.status::text IN \('open', 'accepted', 'in_progress'\)\s+AND EXISTS \(SELECT 1 FROM public\.group_job_helpers g/);
    expect(rule).toMatch(/g\.helper_completed_at IS NULL/);
    const all = migrationFiles(dir).map((f) => blankSqlComments(readFileSync(join(dir, f), "utf8"))).join("\n");
    expect(all).toMatch(/CREATE TRIGGER zz_notify_helpr_of_booking_clash_new\s+AFTER INSERT ON public\.jobs/);
    expect(all).toMatch(/CREATE TRIGGER zz_notify_helpr_of_booking_clash\s+AFTER UPDATE OF helper_id, status/);
    expect(all).toMatch(/CREATE TRIGGER zz_notify_helpr_of_booking_clash_ins\s+AFTER INSERT ON public\.group_job_helpers/);
    expect(all).toMatch(/REVOKE ALL ON FUNCTION public\.my_schedule_clashes\(\) FROM PUBLIC, anon;/);
    expect(all).toMatch(/REVOKE ALL ON FUNCTION public\.helpr_booking_clashes\(uuid\) FROM PUBLIC, anon, authenticated;/);
  });
});

// @mutate src/components/series/JobSeriesCardControls.tsx |   if (!expanded && !(job as { schedule_change_asked_of_me?: boolean }).schedule_change_asked_of_me) return clash; |   if (!expanded && !(job as { schedule_change_asked_of_me?: boolean }).schedule_change_asked_of_me) return null;
// @mutate src/components/series/JobSeriesCardControls.tsx |   const clash = viewer === "helper" ? <ScheduleClashNotice job={job} /> : null; |   const clash = <ScheduleClashNotice job={job} />;
// @mutate src/lib/scheduleClashes.ts |     if (out.has(r.job_id)) continue; |
// @mutate src/lib/scheduleClashes.ts |     if (!isNotDeployedYet(error)) report(error, { severity: "warning", tags: { source: "fetchMyScheduleClashes" } }); |
// @mutate src/hooks/useActivityData.ts | ...(c ? { schedule_clash: c } : {}) | ...{}
// @mutate supabase/migrations/20261012171958_helpr_double_booking_notice.sql | REVOKE ALL ON FUNCTION public.my_schedule_clashes() FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.my_schedule_clashes() FROM PUBLIC;
// @mutate supabase/migrations/20261012171958_helpr_double_booking_notice.sql |             OR (j.status::text IN ('open', 'accepted', 'in_progress') |             OR (j.status::text IN ('accepted', 'in_progress')
