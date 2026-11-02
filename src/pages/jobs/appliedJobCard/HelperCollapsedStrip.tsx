import { JobStatusStrip } from "@/components/job-card/JobStatusStrip";
import { collapsedClocks } from "@/components/job-card/collapsedClocks";
import { CollapsedStartClock } from "@/components/job-card/CollapsedStartClock";
import { helperStatusLine, withDisputeSettling } from "@/components/job-card/jobStatusLine";
import type { AppliedApp, Job } from "../../../components/job-card/activityConstants";
import { CrewStatusStrip } from "./CrewMemberSection";
import type { TrackingData } from "@/components/JobTracking";
import { helperProgress } from "./steps/helperProgress";
import { CountdownRows } from "@/components/job-card/CountdownRows";
import { jobNextStep } from "@/components/tracker/jobNextStep";
import type { JobProgressState } from "@/components/tracker/jobProgressState";
import { NextStep } from "@/components/ui/NextStep";

/**
 * WHAT THIS CARD IS WAITING ON — one sentence, at the collapsed Jobs card's
 * bottom edge (owner, 2026-09-19: "should show what we are waiting on...
 * remove the dots", and on the look: "similar to how dispute open displays").
 * Extracted from AppliedJobCard (component-size ratchet); the card mounts it
 * on `!isMinimalCard && !isExpanded`, exactly where the strip used to sit.
 *
 * THE SAME STRIP THE POSTER'S CARD WEARS, written from the HELPR's point of
 * view — one job, two readers, two sentences. "Approve & release pay" over
 * there is "With them for approval" here.
 *
 * IT ABSORBS THE COLLAPSED DISPUTE BADGE. That badge was the one thing a
 * collapsed disputed card said, and it survives verbatim as `tone: "alarm"` —
 * same words ("Dispute open" / "Admin reviewing" ... "Payment on hold"), same
 * sienna, same `data-dispute-open-badge` hook, so `helperDisputeCopy` still
 * pins that a Helpr scrolling My Jobs can see a 72-hour clock on their pay.
 * The PANEL stays behind the expand, which was already the ruling: controls
 * in, signal out.
 *
 * PURE RENDER — no query, no realtime channel, no tracker. It reads columns
 * the card already holds, and the tracking row the list already fetched
 * (`tracking`, the same `initialTracking` the expanded card's tracker gets):
 * whether work has started lives there, and without it the line said "Finish
 * and mark it done" over an expanded "Start working" (lane B, 2026-10-12). That is also what the compact rail bought and this
 * keeps: the three expanded sections once mounted a full JobTracking on every
 * collapsed card, one subscription per row of the list. (A crew member's
 * strip reads their roster row through CrewMemberSection's query key, so it
 * costs no extra request either.)
 *
 * NOT ON A MINIMAL CARD. A not-selected or cancelled application already
 * leads its body with exactly this statement, in prose that says WHO cancelled
 * (`describeCancellation`) — which is more than a strip can carry. Two of them
 * would be the duplication this card keeps having removed. `deriveHelperWait`
 * still answers for those states (`not_selected` / `cancelled` / `job_gone`);
 * the card chooses not to draw a second copy.
 */
