import type { ReactNode } from "react";
import { jobStartTimeLabel } from "@/lib/jobDate";
import { jobDayLabel } from "@/lib/jobDateWindow";
import type { JobPageRow } from "./useJobPage";

/** The When row: the day and the start time ("Wed, Nov 11 · 9:00 AM"). */
export function whenLine(job: JobPageRow): string {
  return [
    job.date_needed ? jobDayLabel(job) : null,
    jobStartTimeLabel(job.start_time, job.is_flexible_schedule),
  ].filter(Boolean).join(" · ");
}

/** One label/value row of the job's facts (owner pick 11-08, JP1: When / Where / Visits, like a listing's facts). */
export function FactRow({ label, children, ...rest }: { label: string; children: ReactNode } & Record<`data-${string}`, string>) {
  return (
    <div data-job-fact="" className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <dt className="shrink-0 text-ds-14 text-muted-foreground">{label}</dt>
      <dd {...rest} className="min-w-0 text-right text-ds-14 text-foreground [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
