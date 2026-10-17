import { lazy, Suspense } from "react";
import { report } from "@/lib/errorLogger";

// Rentals (owner Q41): the hired Helpr offers the tenant a visit time on a job
// posted from a repair request. Lazy (off /posts' shared chunk); renders nothing
// for every other job. A chunk that cannot load renders nothing (reported).
const RentalVisitHelpr = lazy(() =>
  import("@/components/rentals/RentalVisitHelpr").catch((err: unknown) => {
    report(err, { severity: "warning", tags: { source: "AppliedJobCard.rentalVisit" } });
    return { default: () => null };
  }),
);
const VISIT_STATUSES = new Set(["accepted", "in_progress", "revision_requested"]);

/** The visit-time offer on a hired Helpr's open card, only while the job is live. */
export function RentalVisitHelprSlot({ jobId, jobStatus, show }: { jobId: string; jobStatus: string | null | undefined; show: boolean }) {
  if (!show || !VISIT_STATUSES.has(jobStatus ?? "")) return null;
  return (
    <Suspense fallback={null}>
      <RentalVisitHelpr jobId={jobId} />
    </Suspense>
  );
}
