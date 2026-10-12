import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { isNotDeployedYet } from "@/lib/seriesDates";
import { formatShortDate } from "@/lib/format";
import { jobStartTimeLabel } from "@/lib/jobDate";

/**
 * DOUBLE BOOKING IS ALLOWED, AND SAID (owner, 2026-10-12, Q1326): a Helpr may
 * be hired for two jobs at overlapping times; when it happens they are told
 * they are already booked at that time and need to get one rescheduled.
 *
 * The rule is the database's (helpr_booking_clashes, migration
 * 20261012171958, the same overlap rule a schedule change uses);
 * my_schedule_clashes() returns the caller's own clashing pairs. The cards tag
 * each job with the first job it clashes with (useActivityData), and
 * ScheduleClashNotice prints the sentence. The database also sends a
 * notification at the moment a booking lands in a clash.
 */
export type ScheduleClash = { otherJobId: string; otherTitle: string | null; otherDate: string | null; otherStartTime: string | null };

/** Job id -> the first booking it overlaps (by date, then start). Empty on any failure: the notice explains, it gates nothing. */
export async function fetchMyScheduleClashes(): Promise<Map<string, ScheduleClash>> {
  const { data, error } = await supabase.rpc("my_schedule_clashes");
  const out = new Map<string, ScheduleClash>();
  if (error) {
    if (!isNotDeployedYet(error)) report(error, { severity: "warning", tags: { source: "fetchMyScheduleClashes" } });
    return out;
  }
  for (const r of data ?? []) {
    if (out.has(r.job_id)) continue;
    out.set(r.job_id, { otherJobId: r.other_job_id, otherTitle: r.other_title, otherDate: r.other_date, otherStartTime: r.other_start_time });
  }
  return out;
}

/** The notice's words. */
export function scheduleClashText(c: ScheduleClash): string {
  const when = [formatShortDate(c.otherDate), jobStartTimeLabel(c.otherStartTime)].filter(Boolean).join(" at ");
  const other = c.otherTitle ? `"${c.otherTitle}"` : "another job";
  return `You're also booked for ${other}${when ? ` (${when})` : ""} at an overlapping time. Please get one of these jobs rescheduled.`;
}
