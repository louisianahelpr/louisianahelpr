import { helperStatusLine } from "@/components/job-card/jobStatusLine";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import type { MineFaceAction } from "@/components/job-card/MineJobFace";
import type { TrackingData } from "@/components/JobTracking";
import { helperProgress } from "@/pages/jobs/appliedJobCard/steps/helperProgress";
import { helperFaceAction, helperFaceNextStep } from "@/pages/jobs/appliedJobCard/helperFaceAction";
import type { JobPageRow } from "./useJobPage";

/**
 * The hired Helpr's job page button (audit 2026-10-28 F26: the page had no next action, only "Open in working").
 * It is the Working card's own face button, from the same functions (helperStatusLine with the tracking row's
 * progress, helperFaceNextStep, helperFaceAction), so the page and the card can never offer different steps:
 * "Confirm you'll be at the job", "I'm on my way", "Take the before photo", "Mark job complete", or, while it is the
 * poster's move, "Message <them>". A step opens the job's Working card and asks its tracker to take it there
 * (helperStepRequest / photoCaptureRequest / faceActionRequest), so every gate (GPS, photos, the done floor,
 * Done's confirmation) still decides.
 */
export function hiredHelprFace(
  job: JobPageRow,
  o: { userId: string; posterFirst: string | null; trackingStatus: string | null; doneFloorMinutes?: number; open: () => void; message: () => void },
): MineFaceAction | null {
  const row = job as unknown as Job;
  const workUnderway = helperProgress(row, o.trackingStatus).workUnderway;
  const line = helperStatusLine(
    { id: `page-${job.id}`, job: row, job_id: job.id, helper_id: o.userId, status: "accepted", closed_reason: null, posterName: o.posterFirst } as unknown as AppliedApp,
    false,
    { workUnderway },
  );
  const tracking = o.trackingStatus ? ({ status: o.trackingStatus } as TrackingData) : null;
  // A crew's steps are per member, on the roster (AppliedJobCard: no face step for a group job).
  const step = job.is_group_job ? null : helperFaceNextStep({ ...row, id: job.id }, tracking, line.id);
  const face = helperFaceAction({
    isMinimalCard: false,
    isOffered: false,
    owesReview: false,
    review: o.open,
    manage: o.open,
    open: o.open,
    step,
    doneFloorMinutes: o.doneFloorMinutes,
    wait: line.id,
    jobId: job.id,
    message: job.customer_id && !job.is_group_job ? { name: o.posterFirst || "them", onClick: o.message } : undefined,
  });
  // JOBS-27 (Jobs audit 10-30, h6-crew): a crew member's page fell through to the generic "Manage job". Their own
  // steps (on the way, arrived, photos, done) are on the crew roster in the Working card, so the button says that.
  if (job.is_group_job && face && !face.step && face.label === "Manage job") return { ...face, label: "See your crew steps" };
  return face;
}