export function HelperCollapsedStrip({
  app,
  job,
  userId,
  isCrewLive,
  unsettledDisputeJobIds,
  showStartClock = false,
  hideStatus = false,
  reviewed = false,
  tracking,
  variant = "band",
  progress = null,
  otherFirst = null,
}: {
  app: AppliedApp;
  job: Job;
  userId: string;
  isCrewLive: boolean;
  unsettledDisputeJobIds: Parameters<typeof withDisputeSettling>[1];
  /** A confirmed booking's start clock, on the collapsed card too (owner, 2026-10-05). */
  showStartClock?: boolean;
  /** No strip on an offer: OfferedActions is its statement and carries its one clock (owner, 2026-10-05). */
  hideStatus?: boolean;
  /** This Helpr has reviewed the finished job: said on the ONE bottom line
   *  ("Done · payout pending · Reviewed"), never as a second band above it
   *  (owner, 2026-10-08: "There should only be one section at the bottom"). */
  reviewed?: boolean;
  /** The list's latest `job_tracking` row for this job (AppliedJobsTab `latestTracking`). */
  tracking?: TrackingData | null;
  /** `line` on the mine-card face (board 21). */
  variant?: "band" | "line";
  /** The face's tracker state (jobProgress, the hired Helpr's only). With it, the face line is the shared next step
   *  (A3-16, owner 11-01 "next step everywhere"): jobNextStep, the words the job page prints. */
  progress?: JobProgressState | null;
  /** The poster's first name, for "Waiting on Dana to approve". */
  otherFirst?: string | null;
}) {
  // A crew member's strip has no clock rows of its own yet, so it keeps the
  // start pill above it. Everyone else: every time at the bottom, under the
  // status line, soonest first, one format (owner, 2026-10-07, Q1399).
  const clock = showStartClock && (isCrewLive || hideStatus) ? <CollapsedStartClock job={job} /> : null;
  if (hideStatus) return clock;
  const line = helperCardLine(app, job, unsettledDisputeJobIds, tracking);
  const clocks = showStartClock ? collapsedClocks(job, false) : null;
  // A3-16: on the face, on the path, the line is the job page's next step ("Next: confirm you'll be at the job · by Mon
  // 8:00 AM", "Waiting on Dana to approve ..."). A crew member's roster strip, a dispute (alarm), a job off the path
  // and a line with its own LIVE deadline clock (DeadlineCountdown: the confirm window, owner 2026-10-23 card
  // critique item 7) keep their own strip: the next-step line has no live clock.
  const step = variant === "line" && !isCrewLive && progress && progress.stage !== null && progress.stage > 0 && line.tone !== "alarm" && !line.deadline
    ? jobNextStep(progress, { side: "helpr", otherFirst })
    : null;
  if (step) {
    return (
      <>
        {clock}
        <span className="block" data-job-status-strip={line.id} data-job-status-variant="line" data-job-status-tone={line.tone} data-card-next-step="">
          <NextStep value={step} className="!text-ds-13" />
          {clocks && clocks.length > 0 && <CountdownRows clocks={clocks} variant="bare" />}
        </span>
      </>
    );
  }
  const strip = isCrewLive
    ? <CrewStatusStrip app={app} job={job} userId={userId} unsettledDisputeJobIds={unsettledDisputeJobIds} />
    : <JobStatusStrip line={withReviewed(helperCardLine(app, job, unsettledDisputeJobIds, tracking), reviewed)} extraClocks={showStartClock ? collapsedClocks(job, false) : null} variant={variant} />;
  return <>{clock}{strip}</>;
}

/**
 * THE Helpr card's status line, computed ONCE per card: the strip prints it, the face button's step is vetoed
 * by its id (helperFaceNextStep) and the 8-step bar reads it (jobProgress `card`), so the three never disagree
 * (lead review 2026-10-22). Guard: src/test/trackerAgreesWithCard.test.ts.
 */
export function helperCardLine(
  app: AppliedApp,
  job: Job,
  unsettledDisputeJobIds: Parameters<typeof withDisputeSettling>[1],
  tracking: TrackingData | null | undefined,
): ReturnType<typeof helperStatusLine> {
  return helperStatusLine(app.job ? { ...app, job: withDisputeSettling(app.job, unsettledDisputeJobIds) } : app, false, { workUnderway: helperProgress(job, tracking?.status).workUnderway });
}

/** "Done · payout pending" + " · Reviewed" on a finished job this Helpr reviewed. */
export function withReviewed(line: ReturnType<typeof helperStatusLine>, reviewed: boolean): ReturnType<typeof helperStatusLine> {
  if (!reviewed || (line.id !== "done_paid" && line.id !== "done_payout_pending")) return line;
  return { ...line, detail: `${line.detail} · Reviewed` };
}
