import { useEffect, useId } from "react";
import { ChoicePill } from "@/components/ui/ChoicePill";
import { FLEXIBLE_TIME_LABEL, jobStartTimeLabel } from "@/lib/jobDate";
import type { EnrichedJob } from "@/components/dashboard/types";
import { jobDayLabel, hasDateWindow } from "@/lib/jobDateWindow";
import { formatJobDate } from "@/lib/dateUtils";

/**
 * "Does Sat, Oct 24 at 12:00 PM work for you?" (owner, 2026-10-23: every job asks; if not, the Helpr
 * suggests another day and time, and hiring them agrees to it). The answer travels with the application
 * (apply_to_job's suggestion arguments, 20261023134752); "Yes" sends nothing extra.
 *
 * Asked only where a different time can be honoured: a single job with a day. A crew job, a series visit
 * and a quote-booked job keep one time for everyone (the server refuses a suggestion there too).
 */
/** `jobId` ties the answer to the job it was given on, so a suggestion never carries over to another job's sheet. */
export type ApplyTimeSuggestion = { jobId: string; date: string; time: string | null };

export function canSuggestATime(job: Pick<EnrichedJob, "date_needed" | "is_group_job" | "parent_job_id" | "is_recurring" | "pricing_mode"> | null | undefined): boolean {
  if (!job?.date_needed) return false;
  return !job.is_group_job && !job.parent_job_id && !job.is_recurring && job.pricing_mode !== "quotes";
}

