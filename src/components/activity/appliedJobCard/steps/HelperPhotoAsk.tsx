import { useQueryClient } from "@tanstack/react-query";
import { PhotoProofCaptureChip } from "@/components/PhotoProof";
import { queryKeys } from "@/lib/queryKeys";
import type { Job } from "../../activityConstants";

/**
 * ONE photo ask, belonging to the step the card is on — AS A CONTROL ON THE
 * CARD'S ACTION ROW.
 *
 * Owner, 2026-09-11: uploads "tie to tracker steps instead of sitting
 * always-on… one ask at a time, at the moment it makes sense". The group view
 * (PhotoProofGroup) stays the REVIEW surface — a completed job being looked
 * back on — and is never the ask on a live one.
 *
 * Owner again, 2026-09-19: "before and after buttons should also be on the
 * same lines as the other buttons." This used to render `PhotoProofStep` into
 * the card's `ask` slot: a titled panel with a hint line and a full-width "Add
 * Photo" button, stacked ABOVE the one action row VN-21 asked for. It is now a
 * single chip IN that row, the same object as Message and the primary beside
 * it (`PhotoProofCaptureChip`). The panel is gone rather than left behind with
 * its button removed — a heading and a hint with no control is not an ask.
 *
 * The one-line hint went with it, and that is the deliberate trade: the label
 * ("Before Photo" / "After Photo") plus the dialog's own "Before photos"
 * heading carry it, and the helper's blocked "Mark Job Complete" already
 * states the rule in full (`requiredProof().reason`) at the step where it
 * actually bites.
 *
 * The per-step order, and why:
 *
 *   on site  → Before, and only Before. There is no finished work to photograph.
 *   working  → After FIRST. The owner's state 4 screenshot showed "Add a before
 *              photo" sitting beside a payout request on a job that was already
 *              underway: the wrong step's ask, competing with the step's own.
 *              A still-missing Before is not dropped (the completion trigger
 *              `enforce_helper_completion_gates()` would refuse the job and the
 *              helper would have no way to satisfy it) — it simply falls to
 *              second, so it only ever appears once the After exists.
 *   dispute  → chronological, Before then After: this is evidence, not a step.
 *
 * Once a photo exists its ask is gone, so a satisfied job renders nothing here
 * and the row is one control shorter.
 */
export function HelperPhotoAsk({
  jobId,
  job,
  step,
}: {
  jobId: string;
  job: Job;
  step: "on_site" | "working" | "dispute";
}) {
  // The poster's per-job answer (`jobs.require_photo_proof`). `?? true` because
  // a client running against a database that predates the column must keep
  // today's behaviour — and the migration that adds the column patches the
  // completion trigger in the same file, so the ask can never be hidden on a
  // database whose gate would still refuse the completion.
  const proofRequired = ((job as { require_photo_proof?: boolean | null }).require_photo_proof ?? true) !== false;

  // READ THE JOB BACK AFTER AN UPLOAD — do not wait for realtime to do it.
  //
  // This ask advances on data: once the After photo exists, the Before ask is
  // the one that renders. `PhotoProofStep` defaults its `onUploaded` to a
  // no-op, so the only thing that moved the card forward was the realtime
  // `jobs` subscription in useActivityData invalidating `["activity"]`. That
  // channel is best-effort by this codebase's own account — it drops on a cold
  // native socket, which is why AutoTip reads back explicitly for the same
  // reason. With it down, a helper uploads the After photo, the dialog closes,
  // and the card still says "Add an after photo". They re-upload, or they
  // believe they are done while `enforce_helper_completion_gates` refuses the
  // job for the missing Before — on the step that releases their payout.
  //
  // Invalidating the same key the realtime handler does makes the card's next
  // state certain rather than hopeful; a live channel simply makes it redundant.
  const queryClient = useQueryClient();
  const readBack = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.activity.all });
  };

  if (!proofRequired) return null;

  const beforeUrls = job.proof_before_urls || [];
  const afterUrls = job.proof_after_urls || [];

  const beforeAsk = (
    <PhotoProofCaptureChip
      jobId={jobId}
      type="before"
      existingUrls={beforeUrls}
      onUploaded={readBack}
      label="Before Photo"
    />
  );
  const afterAsk = (
    <PhotoProofCaptureChip
      jobId={jobId}
      type="after"
      existingUrls={afterUrls}
      onUploaded={readBack}
      label="After Photo"
    />
  );

  if (step === "working") {
    if (afterUrls.length === 0) return afterAsk;
    if (beforeUrls.length === 0) return beforeAsk;
    return null;
  }
  // on_site and dispute both start from the Before.
  if (beforeUrls.length === 0) return beforeAsk;
  if (step === "dispute" && afterUrls.length === 0) return afterAsk;
  return null;
}
