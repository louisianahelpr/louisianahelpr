import { CalendarClock } from "lucide-react";
import { formatJobDate } from "@/lib/dateUtils";
import { jobStartTimeLabel } from "@/lib/jobDate";

/**
 * "Suggests Sun, Oct 25 at 2:00 PM" on an applicant's card (owner 2026-10-23): the day/time they
 * asked for when they applied. Hiring them agrees to it (ResponseDeadlineDialog says so before Send).
 * Nothing renders when they said the job's own time works.
 */
function applicantSuggestedTimeLabel(
  app: { suggested_date?: string | null; suggested_start_time?: string | null },
  jobStartTime?: string | null,
): string | null {
  if (!app.suggested_date) return null;
  const time = jobStartTimeLabel(app.suggested_start_time ?? jobStartTime ?? null);
  return [formatJobDate(app.suggested_date), time].filter(Boolean).join(" at ");
}

export function ApplicantSuggestedTime({
  app,
  jobStartTime,
}: {
  app: { suggested_date?: string | null; suggested_start_time?: string | null };
  jobStartTime?: string | null;
}) {
  const label = applicantSuggestedTimeLabel(app, jobStartTime);
  if (!label) return null;
  return (
    <span
      className="mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-ds-12 font-sans font-semibold"
      style={{ background: "hsl(var(--bark) / 0.08)", color: "hsl(var(--ink-deep))" }}
      data-applicant-suggested-time=""
    >
      <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Suggests {label}
    </span>
  );
}
