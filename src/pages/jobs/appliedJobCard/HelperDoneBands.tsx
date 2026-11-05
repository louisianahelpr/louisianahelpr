import { CheckCircle2, Star, Image } from "lucide-react";
import { PhotoProofDialog } from "@/components/PhotoProof";
import { JobActionRow, JobActionChip, JobStepPrimaryButton } from "../../../components/job-card/JobActionRow";
import { HelperSeriesRow } from "@/components/series/JobSeriesCardControls";
import type { Job } from "../../../components/job-card/activityConstants";
import type { AppliedJobCardProps } from "./types";

/** The card's closing bands: a done job's photos + review, the no-action fallback, the recurring series row. Moved verbatim from AppliedJobCard (Q806). */
export function HelperDoneBands({
  app, job, userId, helperReviewedJobIds, onHelperReview, isCompleted, isFullyDone, isExpanded, isMinimalCard, hasActionSection, canLeaveReview, hasProof, posterId, photosOpen, setPhotosOpen,
}: Pick<AppliedJobCardProps, "app" | "userId" | "helperReviewedJobIds" | "onHelperReview"> & {
  job: Job; isCompleted: boolean; isFullyDone: boolean; isExpanded: boolean; isMinimalCard: boolean; hasActionSection: boolean;
  canLeaveReview: boolean; hasProof: boolean; posterId: string | null; photosOpen: boolean; setPhotosOpen: (open: boolean) => void;
}) {
  return (
    <>
          {/* Completed - not yet reviewed: the proof photos and the review, as
              two chips on one row.

              The BAND itself is gated on having something to put in it. It used
              to be unconditional because the proof panel was unconditional —
              it printed "No photos were uploaded for this job" on a job with
              none. With the panel gone that would leave a bordered strip with
              nothing in it, which is the silent-band defect this card already
              has a fallback for further down. */}
          {isCompleted && !isFullyDone && isExpanded && (canLeaveReview || hasProof) && (
            <div className="px-4 py-3 border-t border-[hsl(var(--olivewood)/0.1)] bg-card space-y-2.5" onClick={(e) => e.stopPropagation()}>
              {/* Same icon-over-label chip PostedJobCard's completed state
                  uses for Review/Reviewed — this was a plain full-width
                  outline Button, the one place the two Done-tab cards
                  visibly diverged in style. */}
              {/* `payout_pending` counts too. Migration
                  20260825053000_reviews_allow_payout_pending.sql widened the
                  reviews INSERT policy to accept BOTH settlement states for
                  exactly this reason — payment_status only becomes 'released'
                  when the payout actually settles, ~24h later. The poster's
                  gate (PostedJobActions.tsx:533) was updated; the helper's was
                  not, so the helper was locked out for a full day while the
                  poster's review sat hidden behind feedback_visible_at waiting
                  for a counter-review that could not be written. */}
              {/* `posterId &&`: a review needs a reviewee. On an ownerless job
                  there is no account to address one to, and the INSERT would
                  fail on a null `reviewee_id` — so the chip doesn't render
                  rather than offering an action that cannot complete. */}
              {/* ONE row: the photos beside the review, rather than a proof
                  PANEL stacked above a one-chip row. `columns` is passed, not
                  counted, so an absent chip yields a deliberate one-up row
                  (JobActionRow). The Photos chip is gated on there BEING
                  photos — a chip is a tap, and an empty gallery is a dead
                  end — which is why this card no longer prints "No photos were
                  uploaded for this job" when a job has none. */}
              <JobActionRow columns={canLeaveReview && hasProof ? 2 : 1}>
                {hasProof ? (
                  <JobActionChip
                    icon={Image}
                    label="Photos"
                    ariaLabel="Photos — the before and after proof photos from this job"
                    tone="neutral"
                    onClick={() => setPhotosOpen(true)}
                  />
                ) : null}
                {!canLeaveReview ? null : helperReviewedJobIds.has(app.job_id) ? (
                  <JobActionChip
                    icon={CheckCircle2}
                    label="Reviewed"
                    ariaLabel="Already reviewed the person who posted this job"
                    tone="done"
                    disabled
                    onClick={() => {}}
                  />
                ) : (
                  // The card's next move, so a PRIMARY on the right (owner, 2026-10-08).
                  <JobStepPrimaryButton
                    icon={Star}
                    label="Leave a Review"
                    ariaLabel="Leave a review for the person who posted this job"
                    onClick={() => onHelperReview(app.job_id, posterId!, app.posterName || "the person who posted this job")}
                  />
                )}
              </JobActionRow>
              <PhotoProofDialog
                open={photosOpen}
                onOpenChange={setPhotosOpen}
                beforeUrls={job.proof_before_urls || []}
                afterUrls={job.proof_after_urls || []}
              />
              {/* No dispute link on a completed job (owner, 2026-09-14,
                  VN-28: "they can't report a job once it's done") — this
                  replaced the issue-#113 7-day post-completion link. */}
            </div>
          )}

          {/* Fully done (reviewed): "Reviewed" rides the ONE bottom line
              (HelperCollapsedStrip `reviewed`), no band of its own (owner,
              2026-10-08: "There should only be one section at the bottom"). */}
          {isFullyDone && isExpanded && hasProof && (
            <div className="px-4 py-3 border-t border-[hsl(var(--olivewood)/0.1)] bg-card space-y-2.5" onClick={(e) => e.stopPropagation()}>
              {/* The same Photos button as the completed-not-reviewed branch
                  above (owner item 10). Alone in its row here: on a job that is
                  finished AND reviewed there is nothing else left to do. The
                  band no longer renders at all when the job has no photos,
                  where it used to print an empty proof panel. */}
              <JobActionRow columns={1}>
                <JobActionChip
                  icon={Image}
                  label="Photos"
                  ariaLabel="Photos — the before and after proof photos from this job"
                  tone="neutral"
                  onClick={() => setPhotosOpen(true)}
                />
              </JobActionRow>
              <PhotoProofDialog
                open={photosOpen}
                onOpenChange={setPhotosOpen}
                beforeUrls={job.proof_before_urls || []}
                afterUrls={job.proof_after_urls || []}
              />
            </div>
          )}


          {/* Last resort: a live application that matched NO action section.
              Two cards in visibly the same state, one with a Withdraw button
              and one with nothing under it, is what the owner reported — and
              the blank one was not "no actions available", it was a state the
              card had no branch for. The branch gap itself is fixed above
              (`isAssigned` now trusts the application's own status), but a card
              must never again go silent: if some future status slips through,
              say so rather than rendering an empty band. */}
          {!isMinimalCard && !hasActionSection && (
            <div
              className="px-4 py-2.5"
              style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.10)" }}
            >
              <p className="text-ds-11 text-muted-foreground">
                No actions available on this application right now — open the job to see where it stands.
              </p>
            </div>
          )}

          {/* Footer: the recurring series row */}
          {/* No group-size line here: it moved into the meta row, after the time
              (owner), not below the helper's controls; see `helpersNeeded`. No
              photos here either: they sat below the buttons (owner 2026-10-06). */}
          {!isMinimalCard && (!isFullyDone || isExpanded) && job.is_recurring && (
            <div className="px-4 py-2.5 border-t border-border/20 space-y-2">
              {job.is_recurring && <HelperSeriesRow job={job} userId={userId} />}
            </div>
          )}
    </>
  );
}
