import { RefreshCw } from "lucide-react";
import { SeriesDatesPanel } from "@/components/series/SeriesDatesPanel";
import { EndSeriesControl } from "@/components/series/EndSeriesControl";
import { ScheduleChangeControl } from "@/components/schedule/ScheduleChangeControl";
import { DetailChangeControl } from "@/components/schedule/DetailChangeControl";
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
export function ScheduleChangeForJob({
  job,
  userId,
  viewer,
  expanded,
}: {
  job: SeriesCardJob;
  userId: string | null | undefined;
  viewer: "poster" | "helper";
  /** The card's own expand state. Required, so no card can forget it: the
   *  date-change control lives BEHIND the expand on every card (owner,
   *  2026-10-05: "Ask for a new date or time" shows only expanded, it takes
   *  too much space collapsed). Guard: src/test/offerCardHierarchy.test.tsx. */
  expanded: boolean;
}) {
  if (!expanded || !userId) return null;
  const notSeries = !job.parent_job_id && !job.recurrence_days?.length && !!job.date_needed;
  const schedule =
    job.status === "accepted" && !!job.helper_id && !job.helper_completed_at &&
    (viewer === "poster" || job.helper_id === userId) && notSeries && !job.is_group_job;
  const details =
    (job.status === "accepted" || job.status === "open") && !job.helper_completed_at && notSeries &&
    (job.is_group_job ? true : !!job.helper_id && (viewer === "poster" || job.helper_id === userId));
  if (!schedule && !details) return null;
  return (
    <>
      {schedule && (
        <ScheduleChangeControl
          jobId={job.id}
          jobTitle={job.title}
          userId={userId}
          dateNeeded={job.date_needed as string}
          startTime={job.start_time ?? null}
        />
      )}
      {details && (
        <DetailChangeControl
          jobId={job.id}
          jobTitle={job.title}
          userId={userId}
          viewer={viewer}
          isCrew={!!job.is_group_job}
          current={{
            title: job.title ?? "",
            description: job.description ?? "",
            location: job.location ?? "",
            materials_note: job.materials_note ?? "",
          }}
        />
      )}
    </>
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
