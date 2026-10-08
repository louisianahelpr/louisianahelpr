import { hasJobStarted } from "@/lib/dateUtils";
import { RefreshCw } from "lucide-react";
import { SeriesDatesPanel } from "@/components/series/SeriesDatesPanel";
import { EndSeriesControl } from "@/components/series/EndSeriesControl";
import { ScheduleChangeControl } from "@/components/schedule/ScheduleChangeControl";
import { formatRecurrenceInterval, formatShortDate } from "@/lib/format";
import { formatJobDate } from "@/lib/dateUtils";

/**
 * The two Q407 controls BOTH job cards carry (the poster's PostedJobCard and
 * the Helpr's AppliedJobCard), with the rule for when each shows written
 * once instead of twice. Each renders nothing when its rule says no.
 */
export type SeriesCardJob = {
  id: string;
  title: string | null;
  status: string;
  parent_job_id?: string | null;
  recurrence_days?: number[] | null;
  recurrence_weeks?: number | null;
  date_needed?: string | null;
  start_time?: string | null;
  series_ended_on?: string | null;
  series_split_ok?: boolean | null;
  recurring_helper_id?: string | null;
  helper_id?: string | null;
  helper_completed_at?: string | null;
  helper_confirmed_at?: string | null;
  is_group_job?: boolean | null;
  recurrence_interval?: string | null;
  recurrence_end_date?: string | null;
  // Q1254: the place and details an agreed change request proposes to replace.
  description?: string | null;
  location?: string | null;
  materials_note?: string | null;
};

/**
 * Who has each upcoming visit date, and the open ones the viewer can offer
 * (poster) or pick (Helpr) (Q407 5/6). Series parents that are still running.
 */
export function SeriesDatesForJob({
  job,
  userId,
  isPoster,
  inset,
}: {
  job: SeriesCardJob;
  userId: string | null | undefined;
  isPoster: boolean;
  inset?: boolean;
}) {
  if (job.parent_job_id || !(job.recurrence_days?.length) || !job.recurrence_weeks || !job.date_needed) return null;
  if (job.series_ended_on || job.status === "cancelled") return null;
  return (
    <SeriesDatesPanel
      inset={inset}
      jobId={job.id}
      jobTitle={job.title}
      dateNeeded={job.date_needed}
      recurrenceDays={job.recurrence_days}
      recurrenceWeeks={job.recurrence_weeks}
      userId={userId ?? null}
      isPoster={isPoster}
      firstHelpr={job.recurring_helper_id && job.recurring_helper_id === job.helper_id ? job.recurring_helper_id : null}
      splitOk={!!job.series_split_ok}
    />
  );
}

/**
 * A booked one-time job's date/time changes only by a request the other
 * party accepts (Q407 8). `viewer: "helper"` additionally requires the viewer
 * to be the hired Helpr; the poster's card is already the poster's own job.
 *
 * Beside it, the place and details change only by a request every booked
 * Helpr accepts (Q1254). That one covers a crew too: the poster's card asks
 * once its roster names a Helpr; a Helpr's card answers only a request that
 * asked them (the read itself says so: RLS returns the request only to the
 * poster and the Helprs asked).
 */
/** Whether this reader may ask to move this job's date or time (a booked
 *  or offered one-time job, before the Helpr has marked it done). */
export function scheduleChangeAllowed(
  job: SeriesCardJob,
  userId: string | null | undefined,
  viewer: "poster" | "helper",
): job is SeriesCardJob & { date_needed: string } {
  if (!userId || job.status !== "accepted" || !job.helper_id || job.helper_completed_at) return false;
  // Only once the Helpr has ACCEPTED (owner, 2026-10-08: "that should only show
  // once they accept"): an unanswered offer is not a booked job.
  if (!job.helper_confirmed_at) return false;
  // Not once the start has come: the RPC refuses it (schedule_change_too_late).
  if (hasJobStarted(job.date_needed, job.start_time ?? null)) return false;
  if (viewer === "helper" && job.helper_id !== userId) return false;
  if (job.parent_job_id || job.recurrence_days?.length || job.is_group_job || !job.date_needed) return false;
  return true;
}

export function ScheduleChangeForJob({
  job,
  userId,
  viewer,
  expanded,
  hideAsk = false,
}: {
  job: SeriesCardJob;
  userId: string | null | undefined;
  viewer: "poster" | "helper";
  /** The card's own expand state. Required, so no card can forget it: the
   *  date-change control lives BEHIND the expand on every card (owner,
   *  2026-10-05: "Ask for a new date or time" shows only expanded, it takes
   *  too much space collapsed). Guard: src/test/offerCardHierarchy.test.tsx. */
  expanded: boolean;
  /** The ask is a button in the card's action row instead (the poster's
   *  ScheduledStep, owner 2026-10-07); this block keeps the request's state. */
  hideAsk?: boolean;
}) {
  if (!expanded || !userId) return null;
  // The details-change request ("Ask to change the details") is gone (owner,
  // 2026-10-08: "delete ask to change the details"); only the date/time ask remains.
  if (!scheduleChangeAllowed(job, userId, viewer)) return null;
  return (
        <ScheduleChangeControl
          jobId={job.id}
          jobTitle={job.title}
          userId={userId}
          dateNeeded={job.date_needed as string}
          startTime={job.start_time ?? null}
          hideAsk={hideAsk}
        />
  );
}

/**
 * The Helpr card's recurring footer (AppliedJobCard, recurring jobs only): the
 * interval line, the standing Helpr's way out of a running series parent, and
 * the visit dates they hold or can pick.
 */
export function HelperSeriesRow({ job, userId }: { job: SeriesCardJob; userId: string | null | undefined }) {
  return (
    <>
      <div className="flex items-center gap-1.5 text-ds-11 text-muted-foreground">
        <RefreshCw className="w-3 h-3 text-primary" />
        <span>{formatRecurrenceInterval(job.recurrence_interval)}{job.recurrence_end_date && ` until ${formatShortDate(job.recurrence_end_date)}`}{job.series_ended_on && ` · ended ${formatJobDate(job.series_ended_on)}`}</span>
        {/* end_recurring_series called by a Helpr LEAVES the series (their
            upcoming dates go back to it; owner decision 6). Only the standing
            Helpr who is STILL hired on the parent (review 2026-09-25). */}
        {!job.parent_job_id && (job.recurrence_days?.length ?? 0) > 0 && !!userId &&
          job.recurring_helper_id === userId && job.helper_id === userId &&
          !job.series_ended_on && job.status !== "cancelled" && (
          <span className="ml-auto shrink-0">
            <EndSeriesControl jobId={job.id} jobTitle={job.title} userId={userId} mode="leave" />
          </span>
        )}
      </div>
      {/* Visit dates: yours, and any you can pick (Q407 5/6). */}
      <SeriesDatesForJob job={job} userId={userId} isPoster={false} inset={false} />
    </>
  );
}
