import { report } from "@/lib/errorLogger";
import type { HaulAwayRow } from "@/lib/declutter/haulAwayParam";

type HaulLib = typeof import("@/lib/declutter/haulAway");

/**
 * My listings' haul-away actions (Put back on sale, Finish booking), moved out of DeclutterHomeView unchanged
 * (train 1122c: that file was over the 600-line component threshold, src/test/componentSizeRatchet.test.ts).
 * An unpaid haul-away's job is deleted first (its checkout can then never be opened again), then the item is put back
 * or booked on a new job. Only a 'job_open' job is deleted (never a cancelled one, whose photos and record stay). A
 * declined card's job ('job_stuck') can't be deleted by its poster, so it is never tried: reported, and the seller is
 * told it can't be removed from here; a delete the policy refuses anyway is reported inside deleteNeverPaidHaulJob
 * (unwrapMutation) and told the same way.
 * `lib` is loaded by the caller BEFORE anything is deleted: work that has written must never wait on a reload.
 */
export async function releaseHaulJob(row: HaulAwayRow, lib: HaulLib): Promise<void> {
  // Its words ride on userMessage (declutterErrorMessage shows them): the
  // haul-away copy loads with the haul-away code, never on /posts (Q178).
  const stuck = () => Object.assign(new Error("haul_away_job_stuck"), { userMessage: lib.HAUL_AWAY_CLIENT_ERROR_COPY.haul_away_job_stuck });
  if (row.job_hold === "job_stuck") {
    report(new Error("haul-away job is stuck: a declined card, and the person who posted it can't delete it"), {
      severity: "warning",
      tags: { source: "DeclutterHome.releaseHaulJob" },
      context: { job_id: row.job_id },
    });
    throw stuck();
  }
  const jobId = lib.haulJobToDelete(row);
  if (jobId && !(await lib.deleteNeverPaidHaulJob(jobId))) throw stuck();
}
