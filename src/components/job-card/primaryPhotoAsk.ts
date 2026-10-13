/**
 * Which photo, if any, IS the Helpr card's primary — one rule for the expanded
 * card's row and its collapsed line.
 *
 * Owner, 2026-10-08 ("photo first"): on a one-Helpr job the owed before photo
 * is the on-site step's primary, and the owed after photo the working step's,
 * until taken. HelperPhotoAsk draws that primary; the collapsed status line
 * (jobStatusLine `before_photo`) names the same step. They used to disagree:
 * an arrived Helpr with no before photo saw "Take Before Photo" expanded and
 * "Finish and mark it done" collapsed (seed job 90aa6c8b at 375, 2026-10-12).
 *
 * Pure: no React, no query. Guard: src/test/collapsedLineNamesThePhotoPrimary.test.ts.
 */
import type { Job } from "./activityConstants";

export type PhotoAsk = "before" | "after";
export type PhotoStep = "on_site" | "working" | "dispute" | "revision";

/** The poster's per-job answer. `?? true`: a row from before the column keeps the old always-ask rule. */
export function photoProofRequired(job: Pick<Job, "id">): boolean {
  return ((job as { require_photo_proof?: boolean | null }).require_photo_proof ?? true) !== false;
}

/** The photo that is the row's primary at this step, or null (a crew has no photo primary). */
export function primaryPhotoAsk(args: {
  crew: boolean;
  step: PhotoStep;
  beforeCount: number;
  afterCount: number;
}): PhotoAsk | null {
  if (args.crew) return null;
  if (args.step === "working" && args.afterCount === 0) return "after";
  if (args.step === "on_site" && args.beforeCount === 0) return "before";
  return null;
}

/**
 * The same question at the working step (work underway, which only the
 * tracking row knows: the caller asks only then). The owed after photo is that
 * step's primary on a one-Helpr job until it is taken.
 */
export function afterPhotoIsThePrimary(job: Job): boolean {
  if (!photoProofRequired(job) || !job.helper_arrived_at) return false;
  return (
    primaryPhotoAsk({
      crew: job.is_group_job === true,
      step: "working",
      beforeCount: (job.proof_before_urls ?? []).length,
      afterCount: (job.proof_after_urls ?? []).length,
    }) === "after"
  );
}

/**
 * The collapsed line's question: is this arrived one-Helpr job's primary the
 * before photo? With no before photo the Helpr cannot be at the working step
 * (Start Working is refused server-side until it exists:
 * tracker_requires_before_photo), so an arrived job with none is on its
 * on-site step, whose primary is that photo.
 */
export function beforePhotoIsThePrimary(job: Job): boolean {
  if (!job.helper_arrived_at || !photoProofRequired(job)) return false;
  return (
    primaryPhotoAsk({
      crew: job.is_group_job === true,
      step: "on_site",
      beforeCount: (job.proof_before_urls ?? []).length,
      afterCount: (job.proof_after_urls ?? []).length,
    }) === "before"
  );
}
