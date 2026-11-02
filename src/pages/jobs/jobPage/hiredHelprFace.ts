import { helperStatusLine } from "@/components/job-card/jobStatusLine";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import type { MineFaceAction } from "@/components/job-card/MineJobFace";
import type { TrackingData } from "@/components/JobTracking";
import { helperProgress } from "@/pages/jobs/appliedJobCard/steps/helperProgress";
import { helperFaceAction, helperFaceNextStep } from "@/pages/jobs/appliedJobCard/helperFaceAction";
import type { JobPageRow } from "./useJobPage";
import type { CrewSlot } from "@/lib/crewLifecycle";
import { crewMemberFace } from "./crewMemberFace";
import { workIsBackWithHelper } from "@/components/job-card/activityFilters";

/** A job in one of these has no step left for its Helpr (a no-show report and an expired listing are 'cancelled'). */
const ENDED_JOB_STATUSES = new Set(["cancelled", "expired"]);
/** An application in one of these is off the job, whatever the job row still says. */
const CLOSED_APPLICATION_STATUSES = new Set(["rejected", "withdrawn", "cancelled", "closed"]);

/**
 * The hired Helpr's job page button (audit 2026-10-28 F26: the page had no next action, only "Open in working").
 * It is the Working card's own face button, from the same functions (helperStatusLine with the tracking row's
 * progress, helperFaceNextStep, helperFaceAction), so the page and the card can never offer different steps:
 * "Confirm you'll be at the job", "I'm on my way", "Take the before photo", "Mark it done", or, while it is the
 * poster's move, "Message <them>". A step opens the job's Working card and asks its tracker to take it there
 * (helperStepRequest / photoCaptureRequest / faceActionRequest), so every gate (GPS, photos, the done floor,
 * Done's confirmation) still decides.
 */
export function hiredHelprFace(
  job: JobPageRow,
  o: {
    userId: string; posterFirst: string | null; trackingStatus: string | null; doneFloorMinutes?: number; open: () => void; message: () => void;
    /** JA-22: a finished, paid job this Helpr has not reviewed (the Working card's own owesReview), and how to review. */
    owesReview?: boolean; review?: () => void;
    /** A3-33: a crew member's own roster row (useCrewSlot): their step is the page's button. */
    crewSlot?: CrewSlot | null;
    /** This Helpr's own application row (useJobPage myApplication), or null/undefined when not read yet. */
    application?: { status: string; closed_reason: string | null } | null;
    /** Q2668: a job sent back for a fix, the fix still owed: "Mark it done" marks the fix done (usePageMarkFixDone). */
    markFixDone?: () => void;
    /** The mark is on its way: the button is greyed. */
    markingFix?: boolean;
  },
): MineFaceAction | null {
  const row = job as unknown as Job;
  // Audit 1102b row 1 (Q2587): a job that ended (cancelled, which a no-show report and an expired listing also are)
  // or an application that closed (no_show, not picked, withdrawn) has no tracker step left. The line was built
  // with the application hard-coded accepted, so a job cancelled on its day after the Helpr confirmed offered a
  // primary "I'm on my way" under "This job was cancelled".
  const app = o.application ?? null;
  const ended = ENDED_JOB_STATUSES.has(job.status ?? "") || !!app?.closed_reason || (!!app && CLOSED_APPLICATION_STATUSES.has(app.status));
  // Q2668 (audit 1102e row 1): the step line says "Fix it and mark it done by <revision_deadline>", so the page's one
  // primary is that step, never only Message / Open in Jobs. Once marked (revision_completed_at), the poster checks it.
  const fixOwed = !ended && !job.is_group_job && job.status === "revision_requested" && workIsBackWithHelper(job);
  if (fixOwed && o.markFixDone) return { label: "Mark it done", onClick: o.markFixDone, tone: "primary", disabled: !!o.markingFix };
  const workUnderway = helperProgress(row, o.trackingStatus).workUnderway;
  const line = helperStatusLine(
    { id: `page-${job.id}`, job: row, job_id: job.id, helper_id: o.userId, status: app?.status ?? "accepted", closed_reason: app?.closed_reason ?? null, posterName: o.posterFirst } as unknown as AppliedApp,
    false,
    { workUnderway },
  );
  const tracking = o.trackingStatus ? ({ status: o.trackingStatus } as TrackingData) : null;
  // A crew's steps are per member, on the roster (AppliedJobCard: no face step for a group job).
  const step = job.is_group_job || ended ? null : helperFaceNextStep({ ...row, id: job.id }, tracking, line.id);
  const face = helperFaceAction({
    isMinimalCard: false,
    isOffered: false,
    owesReview: !!o.owesReview && !job.is_group_job,
    review: o.review ?? o.open,
    manage: o.open,
    open: o.open,
    step,
    doneFloorMinutes: o.doneFloorMinutes,
    wait: line.id,
    jobId: job.id,
    message: job.customer_id && !job.is_group_job ? { name: o.posterFirst || "them", onClick: o.message } : undefined,
    posterId: job.customer_id ?? null,
  });
  // JOBS-27 (Jobs audit 10-30, h6-crew): a crew member's page fell through to the generic "Manage job". Their own
  // steps (on the way, arrived, photos, done) are on the crew roster in the Working card, so the button says that.
  // A3-33 (audit 11-01): when the member has a step of their own (on the way, arrived, mark my part done), that step
  // is the button; only a wait keeps "See your crew steps".
  if (job.is_group_job && face && !face.step && face.label === "Manage job") {
    return crewMemberFace(job.id, o.crewSlot, job, o.open) ?? { ...face, label: "See your crew steps" };
  }
  return face;
}
