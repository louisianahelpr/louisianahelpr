import { useState } from "react";
import type { PosterWait } from "@/components/job-card/jobStatusLine";
import type { MineFaceAction } from "@/components/job-card/MineJobFace";
import type { Job } from "../../../components/job-card/activityConstants";
import { requestFaceAction } from "@/components/job-card/faceActionRequest";
import { useHelprTakesTips } from "@/hooks/useHelprTakesTips";

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
  /** F29: false when the Helpr's payout setup is not finished (useHelprTakesTips); the face then offers no tip. */
  tipsReady?: boolean | null;
  postAgain: () => void;
  message: () => void;
  manage: () => void;
  /** Opens the card and asks its JobConfirmation for the day-before confirm (faceActionRequest). */
  confirm: () => void;
  /** The card's own No-Show dialog (ActivityDialogs). */
  noShow: () => void;
  /** The card's own Cancel job dialog. */
  cancel: () => void;
  /** The dispute's timeline and evidence (the card's View dispute). */
  viewDispute: () => void;
}

/** "Hallie H." -> "Hallie": a button label names the person, short. */
const first = (name: string) => name.trim().split(/\s+/)[0] || name;

export function posterFaceAction(
  wait: PosterWait,
  job: Pick<Job, "is_group_job"> & { helper_id?: string | null },
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
        label: h.confirmingArrival ? "Confirming…" : "Confirm they've arrived",
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
    case "done_tip_open_review_closed":
      // A crew is tipped member by member, in the card.
      return job.is_group_job || h.tipsReady === false
        ? { label: "Manage job", onClick: h.manage, tone: "secondary" }
        : { label: `Tip ${first(h.helperName)}`, onClick: h.tip, tone: "primary" };
    case "stalled":
      // No poster "it's done" path exists: a stalled job is released or refunded
      // only by a person (STALLED_APPROVE_DISABLED_REASON). Talking to them is.
      // Secondary (lead 2026-10-20): filled olive is kept for money and real next steps.
      return { label: `Message ${first(h.helperName)}`, onClick: h.message, tone: "secondary" };
    case "cancelled":
      return { label: "Post again", onClick: h.postAgain, tone: "secondary" };
    /* THE BUTTON DOES WHAT THE LINE ASKS (owner, 2026-10-23, card critique items 1, 2, 15). The day-before
       confirm is owed: the confirm itself, through the card's own dialog. Past the day: the line's own action
       (No-Show? / cancel?), secondary because it is not the job's next step. A dispute: open it. */
    case "confirm_still_on":
      return { label: "I'm still on", onClick: h.confirm, tone: "primary" };
    case "overdue_no_show":
    case "started_no_checkin":
      // started_no_checkin: the start passed with no check-in (A2-B12), the same choice, on the face, not under More.
      return { label: "Report no-show", onClick: h.noShow, tone: "secondary" };
    case "overdue_unhired":
    case "overdue_unconfirmed":
    case "overdue_not_started":
    case "overdue_not_arrived":
      return { label: "Cancel job", onClick: h.cancel, tone: "secondary" };
    case "dispute":
    case "dispute_escalated":
      return { label: "Open the dispute", onClick: h.viewDispute, tone: "secondary" };
    case "no_applicants":
      // Poster is waiting for Helprs to apply — no real next step. step: "waiting" keeps faceTakesStep
      // false so the open tracker's bar stays on "Posted" (its own sameStep sentence), not the card's
      // "No applicants yet" (which is only the collapsed-card label, not a tracker instruction).
      return { label: "Manage job", onClick: h.manage, tone: "secondary", step: "waiting" };
    default:
      // WAITING ON THE HELPR (owner, 2026-10-23, card critique item 13; board 14): the one button talks to them,
      // and "Manage job" (the card's controls) is a small text link beside it. No Helpr yet, or a crew: Manage job.
      return job.helper_id && !job.is_group_job
        ? { label: `Message ${first(h.helperName)}`, onClick: h.message, tone: "secondary", also: { label: "Manage job", onClick: h.manage } }
        : { label: "Manage job", onClick: h.manage, tone: "secondary" };
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
  onNoShow: (jobId: string) => void;
  onCancel: (job: Job) => void;
  onViewDispute: (job: Job) => void;
}): { faceAction: MineFaceAction; completionRequest: number } {
  const { job, toggle } = a;
  const tipsReady = useHelprTakesTips(job.helper_id, (a.wait === "done_tip_open" || a.wait === "done_tip_open_review_closed") && !job.is_group_job);
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
    tipsReady,
    postAgain: () => a.navigate(`/post-job?rebook=${job.id}`),
    message: () => a.navigate(job.helper_id ? `/messages?jobId=${job.id}&userId=${job.helper_id}` : "/messages"),
    manage: () => toggle(job.id),
    confirm: () => {
      requestFaceAction(job.id, "confirm");
      if (!a.isExpanded) toggle(job.id);
    },
    noShow: () => a.onNoShow(job.id),
    cancel: () => a.onCancel(job),
    viewDispute: () => a.onViewDispute(job),
  });
  return { faceAction, completionRequest };
}
