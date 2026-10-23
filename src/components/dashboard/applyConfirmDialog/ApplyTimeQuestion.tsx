import { useId } from "react";
import { formatJobDate } from "@/lib/dateUtils";
import { jobStartTimeLabel } from "@/lib/jobDate";
import type { EnrichedJob } from "@/components/dashboard/types";

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
function platformToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
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
  const when = [job.date_needed ? formatJobDate(job.date_needed) : null, jobStartTimeLabel(job.start_time, job.is_flexible_schedule)]
    .filter(Boolean)
    .join(" at ");
  // An answer given on another job's sheet is not this job's answer.
  const value = given && given.jobId === job.id ? given : null;
  const suggesting = value !== null;
  const today = platformToday();

  return (
    <fieldset className="space-y-2 min-w-0" data-testid="apply-time-question" disabled={disabled}>
      <legend className="font-sans font-semibold text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
        Does {when} work for you?
      </legend>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={`Does ${when} work for you?`}>
        <button
          type="button"
          role="radio"
          aria-checked={!suggesting}
          onClick={() => onChange(null)}
          className={`min-h-11 rounded-xl border px-3 text-ds-14 font-semibold transition-colors ${!suggesting ? "border-[hsl(var(--bark))] bg-[hsl(var(--bark)/0.08)]" : "border-border bg-card"}`}
          data-testid="apply-time-yes"
        >
          Yes, that works
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={suggesting}
          onClick={() => onChange(value ?? { jobId: job.id, date: job.date_needed && job.date_needed >= today ? job.date_needed : today, time: job.start_time ? job.start_time.slice(0, 5) : null })}
          className={`min-h-11 rounded-xl border px-3 text-ds-14 font-semibold transition-colors ${suggesting ? "border-[hsl(var(--bark))] bg-[hsl(var(--bark)/0.08)]" : "border-border bg-card"}`}
          data-testid="apply-time-suggest"
        >
          Suggest another time
        </button>
      </div>
      {suggesting && (
        <div className="grid grid-cols-2 gap-2 min-w-0">
          <label className="flex flex-col gap-1 min-w-0 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.85)" }} htmlFor={`${id}-d`}>
            Day
            <input
              id={`${id}-d`}
              type="date"
              min={today}
              max={addDays(today, 90)}
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
