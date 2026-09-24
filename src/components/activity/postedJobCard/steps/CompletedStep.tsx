import { useState } from "react";
import { DollarSign, CheckCircle2, Star, RotateCcw, Image } from "lucide-react";
import { JobStepCard } from "@/components/activity/JobStepCard";
import { JobActionChip } from "../../JobActionRow";
import { PhotoProofDialog } from "@/components/PhotoProof";
import type { PosterStepCtx } from "./posterStepContract";
import { reviewWindowOpen } from "@/lib/reviewWindow";

/**
 * POSTER STEP 4 — done.
 *
 * Nothing is being asked and nothing is primary: the job is over and every
 * remaining control is optional. So this state is a review surface plus one
 * row — Tip · Review · Hire Again.
 *
 * No Dispute and no Report Job here (owner rule, 2026-09-14, VN-28: "they
 * can't report a job once it's done"). This reverses the earlier 7-day
 * post-completion dispute window and the Done-tab Report Job chip.
 *
 * The proof is a BUTTON on that row now, not a panel above it (owner item 10,
 * 2026-09-19: "before & after pictures" goes on the same row as the other
 * action buttons). It still renders only when there ARE photos (owner: "move
 * to the collapsed part") — an empty group printed two rows of chrome to
 * report an absence, and an empty gallery behind a chip would be a dead tap.
 */
export function CompletedStep({
  job,
  helperNames,
  completedJobMeta,
  navigate,
  onTip,
  onReview,
}: PosterStepCtx) {
  const [photosOpen, setPhotosOpen] = useState(false);
  const meta = completedJobMeta[job.id];
  const hasTipped = meta?.tipped;
  const hasReviewed = meta?.reviewed;
  const helperName = job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr";
  const hasProof = (job.proof_before_urls?.length ?? 0) > 0 || (job.proof_after_urls?.length ?? 0) > 0;

  // Approving completion leaves the job at 'payout_pending' until the transfer
  // settles, so gating Review on 'released' hid it during exactly the window
  // when the app auto-opens the rating sheet. Matches the reviews INSERT policy.
  // DH-003: once the review window has closed, "Reviewed" still shows but an
  // unreviewed job no longer offers a Review the server would refuse.
  const canReview =
    (job.payment_status === "released" || job.payment_status === "payout_pending") &&
    (!!hasReviewed || reviewWindowOpen(job));

  return (
    <JobStepCard
      side="poster"
      step="completed"
      actions={[
        /* The before & after pictures, first in the row: the quietest control
           here and the only one that isn't a fresh decision — Tip, Review and
           Hire Again all are, and the owner's primary-right rule (V2/V3) keeps
           the loudest of them on the right. */
        hasProof ? (
          <JobActionChip
            key="photos"
            icon={Image}
            label="Photos"
            ariaLabel="Photos — the before and after proof photos from this job"
            tone="neutral"
            onClick={() => setPhotosOpen(true)}
          />
        ) : null,
        /* TIP IS NOT GATED ON THE HELPER BEING PAYABLE, and this component
           cannot gate it: `create-payment` refuses a tip outright when the
           helper has no `profiles.stripe_account_id`, and nothing in scope here
           carries that fact. Gating it needs a `helperPayoutReady` map built
           beside `helperNames`. Not guessed at here. */
        !hasTipped ? (
          <JobActionChip
            key="tip"
            icon={DollarSign}
            label="Tip"
            ariaLabel={`Tip ${helperName}`}
            tone="boost"
            onClick={() => onTip(job.id, helperName)}
          />
        ) : (
          <JobActionChip
            key="tip"
            icon={CheckCircle2}
            label="Tipped"
            ariaLabel={`Tipped — you already tipped ${helperName}`}
            tone="done"
            disabled
            onClick={() => {}}
          />
        ),
        canReview
          ? !hasReviewed
            ? (
              <JobActionChip
                key="review"
                icon={Star}
                label="Review"
                ariaLabel={`Review — leave a review for ${helperName}`}
                tone="edit"
                onClick={() => onReview(job)}
              />
            )
            : (
              <JobActionChip
                key="review"
                icon={CheckCircle2}
                label="Reviewed"
                ariaLabel={`Reviewed — you already reviewed ${helperName}`}
                tone="done"
                disabled
                onClick={() => {}}
              />
            )
          : null,
        /* Hire again — direct offer to the same helper: PostJob with offerTo +
           rebook, so the form is prefilled AND the offer skips the queue. */
        job.helper_id ? (
          <JobActionChip
            key="again"
            icon={RotateCcw}
            label="Hire Again"
            ariaLabel={`Hire Again — hire ${helperName} for a new job`}
            tone="primary"
            onClick={() => navigate(`/post-job?rebook=${job.id}&offerTo=${job.helper_id}`)}
          />
        ) : (
          <JobActionChip
            key="again"
            icon={RotateCcw}
            label="Re-Post"
            ariaLabel="Re-Post — post this job again"
            tone="primary"
            onClick={() => navigate(`/post-job?rebook=${job.id}`)}
          />
        ),
      ]}
      dialogs={
        <PhotoProofDialog
          open={photosOpen}
          onOpenChange={setPhotosOpen}
          beforeUrls={job.proof_before_urls || []}
          afterUrls={job.proof_after_urls || []}
        />
      }
    />
  );
}
