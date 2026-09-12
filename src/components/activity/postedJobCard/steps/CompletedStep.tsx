import { DollarSign, CheckCircle2, Star, AlertTriangle, RotateCcw, Flag } from "lucide-react";
import { JobStepCard } from "@/components/activity/JobStepCard";
import { JobActionChip } from "../../JobActionRow";
import { PhotoProofGroup } from "@/components/PhotoProof";
import { shouldShowDisputeLink } from "@/components/jobs/DisputeLink";
import type { PosterStepCtx } from "./posterStepContract";

/**
 * POSTER STEP 4 — done.
 *
 * Nothing is being asked and nothing is primary: the job is over and every
 * remaining control is optional. So this state is a review surface plus one
 * row — Tip · Review · Dispute · Hire Again · Report Job.
 *
 * The proof group renders only when there ARE photos (owner: "move to the
 * collapsed part") — an empty group printed two rows of chrome to report an
 * absence.
 */
export function CompletedStep({
  job,
  helperNames,
  completedJobMeta,
  navigate,
  onTip,
  onReview,
  onDispute,
  onReport,
}: PosterStepCtx) {
  const meta = completedJobMeta[job.id];
  const hasTipped = meta?.tipped;
  const hasReviewed = meta?.reviewed;
  const helperName = job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr";
  const hasProof = (job.proof_before_urls?.length ?? 0) > 0 || (job.proof_after_urls?.length ?? 0) > 0;

  // Approving completion leaves the job at 'payout_pending' until the transfer
  // settles, so gating Review on 'released' hid it during exactly the window
  // when the app auto-opens the rating sheet. Matches the reviews INSERT policy.
  const canReview = job.payment_status === "released" || job.payment_status === "payout_pending";
  // NOT after the poster approved (owner: "if the job is already marked
  // complete this should not be an option"). A job that auto-released without
  // them ever approving keeps the 7-day window: they never got their say.
  const canDispute = !job.poster_completed_at && shouldShowDisputeLink(job, "customer");

  return (
    <JobStepCard
      side="poster"
      step="completed"
      ask={
        hasProof ? (
          <PhotoProofGroup
            jobId={job.id}
            beforeUrls={job.proof_before_urls || []}
            afterUrls={job.proof_after_urls || []}
            canUpload={false}
          />
        ) : null
      }
      actions={[
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
        canDispute ? (
          <JobActionChip
            key="dispute"
            icon={AlertTriangle}
            label="Dispute"
            ariaLabel="Dispute — something wrong? open a dispute about this job"
            tone="danger"
            onClick={() => onDispute(job)}
          />
        ) : null,
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
        /* Report — a distinct escape hatch from Dispute: that is a payment
           disagreement while the job is still settling, this is a conduct or
           safety concern once it is over. ReportDialog opens with
           reportedType="job", so the spoken name promises only the job. */
        <JobActionChip
          key="report"
          icon={Flag}
          label="Report Job"
          ariaLabel="Report Job — report a problem with this job"
          tone="danger"
          onClick={() => onReport(job)}
        />,
      ]}
    />
  );
}
