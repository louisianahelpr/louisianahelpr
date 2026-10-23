import type { MineFaceAction } from "@/components/job-card/MineJobFace";
import type { TrackingData } from "@/components/JobTracking";
import { requestHelperStep } from "@/components/job-card/helperStepRequest";
import { requestPhotoCapture } from "@/components/job-card/photoCaptureRequest";
import type { HelperWait } from "@/components/job-card/jobStatusLine";

/** The card lines that say work has started (helperProgress' workUnderway): the next tap is Mark done. */
const WORK_UNDERWAY: ReadonlySet<string> = new Set<HelperWait>(["working", "after_photo", "overdue_unfinished", "overdue_after_photo"]);

/** The tracker step the face can take directly, with the face's sentence-case label. */
type HelperFaceStep = { jobId: string; key: "on_the_way" | "arrived" | "working" | "done" | "before_photo" | "after_photo"; label: string };

/**
 * THE OWED PHOTO IS THE FACE'S BUTTON (owner, 2026-10-23: "like before and after photos were required on the last
 * tracker we need to keep that also"). The before photo gates Start working (tracker_requires_before_photo) and the
 * after photo gates Done (hasRequiredProof): while the card's line says "Take the before/after photo", the button
 * says it too and opens the card's own capture dialog, instead of offering Start working or Mark done, which the
 * gates would refuse. Guard: src/test/trackerKeepsThePhotos.test.tsx.
 */
const PHOTO_WAITS: Readonly<Record<string, "before" | "after">> = {
  before_photo: "before",
  overdue_before_photo: "before",
  after_photo: "after",
  overdue_after_photo: "after",
};

/**
 * The Helpr's next tracker step, read from the job's own stamps (boards 62 and 64). Mirrors
 * the tracker's order (STATUSES in JobTracking) and its one name-keyed gate: On my way needs
 * the Helpr's own day-before confirm (helper_dayof_confirmed_at, Q1570). Before that, and
 * once Done is stamped, there is no direct step and the face keeps "Manage job". If the
 * tracker still disagrees, its own gates win: the request is dropped and the card just opens.
 *
 * `wait` is the card's own status-line id (helperCardLine): while it says Start working is LOCKED on the
 * arrival rule ("Waiting on them to confirm you arrived"), the face offers no step, so the button, the
 * sentence and the 8-step bar all say it is the other person's move (lead review 2026-10-22).
 */
export function helperFaceNextStep(
  job: { id: string; status?: string | null; helper_dayof_confirmed_at?: string | null; helper_on_the_way_at?: string | null; helper_arrived_at?: string | null; helper_completed_at?: string | null },
  tracking: TrackingData | null | undefined,
  wait?: HelperWait | (string & {}),
): HelperFaceStep | null {
  // A revision or a dispute owns completion (the tracker hides its Done then): keep "Manage job".
  if (job.status === "revision_requested" || job.status === "disputed") return null;
  if (wait === "arrival_unconfirmed" || wait === "overdue_arrival_unconfirmed") return null;
  if (!job.helper_dayof_confirmed_at || job.helper_completed_at) return null;
  if (!job.helper_on_the_way_at) return { jobId: job.id, key: "on_the_way", label: "I'm on my way" };
  if (!job.helper_arrived_at) return { jobId: job.id, key: "arrived", label: "I've arrived" };
  const photo = wait ? PHOTO_WAITS[wait] : undefined;
  if (photo === "before") return { jobId: job.id, key: "before_photo", label: "Take the before photo" };
  if (photo === "after") return { jobId: job.id, key: "after_photo", label: "Take the after photo" };
  // Started or not: the card's own line already decided it (helperCardLine reads helperProgress, the tracker's
  // derivation), so the button never says "Start working" under "Finish and mark it done" (card shots,
  // 2026-10-23). Without the line, the tracking row alone, as before.
  const started = wait ? WORK_UNDERWAY.has(wait) : tracking?.status === "working";
  if (!started) return { jobId: job.id, key: "working", label: "Start working" };
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
 *  - Applied, waiting on the poster: "View application" (audit #48), which opens the application in place.
 *  - Everything else: "Manage job", which opens the card's live tracker and
 *    its step row (On my way, photos, Start working, Mark done, More) in place.
 */
export function helperFaceAction(s: {
  isMinimalCard: boolean;
  isOffered: boolean;
  /** Applied and waiting (audit #48): the face says what the card holds, the application. */
  isPending?: boolean;
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
  if (s.isPending) return { label: "View application", onClick: s.manage, tone: "secondary" };
  const step = s.step;
  if (step) {
    const ask = () => (step.key === "before_photo" ? requestPhotoCapture(step.jobId, "before") : step.key === "after_photo" ? requestPhotoCapture(step.jobId, "after") : requestHelperStep(step.jobId, step.key));
    return { label: step.label, onClick: () => { ask(); (s.open ?? s.manage)(); }, tone: "primary", step: step.key };
  }
  return { label: "Manage job", onClick: s.manage, tone: "secondary" };
}