/** Today in the platform zone, as YYYY-MM-DD (the server's own day rule). */
function platformToday(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Now in the platform zone, as HH:MM (24-hour). */
function platformNowHHMM(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/** Accept refuses a job whose start is 15 minutes away or less (job_starts_too_soon). */
const ACCEPT_LEAD_MINUTES = 15;
/** Hiring at a suggested time refuses one less than 2 hours away (suggestion_too_soon, 20261023134752). */
const SUGGESTION_LEAD_MINUTES = 120;

/**
 * Q2408 (review): is today's start still at least `leadMinutes` ahead? With no start time the day counts until
 * 11:59 PM (the server's COALESCE(start_time, '23:59')). Never true once `now + lead` has crossed midnight.
 */
function todayStillBookable(startTime: string | null | undefined, now: Date = new Date(), leadMinutes: number = ACCEPT_LEAD_MINUTES): boolean {
  const start = (startTime || "23:59").slice(0, 5);
  const later = new Date(now.getTime() + leadMinutes * 60 * 1000);
  return platformToday(later) === platformToday(now) && platformNowHHMM(later) < start;
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function ApplyTimeQuestion({
  job,
  value: given,
  onChange,
  disabled,
}: {
  job: EnrichedJob;
  value: ApplyTimeSuggestion | null;
  onChange: (v: ApplyTimeSuggestion | null) => void;
  disabled?: boolean;
}) {
  const id = useId();
  // A flexible start has no time to ask about: "Does Sat, Oct 31 work for you?", never "… at Flexible …"
  // (deep audit 2026-10-28, real data: is_flexible_schedule with no start_time).
  const startLabel = jobStartTimeLabel(job.start_time, job.is_flexible_schedule);
  const when = [job.date_needed ? (hasDateWindow(job) ? formatJobDate(job.date_needed) : jobDayLabel(job)) : null, startLabel === FLEXIBLE_TIME_LABEL ? null : startLabel]
    .filter(Boolean)
    .join(" at ");
  // Q2607 (Jobs audit 1102b row 21): "9:00 AM" broke with "AM" alone on the next line; the time stays together.
  // Q2408: a week-window job asks about its FIRST day and says the poster takes any day in the window; "Other
  // time" then picks a day inside the window (hiring moves the job to it, which ends the window).
  const windowed = hasDateWindow(job);
  const day = job.date_needed ? (windowed ? formatJobDate(job.date_needed) : jobDayLabel(job)) : null;
  const time = startLabel === FLEXIBLE_TIME_LABEL ? null : startLabel;
  // An answer given on another job's sheet is not this job's answer.
  const value = given && given.jobId === job.id ? given : null;
  const suggesting = value !== null;
  const today = platformToday();
  // Q2408 (review): once a window's first day is gone (a past day, or today with its start 15 minutes away or less),
  // "Yes, that works" would book a day accept refuses (job_starts_too_soon). Then only the days still ahead in the
  // window are offered. On day 1 with its start still ahead, Yes stays: pre-filling today there would be the job's
  // own day and time, which apply refuses (suggestion_same_as_job).
  const firstDayGone =
    windowed && !!job.date_needed && (job.date_needed < today || (job.date_needed === today && !todayStillBookable(job.start_time)));
  // Today is offered only while its start is 2+ hours ahead (hiring at a suggested time refuses less:
  // suggestion_too_soon); on the window's last day it is the ONLY day left. Else tomorrow.
  const firstOpenDay = firstDayGone ? (todayStillBookable(job.start_time, new Date(), SUGGESTION_LEAD_MINUTES) ? today : addDays(today, 1)) : null;
  const windowOver = firstDayGone && !!job.date_window_end && firstOpenDay! > job.date_window_end;
  useEffect(() => {
    if (firstDayGone && !windowOver && !value) onChange({ jobId: job.id, date: firstOpenDay!, time: null });
  }, [firstDayGone, windowOver, value, onChange, job.id, firstOpenDay]);

  return (
    <fieldset className="space-y-2 min-w-0" data-testid="apply-time-question" disabled={disabled}>
      <legend className="font-sans font-semibold text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
        {firstDayGone ? (
          "Which day works for you?"
        ) : (
          <>Does {day}{day && time ? " at " : ""}{time && <span data-apply-time="" className="whitespace-nowrap">{time}</span>} work for you?</>
        )}
      </legend>
      {windowed && !firstDayGone && (
        <p className="text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }} data-testid="apply-time-window">
          {jobDayLabel(job)} works for the person who posted this job. To pick another day that week, suggest it below.
        </p>
      )}
      {!firstDayGone && <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={`Does ${when} work for you?`}>
        <ChoicePill
          selected={!suggesting}
          onClick={() => onChange(null)}
          className="justify-center px-3"
          data-testid="apply-time-yes"
        >
          Yes, that works
        </ChoicePill>
        <ChoicePill
          selected={suggesting}
          onClick={() => onChange(value ?? { jobId: job.id, date: job.date_needed && job.date_needed >= today ? job.date_needed : today, time: job.start_time ? job.start_time.slice(0, 5) : null })}
          className="justify-center px-3"
          data-testid="apply-time-suggest"
          // A3-95 (audit 11-01): a short label so the pair stays on one line at 375 (owner 11-01 12:49 PM); the full words stay here.
          aria-label="Suggest another time"
        >
          Other time
        </ChoicePill>
      </div>}
      {suggesting && (
        <div className="grid grid-cols-2 gap-2 min-w-0">
          <label className="flex flex-col gap-1 min-w-0 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.85)" }} htmlFor={`${id}-d`}>
            Day
            <input
              id={`${id}-d`}
              type="date"
              min={firstOpenDay ?? (windowed && job.date_needed! > today ? job.date_needed! : today)}
              max={windowed ? job.date_window_end! : addDays(today, 90)}
              value={value.date}
              onChange={(e) => onChange({ ...value, date: e.target.value })}
              className="min-h-11 w-full min-w-0 rounded-xl border border-border bg-card px-3 text-ds-16"
              data-testid="apply-time-date"
            />
          </label>
          <label className="flex flex-col gap-1 min-w-0 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.85)" }} htmlFor={`${id}-t`}>
            Start time
            <input
              id={`${id}-t`}
              type="time"
              value={value.time ?? ""}
              onChange={(e) => onChange({ ...value, time: e.target.value || null })}
              className="min-h-11 w-full min-w-0 rounded-xl border border-border bg-card px-3 text-ds-16"
              data-testid="apply-time-time"
            />
          </label>
          <p className="col-span-2 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            If they hire you, the job moves to this day{value.time ? " and time" : ` (start time stays ${jobStartTimeLabel(job.start_time, job.is_flexible_schedule) ?? "as posted"})`}.
          </p>
        </div>
      )}
    </fieldset>
  );
}
