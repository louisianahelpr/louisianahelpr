import type { MineFaceAction } from "@/components/job-card/MineJobFace";
import type { TrackingData } from "@/components/JobTracking";
import { requestHelperStep } from "@/components/job-card/helperStepRequest";

/** The tracker step the face can take directly, with the face's sentence-case label. */
type HelperFaceStep = { jobId: string; key: "on_the_way" | "arrived" | "working" | "done"; label: string };

/**
 * The Helpr's next tracker step, read from the job's own stamps (boards 62 and 64). Mirrors
 * the tracker's order (STATUSES in JobTracking) and its one name-keyed gate: On my way needs
 * the Helpr's own day-before confirm (helper_dayof_confirmed_at, Q1570). Before that, and
 * once Done is stamped, there is no direct step and the face keeps "Manage job". If the
 * tracker still disagrees, its own gates win: the request is dropped and the card just opens.
 */
export function helperFaceNextStep(
  job: { id: string; status?: string | null; helper_dayof_confirmed_at?: string | null; helper_on_the_way_at?: string | null; helper_arrived_at?: string | null; helper_completed_at?: string | null },
  tracking: TrackingData | null | undefined,
): HelperFaceStep | null {
  // A revision or a dispute owns completion (the tracker hides its Done then): keep "Manage job".
  if (job.status === "revision_requested" || job.status === "disputed") return null;
  if (!job.helper_dayof_confirmed_at || job.helper_completed_at) return null;
  if (!job.helper_on_the_way_at) return { jobId: job.id, key: "on_the_way", label: "I'm on my way" };
  if (!job.helper_arrived_at) return { jobId: job.id, key: "arrived", label: "I've arrived" };
  if (tracking?.status !== "working") return { jobId: job.id, key: "working", label: "Start working" };
  return { jobId: job.id, key: "done", label: "Mark done" };
}

/**
 * The ONE button on the Helpr's Working card face (board 21; lead 2026-10-20).
 *
 *  - A direct offer: none here. OfferedActions (Accept / Decline) already draws
 *    on the closed card and is that card's statement (owner, 2026-10-05).
 *  - Not picked / cancelled (the minimal card): none. Nothing is left to do.
 *  - A finished job this Helpr can still review: "Leave a review", the same
 *    handler as the card's own Leave a Review chip.
 *  - A live job with a next tracker step (helperFaceNextStep): that step, as the one
 *    filled button. It opens the card and asks the tracker to press the same step
 *    (helperStepRequest.ts), so the tracker's gates and Done's confirmation still apply.
 *  - Everything else: "Manage job", which opens the card's live tracker and
 *    its step row (On my way, photos, Start working, Mark done, More) in place.
 */
export function helperFaceAction(s: {
  isMinimalCard: boolean;
  isOffered: boolean;
  owesReview: boolean;
  review: () => void;
  manage: () => void;
  /** Opens the card (never closes it), for a direct step. */
  open?: () => void;
  step?: HelperFaceStep | null;
}): MineFaceAction | null {
  if (s.isMinimalCard || s.isOffered) return null;
  if (s.owesReview)
    return { label: "Leave a review", onClick: s.review, tone: "primary" };
  const step = s.step;
  if (step) return { label: step.label, onClick: () => { requestHelperStep(step.jobId, step.key); (s.open ?? s.manage)(); }, tone: "primary" };
  return { label: "Manage job", onClick: s.manage, tone: "secondary" };
}
