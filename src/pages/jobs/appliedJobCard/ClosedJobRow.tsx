import { formatJobDate } from "@/lib/dateUtils";

/**
 * JOBS-12: the row for a job that has closed to this Helpr. It names the job when its title and date can still be
 * read (get_closed_application_job_labels); a job with no row left keeps the plain line.
 */
export function ClosedJobRow({ label, status }: { label?: { title: string | null; date_needed: string | null } | null; status: string }) {
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
