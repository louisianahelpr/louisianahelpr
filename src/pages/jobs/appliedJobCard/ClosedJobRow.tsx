import type { Ref } from "react";
import { formatJobDate } from "@/lib/dateUtils";
import { JobCardShell } from "@/components/job-card/JobCardShell";

/**
 * JOBS-12: the row for a job that has closed to this Helpr. It names the job when its title and date can still be
 * read (get_closed_application_job_labels); a job with no row left keeps the plain line.
 */
type ClosedLabel = { title: string | null; date_needed: string | null } | null;

export function ClosedJobRow({ label, status }: { label?: ClosedLabel; status: string }) {
  const title = label?.title?.trim();
  if (!title) {
    return (
      <>
        <p className="text-ds-13 font-medium" style={{ color: "hsl(var(--ink-deep))" }}>{status}</p>
        <p className="text-ds-11 text-muted-foreground">This job has closed, so its details aren’t available any more.</p>
      </>
    );
  }
  return (
    <>
      <p className="text-ds-13 font-medium truncate" style={{ color: "hsl(var(--ink-deep))" }}>{title}</p>
      <p className="text-ds-11 text-muted-foreground">
        {label?.date_needed ? `${formatJobDate(label.date_needed)} · ` : ""}{status}
      </p>
    </>
  );
}

/** The whole card for an application whose job row the Helpr can no longer read (AppliedJobCard's `!job` case). */
export function ClosedJobCard({ cardRef, label, status }: { cardRef: Ref<HTMLDivElement>; label?: ClosedLabel; status: string }) {
  return (
    <div ref={cardRef}>
      <JobCardShell expandable={false} expanded={false} onToggle={() => {}}>
        <div className="px-4 py-3 space-y-1">
          <ClosedJobRow label={label} status={status} />
        </div>
      </JobCardShell>
    </div>
  );
}
