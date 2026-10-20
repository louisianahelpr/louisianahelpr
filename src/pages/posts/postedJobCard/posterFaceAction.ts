import { useState } from "react";
import type { PosterWait } from "@/components/job-card/jobStatusLine";
import type { MineFaceAction } from "@/components/job-card/MineJobFace";
import type { Job } from "../../../components/job-card/activityConstants";

/**
 * The ONE button on the poster's Posted card face (board 14; lead 2026-10-20:
 * "the card's REAL next step whenever there is one ... Manage job only as the
 * fallback when the next step is just waiting").
 *
 * It reads the same `PosterWait` the status line under the title prints, so
 * the button can never disagree with the sentence above it. Each real step
 * runs the SAME handler the expanded card's step row runs:
 *   applicants        -> the applicants panel (onLoadApplications)
 *   confirm_arrival   -> onConfirmArrival (the ladder's rung, already gated by derivePosterWait)
 *   approve           -> opens the card and its completion sheet (the sheet is the confirmation; never a one-tap release)
 *   done_*_open       -> onReview / onTip (a crew's per-member tips live in the card)
 *   stalled           -> Message <Helpr> (there is no poster "done" path)
 *   cancelled         -> Post again (/post-job?rebook=)
 * Everything else opens the card's own controls in place.
 */
export interface PosterFaceHandlers {
  pendingApplicants: number;
  helperName: string;
  confirmingArrival: boolean;
  completing: boolean;
  openApplicants: () => void;
  confirmArrival: () => void;
  approve: () => void;
  review: () => void;
  tip: () => void;
  postAgain: () => void;
  message: () => void;
  manage: () => void;
}

/** "Hallie H." -> "Hallie": a button label names the person, short. */
const first = (name: string) => name.trim().split(/\s+/)[0] || name;

export function posterFaceAction(
  wait: PosterWait,
  job: Pick<Job, "is_group_job">,
  h: PosterFaceHandlers,
): MineFaceAction {
  switch (wait) {
    case "applicants":
      return {
        label: `Review ${h.pendingApplicants} applicant${h.pendingApplicants === 1 ? "" : "s"}`,
        onClick: h.openApplicants,
        tone: "primary",
      };
    case "confirm_arrival":
      return {
        label: h.confirmingArrival ? "Confirming…" : "Confirm arrival",
        onClick: h.confirmArrival,
        tone: "primary",
        disabled: h.confirmingArrival,
      };
    case "approve":
      return {
        label: "Approve and release",
        onClick: h.approve,
        tone: "primary",
        disabled: h.completing,
      };
    case "done_review_open":
    case "done_both_open":
      return { label: "Leave a review", onClick: h.review, tone: "primary" };
    case "done_tip_open":
      // A crew is tipped member by member, in the card.
      return job.is_group_job
        ? { label: "Manage job", onClick: h.manage, tone: "secondary" }
        : { label: `Tip ${first(h.helperName)}`, onClick: h.tip, tone: "primary" };
    case "stalled":
      // No poster "it's done" path exists: a stalled job is released or refunded
      // only by a person (STALLED_APPROVE_DISABLED_REASON). Talking to them is.
      // Secondary (lead 2026-10-20): filled olive is kept for money and real next steps.
      return { label: `Message ${first(h.helperName)}`, onClick: h.message, tone: "secondary" };
    case "cancelled":
      return { label: "Post again", onClick: h.postAgain, tone: "secondary" };
    default:
      return { label: "Manage job", onClick: h.manage, tone: "secondary" };
  }
}

/** The Posted card's wiring of the face button to its real handlers (PostedJobCard). */
export function usePosterFaceAction(a: {
  job: Job;
  wait: PosterWait;
  isExpanded: boolean;
  helperName: string;
  pendingApplicants: number;
  confirmingArrival: boolean;
  completing: boolean;
  toggle: (id: string) => void;
  navigate: (to: string) => void;
  onLoadApplications: (job: Job) => void;
  onConfirmArrival: (jobId: string) => void;
  onReview: (job: Job) => void;
  onTip: (jobId: string, helperName: string) => void;
}): { faceAction: MineFaceAction; completionRequest: number } {
  const { job, toggle } = a;
  // Bumped by "Approve and release": PostedJobActions opens its completion sheet.
  const [completionRequest, setCompletionRequest] = useState(0);
  const faceAction = posterFaceAction(a.wait, job, {
    pendingApplicants: a.pendingApplicants,
    helperName: a.helperName,
    confirmingArrival: a.confirmingArrival,
    completing: a.completing,
    openApplicants: () => a.onLoadApplications(job),
    confirmArrival: () => a.onConfirmArrival(job.id),
    approve: () => {
      if (!a.isExpanded) toggle(job.id);
      setCompletionRequest((n) => n + 1);
    },
    review: () => a.onReview(job),
    tip: () => a.onTip(job.id, a.helperName),
    postAgain: () => a.navigate(`/post-job?rebook=${job.id}`),
    message: () => a.navigate(job.helper_id ? `/messages?jobId=${job.id}&userId=${job.helper_id}` : "/messages"),
    manage: () => toggle(job.id),
  });
  return { faceAction, completionRequest };
}
